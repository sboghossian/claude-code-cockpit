// =============================================================================
// Claude Cockpit — Filesystem snapshot + rollback (Phase 1, approval-queue).
//
// Snapshots are TAKEN per-action (only the files declared in
// `WorktreeAction.filesAffected`) so capture cost stays bounded and no
// full-repo snapshot ever happens. Each snapshot lives at
// `~/.claude/.cockpit/snapshots/<id>/` with this layout:
//
//   manifest.json                       # SnapshotManifest (typed below)
//   files/<sha256>                      # raw bytes, content-addressed
//
// Rollback strategy is defensive — the queue is the trust gate, so a wrong
// rollback is worse than not having one. Concretely:
//
//   1. Per file, recompute the current sha256 BEFORE overwriting. If it does
//      not match the pre-action sha (and is not equal to the snapshot sha
//      either, meaning the file was edited again post-action), that file is
//      flagged `drifted`. The caller decides whether to proceed (force) or
//      stop (default = stop, return per-file results).
//   2. Restore writes to a sibling `<file>.cockpit-restore-<rand>` in the
//      same directory, fsync's it, then atomically renames over the target.
//      That keeps the destination either fully old or fully new — never
//      half-written, even on power loss between fsync and rename.
//   3. Files that did not exist at snapshot time (`absent: true`) are
//      removed on rollback (rename to `.cockpit-trash-<rand>` first, then
//      unlink — same atomic-trash idiom).
//
// Hash check is sha256 over file bytes. We do NOT hash the parent directory
// or anything outside `filesAffected` — Cockpit's contract is "I can undo
// the changes you declared."
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import type { SnapshotRef } from './plugin';

const SNAPSHOTS_ROOT = path.join(os.homedir(), '.claude', '.cockpit', 'snapshots');

// Cap a single snapshot's total size (bytes) so a misbehaving caller can't
// fill the disk. Default mirrors the package.json default
// `claudeCockpit.approval.snapshotMaxBytes` = 50 MB; the queue layer is what
// actually reads the user setting and forwards it to capture().
export const DEFAULT_SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024;

export interface SnapshotFileEntry {
  /** Absolute path of the original file. We restore back to this exact path. */
  absPath: string;
  /** sha256 of the file's bytes at snapshot time. '' when `absent` is true. */
  sha256: string;
  /** Bytes at snapshot time. 0 when `absent` is true. */
  bytes: number;
  /** True when the file did not exist at snapshot time (post-action create). */
  absent: boolean;
  /** Filesystem mode (chmod bits) at snapshot time. */
  mode: number;
}

export interface SnapshotManifest extends SnapshotRef {
  files: SnapshotFileEntry[];
  /** Optional cap honoured by capture(); pinned in the manifest for audit. */
  maxBytes: number;
}

export type RollbackFileStatus =
  | 'restored'        // file was successfully restored to its snapshot bytes
  | 'removed'         // file was created post-snapshot and was removed
  | 'unchanged'       // file already matched the snapshot sha; no write
  | 'drifted-skipped' // file was edited post-snapshot; skipped (force=false)
  | 'drifted-forced'  // file was edited post-snapshot; restored anyway (force=true)
  | 'failed';         // I/O error during restore — see error string

export interface RollbackFileResult {
  absPath: string;
  status: RollbackFileStatus;
  /** Pre-rollback sha of the file as it currently exists on disk. */
  currentSha256: string;
  error?: string;
}

export interface RollbackResult {
  snapshotId: string;
  files: RollbackFileResult[];
  /** True when every file was restored or unchanged (no drift, no failure). */
  ok: boolean;
}

export interface CaptureFailure {
  reason:
    | 'no-files'
    | 'over-budget'
    | 'io-error';
  detail: string;
}

export interface CaptureResult {
  ok: true;
  manifest: SnapshotManifest;
}

export interface CaptureRejection {
  ok: false;
  failure: CaptureFailure;
}

// -----------------------------------------------------------------------------
// Helpers — kept private; the queue layer uses capture/rollback/list/remove.
// -----------------------------------------------------------------------------

function ensureRoot(): void {
  fs.mkdirSync(SNAPSHOTS_ROOT, { recursive: true, mode: 0o700 });
}

