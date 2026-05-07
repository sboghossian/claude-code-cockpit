// =============================================================================
// Replay module — Phase 1 of v1.0 launch wave (feat/launch-replay-timeline).
//
// Owns the host-side replay surface: lightweight digest for the snapshot,
// per-session detailed payloads (lazy-loaded), cost projection for the next N
// events, and "fork from any point" file-copy semantics.
//
// Fork semantics (intentional + documented):
//
//   "Fork" copies the original session JSONL up to (and including) the
//   chosen event's underlying line into a NEW file under
//   ~/.claude/.cockpit/forks/. Claude Code itself does NOT pick this up
//   automatically — the discovered-sessions glob only walks
//   ~/.claude/projects/<encoded-cwd>/. To actually resume from the fork,
//   the user must either (a) `cp` the fork into their project dir under a
//   new uuid, or (b) run `claude --resume <fork-path>` if/when Claude Code
//   gains that flag. Today the fork is therefore an EXPORT — a faithful
//   transcript prefix the user can replay, audit, share, or graft. The UI
//   reports the absolute fork path so the user can do step (a) themselves.
//
// We never mutate the original JSONL. Forks live in a Cockpit-owned dir we
// create on demand.
// =============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import {
  computeCost,
  modelFamilyOf,
  ModelFamily,
} from './claudeData';
import {
  getCachedSession,
  ReplayEvent,
  ReplayDigest,
  reconstructFileAt,
  diffBetween,
  FileDiff,
  __resetCache,
} from './sessionDiff';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/** Carried in CockpitSnapshot — small enough to round-trip through postMessage. */
export interface ReplayIndex {
  /** True when an active session JSONL exists and was successfully parsed. */
  available: boolean;
  /** Total events in the active session (entire JSONL). */
  totalEvents: number;
  /** Files Claude wrote/edited at any point in the session. */
  touchedFiles: string[];
  /** Tail of the timeline so the Now tab can preview where we are. */
  tailEvents: ReplayTimelineEntry[];
  /** Last event index (== totalEvents - 1, or -1 when empty). */
  lastIndex: number;
  /** Session id if available. */
  sessionId: string | undefined;
  /** Tokens accumulated across the session. */
  totalTokens: number;
}

/** Lightweight projection of a ReplayEvent for postMessage transport. */
export interface ReplayTimelineEntry {
  index: number;
  kind: ReplayEvent['kind'];
  timestamp: string | undefined;
  toolName: string | undefined;
  filePath: string | undefined;
  summary: string;
}

export interface ReplayCostProjection {
  spentUsd: number;
  /** Dollars-per-event averaged over the most recent window. */
  perEventUsd: number;
  /** Linear projection over the next `lookahead` events. */
  projectedUsd: number;
  lookahead: number;
  /** Family used for the projection ("opus" / "sonnet" / "haiku" / "unknown"). */
  family: ModelFamily;
  /** True when budget config has a daily cap and the projection would exceed it. */
  willHitDailyCap: boolean;
}

export interface ReplaySessionPayload {
  digest: ReplayDigest;
  events: ReplayTimelineEntry[];
  cost: ReplayCostProjection;
  /** Absolute path to the session JSONL — for "Open in editor" links. */
  sessionFile: string;
}

export interface ForkResult {
  ok: boolean;
  forkPath: string | undefined;
  /** Number of JSONL lines copied into the fork. */
  lineCount: number;
  /** Reason on failure. */
  error: string | undefined;
}

// -----------------------------------------------------------------------------
// Snapshot-time replay index — small, bounded payload only.
// -----------------------------------------------------------------------------

const TAIL_PREVIEW_COUNT = 5;

/**
 * Build a small-payload replay index for the active session. Designed to be
 * cheap enough to call inside snapshot() — heavy lifting (diff reconstruction)
 * stays behind the on-demand handlers.
 */
export function buildReplayIndex(sessionFile: string | undefined): ReplayIndex {
  if (!sessionFile) {
    return EMPTY_INDEX;
  }
  const cached = getCachedSession(sessionFile);
  if (!cached) return EMPTY_INDEX;
  const { events, digest } = cached;
  if (events.length === 0) {
    return {
      available: true,
      totalEvents: 0,
      touchedFiles: digest.touchedFiles,
      tailEvents: [],
      lastIndex: -1,
      sessionId: digest.sessionId,
      totalTokens: digest.totalTokens,
    };
  }
  const tail = events
    .slice(-TAIL_PREVIEW_COUNT)
    .map(toTimelineEntry);
  return {
    available: true,
    totalEvents: events.length,
    touchedFiles: digest.touchedFiles,
    tailEvents: tail,
    lastIndex: events.length - 1,
    sessionId: digest.sessionId,
    totalTokens: digest.totalTokens,
  };
}

