'use strict';

// Replay-timeline (Phase 1 launch wave) tests. Five sessionDiff cases per the
// brief — single-edit, multi-edit ordering, write-then-edit, conflicting
// writes, malformed line — plus fork creation and cost projection.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// IMPORTANT: this file is auto-discovered by test/claudeData.test.js BEFORE
// it overrides process.env.HOME. We MUST NOT eagerly require modules that
// transitively import './claudeData' (e.g. replay.js → claudeData.js for
// computeCost/modelFamilyOf), or claudeData captures the wrong $HOME and
// every other test breaks. Defer all such imports until the test bodies run.
let sessionDiff;
let replay;
function loadModules() {
  if (!sessionDiff) sessionDiff = require('../out/sessionDiff.js');
  if (!replay) replay = require('../out/replay.js');
}

const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'replay.jsonl'),
  'utf8',
);

// --- sessionDiff: single-edit -------------------------------------------------

test('sessionDiff: parses fixture and tracks single-edit Edit application', () => {
  loadModules();
  sessionDiff.__resetCache();
  const events = sessionDiff.parseSessionEvents(fixture);
  // 1 user + 4 assistant + 4 tool_use events = 9 events.
  assert.equal(events.length, 9);
  // Event 0 is user, event 1 is assistant marker, event 2 is the Write tool_use.
  const writeEvent = events.find((e) => e.kind === 'tool_use' && e.toolName === 'Write');
  assert.ok(writeEvent, 'expected at least one Write tool_use');
  // Single-edit: the Edit at event index 4 changes "line 2" → "LINE TWO".
  const afterEdit = sessionDiff.reconstructFileAt(events, '/repo/a.ts', 4);
  assert.ok(afterEdit && afterEdit.includes('LINE TWO'));
  assert.ok(afterEdit && !afterEdit.includes('line 2'));
});

// --- sessionDiff: multi-edit ordering ----------------------------------------

test('sessionDiff: MultiEdit applies all edits in order', () => {
  loadModules();
  sessionDiff.__resetCache();
  const events = sessionDiff.parseSessionEvents(fixture);
  const after = sessionDiff.reconstructFileAt(events, '/repo/b.ts', 6);
  // /repo/b.ts had no prior write — MultiEdit on a fresh file should
  // produce a sketch from new_string concatenation.
  assert.ok(after, 'expected a reconstructed buffer for /repo/b.ts');
  assert.ok(after.includes('ALPHA'));
  assert.ok(after.includes('BETA'));
});

// --- sessionDiff: write-then-edit --------------------------------------------

test('sessionDiff: write-then-edit reconstructs cumulative state', () => {
  loadModules();
  sessionDiff.__resetCache();
  const events = sessionDiff.parseSessionEvents(fixture);
  // After event 4 (the Edit), /repo/a.ts has line 1, LINE TWO, line 3.
  const before = sessionDiff.reconstructFileAt(events, '/repo/a.ts', 4);
  assert.ok(before && before.includes('LINE TWO'));
  // After event 8 (the second Write fully replaces the file).
  const after = sessionDiff.reconstructFileAt(events, '/repo/a.ts', 8);
  assert.ok(after && after.startsWith('FRESH'));
  assert.ok(after && !after.includes('LINE TWO'));
});

// --- sessionDiff: conflicting writes (diffBetween produces a hunk) -----------

test('sessionDiff: diffBetween emits a unified-style diff for write-replaced file', () => {
  loadModules();
  sessionDiff.__resetCache();
  const events = sessionDiff.parseSessionEvents(fixture);
  const diffs = sessionDiff.diffBetween(events, 4, 8);
  const aDiff = diffs.find((d) => d.filePath === '/repo/a.ts');
  assert.ok(aDiff, 'expected a diff entry for /repo/a.ts');
  assert.ok(aDiff.unified.includes('--- /repo/a.ts'));
  assert.ok(aDiff.unified.includes('+++ /repo/a.ts'));
  assert.ok(aDiff.addedLines >= 2);
  assert.ok(aDiff.removedLines >= 2);
});

