'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pin HOME to an isolated tmp dir BEFORE loading claudeData — the module
// captures `os.homedir()` at import time. Each test scopes its own subdir
// underneath so they don't collide.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-'));
process.env.HOME = tmpHome;

const {
  encodeCwd,
  findActiveSession,
  readSession,
  readMemoryIndex,
  snapshot,
  formatTokens,
  computeWatchtower,
  computeBudget,
  computeNotifications,
  computeCostByTool,
  globalSessionSearch,
} = require('../out/claudeData.js');

const FIXTURES = path.join(__dirname, 'fixtures');

function makeWorkspace(name) {
  // Each test gets its own fake cwd whose encoded form maps to a fresh project
  // dir under our tmp HOME. Returns { cwd, projectDir, memoryDir }.
  const cwd = path.join(tmpHome, 'ws', name);
  const projectDir = path.join(tmpHome, '.claude', 'projects', encodeCwd(cwd));
  const memoryDir = path.join(projectDir, 'memory');
  return { cwd, projectDir, memoryDir };
}

function copyFixture(name, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, name), dest);
}

test('encodeCwd replaces all forward slashes with dashes', () => {
  assert.equal(encodeCwd('/Users/stephane/code'), '-Users-stephane-code');
  assert.equal(encodeCwd('/'), '-');
  assert.equal(encodeCwd('no-slash'), 'no-slash');
  assert.equal(encodeCwd('/a/b/c/d'), '-a-b-c-d');
});

test('findActiveSession returns undefined when project dir is missing', () => {
  const ws = makeWorkspace('missing');
  assert.equal(findActiveSession(ws.cwd), undefined);
});

test('findActiveSession returns undefined when dir exists but has no .jsonl files', () => {
  const ws = makeWorkspace('empty');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  fs.writeFileSync(path.join(ws.projectDir, 'README.txt'), 'not jsonl');
  assert.equal(findActiveSession(ws.cwd), undefined);
});

test('findActiveSession picks the most recently modified .jsonl', () => {
  const ws = makeWorkspace('mtime');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const older = path.join(ws.projectDir, 'old.jsonl');
  const newer = path.join(ws.projectDir, 'new.jsonl');
  fs.writeFileSync(older, '{}\n');
  fs.writeFileSync(newer, '{}\n');
  // Force a clear mtime gap.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(older, past, past);
  const found = findActiveSession(ws.cwd);
  assert.equal(found, newer);
});

test('readSession returns empty stats when no file is given', () => {
  const stats = readSession(undefined, '/whatever');
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.messageCount, 0);
  assert.deepEqual(stats.filesTouched, []);
  assert.equal(stats.sessionId, undefined);
});

test('readSession returns empty stats when file does not exist', () => {
  const stats = readSession('/path/does/not/exist.jsonl', '/cwd');
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.messageCount, 0);
});

test('readSession sums tokens across all usage blocks', () => {
  const ws = makeWorkspace('valid');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', file);

  const stats = readSession(file, ws.cwd);
  assert.equal(stats.inputTokens, 110);
  assert.equal(stats.outputTokens, 55);
  assert.equal(stats.cacheReadTokens, 1000);
  assert.equal(stats.cacheCreationTokens, 200);
  assert.equal(stats.totalTokens, 1365);
});

test('readSession captures session metadata from first eligible line', () => {
  const ws = makeWorkspace('meta');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', file);

  const stats = readSession(file, ws.cwd);
  assert.equal(stats.sessionId, 'sess-abc');
  assert.equal(stats.startedAt, '2026-05-05T10:00:00.000Z');
  assert.equal(stats.lastActivityAt, '2026-05-05T10:00:04.000Z');
  assert.equal(stats.messageCount, 5);
});

test('readSession only counts file tools in filesTouched but counts every tool_use in toolCallCount', () => {
  const ws = makeWorkspace('tools');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', file);

  const stats = readSession(file, ws.cwd);
  // Tool calls in fixture: Edit, Write, Bash, Edit, Read, MultiEdit, NotebookEdit = 7
  assert.equal(stats.toolCallCount, 7);
  // File-touching tools only: a.ts (Edit x2), b.ts (Write), d.ts (MultiEdit), e.ipynb (NotebookEdit)
  const paths = stats.filesTouched.map((f) => f.filePath).sort();
  assert.deepEqual(paths, ['/repo/a.ts', '/repo/b.ts', '/repo/d.ts', '/repo/e.ipynb']);
});

