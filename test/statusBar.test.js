'use strict';

// Status-bar update tests — covers the brief's acceptance criterion:
// "status-bar update on approval-count change."
//
// IMPORTANT: this file is auto-discovered by test/claudeData.test.js BEFORE
// it pins process.env.HOME. statusBar.ts imports claudeData (for
// formatTokens), which captures `os.homedir()` at module load. We MUST
// require statusBar lazily inside test bodies. Same pattern as
// test/replay.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

let statusBar;
let vscodeStub;
const created = [];

function loadStatusBar() {
  if (statusBar) return;
  vscodeStub = require('./vscodeStub.js');
  // Patch the stub with a StatusBarItem factory + alignment enum so the
  // module-under-test compiles without a real VS Code host.
  vscodeStub.StatusBarAlignment = { Left: 1, Right: 2 };
  vscodeStub.window.createStatusBarItem = () => {
    const item = {
      text: '',
      tooltip: '',
      command: undefined,
      visible: false,
      show() { this.visible = true; },
      hide() { this.visible = false; },
      dispose() { this.visible = false; },
    };
    created.push(item);
    return item;
  };
  statusBar = require('../out/statusBar.js');
}

function emptyStats() {
  return {
    sessionFile: undefined,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    filesTouched: [],
  };
}

function makeSnap(overrides) {
  return Object.assign({
    cwd: '/tmp/demo',
    projects: [],
    stats: {
      ...emptyStats(),
      sessionFile: '/tmp/demo/.session.jsonl',
      totalTokens: 12345,
      filesTouched: [{ filePath: 'a.ts', tool: 'Edit', count: 1 }],
    },
    approvalCounts: { pending: 0, recent: 0 },
    audit: { last24h: 0, lastDomain: undefined },
  }, overrides);
}

test('status-bar shows approval count when pending > 0', () => {
  loadStatusBar();
  created.length = 0;
  const sb = statusBar.createStatusBar();
  // approvalItem is the 4th item created (cwd, token, files, approval).
  const approvalItem = created[3];
  assert.ok(approvalItem, 'approval status bar item should be created');

  sb.update(makeSnap({ approvalCounts: { pending: 0, recent: 0 } }));
  assert.equal(approvalItem.visible, false, 'approval hidden when pending = 0');

  sb.update(makeSnap({ approvalCounts: { pending: 3, recent: 5 } }));
  assert.equal(approvalItem.visible, true, 'approval visible when pending > 0');
  assert.match(approvalItem.text, /3/, 'shows the pending count');

  sb.update(makeSnap({ approvalCounts: { pending: 0, recent: 0 } }));
  assert.equal(approvalItem.visible, false, 'hidden again when count drops back to 0');

  sb.dispose();
});

test('status-bar hides every dynamic item when snapshot is undefined', () => {
  loadStatusBar();
  created.length = 0;
  const sb = statusBar.createStatusBar();
  sb.update(undefined);
  for (const item of created) {
    assert.equal(item.visible, false, 'all items hidden');
  }
  sb.dispose();
});

test('status-bar surfaces audit dot when last24h > 0', () => {
  loadStatusBar();
  created.length = 0;
  const sb = statusBar.createStatusBar();
  // auditItem is the 5th (cwd, token, files, approval, audit).
  const auditItem = created[4];
  sb.update(makeSnap({ audit: { last24h: 7, lastDomain: 'api.github.com' } }));
  assert.equal(auditItem.visible, true);
  assert.match(auditItem.text, /7/);
  sb.dispose();
});