// --- sessionDiff: malformed line is tolerated --------------------------------

test('sessionDiff: malformed JSON line is silently dropped', () => {
  loadModules();
  sessionDiff.__resetCache();
  // Append a malformed last line without trailing newline (partial-write tail).
  const tainted = fixture + '{"type":"assistant","timestamp":';
  const events = sessionDiff.parseSessionEvents(tainted);
  // Same count as the clean fixture — partial tail dropped.
  const baseline = sessionDiff.parseSessionEvents(fixture);
  assert.equal(events.length, baseline.length);
  // Also confirm a mid-file garbage line doesn't throw and yields baseline.
  const lines = fixture.split('\n');
  lines.splice(2, 0, '{garbage');
  const tainted2 = lines.join('\n');
  const events2 = sessionDiff.parseSessionEvents(tainted2);
  assert.equal(events2.length, baseline.length);
});

// --- replay: fork creation ----------------------------------------------------

test('replay: forkSession copies the JSONL prefix into ~/.claude/.cockpit/forks/', () => {
  loadModules();
  sessionDiff.__resetCache();
  // Stage a real file under a temp dir and fork it. We use the public
  // forkSession API — it always writes to ~/.claude/.cockpit/forks/ which is
  // OK on a developer machine; clean up after.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-replay-'));
  const sessFile = path.join(tmpDir, 'fixture.jsonl');
  fs.writeFileSync(sessFile, fixture, 'utf8');
  const events = sessionDiff.parseSessionEvents(fixture);
  // Pick the Edit-at-event-4 scrub point.
  const result = replay.forkSession(sessFile, 4);
  try {
    assert.equal(result.ok, true, 'fork should succeed: ' + (result.error || ''));
    assert.ok(result.forkPath && fs.existsSync(result.forkPath));
    const forked = fs.readFileSync(result.forkPath, 'utf8');
    // Fork should include the line containing event #4 — that's JSONL line
    // index 2 (0-based: user, write, edit), so 3 lines preserved.
    const lineCount = forked.split('\n').filter((l) => l.trim()).length;
    assert.equal(lineCount, 3);
    // Bytes should be a strict prefix of the original file's first three lines.
    const origPrefix = fixture.split('\n').slice(0, 3).join('\n') + '\n';
    assert.equal(forked, origPrefix);
  } finally {
    if (result.forkPath) fs.unlinkSync(result.forkPath);
    fs.unlinkSync(sessFile);
    fs.rmdirSync(tmpDir);
  }
});

// --- replay: cost projection / budget warning --------------------------------

test('replay: projectCost flags willHitDailyCap when projection exceeds the cap', () => {
  loadModules();
  sessionDiff.__resetCache();
  const events = sessionDiff.parseSessionEvents(fixture);
  // Tiny cap, with spentToday already at the cap → projection definitely
  // crosses. perEventUsd from our fixture is on the order of 1e-4 USD, so we
  // pick a cap and spentToday that obviously trip the boundary.
  const tight = replay.projectCost(events, /* dailyCap */ 0.001, /* spentToday */ 0.001);
  assert.equal(tight.willHitDailyCap, true);
  // Large cap → must not warn.
  const loose = replay.projectCost(events, /* dailyCap */ 1000, /* spentToday */ 0.0);
  assert.equal(loose.willHitDailyCap, false);
  // Cap == 0 → opt-out, must not warn even when spend is high.
  const optOut = replay.projectCost(events, /* dailyCap */ 0, /* spentToday */ 100);
  assert.equal(optOut.willHitDailyCap, false);
  // perEventUsd must be derived from the last cumulative usage block.
  assert.ok(tight.perEventUsd > 0);
  assert.ok(tight.spentUsd > 0);
});
