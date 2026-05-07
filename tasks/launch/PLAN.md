# Claude Cockpit v1.0 — Launch Wave Master Plan

Owner: Stephane | Current: v0.21.0 | Target: v1.0.0
Repo: /Users/stephaneboghossian/Documents/Code/claude-cockpit
Lines: 16,356 (5,099 sidebar.js, 3,316 claudeData.ts, 2,393 sidebar.css,
1,155 sidebarProvider.ts, 1,000 integrations.ts, 367 jarvis.ts, ...)

## Guiding constraints (don't violate)

- TypeScript strict, zero `any`. Plain CSS only (no Tailwind / new framework).
- Local-first. No new outbound services beyond existing PostHog (HAQQ project
  already wired) + Cloudflare Pages (the landing page).
- Reuse: `logger` (logger.ts), the `CockpitSidebarProvider` message bus
  (sidebarProvider.ts:55–131 InboundMessage union, :574 handle()), the JSONL
  reader (claudeData.ts:512 readSession), `record/recordAsync` telemetry
  (telemetry.ts), and the COMPONENTS / DEFAULT_TAB_COMPOSITIONS registry
  (sidebar.js:3385 / :3525). DO NOT introduce a new state manager.
- Webview CSP locked: `connect-src 'none'`. PostHog calls go through the
  EXTENSION host (Node), not the webview. Same shape as existing
  fetchGithubTrending / checkForUpdate.
- No mutations to `~/.claude/projects/*.jsonl` or any session JSONL. Approval
  queue / replay both write to NEW Cockpit-owned dirs only.
- Don't break v0.21.0 tabs: welcome, custom, now, recs, mac, watchtower,
  office, agents, routines, discover, timeline, settings, history, obsidian,
  library, skills, browse, talk, security, self, help. All must keep
  rendering through the migration.
- v0.21.0 zero-bug pattern: every PR ships with `npm test` green and a manual
  smoke pass on its own tab + the Now + Welcome + Talk + Security tabs.

## 18 features → 9 worktrees

| # | Feature                                | Worktree                                |
|---|----------------------------------------|-----------------------------------------|
| 1 | Approval queue + rollback              | feat/launch-approval-queue              |
| 2 | Session timeline + replay + diff       | feat/launch-replay-timeline             |
| 3 | Cost telemetry + budgets (extend)      | feat/launch-replay-timeline (shared)    |
| 4 | Crash + opt-in PostHog telemetry       | feat/launch-telemetry-posthog           |
| 5 | Permissions audit log                  | feat/launch-permissions-audit           |
| 6 | First-run sandbox demo                 | feat/launch-onboarding-sandbox          |
| 7 | Status bar + command palette           | feat/launch-onboarding-sandbox          |
| 8 | Desktop notifications                  | feat/launch-onboarding-sandbox          |
| 9 | Tutorial / recommendations tab         | feat/launch-onboarding-sandbox          |
|10 | Skill / agent gallery + share          | feat/launch-skill-gallery               |
|11 | Plugin API + extension points          | feat/launch-plugin-api (Phase 0)        |
|12 | Tab pin/hide/reorder/popout + presets  | feat/launch-tab-system-v2               |
|13 | Drag-drop tabs + full-screen grid      | feat/launch-tab-system-v2               |
|14 | Keyboard-first nav                     | feat/launch-tab-system-v2               |
|15 | Themes + accessibility (WCAG AA)       | feat/launch-a11y-theme                  |
|16 | Mobile companion (Cloudflare Pages)    | feat/launch-mobile-companion            |
|17 | Obsidian graph view                    | feat/launch-obsidian-graph              |
|18 | Security tab — keys, leaks, network    | feat/launch-permissions-audit (shared)  |

## Dependency graph

```
                     +----------------------------+
                     | Phase 0: feat/launch-plugin-api |
                     |  (one new file: src/plugin.ts) |
                     |  Extension points + types       |
                     +-------------------+----------+
                                         |
        +------------+------------+------+--------+--------------+--------------+
        |            |            |               |              |              |
        v            v            v               v              v              v
 approval-queue  replay-tl   permissions-audit  skill-gallery  tab-system-v2  a11y-theme
   (XL)           (XL)         (M)               (M)            (L)            (M)
        |            |            |               |              |              |
        +------------+------------+---------------+--------------+              |
                                  |                                              |
                                  v                                              |
                      onboarding-sandbox (L)                                     |
                      (depends on approval-queue snapshot,                        |
                       permissions-audit log, replay-timeline)                    |
                                  |                                              |
                                  v                                              v
                      telemetry-posthog (M) <----- a11y-theme (final pixel pass)
                                  |
                                  v
                      mobile-companion (L)
                      (depends on approval-queue REST shape and posthog event names)
                                  |
                                  v
                      obsidian-graph (M)  -- can run anytime after Phase 0; merge near end
```

