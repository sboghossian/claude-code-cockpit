'use strict';

// Notifications debounce test — covers the brief's acceptance criterion:
// "Notifications fire at most once per 30s window."
//
// We patch the vscode stub at module-resolution time so notify() actually
// invokes a spy instead of a real VS Code dialog.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Override the vscode stub for THIS file BEFORE we require notifications.
// The shared register.js routes `require('vscode')` to test/vscodeStub.js;
// we mutate that exported object so subsequent requires see the spy.
const vscodeStub = require('./vscodeStub.js');

let infoCalls = [];
let warnCalls = [];

vscodeStub.window.showInformationMessage = async (message, ...labels) => {
  infoCalls.push({ message, labels });
  return labels[0]; // user "clicks" first action by default
};
vscodeStub.window.showWarningMessage = async (message, ...labels) => {
  warnCalls.push({ message, labels });
  return labels[0];
};
vscodeStub.workspace = {
  getConfiguration: () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  }),
};

// Now require the module under test.
const notifications = require('../out/notifications.js');

test('notify() fires once, then drops duplicates within the debounce window', async () => {
  notifications.__resetForTests();
  infoCalls = [];

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
  // First call returns whatever the spy "chose" (no labels → undefined).
  assert.equal(a, undefined);
  assert.equal(b, undefined);
  assert.equal(c, undefined);
});

test('notify() honors a custom debounce window', async () => {
  notifications.__resetForTests();
  infoCalls = [];

  await notifications.notify({
    key: 'test.window',
    level: 'info',
    message: 'first',
    debounceMs: 1, // very small
  });
  // Wait past the window.
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
  notifications.__resetForTests();
  warnCalls = [];
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
  notifications.__resetForTests();
  infoCalls = [];
  // Flip the toggle off.
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
  // Restore.
  vscodeStub.workspace.getConfiguration = () => ({
    get: (_key, fallback) => (fallback === undefined ? true : fallback),
  });
});
