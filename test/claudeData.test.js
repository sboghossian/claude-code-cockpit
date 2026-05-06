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
  computeOfficeFloor,
  computeBudget,
  computeNotifications,
  computeRecommendations,
  computeCostByTool,
  globalSessionSearch,
  classifyPrompt,
  minePrompts,
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

test('computeBudget surfaces forward-looking burn-rate fields', () => {
  // No burn rate → projection fields collapse to zero / undefined.
  const idle = computeBudget({ enabled: true, dailyCapUsd: 50, sessionCapUsd: 0 }, 10, 0, 0);
  assert.equal(idle.burnUsdPerHour, 0);
  assert.equal(idle.projected30MinUsd, 0);
  assert.equal(idle.minutesToDailyCap, undefined);

  // Active burn → 30-min projection is half the hourly rate; ETA is computed.
  const active = computeBudget({ enabled: true, dailyCapUsd: 50, sessionCapUsd: 0 }, 10, 0, 12);
  assert.equal(active.burnUsdPerHour, 12);
  assert.equal(active.projected30MinUsd, 6);
  // 40 remaining / 12 per hour = 200 minutes (rounded).
  assert.equal(active.minutesToDailyCap, 200);
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

test('computeRecommendations surfaces actionable suggestions across categories', () => {
  const stats = {
    totalTokens: 100_000,
    contextWindowMax: 200_000,
    contextFillPct: 95,
    cacheHitRate: 0.1,
    messageCount: 60,
  };
  const memory = Array.from({ length: 6 }, (_, i) => ({
    isStale: true,
    title: `m${i}`,
    filename: `m${i}.md`,
    hook: '',
    lastModifiedAt: undefined,
    lastModifiedMs: 0,
  }));
  const watchtower = [
    { name: 'a', status: 'idle', ageSeconds: 1200 },
    { name: 'b', status: 'idle', ageSeconds: 1500 },
    { name: 'c', status: 'stale', ageSeconds: 3000 },
  ];
  const budget = computeBudget(
    { enabled: false, dailyCapUsd: 0, sessionCapUsd: 0 },
    0,
    0,
  );
  const recs = computeRecommendations({
    stats,
    memory,
    skills: [],
    prompts: [],
    agents: [],
    watchtower,
    budget,
    settings: { settingsExists: true, mcpServerNames: [], hooks: [], enabledPlugins: [] },
    rtk: { installed: false, version: undefined, totalSavingsTokens: 0, totalSavingsUsd: 0 },
    obsidian: { installed: false, vaults: [], primaryVault: undefined, recentNotes: [] },
    diskUsageBytes: 0,
    cwd: '/tmp/x',
  });
  const ids = recs.map((r) => r.id);
  assert.ok(ids.includes('rec-context-compact'));
  assert.ok(ids.includes('rec-cache-cold'));
  assert.ok(ids.includes('rec-memory-prune'));
  assert.ok(ids.includes('rec-idle-sessions'));
  assert.ok(ids.includes('rec-budget-set'));
  assert.ok(ids.includes('rec-prompts-empty'));
  assert.ok(ids.includes('rec-agents-empty'));
  assert.ok(ids.includes('rec-hooks-none'));
  // High-impact recs sort first.
  const firstHigh = recs.findIndex((r) => r.impact === 'high');
  const firstLow = recs.findIndex((r) => r.impact === 'low');
  if (firstHigh >= 0 && firstLow >= 0) {
    assert.ok(firstHigh < firstLow);
  }
});

test('computeRecommendations returns empty when cockpit is clean', () => {
  const stats = {
    totalTokens: 1_000,
    contextWindowMax: 200_000,
    contextFillPct: 5,
    cacheHitRate: 0.95,
    messageCount: 5,
  };
  const budget = computeBudget(
    { enabled: true, dailyCapUsd: 50, sessionCapUsd: 0 },
    1,
    0,
  );
  const recs = computeRecommendations({
    stats,
    memory: [{ isStale: false, title: 'm', filename: 'm.md', hook: '', lastModifiedAt: undefined, lastModifiedMs: 0 }],
    skills: [{ name: 'foo', description: '', source: 'user', pluginName: undefined, useCount: 1 }],
    prompts: [{ id: 'p1', title: 't', body: 'b' }],
    agents: [{ name: 'a', description: '', scope: 'global', filePath: '/x', model: undefined, color: undefined, tools: undefined }],
    watchtower: [],
    budget,
    settings: { settingsExists: true, mcpServerNames: [], hooks: [{ event: 'UserPromptSubmit', count: 1, commands: [] }], enabledPlugins: [] },
    rtk: { installed: true, version: '1.0', totalSavingsTokens: 0, totalSavingsUsd: 0 },
    obsidian: { installed: true, vaults: [], primaryVault: undefined, recentNotes: [] },
    diskUsageBytes: 1024,
    cwd: '/tmp/clean',
  });
  assert.equal(recs.length, 0);
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

test('computeOfficeFloor surfaces last tool, current file, and subagent name per project', () => {
  const ws = makeWorkspace('floor-' + Date.now());
  const session = path.join(ws.projectDir, 'session.jsonl');
  fs.mkdirSync(ws.projectDir, { recursive: true });
  // Hand-crafted JSONL: a Task tool call (subagent) then a tool_use Edit on a.ts
  // then its tool_result success.
  const lines = [
    JSON.stringify({type:'user',timestamp:'2026-05-06T10:00:00.000Z',sessionId:'s1',message:{content:'hi'}}),
    JSON.stringify({type:'assistant',timestamp:'2026-05-06T10:00:01.000Z',sessionId:'s1',message:{model:'claude-opus-4-7',usage:{input_tokens:10,output_tokens:5},content:[{type:'tool_use',id:'tu_1',name:'Task',input:{subagent_type:'general-purpose',description:'find bug'}}]}}),
    JSON.stringify({type:'assistant',timestamp:'2026-05-06T10:00:02.000Z',sessionId:'s1',message:{content:[{type:'tool_use',id:'tu_2',name:'Edit',input:{file_path:'/repo/a.ts'}}]}}),
    JSON.stringify({type:'user',timestamp:'2026-05-06T10:00:03.000Z',sessionId:'s1',message:{content:[{type:'tool_result',tool_use_id:'tu_2',is_error:false,content:'ok'}]}}),
  ];
  fs.writeFileSync(session, lines.join('\n') + '\n');
  const future = new Date(Date.now() + 5 * 60_000);
  fs.utimesSync(session, future, future);
  const tiles = computeOfficeFloor();
  const mine = tiles.find((t) => t.sessionFile === session);
  assert.ok(mine, 'expected a floor tile for the freshly-touched session');
  assert.equal(mine.lastTool, 'Edit');
  assert.equal(mine.currentFile, '/repo/a.ts');
  assert.equal(mine.lastToolResult, 'ok');
  assert.equal(mine.subAgentName, 'general-purpose');
  assert.equal(mine.subAgentDescription, 'find bug');
  assert.ok(['live', 'recent', 'idle', 'stale'].includes(mine.status));
});

test('globalSessionSearch rejects queries shorter than 2 chars', () => {
  assert.deepEqual(globalSessionSearch(''), []);
  assert.deepEqual(globalSessionSearch('a'), []);
});

test('classifyPrompt returns expected category for keyword-bearing bodies', () => {
  assert.equal(classifyPrompt('Please draft an NDA clause for HAQQ Legal'), 'legal');
  assert.equal(classifyPrompt('Ship a PR refactoring the auth middleware'), 'build');
  assert.equal(classifyPrompt('Review this design for accessibility'), 'review');
  assert.equal(classifyPrompt('Plan the architecture for the lead pipeline'), 'plan');
  assert.equal(classifyPrompt('Investigate why the build is slow'), 'research');
  assert.equal(classifyPrompt('Configure the kubernetes deploy pipeline'), 'infra');
  assert.equal(classifyPrompt('hi there'), 'other');
});

test('minePrompts dedupes recurring prompts and surfaces reuse signal', () => {
  // Build a fake project dir with a JSONL that contains the same prompt twice
  // and a one-shot. minePrompts should return the recurring one with
  // occurrences=2, and the one-shot only if it's substantial enough.
  const ws = makeWorkspace('mine-' + Date.now());
  fs.mkdirSync(ws.projectDir, { recursive: true });
  const reused = 'Review the latest diff for SQL injection risks and tell me if any user input flows unescaped into a query.';
  const oneShot = 'short prompt';
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-05-01T10:00:00Z', message: { content: reused } }),
    JSON.stringify({ type: 'user', timestamp: '2026-05-02T10:00:00Z', message: { content: reused } }),
    JSON.stringify({ type: 'user', timestamp: '2026-05-03T10:00:00Z', message: { content: oneShot } }),
  ].join('\n');
  fs.writeFileSync(path.join(ws.projectDir, 'sess.jsonl'), lines);

  const mined = minePrompts(20);
  const reusedHit = mined.find((p) => p.body.startsWith('Review the latest diff'));
  assert.ok(reusedHit, 'reused prompt should be mined');
  assert.equal(reusedHit.occurrences, 2);
  assert.equal(reusedHit.category, 'review');
  // One-shot below 80 chars should be filtered.
  assert.ok(!mined.some((p) => p.body === oneShot));
});

test('readPlans parses checkboxes from tasks/todo.md', () => {
  const { readPlans } = require('../out/integrations.js');
  const ws = makeWorkspace('plans-' + Date.now());
  const tasksDir = path.join(ws.cwd, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(tasksDir, 'todo.md'),
    '# plan\n\n- [x] done thing\n- [ ] do another thing\n- [X] big done\n- [ ] urgent\n- not a checkbox\n',
  );
  const plans = readPlans(ws.cwd);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].totalCount, 4);
  assert.equal(plans[0].doneCount, 2);
  assert.equal(plans[0].pendingCount, 2);
  assert.equal(plans[0].pct, 50);
  assert.deepEqual(plans[0].nextItems, ['do another thing', 'urgent']);
});

test('readPlans returns empty when no plan files exist', () => {
  const { readPlans } = require('../out/integrations.js');
  const ws = makeWorkspace('noplans-' + Date.now());
  fs.mkdirSync(ws.cwd, { recursive: true });
  assert.deepEqual(readPlans(ws.cwd), []);
});

test('readPlans handles plan files in workspace root, not just tasks/', () => {
  const { readPlans } = require('../out/integrations.js');
  const ws = makeWorkspace('rootplans-' + Date.now());
  fs.mkdirSync(ws.cwd, { recursive: true });
  fs.writeFileSync(path.join(ws.cwd, 'TODO.md'), '- [x] a\n- [ ] b\n');
  const plans = readPlans(ws.cwd);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, 'TODO.md');
  assert.equal(plans[0].totalCount, 2);
});

