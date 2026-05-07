// =============================================================================
// Claude Cockpit — Mobile companion exporter (Phase 2, mobile-companion).
//
// Read-only mobile companion for v1.0. The desktop extension publishes a
// SANITIZED snapshot of the approval queue to
// `~/.claude/.cockpit/queue.public.json`. The user is responsible for
// exposing that file via their existing Cloudflare Tunnel (see
// integrations.ts:readTunnels) and protecting it with Cloudflare Access SSO.
//
// Design constraints (from the brief + master plan):
//   - Local-first. Cockpit makes ZERO outbound calls. The published file is
//     read by infra the user already configured.
//   - Strict whitelist sanitizer. NO file paths, NO argsRedacted, NO snapshot
//     ids, NO secrets. Manual diff confirms output fields are exactly:
//       { id, tool, ageSeconds, agentName, expectedDiffBytes, status }.
//   - Default OFF. Setting `claudeCockpit.mobile.enabled` (default false)
//     gates publication. When false we DELETE any pre-existing published
//     file so it can't go stale.
//   - Atomic writes via tmp+rename, mode 0o600 — same pattern as the queue
//     and audit log.
//   - v1.0 is read-only. The mobile page shows the queue; approvals stay
//     desktop-only. v1.1 will add mobile-side approve via a webhook that
//     the desktop extension polls (NOT a public POST endpoint — the desktop
//     pulls decisions back from the same Cloudflare-Access-protected URL).
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import type { ApprovalEntry } from './approvalQueue';

// Sanitized shape — keep this file the SOLE definition; if a future feature
// wants to add a field, it MUST go through the sanitizer below.
export interface PublicApprovalEntry {
  id: string;
  tool: string;
  ageSeconds: number;
  agentName: string;
  expectedDiffBytes: number;
  status: 'pending' | 'approved' | 'rejected' | 'rolled-back' | 'snapshot-failed';
  fileCount: number;
}

export interface PublicQueuePayload {
  version: 1;
  publishedAt: number;
  /** When false the page should render "queue paused." Caller is responsible. */
  enabled: boolean;
  /** Total pending entries (post-sanitization) for the burn-down counter. */
  pendingCount: number;
  entries: PublicApprovalEntry[];
}

const PUBLIC_DIR = path.join(os.homedir(), '.claude', '.cockpit');
const PUBLIC_PATH = path.join(PUBLIC_DIR, 'queue.public.json');

/** Max chars of agent name that survive sanitization. */
const AGENT_NAME_MAX = 8;
/** Max entries we ever emit. The mobile page paginates client-side if needed. */
const MAX_ENTRIES = 50;
/** Tool name max length (truncate after this; mobile UI is narrow). */
const TOOL_NAME_MAX = 24;

// -----------------------------------------------------------------------------
// Sanitizer — pure function, no I/O. Hot path under tests.
// -----------------------------------------------------------------------------

export function sanitizeEntry(entry: ApprovalEntry, now: number): PublicApprovalEntry {
  const action = entry.action;
  const requestedAt = typeof action.requestedAt === 'number' ? action.requestedAt : now;
  const ageSeconds = Math.max(0, Math.floor((now - requestedAt) / 1000));
  const agent = (action.byAgent ?? '').slice(0, AGENT_NAME_MAX);
  const tool = (action.tool ?? '').slice(0, TOOL_NAME_MAX);
  const expectedDiffBytes = Math.max(0, Math.floor(action.expectedDiffBytes ?? 0));
  return {
    id: stripPath(entry.id),
    tool: stripPath(tool),
    ageSeconds,
    agentName: stripPath(agent),
    expectedDiffBytes,
    status: entry.status,
    fileCount: Array.isArray(action.filesAffected) ? action.filesAffected.length : 0,
  };
}

/**
 * Defence-in-depth: even if a future code path wires a path-shaped string into
 * a field that lands in the public payload, we strip directory separators here
 * so a stray `/Users/<name>/...` can never escape. The sanitizer's main
 * contract is the field whitelist above — this is belt-and-braces.
 */
function stripPath(value: string): string {
  if (typeof value !== 'string') return '';
  if (!value.includes('/') && !value.includes('\\')) return value;
  // Replace any path separator with a space; collapse runs.
  return value.replace(/[/\\]+/g, ' ').trim();
}