test('readSession dedupes repeated touches into a single entry with incremented count', () => {
  const ws = makeWorkspace('dedupe');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', file);

  const stats = readSession(file, ws.cwd);
  const aTs = stats.filesTouched.find((f) => f.filePath === '/repo/a.ts');
  assert.ok(aTs, 'expected /repo/a.ts entry');
  assert.equal(aTs.tool, 'Edit');
  assert.equal(aTs.count, 2);
  assert.equal(aTs.lastTouchedAt, '2026-05-05T10:00:03.000Z');
});

test('readSession skips malformed JSON lines but counts the valid ones', () => {
  const ws = makeWorkspace('malformed');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('malformed.jsonl', file);

  const stats = readSession(file, ws.cwd);
  // Three valid lines in fixture (first user, middle assistant, last user).
  assert.equal(stats.messageCount, 3);
  assert.equal(stats.inputTokens, 42);
  assert.equal(stats.outputTokens, 7);
  assert.equal(stats.totalTokens, 49);
  assert.equal(stats.filesTouched.length, 1);
  assert.equal(stats.filesTouched[0].filePath, '/repo/ok.ts');
});

test('readSession handles assistant messages without a usage block', () => {
  const ws = makeWorkspace('no-usage');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const file = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('no-usage.jsonl', file);

  const stats = readSession(file, ws.cwd);
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.messageCount, 2);
  // Bash and Read are tool_use but neither is a file-touching tool.
  assert.equal(stats.toolCallCount, 2);
  assert.deepEqual(stats.filesTouched, []);
});

test('readMemoryIndex returns empty array when MEMORY.md is missing', () => {
  const ws = makeWorkspace('no-memory');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  assert.deepEqual(readMemoryIndex(ws.cwd), []);
});

test('readMemoryIndex returns empty array when project dir itself is missing', () => {
  const ws = makeWorkspace('totally-missing');
  assert.deepEqual(readMemoryIndex(ws.cwd), []);
});

test('readMemoryIndex parses only lines that match the link+hook pattern', () => {
  const ws = makeWorkspace('memory');
  fs.mkdirSync(ws.memoryDir, { recursive: true });
  copyFixture('MEMORY.md', path.join(ws.memoryDir, 'MEMORY.md'));

  const entries = readMemoryIndex(ws.cwd);
  assert.equal(entries.length, 3);
  // Strip per-file mtime fields — they vary per run.
  const stripMtime = (e) => ({ title: e.title, filename: e.filename, hook: e.hook });
  assert.deepEqual(stripMtime(entries[0]), {
    title: 'Roadmap',
    filename: 'roadmap.md',
    hook: 'single source of truth for shipping',
  });
  assert.deepEqual(stripMtime(entries[1]), {
    title: 'Subdomains',
    filename: 'subdomains.md',
    hook: 'dash separator works too',
  });
  assert.deepEqual(stripMtime(entries[2]), {
    title: 'Plans',
    filename: 'plans.md',
    hook: 'pricing tiers and rollout',
  });
  // Each entry has the staleness metadata fields, even when the file is missing.
  for (const e of entries) {
    assert.ok('lastModifiedAt' in e, 'lastModifiedAt missing');
    assert.ok('lastModifiedMs' in e, 'lastModifiedMs missing');
    assert.equal(typeof e.isStale, 'boolean');
  }
});

test('snapshot composes projectDir, stats and memory in one call', () => {
  const ws = makeWorkspace('snapshot');
  fs.mkdirSync(ws.memoryDir, { recursive: true });
  const session = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', session);
  copyFixture('MEMORY.md', path.join(ws.memoryDir, 'MEMORY.md'));

  const snap = snapshot(ws.cwd);
  assert.equal(snap.cwd, ws.cwd);
  assert.equal(snap.projectDir, ws.projectDir);
  assert.equal(snap.stats.sessionFile, session);
  assert.equal(snap.stats.totalTokens, 1365);
  assert.equal(snap.memory.length, 3);
});

test('snapshot falls back to the globally active session when the cwd has none', () => {
  // Sessions are first-class. With no JSONL for the requested cwd, snapshot
  // should hand back whichever session was most recently touched globally.
  const ws = makeWorkspace('snapshot-empty');
  const snap = snapshot(ws.cwd);
  assert.notEqual(snap.cwd, ws.cwd);
  assert.notEqual(snap.stats.sessionFile, undefined);
  assert.ok(snap.stats.totalTokens > 0);
});