## Phasing

### Phase 0 — Foundations (1 worktree, sequential, must merge first)

- **feat/launch-plugin-api** — defines `src/plugin.ts`: typed extension
  points (`registerTab`, `registerWidget`, `registerTrigger`, `registerSidebarPanel`),
  the `WorktreeAction` and `Snapshot` types that approval-queue / replay /
  audit will all share, and a thin shim that exposes the existing
  `COMPONENTS` registry (sidebar.js:3385) as a programmatic API. Also
  formalizes the `ExtensionPointEvent` enum that telemetry will hook into.

  Phase-0 lands ALONE on main. Every Phase-1 worktree branches off the
  merged Phase-0 commit. This eliminates the worst conflict source (every
  feature otherwise wants to touch `COMPONENTS` and `DEFAULT_TAB_COMPOSITIONS`
  in `sidebar.js` independently).

### Phase 1 — Parallel feature builds (7 worktrees in parallel)

Run all seven against the post-Phase-0 commit. Each worktree owns its own
new files and a SLIM, declared edit window in shared files. The conflict
map below names the exact line ranges each worktree may touch in
`sidebarProvider.ts`, `claudeData.ts`, `package.json`, `media/sidebar.js`,
`media/sidebar.css`, `CHANGELOG.md`, and `tasks/todo.md`.

- approval-queue, replay-timeline, permissions-audit, skill-gallery,
  tab-system-v2, a11y-theme, obsidian-graph.

### Phase 2 — Integration + polish (3 worktrees, sequential)

- **onboarding-sandbox** depends on approval-queue's snapshot APIs +
  permissions-audit's log API + replay-timeline's session digests.
- **telemetry-posthog** wraps every Phase-1 surface (it observes them; it
  must merge after they exist so the event taxonomy is real).
- **mobile-companion** consumes approval-queue's serializable queue shape
  + telemetry-posthog event names. Lands LAST, fully optional behind
  `claudeCockpit.mobile.enabled = false` default.

## Conflict map (THE hot zones)

### Hottest: `media/sidebar.js` (5,099 lines)

The COMPONENTS registry (3385–3444), DEFAULT_TAB_COMPOSITIONS (3525–3553),
TAB_ICONS (3558–3579), tabCatalogue() (3581–3612). **Every** feature wants
to add a widget here. Conflict-resolution rule:

- Phase 0 introduces a new map `EXTERNAL_COMPONENTS = {}` adjacent to
  COMPONENTS. From Phase 1 onward, NEW widgets go in EXTERNAL_COMPONENTS
  inside the worktree's OWN file (e.g. `media/sidebar.approval.js`,
  loaded as a sibling script via `sidebarProvider.html()`). This means
  zero overlap on the COMPONENTS object literal itself.
- Each worktree may append ONE entry to DEFAULT_TAB_COMPOSITIONS (its own
  default tab) and ONE entry to TAB_ICONS / tabCatalogue(). All other
  edits stay inside the worktree's new sibling JS file.
- The merge order below sequences these tiny edits to keep them
  serializable.

### Second hottest: `src/sidebarProvider.ts` (1,155 lines)

- Inbound message union (55–131) — every worktree adds 2-6 message types.
  Rule: each worktree adds its types in a NAMED block comment
  (`// === approval-queue ===`) at the END of the union. Reviewers can
  re-sort during merge in 30 seconds.
- handle() switch (574–1063) — same rule. Each worktree appends its
  cases at the END, inside a labeled block.
- Watchers (jarvisWatcher pattern, 279–293) — additive only; each new
  watcher gets its own private member.

### Third hottest: `src/claudeData.ts` (3,316 lines)

- snapshot()/snapshotInner() (1998–2230) builds the payload object.
  Every worktree wants to graft a new key onto `CockpitSnapshot`.
  Rule: extend the `CockpitSnapshot` interface in EACH worktree, but
  add the new key via an OPTIONAL field (`approvalQueue?: ApprovalQueueSnapshot`).
  Wire it inside snapshotInner ONLY in the dedicated section
  (one `recordTime('snapshot.<feature>', ...)` line each, listed in the
  worktree brief). Conflicts become 1-line additive merges.