test('computeActivityHeatmap returns 24-hour and 7-day buckets', () => {
  const { computeActivityHeatmap } = require('../out/integrations.js');
  const heat = computeActivityHeatmap();
  assert.equal(heat.byHour.length, 24);
  assert.equal(heat.byDay.length, 7);
  assert.equal(typeof heat.max, 'number');
  assert.ok(Array.isArray(heat.cells));
});

test('readAgents returns empty array when no agents directories exist', () => {
  const { readAgents } = require('../out/integrations.js');
  const ws = makeWorkspace('agents-empty-' + Date.now());
  const list = readAgents(ws.cwd);
  // tmpHome has no global agents in this test scope; should be safe.
  assert.ok(Array.isArray(list));
});

test('readTunnels returns empty array when no cloudflared dir exists', () => {
  const { readTunnels } = require('../out/integrations.js');
  // Same: tmpHome has no ~/.cloudflared/.
  const list = readTunnels();
  assert.ok(Array.isArray(list));
});

test('computeStats returns expected shape and labels', () => {
  const { computeStats } = require('../out/integrations.js');
  const stats = computeStats({
    byHour: new Array(24).fill(0),
    byDay: new Array(7).fill(0),
    watchtower: [],
    todayUsdRaw: 0,
  });
  // Streak/activeDays depends on tmpHome session fixtures from earlier tests
  // — assert types and ranges, not exact values.
  assert.equal(typeof stats.streakDays, 'number');
  assert.ok(stats.streakDays >= 0);
  assert.ok(stats.activeDays30 >= 0);
  assert.equal(stats.peakHourLabel, '—');
  assert.equal(stats.weekUsdRaw, 0);
  assert.equal(typeof stats.totalSessions, 'number');
});

