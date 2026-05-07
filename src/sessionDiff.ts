// =============================================================================
// Session diff engine — Phase 1 of v1.0 launch wave (feat/launch-replay-timeline).
//
// Parses a session JSONL into a flat list of replay events, reconstructs the
// state of any file at any step (for files Claude Edit/Write/MultiEdit-touched),
// and emits unified diffs between two scrub points.
//
// Caching strategy: parses are cached by (sessionFile + size + mtimeMs). The
// cache is process-local; we never re-read the file on each render call. The
// JSONL format is append-only, so when mtime advances we re-parse from scratch
// (a future optimization could append new events instead of full re-parse).
//
// JSONL parser is defensive: tolerates a truncated last line (Claude Code may
// be mid-write) and silently drops unparseable lines (no exceptions bubble).
// =============================================================================

import * as fs from 'fs';
import { logger } from './logger';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type EventKind = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'meta';

/**
 * A single normalized step in the replay timeline. One JSONL line can produce
 * multiple events when an assistant message contains several tool_use blocks —
 * each tool_use is its own event so the scrubber lands on individual actions.
 */
export interface ReplayEvent {
  /** 0-based, monotonically increasing across the whole session. */
  index: number;
  /** Underlying JSONL line index (0-based). Multiple events may share this. */
  lineIndex: number;
  kind: EventKind;
  timestamp: string | undefined;
  /** Tool name when kind === 'tool_use'. */
  toolName: string | undefined;
  /** File path argument for file-mutating tools. */
  filePath: string | undefined;
  /** Raw input args for file-mutating tools (used for reconstruction). */
  toolInput: ToolInput | undefined;
  /** Cumulative usage seen at this point (last-write-wins per usage block). */
  usage: ReplayUsage | undefined;
  /** Last assistant model seen — used to attribute cost downstream. */
  model: string | undefined;
  /** Short human-readable summary for the timeline list. */
  summary: string;
}

export interface ReplayUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ToolInput {
  filePath: string | undefined;
  /** Edit args. */
  oldString?: string;
  newString?: string;
  /** Write args (full content replacement). */
  content?: string;
  /** MultiEdit args. */
  edits?: { oldString: string; newString: string }[];
  /** Bash args (recorded for cost projection but not used in diff). */
  command?: string;
  /** Untyped tail — preserved so callers can read other fields if needed. */
  raw?: Record<string, unknown>;
}

export interface FileDiff {
  filePath: string;
  /** Cumulative state at indexA. `undefined` = file did not exist (or only-read). */
  before: string | undefined;
  /** Cumulative state at indexB. */
  after: string | undefined;
  /** Unified diff between before and after. Empty when identical. */
  unified: string;
  /** Lines added (+) at this step pair. */
  addedLines: number;
  /** Lines removed (-) at this step pair. */
  removedLines: number;
}

export interface ReplayDigest {
  /** Stable identifier (path is fine — not exposed to webview). */
  sessionFile: string;
  /** Session ID extracted from JSONL, when present. */
  sessionId: string | undefined;
  totalEvents: number;
  totalLines: number;
  /** Unique files touched by file-mutating tools. */
  touchedFiles: string[];
  /** Cumulative tokens after the last event. */
  totalTokens: number;
  /** First and last event timestamps (when present). */
  startedAt: string | undefined;
  endedAt: string | undefined;
}

// -----------------------------------------------------------------------------
// Public: tolerant JSONL parse
// -----------------------------------------------------------------------------

interface RawLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    content?: unknown;
  };
}

