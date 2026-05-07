'use strict';

// tab-system-v2 host-side tests. Cover the four cases from the launch brief
// + reorder + pin/hide + overlay determinism. Pure functions, zero DOM.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { saveLayout, loadLayout, deleteLayout, pinTab, hideTab, showTab, reorderTabs, applyOverlay } = require('../out/tabLayout.js');

test('saveLayout snapshots current state under a name and sets currentLayoutName', () => {
  const before = {
    tabOrder: ['now', 'security', 'help'],
    pinnedTabs: ['now'],
    hiddenTabs: ['recs'],
    tabComponents: { now: ['greeting', 'cost'] },
  };
  const after = saveLayout(before, 'Coding');
  assert.equal(after.currentLayoutName, 'Coding');
  assert.ok(after.tabLayouts);
  assert.deepEqual(after.tabLayouts.Coding.tabOrder, ['now', 'security', 'help']);
  assert.deepEqual(after.tabLayouts.Coding.pinnedTabs, ['now']);
  assert.deepEqual(after.tabLayouts.Coding.hiddenTabs, ['recs']);
  assert.deepEqual(after.tabLayouts.Coding.tabComponents, { now: ['greeting', 'cost'] });
});

test('saveLayout truncates names longer than 60 chars and trims whitespace', () => {
  const before = { tabOrder: [], pinnedTabs: [], hiddenTabs: [] };
  const long = '   ' + 'X'.repeat(80) + '   ';
  const after = saveLayout(before, long);
  assert.equal(after.currentLayoutName.length, 60);
  assert.ok(!after.currentLayoutName.startsWith(' '));
});

test('saveLayout ignores empty / whitespace-only names', () => {
  const before = { tabOrder: ['now'], pinnedTabs: [], hiddenTabs: [] };
  const after = saveLayout(before, '   ');
  assert.equal(after, before);
});

test('loadLayout applies a saved preset', () => {
  const layouts = {
    Coding: { tabOrder: ['now', 'help'], pinnedTabs: ['now'], hiddenTabs: ['recs'], tabComponents: {} },
  };
  const before = { tabLayouts: layouts, tabOrder: [], pinnedTabs: [], hiddenTabs: [] };
  const after = loadLayout(before, 'Coding');
  assert.deepEqual(after.tabOrder, ['now', 'help']);
  assert.deepEqual(after.pinnedTabs, ['now']);
  assert.deepEqual(after.hiddenTabs, ['recs']);
  assert.equal(after.currentLayoutName, 'Coding');
});

test('loadLayout on a missing name is a no-op (returns prefs unchanged)', () => {
  const before = { tabLayouts: { Coding: { tabOrder: [], pinnedTabs: [], hiddenTabs: [], tabComponents: {} } } };
  const after = loadLayout(before, 'NoSuch');
  assert.equal(after, before);
});

test('saveLayout + loadLayout round-trips through globalState shape', () => {
  let prefs = { tabOrder: ['a', 'b'], pinnedTabs: ['a'], hiddenTabs: [], tabComponents: { a: ['x'] } };
  prefs = saveLayout(prefs, 'Round');
  // Simulate the user reordering after save.
  prefs = { ...prefs, tabOrder: ['b', 'a'], pinnedTabs: [], hiddenTabs: ['a'] };
  prefs = loadLayout(prefs, 'Round');
  assert.deepEqual(prefs.tabOrder, ['a', 'b']);
  assert.deepEqual(prefs.pinnedTabs, ['a']);
  assert.deepEqual(prefs.hiddenTabs, []);
});

test('deleteLayout drops the entry and clears currentLayoutName when active', () => {
  const before = saveLayout({ tabOrder: ['now'], pinnedTabs: [], hiddenTabs: [] }, 'Coding');
  const after = deleteLayout(before, 'Coding');
  assert.deepEqual(after.tabLayouts, {});
  assert.equal(after.currentLayoutName, undefined);
});

