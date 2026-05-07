// =============================================================================
// Claude Cockpit — Permissions audit log (Phase 1, feat/launch-permissions-audit).
//
// Append-only newline-delimited JSON (NDJSON) log of every meta-event the
// extension witnesses: outbound network calls, MCP calls, key access, file
// reads. Lives at `~/.claude/.cockpit/audit.log` so we don't co-mingle with
// Claude Code's own session JSONLs under `~/.claude/projects/`.
//
// Design notes:
//   * Append-and-fsync per write so a crashed extension cannot lose the last
//     event AND cannot leave a half-line. The tradeoff (one fsync per event)
//     is fine because event volume is low (single-digit/min for most users).
//   * Rotation at 50 MB. Rotated files are named `audit.log.1`, `audit.log.2`,
//     up to `audit.log.5`; the oldest is dropped. Rotation is a synchronous
//     rename chain — cheap and robust.
//   * Detail is REDACTED at the call site. This module never inspects fields
//     for secrets — that's the caller's responsibility. We sanity-check the
//     serialized line length (8 KB cap) so a misbehaving caller can't blow
//     the log up; oversized events are truncated with a `truncated: true`
//     flag in their detail.
//   * Opt-in via `claudeCockpit.audit.enabled`. The extension passes the
//     resolved boolean to `setAuditEnabled()` on activation; if disabled the
//     append is a no-op (zero behavior change for v0.21.0 users).
// =============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditEvent } from './plugin';
import { logger } from './logger';

const DEFAULT_DIR = path.join(os.homedir(), '.claude', '.cockpit');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'audit.log');

// 50 MB hot file, 5 rotated archives → 300 MB ceiling. Anything older is
// dropped; the user can reset the log entirely via the Audit sub-view.
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROTATIONS = 5;

// 8 KB per line. Bigger than any realistic redacted detail; small enough to
// stay friendly to readline-style parsers downstream (PostHog, mobile companion).
const MAX_LINE_BYTES = 8 * 1024;

// Mutable refs so unit tests can redirect to a temp dir + lower the rotation
// threshold without monkeypatching `fs`. Production code never mutates these
// outside of setAuditEnabled.
const REF: { dir: string; file: string; enabled: boolean; maxBytes: number } = {
  dir: DEFAULT_DIR,
  file: DEFAULT_FILE,
  enabled: true,
  maxBytes: DEFAULT_MAX_BYTES,
};

export function setAuditEnabled(v: boolean): void {
  REF.enabled = v;
}

export function isAuditEnabled(): boolean {
  return REF.enabled;
}

export function getAuditLogPath(): string {
  return REF.file;
}

function ensureDir(): void {
  if (!fs.existsSync(REF.dir)) {
    fs.mkdirSync(REF.dir, { recursive: true });
  }
}

