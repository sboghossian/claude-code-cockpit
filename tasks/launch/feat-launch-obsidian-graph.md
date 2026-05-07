# feat/launch-obsidian-graph  (Phase 1, M, ~600 LOC)

## Goal

(17) Replace the Obsidian tab's current file-list (sidebar.js:1577
obsidianSection) with a real-time vault graph. d3-force layout, nodes =
notes, edges = wikilinks (`[[link]]`), color = "touched today by Claude
session" (cross-referenced with `claudeData.filesTouched`), click =
opens in Obsidian externally via `obsidian://open?vault=...&file=...`
(already implemented at obsidianUriFor). User picks vault from the
detected list (already in `readObsidianStatus`).

## In-scope files

- NEW `src/graph.ts` — walk the chosen vault, parse `[[wikilinks]]`,
  build nodes + edges array. Cached at
  `~/.claude/.cockpit/graph-cache-<vaultId>.json` keyed on vault mtime.
  ~350 LOC.
- NEW `media/sidebar.graph.js` — d3-force renderer. Uses bundled
  `media/vendor/d3.min.js` (~250KB local copy, no CDN). ~250 LOC.
- NEW `media/vendor/d3.min.js` — vendored d3-force build (just the
  modules we need: d3-force, d3-selection, d3-zoom). ~80KB minified.
- `src/sidebarProvider.ts:55–131` — append messages: `graph.refresh |
   graph.openNote | graph.pickVault`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `src/claudeData.ts:191–230` — add OPTIONAL `graphReady?: boolean`.
- `media/sidebar.js:1577 (obsidianSection)` — REPLACE the file-list
  rendering with a single `<div id="cockpit-graph-container">`
  placeholder that the new sidebar.graph.js mounts into. Keep the
  "Open vault" / "Save to Obsidian" buttons unchanged ABOVE the graph.
- `media/sidebar.js:3419` (COMPONENTS.obsidian) — change the render
  fn to call the new graph rendering code path. Existing `obsidian:`
  default tab composition remains the same.
- `package.json:76–110` — add 1 command: `claudeCockpit.obsidian.refreshGraph`.
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT embed Obsidian or its UI. d3 only.
- Do NOT include note CONTENT in the graph data. Just titles, paths,
  and link metadata.
- Do NOT make this the default tab. Keep the Welcome/Now defaults
  unchanged.

## Dependencies

- `plugin.ts:registerExternalComponent` (Phase 0).
- `obsidian.ts:readObsidianStatus`, `obsidianUriFor` — existing.
- SOFT: `replay-timeline` for the "filter by Claude session" overlay
  (color edges that were touched in the chosen session). v1.0 ships
  the static graph + "today's touches" overlay; session-specific
  overlay is v1.1.

## Acceptance criteria

- [ ] Graph renders for Stephane's vault (~5k notes, several thousand
  edges) in <2s after first build, <100ms from cache.
- [ ] Pan/zoom works at 30fps minimum.
- [ ] Click any node → `vscode.env.openExternal(obsidian://...)` opens
  the note in Obsidian.
- [ ] Color overlay: notes whose path appears in
  `claudeData.filesTouched` for today render in accent color.
- [ ] If no vault selected / no Obsidian installed, the tab falls back
  to the v0.21.0 file-list view (graceful degradation).
- [ ] `npm test` green; 4 new tests (wikilink parser, graph caching,
  cycle handling, isolated-node inclusion).

## Test plan

Unit:
- Parse `[[link]]`, `[[link|alias]]`, `[[link#section]]`.
- Cycle detection: A→B→A doesn't infinite-loop the layout.

Manual:
- Open Obsidian tab, pick vault, watch the graph layout.
- Edit a note in Obsidian, click "Refresh graph," see updated edges.

## Rollback plan

Revert. Falls back to v0.21.0 file-list automatically.
