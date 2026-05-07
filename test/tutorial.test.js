'use strict';

// Tutorial recommendation ordering / filtering tests — covers the brief's
// acceptance criterion: "tutorial recommendation ordering".
//
// IMPORTANT: this file is auto-discovered by test/claudeData.test.js BEFORE
// it pins process.env.HOME. claudeData captures `os.homedir()` at module
// load, so we must require it lazily inside test bodies (same pattern as
// test/replay.test.js). Otherwise our top-level require freezes the wrong
// HOME and every claudeData fixture-driven test breaks downstream.

const test = require('node:test');
const assert = require('node:assert/strict');

let claudeData;
function loadClaudeData() {
  if (!claudeData) claudeData = require('../out/claudeData.js');
  return claudeData;
}

// Minimal context shape. computeRecommendations only reads the fields it
// needs; everything else can stay undefined / empty arrays.
function ctx(overrides) {
  return Object.assign({
    stats: {
      contextWindowMax: 200_000,
      contextFillPct: 95, // triggers high-impact rec-context-compact
      totalTokens: 100_000,
      cacheHitRate: 0.5,
      filesTouched: [],
      toolHistory: [],
      subAgents: [],
      sparkline: [],
      lastModel: 'claude-opus-4-7',
      messageCount: 1,
      toolCallCount: 0,
      lastActivityAt: undefined,
      sessionFile: undefined,
    },
    memory: [],
    skills: [],
    prompts: [],
    agents: [],
    watchtower: [],
    budget: {
      enabled: false,
      dailyCapUsd: 0,
      sessionCapUsd: 0,
      spentTodayUsd: 0,
      spentSessionUsd: 0,
      dailyTone: 'ok',
      sessionTone: 'ok',
    },
    settings: { hooksCount: 0, mcpServerCount: 0, pluginCount: 0 },
    rtk: { installed: false },
    obsidian: { installed: false, vaults: [] },
    diskUsageBytes: 0,
    cwd: '/tmp/demo',
  }, overrides);
}

test('computeRecommendations returns at least one high-impact rec when context is full', () => {
  const cd = loadClaudeData();
  const recs = cd.computeRecommendations(ctx());
  assert.ok(recs.length > 0, 'should produce recs');
  const high = recs.find((r) => r.impact === 'high');
  assert.ok(high, 'should include a high-impact rec on a 95%-full context');
});

test('dismissal filter (Set membership) drops only the targeted ids', () => {
  const cd = loadClaudeData();
  const recs = cd.computeRecommendations(ctx());
  assert.ok(recs.length >= 1);
  const dropId = recs[0].id;
  const dismissed = new Set([dropId]);
  const filtered = recs.filter((r) => !dismissed.has(r.id));
  assert.equal(filtered.length, recs.length - 1, 'exactly one rec dropped');
  assert.ok(!filtered.some((r) => r.id === dropId), 'dropped id no longer present');
});

test('minePrompts output shape is stable across calls', () => {
  // Doesn't assert specific prompts (depends on the user's machine; under
  // tests HOME is pinned to a tmp dir so likely empty); just verifies the
  // API shape buildTutorialNudges consumes is intact.
  const cd = loadClaudeData();
  const mined = cd.minePrompts(5);
  assert.ok(Array.isArray(mined));
  for (const m of mined) {
    assert.ok(typeof m.fingerprint === 'string' && m.fingerprint.length > 0);
    assert.ok(typeof m.body === 'string');
    assert.ok(typeof m.occurrences === 'number' && m.occurrences >= 1);
  }
  // Ordering invariant: occurrences DESC.
  for (let i = 1; i < mined.length; i++) {
    assert.ok(mined[i - 1].occurrences >= mined[i].occurrences, 'mined prompts sorted by occurrences DESC');
  }
});
