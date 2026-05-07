'use strict';

// telemetry-posthog tests. Covers the four cases the launch brief calls out:
//   1. capture call with telemetry off → returns immediately, fetcher untouched
//   2. payload shape (api_key, event, distinct_id, properties.detail)
//   3. redactString strips home dir, /Users/... paths, and api-key shaped tokens
//   4. redactDetail drops forbidden keys and walks nested objects
//
// We never let the test hit the real network. The posthog module exposes
// `__setFetcherForTests` — every test installs a recording fetcher that
// captures wire payloads in memory.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const posthog = require('../out/posthog.js');
const audit = require('../out/auditLog.js');

function makeRecorder() {
  const calls = [];
  return {
    calls,
    fetcher: async (url, body) => {
      calls.push({ url, body });
      return { status: 200, bodyText: '{"status":1}' };
    },
  };
}

function withTempAuditPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-posthog-'));
  const file = path.join(dir, 'audit.log');
  return audit.__setLogPathForTests(file);
}

test('capture is a no-op when telemetry is disabled (default state)', async () => {
  posthog.__resetForTests();
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    // Configure with enabled=false — Cockpit's default state.
    posthog.configure({
      enabled: false,
      crashReportsEnabled: false,
      projectId: 'phc_test',
      host: 'localhost',
      distinctId: 'abc',
      extensionVersion: '1.0.0',
      vsCodeVersion: '1.85.0',
    });
    await posthog.capture('cockpit.tab.view', { tab: 'now' });
    assert.equal(rec.calls.length, 0, 'no outbound when enabled=false');
    assert.equal(posthog.getCounters().sent, 0);
    assert.equal(posthog.getCounters().dropped, 1);
  } finally {
    restoreFetcher();
    posthog.__resetForTests();
  }
});

test('capture is a no-op when projectId is empty (forced off)', async () => {
  posthog.__resetForTests();
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    posthog.configure({
      enabled: true,
      crashReportsEnabled: true,
      projectId: '',
      host: 'localhost',
      distinctId: 'abc',
      extensionVersion: '1.0.0',
      vsCodeVersion: '1.85.0',
    });
    await posthog.capture('cockpit.tab.view', { tab: 'now' });
    assert.equal(rec.calls.length, 0, 'no outbound when projectId is empty');
    assert.equal(posthog.getCounters().sent, 0);
  } finally {
    restoreFetcher();
    posthog.__resetForTests();
  }
});

test('capture refuses HAQQ project id 92178', async () => {
  posthog.__resetForTests();
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    posthog.configure({
      enabled: true,
      crashReportsEnabled: true,
      projectId: '92178',
      host: 'localhost',
      distinctId: 'abc',
      extensionVersion: '1.0.0',
      vsCodeVersion: '1.85.0',
    });
    await posthog.capture('cockpit.tab.view', { tab: 'now' });
    assert.equal(rec.calls.length, 0, 'capture must refuse HAQQ project id');
    assert.equal(posthog.isEnabled(), false);
  } finally {
    restoreFetcher();
    posthog.__resetForTests();
  }
});

test('capture POSTs a wire-shape body when opted in', async () => {
  posthog.__resetForTests();
  const restoreAudit = withTempAuditPath();
  audit.setAuditEnabled(true);
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    posthog.configure({
      enabled: true,
      crashReportsEnabled: false,
      projectId: 'phc_unit_test',
      host: 'localhost',
      distinctId: 'distinct-abc',
      extensionVersion: '1.2.3',
      vsCodeVersion: '1.85.0',
    });
    await posthog.capture('cockpit.tab.view', { tab: 'now' });
    assert.equal(rec.calls.length, 1, 'one outbound POST');
    const call = rec.calls[0];
    assert.match(call.url, /^https:\/\/localhost\/i\/v0\/e\/$/, 'capture endpoint');
    const payload = JSON.parse(call.body);
    assert.equal(payload.api_key, 'phc_unit_test');
    assert.equal(payload.event, 'cockpit.tab.view');
    assert.equal(payload.distinct_id, 'distinct-abc');
    assert.equal(payload.properties.tab, 'now');
    assert.equal(payload.properties.$lib, 'claude-cockpit');
    assert.equal(payload.properties.$lib_version, '1.2.3');
    assert.equal(typeof payload.timestamp, 'string');
    assert.equal(posthog.getCounters().sent, 1);
    // Audit log mirroring: the outbound must be recorded.
    const tail = audit.readAuditTail(5);
    assert.ok(tail.some((e) => e.kind === 'net.outbound' && e.detail.host === 'localhost'),
      'capture must mirror to audit log');
  } finally {
    restoreFetcher();
    restoreAudit();
    audit.__resetForTests();
    posthog.__resetForTests();
  }
});

test('capture rejects malformed event names', async () => {
  posthog.__resetForTests();
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    posthog.configure({
      enabled: true,
      crashReportsEnabled: false,
      projectId: 'phc_x',
      host: 'localhost',
      distinctId: 'd',
      extensionVersion: '1.0.0',
      vsCodeVersion: undefined,
    });
    await posthog.capture('not.cockpit.namespaced', { x: 1 });
    await posthog.capture('cockpit', { x: 1 });
    await posthog.capture('cockpit.tab', { x: 1 });
    await posthog.capture('cockpit.tab.view', { x: 1 }); // valid
    assert.equal(rec.calls.length, 1, 'only the valid event is sent');
    assert.equal(posthog.isValidEventName('cockpit.tab.view'), true);
    assert.equal(posthog.isValidEventName('cockpit.replay.scrubTo'), true);
    assert.equal(posthog.isValidEventName('foo.bar.baz'), false);
  } finally {
    restoreFetcher();
    posthog.__resetForTests();
  }
});

