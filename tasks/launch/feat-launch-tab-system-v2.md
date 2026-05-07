# feat/launch-tab-system-v2  (Phase 1, L, ~900 LOC)

## Goal

Three things, all UX-layer:
- (12) Pin / hide / reorder / pop-out tabs + "save layouts as named
  presets" (Coding / Research / Reviewing PRs).
- (13) Drag-and-drop tab reorder; pop-out full-screen mode (sidebar
  webview re-mounts in `vscode.window.createWebviewPanel`).
- (14) Keyboard-first nav: cmd+1..9 jumps to tab N; every action a
  shortcut.

Builds on the existing `enabledTabs` user-pref (sidebarProvider.ts:184)
and `tabComponents` (line 183). Adds a new `tabLayouts` user-pref
storing named presets.

## In-scope files

- NEW `media/sidebar.layout.js` — drag handlers, layout-preset modal,
  pop-out trigger, keybinding listener (works inside the webview only;
  the extension host registers VS Code keybindings separately). ~500 LOC.
- `src/sidebarProvider.ts:133–149` (UserPrefs) — add field
  `tabLayouts?: Record<string, { tabOrder: string[]; tabComponents: Record<string,string[]> }>`
  and `currentLayoutName?: string`.
- `src/sidebarProvider.ts:55–131` — append messages: `layout.save |
   layout.load | layout.delete | layout.popOut | layout.reorderTabs`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `src/sidebarProvider.ts:225–277` (resolveWebviewView) — add a
  command-palette trigger to pop out:
  `vscode.window.createWebviewPanel('claudeCockpit.fullscreen', ...)`
  with the SAME html() output. The fullscreen panel posts the same
  messages back to the same provider.
- `media/sidebar.js:3637–3673` (getEnabledTabIds, visibleTabBar) —
  honor `tabLayouts[currentLayoutName].tabOrder` if set.
- `media/sidebar.js:tab bar render fn` — add drag handles on each
  `.tab` element; listeners wired via sidebar.layout.js.
- `media/sidebar.css` — append a worktree-scoped block for drag styles
  + fullscreen grid layout (CSS grid, 4 cols × N rows).
- `package.json:76–110` — add 12 commands:
  `claudeCockpit.layout.save`, `claudeCockpit.layout.load`,
  `claudeCockpit.layout.popOut`, `claudeCockpit.tab.next`,
  `claudeCockpit.tab.prev`, `claudeCockpit.tab.1` ... `.tab.9`.
- `package.json` keybindings (NEW section under contributes) — add
  `cmd+1..9` mappings (only when `view == claudeCockpit.sidebar`).
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT change the COMPONENTS registry. We only manipulate ORDER, not
  content.
- Do NOT change DEFAULT_TAB_COMPOSITIONS. Layouts are user-saved
  overlays.
- Pop-out shares the same html() and same message bus; do NOT make a
  separate provider class.

## Dependencies

- `plugin.ts:CockpitTrigger` (Phase 0) — keybindings consume this type.
- All other Phase-1 worktrees must have merged FIRST so their tabs
  exist for users to reorder. Hence merge order #5 in PLAN.md.

## Acceptance criteria

- [ ] User can drag a tab to a new position; order persists across reload.
- [ ] User can right-click a tab → "Hide tab" / "Pin tab" / "Save current
  layout as…" / "Load layout".
- [ ] User can pop out: full-screen webview panel opens with all tabs
  in a 4-column grid, each showing its widget body.
- [ ] cmd+1..9 jump to tabs 1..9 in the current order.
- [ ] All v0.21.0 tabs still present in the default layout (no surprises
  when first launched).
- [ ] `npm test` green; 4 new tests for tab-order migration + preset
  load/save.

## Test plan

Unit:
- Save layout, reload globalState, layout intact.
- Load nonexistent layout name → no-op + warning.

Manual:
- Drag tabs into a new order, reload Cockpit, verify order persists.
- Pop out, see grid; close panel, sidebar still works independently.
- Press cmd+5, jumps to tab #5.

## Rollback plan

Revert. tabLayouts in globalState becomes orphaned but doesn't affect
the default flow.