const EMPTY_INDEX: ReplayIndex = {
  available: false,
  totalEvents: 0,
  touchedFiles: [],
  tailEvents: [],
  lastIndex: -1,
  sessionId: undefined,
  totalTokens: 0,
};

function toTimelineEntry(ev: ReplayEvent): ReplayTimelineEntry {
  return {
    index: ev.index,
    kind: ev.kind,
    timestamp: ev.timestamp,
    toolName: ev.toolName,
    filePath: ev.filePath,
    summary: ev.summary,
  };
}

// -----------------------------------------------------------------------------
// On-demand session payload — fired when the webview opens the Replay tab.
// -----------------------------------------------------------------------------

/**
 * Hard cap on events we ship to the webview. The plan brief allows opt-in via
 * `claudeCockpit.replay.maxEventsPerSession` — pass that in here. If exceeded,
 * we sample uniformly so the scrubber stays usable on huge sessions.
 */
export function loadReplayPayload(
  sessionFile: string,
  maxEvents: number,
  budgetDailyCapUsd: number,
  spentTodayUsd: number,
): ReplaySessionPayload | undefined {
  const cached = getCachedSession(sessionFile);
  if (!cached) return undefined;
  const { events, digest } = cached;
  const sampled = sampleEvents(events, Math.max(1, maxEvents)).map(toTimelineEntry);
  const cost = projectCost(events, budgetDailyCapUsd, spentTodayUsd);
  return {
    digest,
    events: sampled,
    cost,
    sessionFile,
  };
}

function sampleEvents(events: readonly ReplayEvent[], maxEvents: number): ReplayEvent[] {
  if (events.length <= maxEvents) return events.slice();
  // Uniform sampling — keep first + last, evenly stride between.
  const step = events.length / maxEvents;
  const out: ReplayEvent[] = [];
  for (let i = 0; i < maxEvents; i++) {
    const idx = Math.min(events.length - 1, Math.floor(i * step));
    out.push(events[idx]);
  }
  // Ensure last event is always present so the user sees current head.
  if (out[out.length - 1].index !== events[events.length - 1].index) {
    out[out.length - 1] = events[events.length - 1];
  }
  return out;
}

// -----------------------------------------------------------------------------
// Cost projection (subsumes feature #3 — the brief's "Cost telemetry + budgets").
// -----------------------------------------------------------------------------

const PROJECTION_LOOKAHEAD_EVENTS = 50;

/**
 * Linear extrapolation: average dollar-per-event over the WHOLE session,
 * extrapolated over the next 50 events. Heuristic — explicitly NOT a budget
 * simulator (per the brief). When budgetDailyCapUsd > 0, also flags whether
 * the projection blows past today's cap.
 */
export function projectCost(
  events: readonly ReplayEvent[],
  budgetDailyCapUsd: number,
  spentTodayUsd: number,
): ReplayCostProjection {
  if (events.length === 0) {
    return {
      spentUsd: 0,
      perEventUsd: 0,
      projectedUsd: 0,
      lookahead: PROJECTION_LOOKAHEAD_EVENTS,
      family: 'unknown',
      willHitDailyCap: false,
    };
  }
  // Find the latest cumulative usage block. Anthropic JSONL emits cumulative
  // usage on each assistant turn, so taking the last seen `usage` and pricing
  // it once gives the session total — same approach as readSession in
  // claudeData.ts.
  let last: ReplayEvent['usage'];
  let lastModel: string | undefined;
  for (const ev of events) {
    if (ev.usage) last = ev.usage;
    if (ev.model) lastModel = ev.model;
  }
  if (!last) {
    return {
      spentUsd: 0,
      perEventUsd: 0,
      projectedUsd: 0,
      lookahead: PROJECTION_LOOKAHEAD_EVENTS,
      family: modelFamilyOf(lastModel),
      willHitDailyCap: false,
    };
  }
  const family = modelFamilyOf(lastModel);
  const cost = computeCost({
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    cacheReadTokens: last.cacheReadTokens,
    cacheCreationTokens: last.cacheCreationTokens,
    modelFamily: family,
  });
  const perEvent = events.length > 0 ? cost.totalUsd / events.length : 0;
  const projected = cost.totalUsd + perEvent * PROJECTION_LOOKAHEAD_EVENTS;
  const willHit =
    budgetDailyCapUsd > 0 &&
    spentTodayUsd + perEvent * PROJECTION_LOOKAHEAD_EVENTS >= budgetDailyCapUsd;
  return {
    spentUsd: cost.totalUsd,
    perEventUsd: perEvent,
    projectedUsd: projected,
    lookahead: PROJECTION_LOOKAHEAD_EVENTS,
    family,
    willHitDailyCap: willHit,
  };
}