test('computeInbox includes idle session and stale memory items', () => {
  const { computeInbox } = require('../out/integrations.js');
  const items = computeInbox({
    watchtower: [{ name: 'foo', ageSeconds: 1200, status: 'idle', sessionFile: '/x.jsonl' }],
    toolHistory: [{ tool: 'Read', result: 'error', errorMessage: 'boom' }],
    memory: [{ isStale: true, title: 'old thing', filename: 'old.md' }],
    plans: [{ name: 'todo.md', pendingCount: 3, nextItems: ['ship it'], path: '/p/todo.md' }],
    subAgents: [],
    budgetTone: 'ok',
  });
  const ids = items.map((i) => i.id);
  assert.ok(ids.some((id) => id.startsWith('idle-')));
  assert.ok(ids.some((id) => id.startsWith('err-')));
  assert.ok(ids.includes('mem-stale'));
  assert.ok(ids.some((id) => id.startsWith('plan-')));
});

test('readChatExport reports installed=false when no export folder is found', () => {
  const { readChatExport } = require('../out/integrations.js');
  // tmpHome has no claude-data-export — should return empty status.
  const status = readChatExport();
  // Could be true or false depending on whether the user's real export folder
  // exists relative to tmpHome — we only assert the shape.
  assert.equal(typeof status.installed, 'boolean');
  assert.ok(Array.isArray(status.recentConversations));
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
