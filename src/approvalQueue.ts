// =============================================================================
// Claude Cockpit — Approval queue (Phase 1, approval-queue worktree).
//
// The queue is the human gate for autonomous Claude actions. It is
// file-backed, append-only-ish (we rewrite the whole file with a single
// fsync per write, since the queue stays bounded), and lives at
// `~/.claude/.cockpit/queue.json`.
//
// Sources of approval requests:
//   1. Cockpit's own webview / external triggers (`enqueue()` below).
//   2. boo-mesh / jarvis (jarvis.ts already polls `~/.../queue.db`). We do
//      NOT modify jarvis.ts. The queue MERGES jarvis pendings at display
//      time (see `mergedView`), and approving a jarvis-source entry forwards
//      to `decideApproval()` from jarvis.ts.
//
// LeCun-style human gate: every entry carries a `WorktreeAction` (declared
// filesAffected) and an optional snapshot id. The UI shows what would be
// touched, the user decides, and a rollback is available iff the entry has
// a snapshot. v1.0 ships dashboard + revert; ENFORCEMENT (blocking the
// underlying agent) is left to upstream PreToolUse hooks the user wires
// separately. Cockpit observes; humans decide.
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import type { WorktreeAction } from './plugin';
import type { JarvisApproval } from './jarvis';
import {
  CaptureRejection,
  capture,
  pruneSnapshotsToBudget,
  removeSnapshot,
  rollback,
  RollbackResult,
} from './snapshot';

// -----------------------------------------------------------------------------
// On-disk shape. Versioned so future migrations can detect-and-rewrite.
// -----------------------------------------------------------------------------

const QUEUE_VERSION = 1;
const QUEUE_DIR = path.join(os.homedir(), '.claude', '.cockpit');
const QUEUE_PATH = path.join(QUEUE_DIR, 'queue.json');

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'rolled-back'
  | 'snapshot-failed';

export type ApprovalSource = 'cockpit' | 'jarvis';

export interface ApprovalEntry {
  id: string;
  source: ApprovalSource;
  /** Mirrors `WorktreeAction` so the UI / audit log can render the same way regardless of source. */
  action: WorktreeAction;
  status: ApprovalStatus;
  /** Snapshot id, if a snapshot was taken at enqueue time. */
  snapshotId: string | undefined;
  /** When the snapshot attempt failed, the reason ends up here for the UI. */
  snapshotError: string | undefined;
  decidedAt: number | undefined;
  decidedBy: string | undefined;
  decisionNote: string | undefined;
  /** If a rollback was performed, summarized status counts per file. */
  rollback: { ok: boolean; performedAt: number; summary: Record<string, number> } | undefined;
}

interface QueueFile {
  version: number;
  entries: ApprovalEntry[];
}

const EMPTY_QUEUE: QueueFile = { version: QUEUE_VERSION, entries: [] };

// -----------------------------------------------------------------------------
// Atomic file IO (single fsync per write, tmp+rename to keep the queue
// either fully old or fully new on power loss).
// -----------------------------------------------------------------------------

function ensureDir(): void {
  fs.mkdirSync(QUEUE_DIR, { recursive: true, mode: 0o700 });
}

function readQueueFile(): QueueFile {
  ensureDir();
  if (!fs.existsSync(QUEUE_PATH)) return { ...EMPTY_QUEUE, entries: [] };
  let raw: string;
  try {
    raw = fs.readFileSync(QUEUE_PATH, 'utf8');
  } catch (err) {
    logger.warn(`approvalQueue: read failed: ${String(err)}`);
    return { ...EMPTY_QUEUE, entries: [] };
  }
  try {
    const parsed = JSON.parse(raw) as QueueFile;
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.entries)) {
      logger.warn(`approvalQueue: malformed queue file; resetting`);
      return { ...EMPTY_QUEUE, entries: [] };
    }
    // Defensive: drop entries that don't look right rather than crash.
    const safe: ApprovalEntry[] = [];
    for (const e of parsed.entries) {
      if (typeof e.id === 'string' && e.action && Array.isArray(e.action.filesAffected)) {
        safe.push(e);
      }
    }
    return { version: parsed.version, entries: safe };
  } catch (err) {
    logger.warn(`approvalQueue: parse failed: ${String(err)}`);
    return { ...EMPTY_QUEUE, entries: [] };
  }
}