// -----------------------------------------------------------------------------
// Fork — copy JSONL prefix into the Cockpit-owned forks dir.
// -----------------------------------------------------------------------------

// Computed lazily so tests that override $HOME between requires still see
// the right path. Production callers see ~/.claude/.cockpit/forks/.
function forksDirInternal(): string {
  return path.join(os.homedir(), '.claude', '.cockpit', 'forks');
}

/**
 * Fork a session at `atIndex`. Copies the JSONL up to and including the line
 * containing event `atIndex` into a fresh file under ~/.claude/.cockpit/forks/.
 * Returns the absolute path or an error explanation.
 *
 * NOTE: This does NOT register the fork as an active session. Claude Code's
 * session loader scans ~/.claude/projects/<cwd>/, not our forks dir. The fork
 * is an EXPORT — the user can grep it, share it, or copy it into a project
 * dir manually if they want Claude Code to pick it up.
 */
export function forkSession(sessionFile: string, atIndex: number): ForkResult {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: 'session file not found' };
  }
  const cached = getCachedSession(sessionFile);
  if (!cached) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: 'session unparseable' };
  }
  const { events } = cached;
  if (events.length === 0) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: 'session has no events' };
  }
  const clamped = Math.max(0, Math.min(atIndex, events.length - 1));
  // Walk events to find the underlying JSONL line for the chosen scrub point.
  // Multiple events can share a line (one assistant message → many tool_use
  // sub-events) — copy through the END of that line.
  const targetLineIndex = events[clamped].lineIndex;

  let raw: string;
  try {
    raw = fs.readFileSync(sessionFile, 'utf8');
  } catch (err) {
    return {
      ok: false,
      forkPath: undefined,
      lineCount: 0,
      error: `read failed: ${String(err)}`,
    };
  }
  const lines = raw.split('\n');
  // Trim trailing empty element if file ended with newline.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const slice = lines.slice(0, targetLineIndex + 1);
  if (slice.length === 0) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: 'nothing to fork' };
  }

  const dir = forksDirInternal();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: `mkdir failed: ${String(err)}` };
  }
  const stem = path.basename(sessionFile, path.extname(sessionFile));
  const ts = Date.now();
  const forkPath = path.join(dir, `${stem}-fork-${ts}.jsonl`);
  try {
    fs.writeFileSync(forkPath, slice.join('\n') + '\n', 'utf8');
  } catch (err) {
    return { ok: false, forkPath: undefined, lineCount: 0, error: `write failed: ${String(err)}` };
  }
  logger.info(`replay: forked ${sessionFile} at index ${clamped} → ${forkPath} (${slice.length} lines)`);
  return { ok: true, forkPath, lineCount: slice.length, error: undefined };
}

// -----------------------------------------------------------------------------
// Diff export — surfaces the same engine to the message handler.
// -----------------------------------------------------------------------------

export interface ExportedDiff {
  filePath: string;
  unified: string;
  addedLines: number;
  removedLines: number;
}

export function diffSessionRange(
  sessionFile: string,
  indexA: number,
  indexB: number,
): ExportedDiff[] {
  const cached = getCachedSession(sessionFile);
  if (!cached) return [];
  const all: FileDiff[] = diffBetween(cached.events, indexA, indexB);
  return all.map((d) => ({
    filePath: d.filePath,
    unified: d.unified,
    addedLines: d.addedLines,
    removedLines: d.removedLines,
  }));
}

/** Reconstruct file state at a specific scrub point — surfaces engine to host. */
export function fileStateAt(
  sessionFile: string,
  filePath: string,
  atIndex: number,
): string | undefined {
  const cached = getCachedSession(sessionFile);
  if (!cached) return undefined;
  return reconstructFileAt(cached.events, filePath, atIndex);
}

/**
 * Test-only.
 */
export function __resetReplayForTests(): void {
  __resetCache();
}

export function forksDir(): string {
  return forksDirInternal();
}