test('redactString strips home dir, absolute paths, and secret-shaped tokens', () => {
  const home = os.homedir();
  const original = `Error in ${home}/Documents/secret/file.txt sk-1234567890ABCDEFGHIJ token=AKIAIOSFODNN7EXAMPLE here`;
  const redacted = posthog.redactString(original);
  assert.ok(!redacted.includes(home), 'home dir must be replaced');
  assert.ok(redacted.includes('~'), 'home dir replaced with ~');
  assert.ok(!redacted.includes('sk-1234567890ABCDEFGHIJ'), 'sk-… token must be redacted');
  assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS access key must be redacted');
  assert.ok(redacted.includes('<redacted-secret>'), 'secret marker present');
});

test('redactString anonymizes /Users/... paths even outside home', () => {
  const out = posthog.redactString('Stack: at fn (/Users/someone/code/file.ts:10:5)');
  assert.ok(!out.includes('/Users/someone'), '/Users/... path must be redacted');
});

test('redactDetail drops forbidden keys and recurses', () => {
  const out = posthog.redactDetail({
    tab: 'now',
    apiKey: 'sk-this-should-never-leave',
    nested: {
      filePath: '/Users/me/secrets.txt',
      ok: true,
      password: 'hunter2',
    },
    arr: [1, 2, '/Users/me/file.ts', { token: 'should-drop' }],
  });
  assert.equal(out.tab, 'now');
  assert.equal(out.apiKey, '<dropped>', 'apiKey must be dropped');
  assert.equal(out.nested.password, '<dropped>', 'nested password must be dropped');
  assert.ok(typeof out.nested.filePath === 'string', 'paths kept but redacted');
  assert.ok(!out.nested.filePath.includes('/Users/'), 'nested path redacted');
  assert.equal(out.nested.ok, true);
  assert.equal(out.arr[0], 1);
  assert.ok(!String(out.arr[2]).includes('/Users/'), 'array string entries redacted');
  assert.equal(out.arr[3].token, '<dropped>', 'forbidden key inside array entries dropped');
});

test('captureCrash is gated by crashReports flag even when telemetry.enabled', async () => {
  posthog.__resetForTests();
  const rec = makeRecorder();
  const restoreFetcher = posthog.__setFetcherForTests(rec.fetcher);
  try {
    // telemetry on but crashReports OFF → no crash event should fire.
    posthog.configure({
      enabled: true,
      crashReportsEnabled: false,
      projectId: 'phc_x',
      host: 'localhost',
      distinctId: 'd',
      extensionVersion: '1.0.0',
      vsCodeVersion: undefined,
    });
    await posthog.captureCrash('activate', new Error('boom'), 'redacted-stack');
    assert.equal(rec.calls.length, 0, 'crash event blocked when crashReports flag off');

    // Flip crashReports on → next capture goes through.
    posthog.configure({
      enabled: true,
      crashReportsEnabled: true,
      projectId: 'phc_x',
      host: 'localhost',
      distinctId: 'd',
      extensionVersion: '1.0.0',
      vsCodeVersion: undefined,
    });
    await posthog.captureCrash('activate', new Error('boom'), 'at fn (out/extension.js:1:1)');
    assert.equal(rec.calls.length, 1, 'crash event fires when both flags on');
    const payload = JSON.parse(rec.calls[0].body);
    assert.equal(payload.event, 'cockpit.crash.report');
    assert.equal(payload.properties.surface, 'activate');
    assert.equal(payload.properties.errorName, 'Error');
    assert.equal(payload.properties.errorMessage, 'boom');
    assert.ok(payload.properties.stack.includes('out/extension.js'));
  } finally {
    restoreFetcher();
    posthog.__resetForTests();
  }
});

test('crash.anonymizeStack replaces home dir and blanks external frames', () => {
  posthog.__resetForTests();
  const crash = require('../out/crash.js');
  crash.setExtensionRoot('/fake/extension');
  const home = os.homedir();
  const fakeStack = [
    'Error: kaboom',
    `    at activate (${home}/Documents/Code/claude-cockpit/out/extension.js:42:10)`,
    `    at /usr/lib/vscode/something.js:1:1`,
    `    at otherFn (/private/tmp/whatever.js:1:1)`,
  ].join('\n');
  const err = new Error('kaboom');
  err.stack = fakeStack;
  const anonymized = crash.anonymizeStack(err);
  assert.ok(!anonymized.includes(home), 'home dir replaced');
  assert.ok(anonymized.includes('out/extension.js'), 'cockpit frame preserved');
  assert.ok(anonymized.includes('<external-frame>'), 'external frames blanked');
});

test('getStatusForSnapshot exposes flags + counters but never the projectId', () => {
  posthog.__resetForTests();
  posthog.configure({
    enabled: true,
    crashReportsEnabled: false,
    projectId: 'phc_secret_value',
    host: 'eu.posthog.com',
    distinctId: 'd-1234',
    extensionVersion: '1.0.0',
    vsCodeVersion: '1.85.0',
  });
  const status = posthog.getStatusForSnapshot();
  assert.equal(status.enabled, true);
  assert.equal(status.crashReportsEnabled, false);
  assert.equal(status.projectIdSet, true);
  assert.equal(status.host, 'eu.posthog.com');
  assert.equal(typeof status.sent, 'number');
  // Defensive: serialised status must not leak the project id or distinctId.
  const serialised = JSON.stringify(status);
  assert.ok(!serialised.includes('phc_secret_value'), 'status must not leak projectId');
  assert.ok(!serialised.includes('d-1234'), 'status must not leak distinctId');
  posthog.__resetForTests();
});