test('snapshot prefers cwd session when its mtime is newer than the global one', () => {
  const ws = makeWorkspace('snapshot-fresh');
  const session = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', session);
  // Bump the mtime forward so it beats whatever previous tests wrote.
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(session, future, future);
  const snap = snapshot(ws.cwd);
  assert.equal(snap.cwd, ws.cwd);
  assert.equal(snap.projectDir, ws.projectDir);
  assert.equal(snap.stats.sessionFile, session);
});

test('computeBudget reports tones based on percent spent', () => {
  const off = computeBudget(undefined, 5, 1);
  assert.equal(off.enabled, false);
  assert.equal(off.dailyTone, 'ok');

  const ok = computeBudget({ enabled: true, dailyCapUsd: 100, sessionCapUsd: 0 }, 25, 0);
  assert.equal(ok.dailyTone, 'ok');

  const warn = computeBudget({ enabled: true, dailyCapUsd: 100, sessionCapUsd: 0 }, 85, 0);
  assert.equal(warn.dailyTone, 'warn');

  const danger = computeBudget(
    { enabled: true, dailyCapUsd: 100, sessionCapUsd: 5 },
    100,
    6,
  );
  assert.equal(danger.dailyTone, 'danger');
  assert.equal(danger.sessionTone, 'danger');
});

test('computeNotifications surfaces context, cache, and budget alerts', () => {
  const stats = {
    totalTokens: 100_000,
    contextWindowMax: 200_000,
    contextFillPct: 95,
    cacheHitRate: 0.1,
  };
  const memory = Array.from({ length: 7 }, (_, i) => ({
    isStale: true,
    title: `m${i}`,
    filename: `m${i}.md`,
    hook: '',
    lastModifiedAt: undefined,
    lastModifiedMs: 0,
  }));
  const watchtower = [
    { name: 'a', status: 'idle', ageSeconds: 1200 },
    { name: 'b', status: 'live', ageSeconds: 5 },
  ];
  const budget = computeBudget(
    { enabled: true, dailyCapUsd: 50, sessionCapUsd: 0 },
    55,
    0,
  );
  const notifs = computeNotifications({
    stats,
    memory,
    watchtower,
    obsidian: { installed: false, vaults: [], primaryVault: undefined, recentNotes: [] },
    budget,
  });
  const ids = notifs.map((n) => n.id);
  assert.ok(ids.includes('context-full'));
  assert.ok(ids.includes('cache-low'));
  assert.ok(ids.includes('memory-stale'));
  assert.ok(ids.includes('idle-sessions'));
  assert.ok(ids.includes('budget-day'));
});

test('computeCostByTool returns proportional approximations', () => {
  const stats = {
    totalTokens: 10_000,
    cost: { totalUsd: 1.0 },
    toolHistogram: [
      { tool: 'Read', count: 10 },
      { tool: 'Bash', count: 5 },
      { tool: 'Glob', count: 1 },
    ],
  };
  const out = computeCostByTool(stats);
  assert.equal(out.length, 3);
  // Read should rank highest given count + weight
  assert.equal(out[0].tool, 'Read');
  // Sum should approximate the total cost
  const sum = out.reduce((a, b) => a + b.approxUsd, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.01);
});

test('computeWatchtower returns recent sessions sorted by mtime', () => {
  // Touch a session to ensure something shows up. Use a far-future mtime so
  // we beat any other "fresh" session that earlier tests left behind.
  const ws = makeWorkspace('watch-' + Date.now());
  const session = path.join(ws.projectDir, 'session.jsonl');
  copyFixture('valid.jsonl', session);
  const future = new Date(Date.now() + 5 * 60_000);
  fs.utimesSync(session, future, future);
  const list = computeWatchtower();
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 1);
  assert.equal(list[0].sessionFile, session);
  // Each entry has a status string and ageSeconds.
  for (const w of list) {
    assert.ok(['live', 'recent', 'idle', 'stale'].includes(w.status));
    assert.equal(typeof w.ageSeconds, 'number');
  }
});

test('globalSessionSearch rejects queries shorter than 2 chars', () => {
  assert.deepEqual(globalSessionSearch(''), []);
  assert.deepEqual(globalSessionSearch('a'), []);
});

test('formatTokens formats raw, k, and M ranges', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(1), '1');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1.0k');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(999_999), '1000.0k');
  assert.equal(formatTokens(1_000_000), '1.00M');
  assert.equal(formatTokens(1_500_000), '1.50M');
  assert.equal(formatTokens(12_345_678), '12.35M');
});
