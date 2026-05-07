'use strict';

// Tests for src/graph.ts (Obsidian graph builder).
//
// Covers the four cases from the launch brief:
//   1. parseWikilinks — handles plain, alias, and section forms.
//   2. buildVaultGraph — cycle (A↔B) doesn't infinite-loop & emits two edges.
//   3. buildVaultGraph — isolated note (no inbound/outbound) is included
//      with isolated=true.
//   4. getOrBuildGraph — caches on first build, returns cache on second
//      call until a vault file mtime advances.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const graph = require('../out/graph.js');

function makeVaultDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-graph-' + prefix + '-'));
}

function makeVault(dir, id) {
  return {
    id: id || 'testvault',
    name: path.basename(dir),
    path: dir,
    isOpen: false,
    lastOpenedMs: 0,
    exists: true,
  };
}

test('parseWikilinks extracts plain, alias, and section forms', () => {
  const body = [
    'See [[Note]] and [[Other Note|alias label]].',
    'Cross-section reference: [[Stack#section heading]].',
    'Both at once: [[Topic#section|with alias]].',
    '',
    '```markdown',
    'This [[fenced]] should NOT be picked up.',
    '```',
  ].join('\n');
  const links = graph.parseWikilinks(body);
  assert.deepEqual(links.sort(), ['Note', 'Other Note', 'Stack', 'Topic'].sort());
  assert.ok(!links.includes('fenced'), 'fenced wikilinks must be ignored');
});

test('buildVaultGraph handles A->B->A cycles without losing either edge', () => {
  const dir = makeVaultDir('cycle');
  fs.writeFileSync(path.join(dir, 'A.md'), '# A\n\nLinks to [[B]].');
  fs.writeFileSync(path.join(dir, 'B.md'), '# B\n\nLinks back to [[A]].');
  const built = graph.buildVaultGraph(makeVault(dir, 'cycle'));
  // Two notes => two nodes (no ghost dupes; A and B both resolve).
  const noteIds = built.nodes.map((n) => n.id).sort();
  assert.deepEqual(noteIds, ['A', 'B']);
  // Two edges: A->B and B->A. Order of emission isn't guaranteed but both
  // must be present.
  const edgePairs = built.edges.map((e) => e.source + '->' + e.target).sort();
  assert.deepEqual(edgePairs, ['A->B', 'B->A']);
});

test('buildVaultGraph includes isolated notes with isolated=true', () => {
  const dir = makeVaultDir('iso');
  fs.writeFileSync(path.join(dir, 'A.md'), 'Links to [[B]].');
  fs.writeFileSync(path.join(dir, 'B.md'), '# B (linked to from A)');
  fs.writeFileSync(path.join(dir, 'Lonely.md'), '# Lonely\n\nNo links here.');
  const built = graph.buildVaultGraph(makeVault(dir, 'iso'));
  const lonely = built.nodes.find((n) => n.id === 'Lonely');
  assert.ok(lonely, 'Lonely must be present in the node list');
  assert.equal(lonely.isolated, true, 'isolated=true for a note nobody links to');
  const a = built.nodes.find((n) => n.id === 'A');
  const b = built.nodes.find((n) => n.id === 'B');
  assert.equal(a.isolated, false, 'A links out, so isolated=false');
  assert.equal(b.isolated, false, 'B is the target of an edge, so isolated=false');
});

test('getOrBuildGraph caches and returns the cache on a second call until mtime advances', () => {
  // Pin HOME so cache lands in an isolated dir we own.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-graph-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const dir = makeVaultDir('cache');
    const aPath = path.join(dir, 'A.md');
    fs.writeFileSync(aPath, '# A\n\nLinks to [[B]].');
    fs.writeFileSync(path.join(dir, 'B.md'), '# B');
    const vault = makeVault(dir, 'cachevault');

    graph.__clearCacheForTests(vault.id);
    const first = graph.getOrBuildGraph(vault);
    const firstBuiltAt = first.builtAt;
    assert.equal(first.nodes.length, 2);

    // Second call: nothing changed → builtAt is preserved (cache hit).
    const second = graph.getOrBuildGraph(vault);
    assert.equal(second.builtAt, firstBuiltAt, 'second call must hit the cache');

    // Bump mtime on A.md → cache invalidates → new builtAt.
    const newer = Date.now() / 1000 + 60; // +60s
    fs.utimesSync(aPath, newer, newer);
    const third = graph.getOrBuildGraph(vault);
    assert.notEqual(third.builtAt, firstBuiltAt, 'cache must invalidate when an .md mtime advances');
  } finally {
    process.env.HOME = prevHome;
  }
});
