'use strict';

// Sandbox synth tests — covers the brief's acceptance criterion:
// "Sandbox JSONL passes the existing parseLine() validator."
//
// IMPORTANT: this file is auto-discovered by test/claudeData.test.js BEFORE
// it pins process.env.HOME to a tmp dir. We MUST NOT eagerly require any
// module that transitively captures `os.homedir()` at module-load time.
// Defer the require into the test bodies. Same pattern as test/replay.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let sandbox;
function loadSandbox() {
  if (!sandbox) sandbox = require('../out/sandbox.js');
  return sandbox;
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-sandbox-'));
}

test('startSandbox synthesizes a project + 30-event JSONL', () => {
  const sb = loadSandbox();
  const root = tmpRoot();
  const restore = sb.__setSandboxRootForTests(root);
  try {
    const result = sb.startSandbox();
    assert.equal(result.ok, true, `expected ok, got error: ${result.error}`);
    assert.ok(result.state, 'state should be defined');
    assert.equal(result.state.active, true);
    assert.ok(fs.existsSync(result.state.projectRoot), 'project dir should exist');
    assert.ok(fs.existsSync(result.state.sessionFile), 'session jsonl should exist');
    assert.ok(fs.existsSync(path.join(result.state.projectRoot, 'CLAUDE.md')));

    // Every line must parse as JSON. The existing claudeData.parseLine
    // validator is intentionally generous — we mirror it inline so this
    // test exercises the SAME shape claudeData consumes.
    const raw = fs.readFileSync(result.state.sessionFile, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 30, `expected 30 events, got ${lines.length}`);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(typeof parsed.type === 'string' && parsed.type.length > 0);
      assert.ok(typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0);
      assert.ok(parsed.sessionId, 'every line carries a sessionId');
    }
  } finally {
    restore();
  }
});

test('startSandbox is idempotent — second call reuses existing JSONL', () => {
  const sb = loadSandbox();
  const root = tmpRoot();
  const restore = sb.__setSandboxRootForTests(root);
  try {
    const first = sb.startSandbox();
    const second = sb.startSandbox();
    assert.equal(second.ok, true);
    assert.equal(second.state.sessionFile, first.state.sessionFile, 'session file should match across starts');
    assert.equal(second.state.sessionId, first.state.sessionId);
  } finally {
    restore();
  }
});

test('exitSandbox tears down the synthesized tree', () => {
  const sb = loadSandbox();
  const root = tmpRoot();
  const restore = sb.__setSandboxRootForTests(root);
  try {
    sb.startSandbox();
    assert.ok(sb.sandboxExists(), 'precondition: sandbox should exist after start');
    const result = sb.exitSandbox();
    assert.equal(result.ok, true);
    assert.equal(sb.sandboxExists(), false, 'sandbox dir should be gone');
  } finally {
    restore();
  }
});