- Pricing constants, model-family map, COST tables (~900–950) — DO NOT
  TOUCH from any Phase-1 worktree. They're load-bearing for the existing
  Now / budget tabs.

### Fourth hottest: `package.json` (223 lines)

- `contributes.commands` (76–110) — each worktree adds 1–4 commands.
  Place in its named block at the end of the array.
- `contributes.configuration.properties` (111–199) — same; append-only.
- `contributes.viewsContainers` (58–66) — UNCHANGED. Don't add new
  activity-bar containers. The "full-screen panel" in tab-system-v2
  uses `vscode.window.createWebviewPanel`, not a new view container.

### Other shared files

- `media/sidebar.css` — append a worktree-scoped block, all selectors
  prefixed `.cockpit-<worktree>-...`. Small, low-conflict.
- `CHANGELOG.md` — every worktree appends to a single dated `## [Unreleased]`
  block. Resolve by chronological merge.
- `tasks/todo.md` — every worktree appends a `## v1.0 — <worktree-name>`
  section.

## Merge order (Phase 1 → main)

Sequencing minimizes rebase pain. Each worktree below merges to main, then
the next rebases on it. Choose the smaller-surface ones first so the giants
(approval-queue, replay-timeline) eat the cost of rebasing once each.

1. feat/launch-plugin-api  *(Phase 0; alone on main)*
2. feat/launch-a11y-theme  *(touches CSS only — narrowest)*
3. feat/launch-permissions-audit  *(new tab + new dir; tiny footprint)*
4. feat/launch-skill-gallery  *(new tab; share button is local-first)*
5. feat/launch-tab-system-v2  *(touches sidebar.js tab bar — needs all
   widgets above to be COMPONENT-registered first so it can pin/hide them)*
