'use strict';

// Snapshot module tests. Run via the same harness as plugin.test.js — the
// vscode stub is required because snapshot.ts -> logger.ts -> vscode.
//
// Each test points the snapshots root at a temp dir by overriding HOME so
// the module-level `SNAPSHOTS_ROOT` resolves into that temp tree. No need
// to mutate the module after import.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function freshHome(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cockpit-snap-${label}-`));
  process.env.HOME = dir;
  // Drop and re-require so SNAPSHOTS_ROOT (computed at module load) re-resolves.
  delete require.cache[require.resolve('../out/snapshot.js')];
  return dir;
}

function loadSnapshot() {
  return require('../out/snapshot.js');
}

function writeFile(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function sha256(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

test('snapshot.capture writes a manifest + content-addressed blobs', () => {
  freshHome('capture');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const a = path.join(tmp, 'a.txt');
  const b = path.join(tmp, 'b.txt');
  writeFile(a, 'alpha');
  writeFile(b, 'beta');

  const result = snap.capture({
    id: 'cap-1',
    cwd: tmp,
    filesAffected: [a, b],
  });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.files.length, 2);
  assert.equal(result.manifest.files[0].sha256, sha256('alpha'));
  assert.equal(result.manifest.files[1].sha256, sha256('beta'));

  // Blobs exist on disk under <root>/cap-1/files/<sha>.
  const blobDir = path.join(snap.snapshotsRoot(), 'cap-1', 'files');
  assert.ok(fs.existsSync(path.join(blobDir, sha256('alpha'))));
  assert.ok(fs.existsSync(path.join(blobDir, sha256('beta'))));
});

test('rollback restores files byte-identically and reports per-file status', () => {
  freshHome('roundtrip');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const f = path.join(tmp, 'sub', 'file.txt');
  const before = 'original-bytes';
  writeFile(f, before);

  const cap = snap.capture({ id: 'rt-1', cwd: tmp, filesAffected: [f] });
  assert.equal(cap.ok, true);

  // Mutate (simulate the action running).
  fs.writeFileSync(f, 'mutated-bytes');
  // Now ask for rollback. The current sha != snapshot sha, so without
  // `force` the file is `drifted-skipped`.
  const skipped = snap.rollback('rt-1');
  assert.equal(skipped.ok, false);
  assert.equal(skipped.files[0].status, 'drifted-skipped');
  assert.equal(fs.readFileSync(f, 'utf8'), 'mutated-bytes');

  // With force=true the rollback proceeds.
  const forced = snap.rollback('rt-1', { force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.files[0].status, 'drifted-forced');
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.equal(sha256(fs.readFileSync(f)), sha256(before));
});

test('snapshotting a missing file records `absent: true`; rollback removes the post-action create', () => {
  freshHome('absent');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const target = path.join(tmp, 'will-be-created.txt');

  const cap = snap.capture({ id: 'abs-1', cwd: tmp, filesAffected: [target] });
  assert.equal(cap.ok, true);
  assert.equal(cap.manifest.files[0].absent, true);

  // Action creates the file.
  fs.writeFileSync(target, 'created-by-action');
  // Rollback should delete it.
  const rb = snap.rollback('abs-1');
  assert.equal(rb.ok, true);
  assert.equal(rb.files[0].status, 'removed');
  assert.equal(fs.existsSync(target), false);
});

test('over-budget capture is rejected without writing any blobs', () => {
  freshHome('overbudget');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const f = path.join(tmp, 'big.txt');
  writeFile(f, 'x'.repeat(2048));
  const result = snap.capture({
    id: 'ob-1',
    cwd: tmp,
    filesAffected: [f],
    maxBytes: 1024,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, 'over-budget');
  assert.equal(fs.existsSync(path.join(snap.snapshotsRoot(), 'ob-1')), false);
});

test('content-hash drift detection: unchanged file restores as `unchanged` (no write)', () => {
  freshHome('unchanged');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const f = path.join(tmp, 'same.txt');
  writeFile(f, 'static');
  snap.capture({ id: 'unc-1', cwd: tmp, filesAffected: [f] });
  // Don't mutate; rollback should be a no-op.
  const rb = snap.rollback('unc-1');
  assert.equal(rb.ok, true);
  assert.equal(rb.files[0].status, 'unchanged');
});

test('pruneSnapshotsToBudget drops oldest first', () => {
  freshHome('prune');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  // Three snapshots, increasing wall-clock by mutating manifest takenAt
  // after capture.
  const ids = ['p-1', 'p-2', 'p-3'];
  for (const id of ids) {
    const f = path.join(tmp, `${id}.txt`);
    writeFile(f, 'x'.repeat(1024));
    snap.capture({ id, cwd: tmp, filesAffected: [f] });
  }
  // Override takenAt so order is deterministic regardless of test speed.
  for (let i = 0; i < ids.length; i += 1) {
    const mp = path.join(snap.snapshotsRoot(), ids[i], 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.takenAt = 1000 + i;
    fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  }
  // Cap = enough for two; oldest (p-1) should be pruned.
  const pruned = snap.pruneSnapshotsToBudget(2 * 1024);
  assert.deepEqual(pruned, ['p-1']);
  assert.equal(fs.existsSync(path.join(snap.snapshotsRoot(), 'p-1')), false);
  assert.equal(fs.existsSync(path.join(snap.snapshotsRoot(), 'p-2')), true);
  assert.equal(fs.existsSync(path.join(snap.snapshotsRoot(), 'p-3')), true);
});

test('atomic-rollback: tmp file does not persist when rollback completes', () => {
  freshHome('atomic');
  const snap = loadSnapshot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-src-'));
  const f = path.join(tmp, 'doc.txt');
  writeFile(f, 'pre');
  snap.capture({ id: 'at-1', cwd: tmp, filesAffected: [f] });
  fs.writeFileSync(f, 'post');
  const rb = snap.rollback('at-1', { force: true });
  assert.equal(rb.ok, true);
  // No `.cockpit-restore-` siblings should remain in the dir.
  const siblings = fs.readdirSync(tmp);
  for (const s of siblings) {
    assert.equal(s.startsWith('.cockpit-restore-'), false, `stale tmp: ${s}`);
    assert.equal(s.startsWith('.cockpit-trash-'), false, `stale trash: ${s}`);
  }
});