function writeQueueFile(q: QueueFile): void {
  ensureDir();
  const tmp = `${QUEUE_PATH}.tmp-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    const buf = Buffer.from(JSON.stringify(q, null, 2), 'utf8');
    fs.writeSync(fd, buf, 0, buf.length, 0);
    try { fs.fsyncSync(fd); } catch { /* best-effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, QUEUE_PATH);
}

// -----------------------------------------------------------------------------
// Module-private state (exposed via the class wrapper for testability).
// -----------------------------------------------------------------------------

export interface EnqueueOptions {
  /** When false, skip snapshotting even if the action declares files. Default true. */
  takeSnapshot?: boolean;
  /** Cap a single snapshot's bytes. Forwarded to `snapshot.capture`. */
  snapshotMaxBytes?: number;
  /** Global cap on all snapshots after enqueue. Falsy = unbounded. */
  globalSnapshotBudgetBytes?: number;
}

export interface EnqueueResult {
  entry: ApprovalEntry;
  snapshotPruned: string[];
}

export interface DecideOptions {
  decidedBy: string;
  note?: string;
  /** Required for `rolled-back`. Otherwise ignored. */
  forceRollback?: boolean;
}

export class ApprovalQueueStore {
  private cache: QueueFile;

  constructor() {
    this.cache = readQueueFile();
  }

  /** Reload from disk — used after external writes (e.g. fs watcher). */
  reload(): void {
    this.cache = readQueueFile();
  }

  list(): ApprovalEntry[] {
    return this.cache.entries.slice();
  }

  pending(): ApprovalEntry[] {
    return this.cache.entries.filter((e) => e.status === 'pending');
  }

  pendingCount(): number {
    return this.cache.entries.reduce((n, e) => (e.status === 'pending' ? n + 1 : n), 0);
  }

  recentCount(windowMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - windowMs;
    return this.cache.entries.reduce(
      (n, e) => (e.action.requestedAt >= cutoff ? n + 1 : n),
      0,
    );
  }

  get(id: string): ApprovalEntry | undefined {
    return this.cache.entries.find((e) => e.id === id);
  }

  /**
   * Add a new pending approval. If `takeSnapshot` is true (default) AND the
   * action declares any filesAffected, we capture a pre-action snapshot
   * before persisting. Failure to snapshot is NOT fatal — the entry is
   * stored with `status: 'snapshot-failed'` and `snapshotError` set so the
   * UI can render a red banner and disable revert.
   */
  enqueue(action: WorktreeAction, opts?: EnqueueOptions): EnqueueResult {
    const takeSnapshot = opts?.takeSnapshot !== false;
    const cwdAtRequest = action.filesAffected[0] ? path.dirname(action.filesAffected[0]) : '';

    let snapshotId: string | undefined;
    let snapshotError: string | undefined;
    let status: ApprovalStatus = 'pending';

    if (takeSnapshot && action.filesAffected.length > 0 && action.rollbackable) {
      const result = capture({
        id: action.id,
        cwd: cwdAtRequest,
        filesAffected: action.filesAffected,
        reason: 'pre-action',
        maxBytes: opts?.snapshotMaxBytes,
      });
      if (result.ok) {
        snapshotId = result.manifest.id;
      } else {
        snapshotError = formatCaptureFailure(result);
        status = 'snapshot-failed';
        logger.warn(`approvalQueue: snapshot for "${action.id}" failed: ${snapshotError}`);
      }
    }

    const entry: ApprovalEntry = {
      id: action.id,
      source: 'cockpit',
      action,
      status,
      snapshotId,
      snapshotError,
      decidedAt: undefined,
      decidedBy: undefined,
      decisionNote: undefined,
      rollback: undefined,
    };

    // De-dupe by id; treat re-enqueue as overwrite (the upstream emitter
    // owns ids, and a duplicate almost certainly means a retry).
    this.cache.entries = this.cache.entries.filter((e) => e.id !== entry.id).concat(entry);
    writeQueueFile(this.cache);

    let snapshotPruned: string[] = [];
    if (opts?.globalSnapshotBudgetBytes && opts.globalSnapshotBudgetBytes > 0) {
      snapshotPruned = pruneSnapshotsToBudget(opts.globalSnapshotBudgetBytes);
      // If our just-captured snapshot was pruned (extremely unlikely — it's
      // newest), we'd want to know.
      if (snapshotId && snapshotPruned.includes(snapshotId)) {
        snapshotId = undefined;
        snapshotError = 'snapshot pruned immediately due to global budget';
        status = 'snapshot-failed';
        const idx = this.cache.entries.findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
          this.cache.entries[idx] = {
            ...this.cache.entries[idx],
            snapshotId,
            snapshotError,
            status,
          };
          writeQueueFile(this.cache);
        }
      }
    }

    return { entry, snapshotPruned };
  }

  /** Add an entry that came from jarvis. No snapshot — boo-mesh owns its own state. */
  ingestJarvis(approvals: readonly JarvisApproval[]): void {
    if (!approvals || approvals.length === 0) return;
    const known = new Set(this.cache.entries.map((e) => e.id));
    let dirty = false;
    for (const a of approvals) {
      const id = `jarvis:${a.id}`;
      if (known.has(id)) continue;
      const entry: ApprovalEntry = {
        id,
        source: 'jarvis',
        action: {
          id,
          worktree: 'boo-mesh',
          tool: a.tool,
          argsRedacted: a.payload.length > 200 ? a.payload.slice(0, 200) + '…' : a.payload,
          filesAffected: [],
          requestedAt: a.requestedAt * 1000, // jarvis stores seconds; queue stores ms.
          byAgent: a.requestedBy || undefined,
          expectedDiffBytes: 0,
          rollbackable: false, // jarvis approvals don't have a Cockpit-owned snapshot
        },
        status: a.status === 'pending' ? 'pending'
          : a.status === 'approved' ? 'approved'
          : a.status === 'rejected' ? 'rejected'
          : 'pending',
        snapshotId: undefined,
        snapshotError: undefined,
        decidedAt: a.decidedAt ? a.decidedAt * 1000 : undefined,
        decidedBy: a.decidedBy ?? undefined,
        decisionNote: a.result ?? undefined,
        rollback: undefined,
      };
      this.cache.entries.push(entry);
      dirty = true;
    }
    if (dirty) writeQueueFile(this.cache);
  }

  approve(id: string, opts: DecideOptions): ApprovalEntry | undefined {
    return this.transition(id, 'approved', opts);
  }

  reject(id: string, opts: DecideOptions): ApprovalEntry | undefined {
    return this.transition(id, 'rejected', opts);
  }

  /**
   * Run rollback for an entry. Status transitions to `rolled-back` only when
   * the rollback succeeded (either restored or no-op). Drift / failure does
   * NOT change status — the entry stays in its prior state and the caller
   * sees per-file results so it can prompt for `force`.
   */
  rollback(id: string, opts: DecideOptions): { entry: ApprovalEntry | undefined; result: RollbackResult } {
    const entry = this.get(id);
    if (!entry) {
      return {
        entry: undefined,
        result: { snapshotId: id, files: [], ok: false },
      };
    }
    if (!entry.snapshotId) {
      return {
        entry,
        result: { snapshotId: id, files: [], ok: false },
      };
    }
    const result = rollback(entry.snapshotId, { force: opts.forceRollback === true });

    if (result.ok) {
      const summary: Record<string, number> = {};
      for (const f of result.files) {
        summary[f.status] = (summary[f.status] ?? 0) + 1;
      }
      const updated: ApprovalEntry = {
        ...entry,
        status: 'rolled-back',
        decidedAt: Date.now(),
        decidedBy: opts.decidedBy,
        decisionNote: opts.note,
        rollback: { ok: true, performedAt: Date.now(), summary },
      };
      this.cache.entries = this.cache.entries.map((e) => (e.id === id ? updated : e));
      writeQueueFile(this.cache);
      return { entry: updated, result };
    }

    // Don't mutate status on failure. Caller surfaces drift to the user.
    return { entry, result };
  }

  /** Hard-remove an entry and its snapshot. Used by Reject-and-discard flow. */
  remove(id: string): void {
    const entry = this.get(id);
    if (!entry) return;
    if (entry.snapshotId) {
      removeSnapshot(entry.snapshotId);
    }
    this.cache.entries = this.cache.entries.filter((e) => e.id !== id);
    writeQueueFile(this.cache);
  }

  private transition(
    id: string,
    next: ApprovalStatus,
    opts: DecideOptions,
  ): ApprovalEntry | undefined {
    const idx = this.cache.entries.findIndex((e) => e.id === id);
    if (idx < 0) return undefined;
    const cur = this.cache.entries[idx];
    if (cur.status !== 'pending' && cur.status !== 'snapshot-failed') {
      // Already decided. No-op rather than throw — UI can click twice.
      return cur;
    }
    const updated: ApprovalEntry = {
      ...cur,
      status: next,
      decidedAt: Date.now(),
      decidedBy: opts.decidedBy,
      decisionNote: opts.note,
    };
    this.cache.entries[idx] = updated;
    writeQueueFile(this.cache);
    return updated;
  }
}

function formatCaptureFailure(rejection: CaptureRejection): string {
  return `${rejection.failure.reason}: ${rejection.failure.detail}`;
}

// -----------------------------------------------------------------------------
// Module-level helpers — sidebarProvider holds a single store instance, but
// the `readApprovalCounts` helper for the snapshot payload is stateless.
// -----------------------------------------------------------------------------

export interface ApprovalCounts {
  pending: number;
  recent: number;
}

export function readApprovalCounts(): ApprovalCounts {
  // Stateless read for the snapshot payload. We do NOT keep an in-memory
  // store here — the singleton inside CockpitSidebarProvider is the source of
  // truth at runtime. This helper exists for snapshotInner() which doesn't
  // (and shouldn't) hold a store reference.
  const q = readQueueFile();
  let pending = 0;
  let recent = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const e of q.entries) {
    if (e.status === 'pending') pending += 1;
    if (e.action && e.action.requestedAt >= cutoff) recent += 1;
  }
  return { pending, recent };
}

export function queuePath(): string {
  return QUEUE_PATH;
}

export function queueDir(): string {
  return QUEUE_DIR;
}