test('deleteLayout preserves currentLayoutName when an inactive preset is removed', () => {
  let prefs = { tabOrder: [], pinnedTabs: [], hiddenTabs: [] };
  prefs = saveLayout(prefs, 'A');
  prefs = saveLayout(prefs, 'B'); // currentLayoutName = B
  prefs = deleteLayout(prefs, 'A');
  assert.equal(prefs.currentLayoutName, 'B');
  assert.ok(prefs.tabLayouts.B);
  assert.ok(!prefs.tabLayouts.A);
});

test('pinTab pushes id onto pinnedTabs and removes it from hiddenTabs', () => {
  const before = { pinnedTabs: ['x'], hiddenTabs: ['now'] };
  const after = pinTab(before, 'now');
  assert.deepEqual(after.pinnedTabs, ['x', 'now']);
  assert.deepEqual(after.hiddenTabs, []);
});

test('hideTab pushes id onto hiddenTabs and removes it from pinnedTabs', () => {
  const before = { pinnedTabs: ['recs', 'now'], hiddenTabs: [] };
  const after = hideTab(before, 'recs');
  assert.deepEqual(after.hiddenTabs, ['recs']);
  assert.deepEqual(after.pinnedTabs, ['now']);
});

test('showTab unhides without affecting pinned', () => {
  const before = { pinnedTabs: ['now'], hiddenTabs: ['recs', 'security'] };
  const after = showTab(before, 'recs');
  assert.deepEqual(after.hiddenTabs, ['security']);
  assert.deepEqual(after.pinnedTabs, ['now']);
});

test('reorderTabs moves src in front of target', () => {
  assert.deepEqual(reorderTabs(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(reorderTabs(['a', 'b', 'c'], 'a', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(reorderTabs(['a', 'b'], 'a', 'missing'), ['a', 'b']);
});

test('applyOverlay returns base unchanged when no layout prefs are set', () => {
  const base = [{ id: 'a' }, { id: 'b' }];
  const result = applyOverlay(base, {});
  assert.deepEqual(result, base);
  // Must be a fresh copy, not a reference to the input array — mutating the
  // result must NOT mutate the input.
  result.push({ id: 'mutate' });
  assert.equal(base.length, 2);
});

test('applyOverlay puts user-pinned ids first', () => {
  const base = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
  ];
  const result = applyOverlay(base, { pinnedTabs: ['c', 'a'] });
  assert.deepEqual(result.map((t) => t.id), ['c', 'a', 'b', 'd']);
});

test('applyOverlay drops hidden tabs unless they are intrinsically pinned (catalogue pinned=true)', () => {
  const base = [
    { id: 'now' },
    { id: 'help', pinned: true },
    { id: 'recs' },
  ];
  const result = applyOverlay(base, { hiddenTabs: ['help', 'recs'] });
  // help still surfaces because its catalogue entry has pinned:true (built-in
  // pinned tabs can't be hidden); recs disappears.
  assert.deepEqual(result.map((t) => t.id), ['help', 'now']);
});

test('applyOverlay honors tabOrder while keeping built-in pinned at the front', () => {
  const base = [
    { id: 'now' },
    { id: 'help', pinned: true },
    { id: 'security' },
    { id: 'recs' },
  ];
  const result = applyOverlay(base, { tabOrder: ['security', 'now'] });
  // help (intrinsically pinned) goes first; tabOrder places security/now;
  // recs falls in last as catalogue remainder.
  assert.deepEqual(result.map((t) => t.id), ['help', 'security', 'now', 'recs']);
});

// Static contract: sidebar.layout.js must NOT call acquireVsCodeApi a second
// time without a try/catch fallback. VSCode forbids the duplicate call.
test('sidebar.layout.js wraps acquireVsCodeApi in try/catch (no second-call crash)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.layout.js'), 'utf8');
  // Match the pattern: try { vscode = acquireVsCodeApi(); } catch ...
  const re = /try\s*\{[^}]*acquireVsCodeApi\s*\(\s*\)/;
  assert.ok(re.test(src), 'sidebar.layout.js must guard acquireVsCodeApi() with try/catch');
});
