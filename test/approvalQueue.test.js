'use strict';

// Approval queue tests. Each test redirects HOME to a temp dir so the
// queue file (`~/.claude/.cockpit/queue.json`) and snapshots root land
// inside an isolated tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshHome(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cockpit-q-${label}-`));
  process.env.HOME = dir;
  delete require.cache[require.resolve('../out/approvalQueue.js')];
  delete require.cache[require.resolve('../out/snapshot.js')];
  return dir;
}

function loadQueue() {
  return require('../out/approvalQueue.js');
}

function makeAction(over) {
  return Object.assign(
    {
      id: 'act-1',
      worktree: 'approval-queue',
      tool: 'Edit',
      argsRedacted: 'edit foo.txt',
      filesAffected: [],
      requestedAt: Date.now(),
      byAgent: 'claude-opus-4-7',
      expectedDiffBytes: 0,
      rollbackable: true,
    },
    over,
  );
}

test('enqueue persists to disk and lists back as pending', () => {
  freshHome('persist');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  const action = makeAction({ id: 'a-persist', filesAffected: [], rollbackable: false });
  const { entry } = store.enqueue(action);
  assert.equal(entry.status, 'pending');

  // Reload from disk (new instance) — entry should still be there.
  const reloaded = new q.ApprovalQueueStore();
  const list = reloaded.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a-persist');
  assert.equal(list[0].status, 'pending');
});

test('enqueue with filesAffected captures a snapshot and rollback restores', () => {
  const home = freshHome('snap-roundtrip');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  const sandbox = path.join(home, 'project');
  fs.mkdirSync(sandbox, { recursive: true });
  const f = path.join(sandbox, 'note.txt');
  fs.writeFileSync(f, 'before-action');

  const { entry } = store.enqueue(
    makeAction({ id: 'a-snap', filesAffected: [f], rollbackable: true }),
  );
  assert.equal(entry.status, 'pending');
  assert.ok(entry.snapshotId, 'snapshot id should be set');

  // Action mutates the file.
  fs.writeFileSync(f, 'after-action');

  // Rollback the entry. Drift detected → without force=true it's skipped.
  const skipped = store.rollback('a-snap', { decidedBy: 'test' });
  assert.equal(skipped.result.ok, false);
  assert.equal(skipped.result.files[0].status, 'drifted-skipped');
  assert.equal(fs.readFileSync(f, 'utf8'), 'after-action');

  const forced = store.rollback('a-snap', { decidedBy: 'test', forceRollback: true });
  assert.equal(forced.result.ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), 'before-action');
  assert.equal(forced.entry.status, 'rolled-back');
});

test('snapshot failure marks entry `snapshot-failed` and disables rollback', () => {
  freshHome('snap-fail');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  // Non-absolute path → capture rejects → entry marked snapshot-failed.
  const { entry } = store.enqueue(
    makeAction({ id: 'a-fail', filesAffected: ['relative/path.txt'], rollbackable: true }),
  );
  assert.equal(entry.status, 'snapshot-failed');
  assert.ok(entry.snapshotError && entry.snapshotError.includes('non-absolute'));
  assert.equal(entry.snapshotId, undefined);

  const result = store.rollback('a-fail', { decidedBy: 'test' });
  assert.equal(result.result.ok, false);
});

test('approve / reject transition pending → decided once and stay decided', () => {
  freshHome('decide');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  store.enqueue(makeAction({ id: 'a-dec', filesAffected: [], rollbackable: false }));
  const approved = store.approve('a-dec', { decidedBy: 'tester' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.decidedBy, 'tester');
  // Second approve / reject is a no-op (already decided).
  const second = store.reject('a-dec', { decidedBy: 'tester2' });
  assert.equal(second.status, 'approved');
});

test('jarvis ingest merges pending approvals as a separate source', () => {
  freshHome('jarvis');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  store.ingestJarvis([
    {
      id: 'jarv-001',
      requestedAt: Math.floor(Date.now() / 1000),
      requestedBy: 'Boo-mac',
      tool: 'action.write',
      payload: 'echo hello',
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      result: null,
    },
  ]);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'jarvis:jarv-001');
  assert.equal(list[0].source, 'jarvis');
  assert.equal(list[0].action.rollbackable, false);
});

test('readApprovalCounts reads the same queue from disk', () => {
  freshHome('counts');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  store.enqueue(makeAction({ id: 'a1', filesAffected: [] }));
  store.enqueue(makeAction({ id: 'a2', filesAffected: [] }));
  store.approve('a1', { decidedBy: 'x' });
  const counts = q.readApprovalCounts();
  assert.equal(counts.pending, 1);
  // Both were within the last 24h.
  assert.equal(counts.recent, 2);
});

test('content-hash drift detection: snapshot-then-restore is `unchanged` when no edits happened', () => {
  const home = freshHome('drift-clean');
  const q = loadQueue();
  const store = new q.ApprovalQueueStore();
  const sandbox = path.join(home, 'project');
  fs.mkdirSync(sandbox, { recursive: true });
  const f = path.join(sandbox, 'pristine.txt');
  fs.writeFileSync(f, 'pristine');
  store.enqueue(makeAction({ id: 'a-clean', filesAffected: [f], rollbackable: true }));
  // Approve without touching the file.
  store.approve('a-clean', { decidedBy: 'tester' });
  // Now ask for rollback even though we approved (sometimes user wants to
  // undo even after approve). The rollback should be a no-op since the file
  // matches the snapshot sha.
  const rb = store.rollback('a-clean', { decidedBy: 'tester' });
  // Status was already approved → store.transition early-outs and rollback
  // still inspects the snapshot. We expect ok=true and 'unchanged'.
  assert.equal(rb.result.ok, true);
  assert.equal(rb.result.files[0].status, 'unchanged');
});
