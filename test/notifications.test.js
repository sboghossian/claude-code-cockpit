'use strict';

// Notifications debounce test — covers the brief's acceptance criterion:
// "Notifications fire at most once per 30s window."
//
// IMPORTANT: this file is auto-discovered by test/claudeData.test.js BEFORE
// it pins process.env.HOME. We must not eagerly require any module that
// transitively captures `os.homedir()` at module load. Notifications module
// itself doesn't, but we still defer the require + the vscode stub mutation
// into the test bodies so we never even risk module-load side effects firing
// before claudeData.test.js has finished setting up its tmp HOME.

const test = require('node:test');
const assert = require('node:assert/strict');

let notifications;
let vscodeStub;
let infoCalls = [];
let warnCalls = [];

function load() {
  if (vscodeStub) return;
  vscodeStub = require('./vscodeStub.js');
  // Patch the stub with the spies + a default-on workspace.getConfiguration.
  vscodeStub.window.showInformationMessage = async (message, ...labels) => {
    infoCalls.push({ message, labels });
    return undefined; // simulate user dismissing without action choice
  };
  vscodeStub.window.showWarningMessage = async (message, ...labels) => {
    warnCalls.push({ message, labels });
    return undefined;
  };
  vscodeStub.workspace = {
    getConfiguration: () => ({
      get: (_key, fallback) => (fallback === undefined ? true : fallback),
    }),
  };
  notifications = require('../out/notifications.js');
}

test('notify() fires once, then drops duplicates within the debounce window', async () => {
  load();
  notifications.__resetForTests();
  infoCalls = [];
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  });

  const a = await notifications.notify({
    key: 'test.dupe',
    level: 'info',
    message: 'first',
  });
  const b = await notifications.notify({
    key: 'test.dupe',
    level: 'info',
    message: 'second (should be dropped)',
  });
  const c = await notifications.notify({
    key: 'test.dupe',
    level: 'info',
    message: 'third (should be dropped)',
  });

  assert.equal(infoCalls.length, 1, 'exactly one underlying showInformationMessage call');
  assert.equal(infoCalls[0].message, 'first');
  assert.equal(a, undefined);
  assert.equal(b, undefined);
  assert.equal(c, undefined);
});

test('notify() honors a custom debounce window', async () => {
  load();
  notifications.__resetForTests();
  infoCalls = [];
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  });

  await notifications.notify({
    key: 'test.window',
    level: 'info',
    message: 'first',
    debounceMs: 1,
  });
  await new Promise((r) => setTimeout(r, 10));
  await notifications.notify({
    key: 'test.window',
    level: 'info',
    message: 'second (should fire)',
    debounceMs: 1,
  });
  assert.equal(infoCalls.length, 2);
});

test('notify() respects level: warn → showWarningMessage', async () => {
  load();
  notifications.__resetForTests();
  warnCalls = [];
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  });

  await notifications.notify({
    key: 'test.warn',
    level: 'warn',
    message: 'careful',
    actions: ['OK', 'Cancel'],
  });
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].message, 'careful');
  assert.deepEqual(warnCalls[0].labels, ['OK', 'Cancel']);
});

test('notify() returns undefined when settings disable notifications', async () => {
  load();
  notifications.__resetForTests();
  infoCalls = [];
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (typeof fallback === 'boolean' ? false : fallback),
  });
  const result = await notifications.notify({
    key: 'test.disabled',
    level: 'info',
    message: 'should not fire',
  });
  assert.equal(result, undefined);
  assert.equal(infoCalls.length, 0);
  // Restore default-on for any later tests.
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  });
});