interface RawBlock {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Tolerant JSONL parser. Drops blank lines, drops the final line if it's a
 * partial-write tail (no trailing newline AND fails to parse), and silently
 * discards any other unparseable line so a single corrupt entry doesn't
 * sink the whole replay.
 */
export function parseSessionEvents(raw: string): ReplayEvent[] {
  if (!raw) return [];
  const events: ReplayEvent[] = [];
  // Preserve whether the file ends with a newline so we can detect truncated
  // tails. If the last line lacks a newline AND fails to parse, treat it as a
  // partial write rather than a hard error.
  const endsWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  // If file ends with newline, the final element is an empty string we drop.
  const lastIdx = endsWithNewline ? lines.length - 1 : lines.length;
  let eventIndex = 0;
  for (let i = 0; i < lastIdx; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let parsed: RawLine | undefined;
    try {
      parsed = JSON.parse(line) as RawLine;
    } catch {
      // Last line, no trailing newline → partial-write tail. Silently skip.
      if (i === lines.length - 1 && !endsWithNewline) continue;
      // Otherwise: skip but don't throw. JSONL is append-only; one bad line
      // shouldn't block replay of the rest.
      continue;
    }
    const line0 = parsed;
    const usage = extractUsage(line0);
    const model = line0.message?.model;
    const ts = line0.timestamp;
    const content = line0.message?.content;

    // 1) Top-level user/assistant marker event (one per JSONL line).
    if (line0.type === 'user' || line0.type === 'assistant') {
      events.push({
        index: eventIndex++,
        lineIndex: i,
        kind: line0.type,
        timestamp: ts,
        toolName: undefined,
        filePath: undefined,
        toolInput: undefined,
        usage,
        model,
        summary: line0.type === 'user' ? 'user message' : 'assistant message',
      });
    }

    // 2) Per-tool-use sub-events (one per tool_use block in content[]).
    if (Array.isArray(content)) {
      for (const block of content as RawBlock[]) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const toolInput = readToolInput(block.input);
          events.push({
            index: eventIndex++,
            lineIndex: i,
            kind: 'tool_use',
            timestamp: ts,
            toolName: block.name,
            filePath: toolInput.filePath,
            toolInput,
            usage,
            model,
            summary: toolInput.filePath
              ? `${block.name}: ${toolInput.filePath}`
              : block.name,
          });
        } else if (block.type === 'tool_result') {
          events.push({
            index: eventIndex++,
            lineIndex: i,
            kind: 'tool_result',
            timestamp: ts,
            toolName: undefined,
            filePath: undefined,
            toolInput: undefined,
            usage,
            model,
            summary: 'tool result',
          });
        }
      }
    }
  }
  return events;
}

