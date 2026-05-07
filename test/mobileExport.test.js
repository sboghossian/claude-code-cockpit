'use strict';

// Mobile companion sanitizer + publisher tests. Each test redirects HOME to a
// temp dir so the published file lands inside an isolated tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshHome(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cockpit-mobile-${label}-`));
  process.env.HOME = dir;
  delete require.cache[require.resolve('../out/mobileExport.js')];
  return dir;
}

function loadMobile() {
  return require('../out/mobileExport.js');
}

function makeEntry(over) {
  return Object.assign(
    {
      id: 'act-1',
      source: 'cockpit',
      action: {
        id: 'act-1',
        worktree: 'approval-queue',
        tool: 'Edit',
        argsRedacted: 'edit foo.txt',
        filesAffected: ['/Users/stephane/secret/CLAUDE.md'],
        requestedAt: Date.now() - 30_000,
        byAgent: 'claude-opus-4-7',
        expectedDiffBytes: 128,
        rollbackable: true,
      },
      status: 'pending',
      snapshotId: 'snap-aaa',
      snapshotError: undefined,
      decidedAt: undefined,
      decidedBy: undefined,
      decisionNote: undefined,
      rollback: undefined,
    },
    over,
  );
}

test('sanitizeEntry strips file paths and never emits /Users/...', () => {
  freshHome('strip-paths');
  const m = loadMobile();
  const entry = makeEntry({
    id: 'act-with-path',
    action: Object.assign(makeEntry().action, {
      tool: '/Users/stephane/Edit',
      byAgent: '/Users/stephane/agents/foo',
    }),
  });
  const out = m.sanitizeEntry(entry, Date.now());
  const json = JSON.stringify(out);
  assert.equal(json.includes('/Users/'), false, `path leaked into ${json}`);
  assert.equal(json.includes('/'), false, `slash leaked into ${json}`);
  // Field whitelist: exactly these keys, nothing else. Use the same
  // collation the Object.keys().sort() default emits so the assertion is
  // case-sensitive-stable across Node versions.
  const keys = Object.keys(out).sort();
  assert.deepEqual(
    keys,
    ['ageSeconds', 'agentName', 'expectedDiffBytes', 'fileCount', 'id', 'status', 'tool'],
  );
});

test('sanitizeEntry truncates agentName to <=8 chars and never emits the full payload', () => {
  freshHome('agent-trunc');
  const m = loadMobile();
  const entry = makeEntry({
    action: Object.assign(makeEntry().action, {
      byAgent: 'claude-opus-4-7-with-very-long-suffix',
      argsRedacted: 'SUPER_SECRET_PAYLOAD_DO_NOT_LEAK_KEY=sk-12345',
    }),
  });
  const out = m.sanitizeEntry(entry, Date.now());
  assert.equal(out.agentName.length <= 8, true);
  // Sanitized output must NOT carry the full argsRedacted string anywhere.
  const json = JSON.stringify(out);
  assert.equal(
    json.includes('SUPER_SECRET_PAYLOAD'),
    false,
    'argsRedacted leaked into public payload',
  );
  assert.equal(json.includes('sk-12345'), false, 'secret-shaped value leaked');
});

test('sanitizeEntry computes ageSeconds against the supplied clock', () => {
  freshHome('age');
  const m = loadMobile();
  const now = 1_700_000_000_000;
  const entry = makeEntry({ action: Object.assign(makeEntry().action, { requestedAt: now - 90_000 }) });
  const out = m.sanitizeEntry(entry, now);
  assert.equal(out.ageSeconds, 90);
});

test('sanitizeQueue caps at 50 entries and surfaces the pending count', () => {
  freshHome('cap');
  const m = loadMobile();
  const entries = [];
  for (let i = 0; i < 80; i++) {
    entries.push(makeEntry({ id: `p-${i}`, action: Object.assign(makeEntry().action, { id: `p-${i}` }) }));
  }
  const payload = m.sanitizeQueue(entries, true, Date.now());
  assert.equal(payload.entries.length, 50);
  assert.equal(payload.pendingCount, 80);
  assert.equal(payload.enabled, true);
  assert.equal(payload.version, 1);
});

test('writePublic + clearPublic round-trip atomically', () => {
  const home = freshHome('rw');
  const m = loadMobile();
  const payload = m.sanitizeQueue([makeEntry()], true, Date.now());
  m.writePublic(payload);
  const p = m.publicQueuePath();
  assert.equal(fs.existsSync(p), true);
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries.length, 1);
  m.clearPublic();
  assert.equal(fs.existsSync(p), false);
  // Idempotent: clearing twice is a no-op, not a throw.
  m.clearPublic();
  assert.equal(home.includes(os.tmpdir()), true);
});

test('MobilePublisher writes only when the queue digest changes', () => {
  freshHome('digest');
  const m = loadMobile();
  let entries = [makeEntry({ id: 'p-1' })];
  let enabled = true;
  let now = 1_700_000_000_000;
  const pub = new m.MobilePublisher({
    supplier: () => entries,
    isEnabled: () => enabled,
    now: () => now,
  });
  pub.publish();
  const first = fs.statSync(m.publicQueuePath()).mtimeMs;
  // Bump the clock but leave entries unchanged — should NOT rewrite.
  now += 60_000;
  pub.publish();
  const second = fs.statSync(m.publicQueuePath()).mtimeMs;
  assert.equal(first, second, 'rewrote despite stable content');
  // Mutate entries — SHOULD rewrite.
  entries = [makeEntry({ id: 'p-2', action: Object.assign(makeEntry().action, { id: 'p-2' }) })];
  pub.publish();
  const third = fs.statSync(m.publicQueuePath()).mtimeMs;
  assert.equal(third >= second, true, 'expected rewrite after mutation');
});

test('MobilePublisher clears the file when disabled', () => {
  freshHome('disable');
  const m = loadMobile();
  let enabled = true;
  const pub = new m.MobilePublisher({
    supplier: () => [makeEntry()],
    isEnabled: () => enabled,
  });
  pub.publish();
  assert.equal(fs.existsSync(m.publicQueuePath()), true);
  enabled = false;
  pub.publish();
  assert.equal(fs.existsSync(m.publicQueuePath()), false, 'file should be cleared when disabled');
});

test('public payload never contains argsRedacted, snapshotId, or filesAffected', () => {
  freshHome('whitelist');
  const m = loadMobile();
  const entry = makeEntry({
    action: Object.assign(makeEntry().action, {
      argsRedacted: 'BANNED_ARGS_VALUE',
      filesAffected: ['/Users/stephane/secret.txt', '/etc/passwd'],
    }),
    snapshotId: 'BANNED_SNAPSHOT_ID',
  });
  const payload = m.sanitizeQueue([entry], true, Date.now());
  const json = JSON.stringify(payload);
  assert.equal(json.includes('BANNED_ARGS_VALUE'), false);
  assert.equal(json.includes('BANNED_SNAPSHOT_ID'), false);
  assert.equal(json.includes('/Users/'), false);
  assert.equal(json.includes('/etc/'), false);
  // fileCount IS surfaced, but the array of paths is not.
  assert.equal(payload.entries[0].fileCount, 2);
});