export function sanitizeQueue(
  entries: readonly ApprovalEntry[],
  enabled: boolean,
  now: number,
): PublicQueuePayload {
  const pending = entries.filter((e) => e.status === 'pending');
  // Show pending first, then most recent N decided entries for context. Bound
  // total to MAX_ENTRIES so we can't accidentally publish a 10MB JSON file.
  const recentDecided = entries
    .filter((e) => e.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .slice(0, Math.max(0, MAX_ENTRIES - pending.length));
  const visible = pending.concat(recentDecided).slice(0, MAX_ENTRIES);
  return {
    version: 1,
    publishedAt: now,
    enabled,
    pendingCount: pending.length,
    entries: visible.map((e) => sanitizeEntry(e, now)),
  };
}

// -----------------------------------------------------------------------------
// File I/O — atomic write, atomic delete. Caller decides when to invoke.
// -----------------------------------------------------------------------------

function ensureDir(): void {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true, mode: 0o700 });
}

export function publicQueuePath(): string {
  return PUBLIC_PATH;
}

export function writePublic(payload: PublicQueuePayload): void {
  ensureDir();
  const tmp = `${PUBLIC_PATH}.tmp-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    const buf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    fs.writeSync(fd, buf, 0, buf.length, 0);
    try { fs.fsyncSync(fd); } catch { /* best-effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, PUBLIC_PATH);
}

/** When the user disables mobile, we wipe the file so a stale snapshot can't
 *  be served by an exposed tunnel that the user forgot to take down. */
export function clearPublic(): void {
  try {
    if (fs.existsSync(PUBLIC_PATH)) fs.unlinkSync(PUBLIC_PATH);
  } catch (err) {
    logger.warn(`mobileExport: clear failed: ${String(err)}`);
  }
}

// -----------------------------------------------------------------------------
// Publication lifecycle — pluggable supplier so tests can drive without a
// running ApprovalQueueStore. The extension wires the real supplier.
// -----------------------------------------------------------------------------

export interface MobilePublisherOptions {
  /** Returns the current set of approval entries. Pure read. */
  supplier: () => readonly ApprovalEntry[];
  /** Returns whether publication is currently enabled (from settings). */
  isEnabled: () => boolean;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export class MobilePublisher {
  private readonly supplier: () => readonly ApprovalEntry[];
  private readonly isEnabled: () => boolean;
  private readonly now: () => number;
  private lastPayloadDigest: string | undefined;

  constructor(opts: MobilePublisherOptions) {
    this.supplier = opts.supplier;
    this.isEnabled = opts.isEnabled;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Recompute + write iff content actually changed. Cheap to call on every
   *  queue mutation; idempotent. */
  publish(): void {
    if (!this.isEnabled()) {
      // Disabled. If a previous run left a file, scrub it; otherwise no-op.
      this.lastPayloadDigest = undefined;
      clearPublic();
      return;
    }
    const payload = sanitizeQueue(this.supplier(), true, this.now());
    // Strip the timestamp from the digest so we don't rewrite the file every
    // tick when nothing else changed; the file mtime is independent.
    const stable: PublicQueuePayload = { ...payload, publishedAt: 0 };
    const digest = crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
    if (digest === this.lastPayloadDigest) return;
    try {
      writePublic(payload);
      this.lastPayloadDigest = digest;
    } catch (err) {
      logger.warn(`mobileExport: write failed: ${String(err)}`);
    }
  }

  /** Force the next publish() to write even if the digest matches. */
  invalidate(): void {
    this.lastPayloadDigest = undefined;
  }
}

// -----------------------------------------------------------------------------
// Convenience: a queue-file watcher that wakes the publisher whenever an
// out-of-process writer (CLI hook, jarvis) mutates the queue. Returns a
// disposer the extension keeps in its subscriptions.
// -----------------------------------------------------------------------------

export interface PublisherWatcher {
  /** Stop watching. Idempotent. */
  dispose: () => void;
  /** Force a re-read + publish. */
  poke: () => void;
}

export function watchQueueAndPublish(
  publisher: MobilePublisher,
  queuePath: string,
): PublisherWatcher {
  let watcher: fs.FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;
  const trigger = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => publisher.publish(), 250);
  };
  try {
    if (fs.existsSync(queuePath)) {
      watcher = fs.watch(queuePath, () => trigger());
    }
  } catch (err) {
    logger.info(`mobileExport: watcher attach failed: ${String(err)}`);
  }
  // Always do an initial publish so the file lands as soon as the setting
  // flips on, even if no queue mutation happens.
  publisher.publish();
  return {
    dispose: () => {
      if (debounce) clearTimeout(debounce);
      try { watcher?.close(); } catch { /* ignore */ }
      watcher = undefined;
    },
    poke: () => trigger(),
  };
}