function extractUsage(line: RawLine): ReplayUsage | undefined {
  const u = line.message?.usage;
  if (!u) return undefined;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function readToolInput(input: Record<string, unknown> | undefined): ToolInput {
  const fp = typeof input?.file_path === 'string'
    ? input.file_path
    : typeof input?.path === 'string'
      ? input.path
      : undefined;
  const out: ToolInput = { filePath: fp, raw: input };
  if (input && typeof input === 'object') {
    if (typeof input.old_string === 'string') out.oldString = input.old_string;
    if (typeof input.new_string === 'string') out.newString = input.new_string;
    if (typeof input.content === 'string') out.content = input.content;
    if (typeof input.command === 'string') out.command = input.command;
    if (Array.isArray(input.edits)) {
      const edits: { oldString: string; newString: string }[] = [];
      for (const e of input.edits) {
        if (e && typeof e === 'object') {
          const eo = e as Record<string, unknown>;
          if (typeof eo.old_string === 'string' && typeof eo.new_string === 'string') {
            edits.push({ oldString: eo.old_string, newString: eo.new_string });
          }
        }
      }
      if (edits.length > 0) out.edits = edits;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// File-state reconstruction
// -----------------------------------------------------------------------------

/**
 * Reconstruct the cumulative state of `filePath` after applying every event in
 * `events` whose index <= upToIndex. Returns undefined when no Write/Edit/
 * MultiEdit ever touched the file (read-only files cannot be reconstructed
 * from the JSONL).
 *
 * For Edit/MultiEdit we replay against the most recent prior state and apply
 * the (oldString → newString) substitution. If oldString is missing from the
 * current buffer (e.g. the file was edited externally), the operation is
 * skipped — we don't fabricate state we can't justify.
 */
export function reconstructFileAt(
  events: readonly ReplayEvent[],
  filePath: string,
  upToIndex: number,
): string | undefined {
  let buf: string | undefined;
  for (const ev of events) {
    if (ev.index > upToIndex) break;
    if (ev.kind !== 'tool_use' || ev.filePath !== filePath || !ev.toolInput) continue;
    const tool = ev.toolName;
    const input = ev.toolInput;
    if (tool === 'Write' && typeof input.content === 'string') {
      buf = input.content;
      continue;
    }
    if (tool === 'Edit' && typeof input.oldString === 'string' && typeof input.newString === 'string') {
      if (buf === undefined) {
        // First-touch edit. We don't have the original on-disk content
        // captured, so we anchor at the new_string only — readers can still
        // see "what was inserted at this step."
        buf = input.newString;
      } else if (buf.includes(input.oldString)) {
        buf = buf.replace(input.oldString, input.newString);
      }
      continue;
    }
    if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
      if (buf === undefined) {
        // No baseline — concatenate the new_strings as a best-effort sketch.
        buf = input.edits.map((e) => e.newString).join('\n');
      } else {
        let next = buf;
        for (const e of input.edits) {
          if (next.includes(e.oldString)) {
            next = next.replace(e.oldString, e.newString);
          }
        }
        buf = next;
      }
      continue;
    }
  }
  return buf;
}

// -----------------------------------------------------------------------------
// Diff computation
// -----------------------------------------------------------------------------

/**
 * Produce a per-file diff between two scrub indices. Returns an entry for
 * every file touched by Edit/Write/MultiEdit between the two indices
 * (inclusive of indexB, exclusive of any change at indexA itself — we diff
 * the "after-A" state against the "after-B" state).
 *
 * A and B may be in either order; the output is normalized so `before`
 * matches the lower index.
 */
export function diffBetween(
  events: readonly ReplayEvent[],
  indexA: number,
  indexB: number,
): FileDiff[] {
  const lo = Math.min(indexA, indexB);
  const hi = Math.max(indexA, indexB);
  if (events.length === 0 || lo === hi) return [];
  const touched = new Set<string>();
  for (const ev of events) {
    if (ev.index <= lo || ev.index > hi) continue;
    if (ev.kind !== 'tool_use' || !ev.filePath) continue;
    if (!ev.toolName) continue;
    if (!FILE_MUTATING_TOOLS.has(ev.toolName)) continue;
    touched.add(ev.filePath);
  }
  const out: FileDiff[] = [];
  for (const filePath of touched) {
    const before = reconstructFileAt(events, filePath, lo);
    const after = reconstructFileAt(events, filePath, hi);
    const unified = unifiedDiff(filePath, before, after);
    const counts = countDiffLines(unified);
    out.push({
      filePath,
      before,
      after,
      unified,
      addedLines: counts.added,
      removedLines: counts.removed,
    });
  }
  // Stable sort by file path for predictable test output.
  out.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return out;
}

const FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

// -----------------------------------------------------------------------------
// Tiny unified-diff implementation (Myers, line-level)
// We avoid pulling a npm dep; outputs are unified-diff-like (--- / +++ /
// @@ hunks) and consumed by our own webview, not by `patch`.
// -----------------------------------------------------------------------------

function unifiedDiff(filePath: string, a: string | undefined, b: string | undefined): string {
  if (a === b) return '';
  const aLines = (a ?? '').split('\n');
  const bLines = (b ?? '').split('\n');
  const ops = lcsDiff(aLines, bLines);
  if (ops.length === 0) return '';
  const header = `--- ${filePath}\n+++ ${filePath}\n`;
  // Group consecutive ops into a single hunk for readability. Cockpit doesn't
  // need exact line numbers (we render in our own viewer), so emit a single
  // synthetic @@ hunk anchored at the first divergence.
  let firstA = 0;
  let firstB = 0;
  for (const op of ops) {
    if (op.kind === 'eq') {
      firstA += 1;
      firstB += 1;
    } else {
      break;
    }
  }
  const hunk = `@@ -${firstA + 1} +${firstB + 1} @@\n`;
  const body = ops
    .map((op) => {
      if (op.kind === 'eq') return ` ${op.line}`;
      if (op.kind === 'del') return `-${op.line}`;
      return `+${op.line}`;
    })
    .join('\n');
  return header + hunk + body + '\n';
}

interface DiffOp {
  kind: 'eq' | 'add' | 'del';
  line: string;
}

/**
 * Classic LCS line-level diff. O(n*m) but our inputs are small (per-file
 * cumulative state); we cap at 5,000 lines per side to bound worst case.
 */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const MAX = 5000;
  const aa = a.length > MAX ? a.slice(0, MAX) : a;
  const bb = b.length > MAX ? b.slice(0, MAX) : b;
  const n = aa.length;
  const m = bb.length;
  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aa[i - 1] === bb[j - 1]) {
        dp[i * w + j] = dp[(i - 1) * w + (j - 1)] + 1;
      } else {
        const top = dp[(i - 1) * w + j];
        const left = dp[i * w + (j - 1)];
        dp[i * w + j] = top >= left ? top : left;
      }
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) {
      ops.push({ kind: 'eq', line: aa[i - 1] });
      i--;
      j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      ops.push({ kind: 'del', line: aa[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'add', line: bb[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ kind: 'del', line: aa[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ kind: 'add', line: bb[j - 1] });
    j--;
  }
  ops.reverse();
  return ops;
}

function countDiffLines(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

// -----------------------------------------------------------------------------
// Cached parse — keyed by (file, mtime, size) so we never re-read on render
// when the JSONL hasn't changed.
// -----------------------------------------------------------------------------

interface CacheEntry {
  events: ReplayEvent[];
  digest: ReplayDigest;
  mtimeMs: number;
  sizeBytes: number;
  parsedAtMs: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 32;

/**
 * Read + parse the session file, returning a cached parse when fresh. Returns
 * undefined when the file does not exist or cannot be read.
 */
export function getCachedSession(file: string): { events: ReplayEvent[]; digest: ReplayDigest } | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return undefined;
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.size) {
    return { events: cached.events, digest: cached.digest };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    logger.warn(`sessionDiff: read failed for ${file}: ${String(err)}`);
    return undefined;
  }
  const events = parseSessionEvents(raw);
  const digest = buildDigest(file, events, raw);
  // Evict oldest if over capacity. Map iteration order is insertion order, so
  // the first key is the oldest.
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === 'string') cache.delete(firstKey);
  }
  cache.set(file, {
    events,
    digest,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
    parsedAtMs: Date.now(),
  });
  return { events, digest };
}

function buildDigest(file: string, events: ReplayEvent[], raw: string): ReplayDigest {
  const touched = new Set<string>();
  let totalTokens = 0;
  let lastUsage: ReplayUsage | undefined;
  let sessionId: string | undefined;
  for (const ev of events) {
    if (ev.kind === 'tool_use' && ev.filePath && ev.toolName && FILE_MUTATING_TOOLS.has(ev.toolName)) {
      touched.add(ev.filePath);
    }
    if (ev.usage) lastUsage = ev.usage;
  }
  if (lastUsage) {
    totalTokens =
      lastUsage.inputTokens +
      lastUsage.outputTokens +
      lastUsage.cacheReadTokens +
      lastUsage.cacheCreationTokens;
  }
  // Cheap session-id sniff (first sessionId field in the JSONL).
  const m = /"sessionId"\s*:\s*"([^"]+)"/.exec(raw);
  if (m) sessionId = m[1];

  const startedAt = events.find((e) => e.timestamp)?.timestamp;
  let endedAt: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].timestamp) {
      endedAt = events[i].timestamp;
      break;
    }
  }
  return {
    sessionFile: file,
    sessionId,
    totalEvents: events.length,
    totalLines: raw.split('\n').filter((l) => l.trim()).length,
    touchedFiles: Array.from(touched).sort(),
    totalTokens,
    startedAt,
    endedAt,
  };
}

/**
 * Test-only. Drops the parse cache so unit tests are deterministic.
 */
export function __resetCache(): void {
  cache.clear();
}
