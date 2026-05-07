# feat/launch-approval-queue  (Phase 1, XL, ~1400 LOC)

## Goal

Every autonomous multi-step Claude action lands in a queue tab with a
filesystem-snapshot rollback bundle. User clicks Approve / Reject / Revert.
LeCun-style human gate. Extends the existing jarvis.ts approval flow
(`JarvisApproval` shape) so boo-mesh requests show up alongside Cockpit's
own queue. Snapshots are tar.gz of touched paths under
`~/.claude/.cockpit/snapshots/<id>/`. Revert untar's atomically.

## In-scope files

- NEW `src/approvalQueue.ts` — queue store (sqlite better-sqlite3 if
  available, else JSON file) at `~/.claude/.cockpit/queue.db`. Shape
  matches `WorktreeAction` from plugin.ts. ~400 LOC.
- NEW `src/snapshot.ts` — pre-action filesystem snapshot. Walks the
  declared `filesAffected[]`, copies each into
  `~/.claude/.cockpit/snapshots/<id>/<sha>` with original relative paths.
  `revert(snapshotId)` writes them back atomically with a single fsync
  per file. ~300 LOC.
- NEW `media/sidebar.approval.js` — webview UI; registers the
  `approvalQueue`, `approvalDetail`, `approvalRollback` widgets via the
  Phase-0 `registerExternalComponent` API. ~500 LOC.
- NEW `media/sidebar.approval.css` — worktree-scoped styles
  (`.cockpit-approval-*`). ~150 LOC.
- `src/sidebarProvider.ts:55–131` — append message types in named block:
  `approval.queueRefresh | approval.approve | approval.reject |
   approval.revert | approval.openSnapshotDir | approval.bulkApprove`.
- `src/sidebarProvider.ts:574–1063` — append `case` branches in named
  block at end of switch.
- `src/sidebarProvider.ts:218–223` — extend constructor: add private
  `approvalQueue: ApprovalQueueStore` instance.
- `src/sidebarProvider.ts:225–277` — append a `startApprovalWatcher()`
  call modeled on `startJarvisWatcher()` (line 279).
- `src/claudeData.ts:191–230` (CockpitSnapshot interface) — add OPTIONAL
  `approvalCounts?: { pending: number; recent: number }`. NOT the full
  queue. Full queue is fetched lazily on tab open.
- `src/claudeData.ts:2008–2230` (snapshotInner) — one new line:
  `recordTime('snapshot.approvalCounts', () => readApprovalCounts())`.
- `media/sidebar.js:3525–3553` (DEFAULT_TAB_COMPOSITIONS) — add one entry:
  `approval: ['approvalQueue', 'approvalDetail']`.
- `media/sidebar.js:3558–3579` (TAB_ICONS) — add one stroke-only SVG.
- `media/sidebar.js:3589–3611` (tabCatalogue array) — append one entry.
- `package.json:76–110` (commands) — add 4 commands:
  `claudeCockpit.approval.openQueue`, `claudeCockpit.approval.bulkApprove`,
  `claudeCockpit.approval.bulkReject`, `claudeCockpit.approval.revertLast`.
- `package.json:111–199` (configuration) — add 3 settings:
  `claudeCockpit.approval.autoSnapshot` (bool, default true),
  `claudeCockpit.approval.snapshotMaxBytes` (number, default 50MB),
  `claudeCockpit.approval.requireForToolNames` (string[], default
  ['Bash','Edit','Write','MultiEdit']).
- `CHANGELOG.md` — append `### Added — Approval queue + rollback`.
- `tasks/todo.md` — append `## v1.0 — approval-queue` section.

## Out-of-scope

- Do NOT modify `src/jarvis.ts`. Read FROM it via the existing
  `readJarvis()` and merge its pendingApprovals into the queue at
  display time.
- Do NOT add any session-modifying logic. Cockpit only OBSERVES Claude
  Code's behavior. The "queue" is a dashboard plus a revert API; the
  enforcement (blocking the agent) is left to upstream hooks Stephane
  configures separately. v1.0 ships dashboard + revert; enforcement is
  v1.1.
- Do NOT replace the welcome notification flow at sidebarProvider.ts:300–319.
  Extend the same `showInformationMessage` notification pattern.

## Dependencies (from other worktrees)

- `plugin.ts:WorktreeAction` (Phase 0).
- `plugin.ts:SnapshotRef` (Phase 0).
- `plugin.ts:registerExternalComponent` (Phase 0).
- `auditLog.ts:appendAuditEvent` (permissions-audit) — every approve/reject
  appends an `AuditEvent` of kind `tool.invoke`. SOFT dependency: log
  via try/catch; if auditLog isn't merged yet, no-op.

## Acceptance criteria

- [ ] User can: open Approval tab, see pending list, click Approve →
  queue updates within 250ms, snapshot file persists, audit log entry
  written.
- [ ] Revert: clicking Revert untar's the snapshot, restores files
  byte-identically (sha256 verified), writes a `revert` audit event.
- [ ] If filesystem snapshot fails (disk full, permission), the queue
  entry is marked `snapshot_failed` and the Approve action shows a red
  warning; revert is grayed out.
- [ ] Existing jarvis approvals (`readJarvis().pendingApprovals`) still
  surface as VSCode `showInformationMessage` notifications (unchanged
  from v0.21.0) AND appear in the new Approval tab as a separate source
  pill.
- [ ] Snapshot directory size is bounded by `snapshotMaxBytes`; oldest
  pruned on overflow.
- [ ] `npm test` green; 6 new tests for snapshot.ts (write/restore/sha,
  prune, overflow, atomic-rollback).

## Test plan

Unit (test/approvalQueue.test.js, test/snapshot.test.js):
- Write 5 files, snapshot, mutate them, revert, verify sha256 unchanged.
- Pre-fill queue with 100 entries, check pruneOldest enforces budget.
- Concurrent approve+revert: revert must win (later wall-clock).

Manual:
- Trigger a real Edit via Claude Code in a sandbox folder with the hook
  `.claude/settings.json:hooks.PreToolUse` set to invoke
  `claudeCockpit.approval.enqueue`. Observe queue tab populates.
- Approve, see action complete; Revert, see file restored.
- Reject, verify Claude Code aborts (depends on hook). Document the
  hook config snippet in tasks/todo.md.

## Rollback plan

Revert the merge commit. The new dir `~/.claude/.cockpit/` is
self-contained; rolling back leaves it on disk but inert (it's just
.tar.gz files). Document `rm -rf ~/.claude/.cockpit/snapshots/` as
a manual cleanup step in the changelog if reverted.