function sha256Stream(absPath: string): { sha: string; bytes: number } {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
      total += n;
    }
    return { sha: hash.digest('hex'), bytes: total };
  } finally {
    fs.closeSync(fd);
  }
}

function shaOfMissing(): string {
  return '';
}

function statSafe(absPath: string): fs.Stats | undefined {
  try {
    return fs.statSync(absPath);
  } catch {
    return undefined;
  }
}

function fsyncSafe(fd: number): void {
  try { fs.fsyncSync(fd); } catch { /* best-effort */ }
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Atomic write: copy `srcAbs` -> `<destAbs>.cockpit-restore-<rand>`, fsync,
 * rename over `destAbs`. Preserves the source mode bits.
 */
function atomicReplace(srcAbs: string, destAbs: string, mode: number): void {
  const dir = path.dirname(destAbs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.cockpit-restore-${path.basename(destAbs)}-${uniqueSuffix()}`);
  // Copy (not rename) so the snapshot files dir stays intact for re-rollback.
  const fdSrc = fs.openSync(srcAbs, 'r');
  const fdDst = fs.openSync(tmp, 'w', mode & 0o777);
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fdSrc, buf, 0, buf.length, pos);
      if (n === 0) break;
      fs.writeSync(fdDst, buf, 0, n);
      pos += n;
    }
    fsyncSafe(fdDst);
  } finally {
    fs.closeSync(fdSrc);
    fs.closeSync(fdDst);
  }
  fs.renameSync(tmp, destAbs);
}

/** Move file out of the way before unlinking — minimises mid-delete races. */
function atomicRemove(absPath: string): void {
  const dir = path.dirname(absPath);
  const trash = path.join(dir, `.cockpit-trash-${path.basename(absPath)}-${uniqueSuffix()}`);
  try {
    fs.renameSync(absPath, trash);
    fs.unlinkSync(trash);
  } catch (err) {
    // If the rename failed because the file is already gone, that's fine.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

// -----------------------------------------------------------------------------
// Public API.
// -----------------------------------------------------------------------------

/**
 * Capture a pre-action snapshot of `filesAffected`. ID is the caller's
 * responsibility (typically the queue entry id) — same id is reused on
 * rollback so the manifest is locatable.
 *
 * `cwd` is recorded for audit but does NOT affect path resolution. Callers
 * MUST pass absolute paths in `filesAffected` (we reject relative paths
 * outright; otherwise a later directory change makes the snapshot useless).
 */
export function capture(input: {
  id: string;
  cwd: string;
  filesAffected: string[];
  reason?: SnapshotRef['reason'];
  maxBytes?: number;
}): CaptureResult | CaptureRejection {
  const reason = input.reason ?? 'pre-action';
  const maxBytes = input.maxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES;

  if (!input.filesAffected || input.filesAffected.length === 0) {
    return { ok: false, failure: { reason: 'no-files', detail: 'filesAffected is empty' } };
  }

  for (const f of input.filesAffected) {
    if (!path.isAbsolute(f)) {
      return {
        ok: false,
        failure: { reason: 'io-error', detail: `non-absolute path "${f}"` },
      };
    }
  }

  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const f of input.filesAffected) {
    const norm = path.resolve(f);
    if (!seen.has(norm)) {
      seen.add(norm);
      dedup.push(norm);
    }
  }

  // Pre-flight: total size budget. We stat first so we never copy bytes when
  // we know we're about to exceed.
  let total = 0;
  const stats = new Map<string, fs.Stats | undefined>();
  for (const f of dedup) {
    const st = statSafe(f);
    stats.set(f, st);
    if (st && st.isFile()) total += st.size;
  }
  if (total > maxBytes) {
    return {
      ok: false,
      failure: {
        reason: 'over-budget',
        detail: `snapshot of ${dedup.length} files would be ${total} bytes (cap ${maxBytes})`,
      },
    };
  }

  ensureRoot();
  const dir = path.join(SNAPSHOTS_ROOT, input.id);
  const filesDir = path.join(dir, 'files');
  try {
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return {
      ok: false,
      failure: { reason: 'io-error', detail: `mkdir "${dir}" failed: ${String(err)}` },
    };
  }

  const fileEntries: SnapshotFileEntry[] = [];
  for (const absPath of dedup) {
    const st = stats.get(absPath);
    if (!st) {
      // File doesn't exist at snapshot time — record `absent: true` so
      // rollback knows to delete it if the action created it.
      fileEntries.push({ absPath, sha256: shaOfMissing(), bytes: 0, absent: true, mode: 0o644 });
      continue;
    }
    if (!st.isFile()) {
      // Cockpit only snapshots regular files. Directories / symlinks /
      // special files are NOT supported and the rollback would be unsafe.
      return {
        ok: false,
        failure: {
          reason: 'io-error',
          detail: `not a regular file: "${absPath}" (mode ${st.mode.toString(8)})`,
        },
      };
    }
    let sha: string;
    let bytes: number;
    try {
      const r = sha256Stream(absPath);
      sha = r.sha;
      bytes = r.bytes;
    } catch (err) {
      return {
        ok: false,
        failure: { reason: 'io-error', detail: `hash "${absPath}" failed: ${String(err)}` },
      };
    }

    const dest = path.join(filesDir, sha);
    if (!fs.existsSync(dest)) {
      try {
        // Atomic copy via tmp+rename, identical to atomicReplace but no
        // pre-existing target.
        const tmp = `${dest}.tmp-${uniqueSuffix()}`;
        const fdSrc = fs.openSync(absPath, 'r');
        const fdDst = fs.openSync(tmp, 'w', 0o600);
        try {
          const buf = Buffer.allocUnsafe(64 * 1024);
          let pos = 0;
          for (;;) {
            const n = fs.readSync(fdSrc, buf, 0, buf.length, pos);
            if (n === 0) break;
            fs.writeSync(fdDst, buf, 0, n);
            pos += n;
          }
          fsyncSafe(fdDst);
        } finally {
          fs.closeSync(fdSrc);
          fs.closeSync(fdDst);
        }
        fs.renameSync(tmp, dest);
      } catch (err) {
        return {
          ok: false,
          failure: { reason: 'io-error', detail: `copy "${absPath}" failed: ${String(err)}` },
        };
      }
    }

    fileEntries.push({
      absPath,
      sha256: sha,
      bytes,
      absent: false,
      mode: st.mode & 0o777,
    });
  }

  const manifest: SnapshotManifest = {
    id: input.id,
    cwd: input.cwd,
    takenAt: Date.now(),
    reason,
    paths: dedup,
    totalBytes: total,
    files: fileEntries,
    maxBytes,
  };

  try {
    const manifestPath = path.join(dir, 'manifest.json');
    const tmp = `${manifestPath}.tmp-${uniqueSuffix()}`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, manifestPath);
  } catch (err) {
    return {
      ok: false,
      failure: { reason: 'io-error', detail: `manifest write failed: ${String(err)}` },
    };
  }

  return { ok: true, manifest };
}

export function manifestPath(id: string): string {
  return path.join(SNAPSHOTS_ROOT, id, 'manifest.json');
}

export function snapshotsRoot(): string {
  return SNAPSHOTS_ROOT;
}

export function readManifest(id: string): SnapshotManifest | undefined {
  const p = manifestPath(id);
  if (!fs.existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SnapshotManifest;
    if (typeof raw.id !== 'string' || !Array.isArray(raw.files)) return undefined;
    return raw;
  } catch (err) {
    logger.warn(`snapshot: manifest read failed for "${id}": ${String(err)}`);
    return undefined;
  }
}

/**
 * Restore the files in `manifest` to their pre-action bytes.
 *
 * `force = false` (default): any file whose current sha differs from the
 * pre-action sha AND from any snapshot we hold is `drifted-skipped`. Caller
 * sees this and surfaces a UI prompt. With `force = true` we restore anyway.
 */
export function rollback(id: string, opts?: { force?: boolean }): RollbackResult {
  const force = opts?.force === true;
  const manifest = readManifest(id);
  if (!manifest) {
    return {
      snapshotId: id,
      files: [],
      ok: false,
    };
  }

  const filesDir = path.join(SNAPSHOTS_ROOT, id, 'files');
  const results: RollbackFileResult[] = [];

  for (const entry of manifest.files) {
    const cur = statSafe(entry.absPath);
    let currentSha = shaOfMissing();
    if (cur && cur.isFile()) {
      try {
        currentSha = sha256Stream(entry.absPath).sha;
      } catch (err) {
        results.push({
          absPath: entry.absPath,
          status: 'failed',
          currentSha256: '',
          error: `hash failed: ${String(err)}`,
        });
        continue;
      }
    }

    if (entry.absent) {
      // Snapshot recorded "file did not exist". Rollback = delete whatever
      // is there now.
      if (!cur) {
        results.push({ absPath: entry.absPath, status: 'unchanged', currentSha256: '' });
        continue;
      }
      try {
        atomicRemove(entry.absPath);
        results.push({ absPath: entry.absPath, status: 'removed', currentSha256: currentSha });
      } catch (err) {
        results.push({
          absPath: entry.absPath,
          status: 'failed',
          currentSha256: currentSha,
          error: String(err),
        });
      }
      continue;
    }

    // File existed at snapshot time. Three cases:
    //   a) current matches snapshot → no-op (unchanged)
    //   b) current matches NOTHING we know (drifted): the file was edited
    //      again post-action → caller decides via `force`.
    //   c) current is missing → restore the snapshot bytes back into place.
    const blob = path.join(filesDir, entry.sha256);
    if (!fs.existsSync(blob)) {
      results.push({
        absPath: entry.absPath,
        status: 'failed',
        currentSha256: currentSha,
        error: `snapshot blob missing for sha ${entry.sha256.slice(0, 12)}`,
      });
      continue;
    }

    if (cur && currentSha === entry.sha256) {
      results.push({ absPath: entry.absPath, status: 'unchanged', currentSha256: currentSha });
      continue;
    }

    // Drift detection. The expected post-action state is a sha that differs
    // from `entry.sha256` (the action wrote new bytes). We can only tell the
    // file drifted if the queue records the post-action sha — which it does
    // not, deliberately, because we don't run the action ourselves. So the
    // strict-but-useful test is: if the file currently exists AND its sha is
    // not the pre-action sha, treat it as drifted unless caller forces.
    const drifted = cur != null;
    if (drifted && !force) {
      results.push({
        absPath: entry.absPath,
        status: 'drifted-skipped',
        currentSha256: currentSha,
      });
      continue;
    }

    try {
      atomicReplace(blob, entry.absPath, entry.mode || 0o644);
      results.push({
        absPath: entry.absPath,
        status: drifted ? 'drifted-forced' : 'restored',
        currentSha256: currentSha,
      });
    } catch (err) {
      results.push({
        absPath: entry.absPath,
        status: 'failed',
        currentSha256: currentSha,
        error: String(err),
      });
    }
  }

  const ok = results.every(
    (r) => r.status === 'restored' || r.status === 'unchanged' || r.status === 'removed' || r.status === 'drifted-forced',
  );
  return { snapshotId: id, files: results, ok };
}

export interface SnapshotSummary {
  id: string;
  takenAt: number;
  totalBytes: number;
  fileCount: number;
}

export function listSnapshots(): SnapshotSummary[] {
  if (!fs.existsSync(SNAPSHOTS_ROOT)) return [];
  const out: SnapshotSummary[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(SNAPSHOTS_ROOT);
  } catch (err) {
    logger.warn(`snapshot: list failed: ${String(err)}`);
    return [];
  }
  for (const id of entries) {
    const m = readManifest(id);
    if (!m) continue;
    out.push({
      id,
      takenAt: m.takenAt,
      totalBytes: m.totalBytes,
      fileCount: m.files.length,
    });
  }
  out.sort((a, b) => b.takenAt - a.takenAt);
  return out;
}

export function removeSnapshot(id: string): void {
  const dir = path.join(SNAPSHOTS_ROOT, id);
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`snapshot: remove "${id}" failed: ${String(err)}`);
  }
}

/**
 * Enforce a global cap across all snapshots. Drops oldest until the disk
 * usage is at-or-under `capBytes`. Returns the ids that were pruned.
 */
export function pruneSnapshotsToBudget(capBytes: number): string[] {
  const summaries = listSnapshots();
  let total = summaries.reduce((acc, s) => acc + s.totalBytes, 0);
  if (total <= capBytes) return [];
  // Oldest first.
  summaries.sort((a, b) => a.takenAt - b.takenAt);
  const pruned: string[] = [];
  for (const s of summaries) {
    if (total <= capBytes) break;
    removeSnapshot(s.id);
    total -= s.totalBytes;
    pruned.push(s.id);
  }
  return pruned;
}