6. feat/launch-obsidian-graph  *(new tab; replaces obsidian widget)*
7. feat/launch-approval-queue  *(big new tab + watcher + snapshot delta)*
8. feat/launch-replay-timeline  *(extends timeline tab + new replay tab;
   uses approval-queue's snapshot dir for diff visualization)*

Then Phase 2:

9. feat/launch-onboarding-sandbox
10. feat/launch-telemetry-posthog
11. feat/launch-mobile-companion

## Cut lines (priority if v1.0 slips)

Order = "first to ship, last to drop." Stephane wants all 18; below is
the slip plan.

| Rank | Worktree                        | If we slip... |
|------|----------------------------------|---------------|
| MUST | feat/launch-plugin-api           | NEVER cut. Phase 0. |
| MUST | feat/launch-approval-queue       | NEVER cut. LeCun gate; gates trust. |
| MUST | feat/launch-permissions-audit    | NEVER cut. Critical for Obsidian + security tab. |
| MUST | feat/launch-replay-timeline      | NEVER cut. Trust + cost. |
| MUST | feat/launch-telemetry-posthog    | NEVER cut. Crash detection. |
| HIGH | feat/launch-onboarding-sandbox   | Defer the SANDBOX (2-min Talk/agent demo) to v1.1, keep the existing welcome banner + status-bar polish + desktop notifications. |
| HIGH | feat/launch-tab-system-v2        | Ship pin/hide/reorder; defer pop-out full-screen grid + named layout presets to v1.1. |
| HIGH | feat/launch-skill-gallery        | Ship local browse + manual share-via-clipboard; defer one-click registry publish to v1.1 (registry doesn't exist yet). |
| MED  | feat/launch-obsidian-graph       | Ship the d3 graph; defer "filter by Claude session" overlay to v1.1. |
| MED  | feat/launch-a11y-theme           | Ship WCAG AA contrast pass + tab keyboard nav; defer screen-reader-perfect ARIA narration to v1.1. |
| LOW  | feat/launch-mobile-companion     | Defer to v1.1 entirely. The approval queue is local-first and works on the desktop; mobile is nice-to-have. v1.0 ships the existing Cloudflare Pages landing untouched. |

## Complexity per worktree

| Worktree                        | Complexity | LOC est | New files |
|----------------------------------|------------|---------|-----------|
| feat/launch-plugin-api           | S  | ~250  | 1 (`src/plugin.ts`) |
| feat/launch-approval-queue       | XL | ~1400 | 4 (`src/approvalQueue.ts`, `src/snapshot.ts`, `media/sidebar.approval.js`, `media/sidebar.approval.css`) |
| feat/launch-replay-timeline      | XL | ~1300 | 3 (`src/replay.ts`, `src/sessionDiff.ts`, `media/sidebar.replay.js`) |
| feat/launch-permissions-audit    | M  | ~600  | 2 (`src/auditLog.ts`, `media/sidebar.audit.js`) |
| feat/launch-telemetry-posthog    | M  | ~500  | 2 (`src/posthog.ts`, `src/crash.ts`) |
| feat/launch-onboarding-sandbox   | L  | ~800  | 3 (`src/sandbox.ts`, `src/notifications.ts`, `media/sidebar.tutorial.js`) |
| feat/launch-skill-gallery        | M  | ~600  | 2 (`src/gallery.ts`, `media/sidebar.gallery.js`) |
| feat/launch-tab-system-v2        | L  | ~900  | 1 (`media/sidebar.layout.js`); heavy edits to existing sidebar.js |
| feat/launch-a11y-theme           | M  | ~400  | 1 (`media/sidebar.themes.css`); CSS-heavy |
| feat/launch-mobile-companion     | L  | ~700  | landing/mobile/* (10ish HTML/JS/CSS) |
| feat/launch-obsidian-graph      | M  | ~600  | 2 (`src/graph.ts`, `media/sidebar.graph.js`) |
| **Total**                        |    | ~8050 | ~31 new files |

## Risks (what could break v0.21.0)

1. **COMPONENTS registry collisions** — fatal if two worktrees both edit
   the literal in sidebar.js:3385–3444. Mitigated by Phase-0 EXTERNAL_COMPONENTS
   map. Reviewer must reject any Phase-1 PR that adds keys directly to
   COMPONENTS.
2. **InboundMessage union edits** — if two worktrees add the same type
   string ("approve", "share", "audit") they'll silently collide in
   handle(). Mitigated by namespace prefix per worktree:
   `approval.approve`, `gallery.publish`, `audit.openLog`, etc.
3. **Snapshot payload size** — every new optional key inflates the
   `postMessage` JSON. Approval queue + audit log + replay timeline could
   bloat to >2MB. Mitigation: each worktree must lazy-load big payloads
   (approvalQueue stays separate from snapshot, fetched on-demand via a
   message; the snapshot only carries `pendingApprovalsCount: number`).
4. **Webview CSP** — Telemetry/PostHog: ALL HTTP from Node host, never
   the webview. Mobile companion: separate domain; no impact on extension
   webview CSP.
5. **Jarvis approval flow already exists** (jarvis.ts) — feat/launch-approval-queue
   must not REPLACE it; it must EXTEND it. boo-mesh integration becomes
   one of N approval sources. Reuse `JarvisApproval` shape.
6. **PostHog**: HAQQ Legal AI's wiring uses project 92178. Cockpit needs
   a NEW project (or a flag); do NOT mix Stephane's customer telemetry
   with extension telemetry.
7. **Tab system v2** — pop-out full-screen grid uses
   `vscode.window.createWebviewPanel`. The existing webview view
   (claudeCockpit.sidebar) must keep working independently; both views
   share the SAME COMPONENTS registry. Risk: layout state desync. Mitigation:
   layout state lives in globalState, not in the view.
8. **Obsidian graph** — d3/cytoscape is ~250KB minified. Must ship as
   `media/vendor/d3.min.js`, locally bundled (not CDN). CSP allows local
   scripts via `script-src 'nonce-...'` so this is fine, but will bump
   the .vsix size by ~250KB. Acceptable.
9. **Security CLI write paths** — feat/launch-permissions-audit appends
   to `~/.claude/.cockpit/audit.log`. Must use atomic append-and-fsync;
   if Claude Code itself is also writing nearby files we must NOT contend
   on the same fd.

## Test gates

Every worktree must:

- `npm test` green (currently 42/42).
- `node --check media/sidebar.js` clean.
- Manual: open Cockpit, click through Welcome → Now → Talk → Security →
  the worktree's own tab. No console errors. No "loading…" stuck states.
- `npm run compile` clean (TypeScript strict).

Final integration gate (before tagging v1.0.0):

- All 11 worktrees merged.
- Boot Cockpit cold; record refresh budget. Should be <1.5x v0.21.0 cold-start.
- Run /qa report-only against the live extension webview.
- Run /design-review against every new tab.
- Run /cso security audit on the merged tree.
