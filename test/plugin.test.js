'use strict';

// Phase 0 plugin API tests. Covers the four cases from the launch brief:
//   1. registerWidget shape check
//   2. duplicate-id error
//   3. registerTab default values
//   4. registerTrigger command-format validation
//
// The plugin module imports ./logger which imports 'vscode'; node --require
// ./test/register.js routes that to the stub, so this file does not need any
// extra setup.

const test = require('node:test');
const assert = require('node:assert/strict');

const plugin = require('../out/plugin.js');

test('registerWidget stores the widget verbatim and lists it back', () => {
  plugin.__resetForTests();
  const widget = {
    id: 'approval.queue',
    label: 'Approval queue',
    category: 'Approval',
    requiresCwd: false,
  };
  plugin.registerWidget(widget);
  const listed = plugin.listWidgets();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], widget);
});

test('registerWidget throws on duplicate id', () => {
  plugin.__resetForTests();
  const w = {
    id: 'replay.session',
    label: 'Replay session',
    category: 'Replay',
    requiresCwd: true,
  };
  plugin.registerWidget(w);
  assert.throws(
    () => plugin.registerWidget({ ...w, label: 'Different label' }),
    /duplicate id "replay\.session"/,
  );
});

test('registerTab fills sensible defaults for omitted fields', () => {
  plugin.__resetForTests();
  const filled = plugin.registerTab({ id: 'audit', label: 'Audit log' });
  assert.equal(filled.id, 'audit');
  assert.equal(filled.label, 'Audit log');
  assert.equal(filled.iconSvg, '');
  assert.equal(filled.pinned, false);
  assert.equal(filled.requiresCwd, false);
  assert.equal(filled.hint, '');
  assert.deepEqual(filled.defaultWidgets, []);
  assert.equal(plugin.listTabs().length, 1);
});

test('registerTrigger rejects unnamespaced command ids', () => {
  plugin.__resetForTests();
  assert.throws(
    () => plugin.registerTrigger({ command: 'openQueue', title: 'Open' }),
    /namespaced format/,
  );
  // A namespaced one passes.
  plugin.registerTrigger({
    command: 'claudeCockpit.approval.openQueue',
    title: 'Open approval queue',
    keybinding: 'cmd+1',
  });
  assert.equal(plugin.listTriggers().length, 1);
});

// Static contract check on media/sidebar.js: every site that filters a list of
// widget IDs must consult BOTH COMPONENTS and EXTERNAL_COMPONENTS. Otherwise an
// externally-registered widget will be silently dropped before tabBodyComposed
// ever sees it, defeating the entire Phase-0 bridge. This regex test fails if
// any future edit re-introduces a `COMPONENTS[id]`-only filter.
test('sidebar.js widget-id filters consult EXTERNAL_COMPONENTS', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'media', 'sidebar.js'),
    'utf8',
  );
  // Forbidden pattern: a filter that gates only on COMPONENTS[id].
  // Allowed: `COMPONENTS[id] || EXTERNAL_COMPONENTS[id]`, the shared `known`
  // helper that consults both, or `Object.entries({ ...EXTERNAL_COMPONENTS, ...COMPONENTS })`.
  const offending =
    /\.filter\(\s*\(\s*id\s*\)\s*=>\s*COMPONENTS\[id\]\s*\)/g;
  const matches = src.match(offending) || [];
  assert.equal(
    matches.length,
    0,
    `media/sidebar.js contains ${matches.length} COMPONENTS-only filter(s); each must also consult EXTERNAL_COMPONENTS or use the shared known() helper.`,
  );
});