function rotateIfNeeded(currentSize: number): void {
  if (currentSize < REF.maxBytes) return;
  // Drop the oldest, shift each rotated file up one slot, move current to .1.
  const oldest = `${REF.file}.${MAX_ROTATIONS}`;
  if (fs.existsSync(oldest)) {
    try {
      fs.unlinkSync(oldest);
    } catch (err) {
      logger.warn(`auditLog: rotate unlink failed: ${String(err)}`);
    }
  }
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const src = `${REF.file}.${i}`;
    const dst = `${REF.file}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst);
      } catch (err) {
        logger.warn(`auditLog: rotate rename ${src} → ${dst} failed: ${String(err)}`);
      }
    }
  }
  try {
    fs.renameSync(REF.file, `${REF.file}.1`);
  } catch (err) {
    logger.warn(`auditLog: rotate primary failed: ${String(err)}`);
  }
}

function serialize(ev: AuditEvent): string {
  let line = JSON.stringify(ev);
  if (line.length > MAX_LINE_BYTES) {
    // Replace detail with a truncated marker but preserve ts + kind so the
    // record is still useful for counts / domain rollups.
    const trimmed: AuditEvent = {
      ts: ev.ts,
      kind: ev.kind,
      detail: { truncated: true, originalBytes: line.length },
      worktree: ev.worktree,
    };
    line = JSON.stringify(trimmed);
  }
  return `${line}\n`;
}

/**
 * Atomic single-line append. Caller MUST redact `ev.detail` before invoking
 * — this module trusts the caller, never inspects fields for secrets.
 *
 * Failures are logged and swallowed. The audit log is observability, not
 * a hot path; we never want a logging failure to crash the host extension.
 */
export function appendAuditEvent(ev: AuditEvent): void {
  if (!REF.enabled) return;
  try {
    ensureDir();
    let size = 0;
    try {
      size = fs.statSync(REF.file).size;
    } catch {
      // File doesn't exist yet — that's fine.
    }
    rotateIfNeeded(size);
    const line = serialize(ev);
    // Open / write / fsync / close. Append mode opens with O_APPEND so
    // concurrent writers (multiple extension hosts) can't tear lines.
    const fd = fs.openSync(REF.file, 'a');
    try {
      fs.writeSync(fd, line);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    logger.warn(`auditLog: append failed: ${String(err)}`);
  }
}

function readFileLines(file: string): AuditEvent[] {
  if (!fs.existsSync(file)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    logger.warn(`auditLog: read ${file} failed: ${String(err)}`);
    return [];
  }
  const out: AuditEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as AuditEvent;
      if (typeof parsed.ts === 'number' && typeof parsed.kind === 'string') {
        out.push(parsed);
      }
    } catch {
      // Corrupt line — skip silently. We never throw on a bad audit line;
      // the log is best-effort observability.
    }
  }
  return out;
}

/**
 * Read the last N events across the current log + rotated archives. Returns
 * newest first. If fewer than N events exist, returns whatever is available.
 */
export function readAuditTail(n: number): AuditEvent[] {
  if (n <= 0) return [];
  // Read newest → oldest. Current file's lines are appended chronologically;
  // reverse to get newest-first. Walk into rotated files only if we still
  // need more events.
  const collected: AuditEvent[] = [];
  collected.push(...readFileLines(REF.file).reverse());
  if (collected.length >= n) return collected.slice(0, n);
  for (let i = 1; i <= MAX_ROTATIONS && collected.length < n; i++) {
    collected.push(...readFileLines(`${REF.file}.${i}`).reverse());
  }
  return collected.slice(0, n);
}

/**
 * Substring search across all audit files, newest first. Case-insensitive.
 * Caps results at 500 to keep the webview responsive.
 */
export function searchAudit(query: string): AuditEvent[] {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const out: AuditEvent[] = [];
  const cap = 500;
  const files = [REF.file];
  for (let i = 1; i <= MAX_ROTATIONS; i++) files.push(`${REF.file}.${i}`);
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < cap; i--) {
      const line = lines[i];
      if (!line) continue;
      if (!line.toLowerCase().includes(q)) continue;
      try {
        const parsed = JSON.parse(line) as AuditEvent;
        if (typeof parsed.ts === 'number' && typeof parsed.kind === 'string') {
          out.push(parsed);
        }
      } catch {
        /* skip corrupt */
      }
    }
    if (out.length >= cap) break;
  }
  return out;
}

export interface OutboundDomainCount {
  host: string;
  count: number;
  lastSeenMs: number;
}

/**
 * Roll up the last N net.outbound events into a per-host count + last-seen
 * timestamp. Used by the Outbound sub-view inside the Security tab.
 */
export function outboundDomainTail(n: number): OutboundDomainCount[] {
  if (n <= 0) return [];
  // We need the last N net.outbound events specifically — readAuditTail
  // returns mixed kinds, so we walk a larger window and filter. Cap at 4×n
  // candidate events scanned to avoid unbounded read on a packed log.
  const window = Math.max(n * 4, 200);
  const tail = readAuditTail(window).filter((e) => e.kind === 'net.outbound').slice(0, n);
  const map = new Map<string, OutboundDomainCount>();
  for (const ev of tail) {
    const host = typeof ev.detail.host === 'string' ? ev.detail.host : '';
    if (!host) continue;
    const existing = map.get(host);
    if (existing) {
      existing.count += 1;
      if (ev.ts > existing.lastSeenMs) existing.lastSeenMs = ev.ts;
    } else {
      map.set(host, { host, count: 1, lastSeenMs: ev.ts });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

export interface AuditSnapshot {
  last24h: number;
  lastDomain: string | undefined;
}

/**
 * Lightweight rollup for `CockpitSnapshot.audit`. Walks at most 1000 recent
 * events, never the full log. Returns a single counter + the most recent
 * outbound host so the Security tab can render a "12 events / 24h, last:
 * api.github.com" pill without a separate roundtrip.
 */
export function readAuditSnapshot(): AuditSnapshot {
  if (!REF.enabled) return { last24h: 0, lastDomain: undefined };
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const tail = readAuditTail(1000);
  let count = 0;
  let lastDomain: string | undefined;
  for (const ev of tail) {
    if (ev.ts < cutoff) break;
    count++;
    if (!lastDomain && ev.kind === 'net.outbound') {
      const host = typeof ev.detail.host === 'string' ? ev.detail.host : undefined;
      if (host) lastDomain = host;
    }
  }
  return { last24h: count, lastDomain };
}

/**
 * Wipe the on-disk log. Surfaced via the audit.clearLog message so the user
 * can opt out of historical retention without disabling the whole feature.
 */
export function clearAuditLog(): void {
  if (fs.existsSync(REF.file)) {
    try { fs.unlinkSync(REF.file); } catch (err) {
      logger.warn(`auditLog: clear failed: ${String(err)}`);
    }
  }
  for (let i = 1; i <= MAX_ROTATIONS; i++) {
    const f = `${REF.file}.${i}`;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (err) {
        logger.warn(`auditLog: clear rotated ${f} failed: ${String(err)}`);
      }
    }
  }
}

/**
 * Test-only reset: drops the current file + rotated archives, restores defaults.
 */
export function __resetForTests(): void {
  clearAuditLog();
  REF.dir = DEFAULT_DIR;
  REF.file = DEFAULT_FILE;
  REF.enabled = true;
  REF.maxBytes = DEFAULT_MAX_BYTES;
}

/**
 * Test-only override of the log path. Returns a restore function.
 */
export function __setLogPathForTests(p: string): () => void {
  const origDir = REF.dir;
  const origFile = REF.file;
  REF.dir = path.dirname(p);
  REF.file = p;
  return () => {
    REF.dir = origDir;
    REF.file = origFile;
  };
}

/**
 * Test-only override of the rotation threshold so the unit test can verify
 * rotation behaviour without writing 50 MB. Returns a restore function.
 */
export function __setMaxBytesForTests(n: number): () => void {
  const orig = REF.maxBytes;
  REF.maxBytes = n;
  return () => { REF.maxBytes = orig; };
}
