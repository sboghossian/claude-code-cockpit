# Claude Cockpit — Phase 1

VSCode extension that surfaces Claude Code's hidden state directly in the editor. Sibling to `claude-overlay` (macOS menubar, cross-surface) — this one is VSCode-native, focused on the Code surface.

## v0.21.0 — Bug-fix + system stats wave (DONE)

### Fixed

- [x] Talk widget ResizeObserver / AudioContext leak on refresh
- [x] Recommendations dropdown routing to renamed tabs (library/settings)
- [x] Roadmap auto-fetch on `'timeline'` tab id
- [x] Manage tab rendering `"undefined"` for missing config keys
- [x] Tab bar sticky positioning clipping 12px on scroll
- [x] Welcome dismiss / reset-first-run / goto-tab instant re-render
- [x] Per-day cost attribution splitting correctly across model families
- [x] Wispr shortcut validated against injection-safe whitelist before AppleScript dispatch
- [x] `runRoutine` validates routine name with strict regex (blocks path traversal)
- [x] App-usage tracker timer leak on extension reload; local-tz used consistently
- [x] `httpGet` capped at 2 MB, follows up to 5 redirects
- [x] Git branch detection in worktrees (`gitdir:` parsing)
- [x] Mac Health network parser tolerates macOS Sequoia layout variations
- [x] Security scan processes long lines in 2000-char windows (was skipping them)
- [x] `listProjects` uses head-only session reader on refresh
- [x] Health refresh no longer double-runs the full snapshot scan
- [x] Jarvis dead-code paths removed from inbound message union

### Added

- [x] Tab icons — inline-SVG line icon beside every tab label; theme-adaptive via `currentColor`; covers all 20 tabs
- [x] System Stats cards in the Mac tab — CPU (used %, stacked bar, core count, model), Memory (pressure %, wired/active/compressed/free, swap), Energy (battery %, cycle count, health %, wattage, time remaining, source pill), Disk (per-volume mini bars), Network (rx/tx KB/s, interface, SSID, IPv4, per-interface IPs); green/amber/red tones at existing thresholds; single-column collapse under 300 px

## Phase 1 (this PR) — read-only sidebar

Goal: prove the data plumbing. No mutations to `~/.claude/`.

- [x] Scaffold extension (`package.json`, `tsconfig.json`, manifest)
- [x] Logger module (OutputChannel-backed, no console.log)
- [x] Read active session JSONL from `~/.claude/projects/<encoded-cwd>/*.jsonl`
- [x] Compute token burn from `usage` blocks (input + output + cache)
- [x] Extract files touched from Edit/Write/MultiEdit tool_use blocks
- [x] Parse `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` index
- [x] Sidebar webview (Activity Bar icon → panel)
- [x] Status bar items (cwd basename, token burn, files touched)
- [x] Watch session JSONL with `fs.watch` for live updates
- [x] Quick action: open MEMORY.md
- [x] README with screenshots placeholder + dev instructions
- [x] Public GitHub repo
- [x] Landing page → cockpit.dashable.dev
- [x] Unit tests for `claudeData.ts` parser (`npm test`, 18 tests, edge cases covered)

## Phase 2 — quick actions (DONE, shipped v0.2.0)

- [x] Cross-project sessions browser (also fixes empty-state when no folder open)
- [x] MCP server names panel (read `~/.claude/settings.json` only — no `~/.claude.json` to avoid credential exposure)
- [x] Hooks inspector — event types + count + command bin names
- [x] Enabled plugins panel
- [x] Sessions are first-class, not workspace folders (v0.2.0 refactor)

## v0.8.0 — Personal OS HUD (DONE, shipped)

User goal: cockpit becomes the "personal OS" surface for VSCode users —
glanceable system health + Claude state + actionable inbox + plain-language
explanations for non-power-users. Shipped:

- [x] **Greeting header** — time-aware ("Morning, Stephane · 4 live runs ·
      2 need you")
- [x] **At-a-glance stats grid** — Streak (consecutive days), Active days
      (30d), Peak hour (last 7d), Favorite model, Week cost
- [x] **Inbox panel** — aggregated needs-you items: idle sessions, errored
      tools, stale memories, pending plan checkboxes, working sub-agents,
      budget breaches
- [x] **Agents tab** — read `.claude/agents/*.md` (global + workspace),
      surface description / model / tools / color
- [x] **Tunnels** — read `~/.cloudflared/*.yml` and subdir configs, surface
      tunnel-name → hostname → service mapping with click-to-open
- [x] **RTK token killer** — if `rtk` is in PATH, run `rtk gain` (cached 60s),
      surface efficiency % + total saved + top command in Config tab
- [x] **Mac Health tab** — disk / memory pressure / battery / CPU load /
      Wi-Fi throughput / external drives / Bluetooth peripheral rings (with
      battery levels for AirPods, keyboard, mouse, etc.) — plus an overall
      excellent/good/attention badge
- [x] **App usage tracker** — polling-based focus tracker via
      `lsappinfo front` once per minute, persists per-day per-app per-hour
      in globalState (30-day retention), renders today's hourly bar chart
      + top-8 apps. Local-only.
- [x] **Help tab** — plain-language explanations of every tab, every metric,
      data sources, and privacy model. For users who aren't deep into Claude
      Code internals.
- [x] **+4 tests** (33/33 pass): readAgents, readTunnels, computeStats,
      computeInbox

### Recon notes (so compaction doesn't lose them)
- Mac Health uses: `df -k`, `vm_stat` + `sysctl hw.memsize`, `pmset -g batt`,
  `sysctl -n vm.loadavg`, `route -n get default` + `netstat -bI`,
  `system_profiler SPBluetoothDataType -json`, `networksetup
  -getairportnetwork`. Cached 8s in module scope. Async refresh every 30s
  while sidebar view is open.
- App usage poll: `/usr/bin/lsappinfo front` returns `"App Name"`. Cheap
  (sub-100ms). 1min cadence keeps overhead trivial. globalState key:
  `claudeCockpit.appUsage`.
- Health tone thresholds: disk 75/90, memory pressure 75/90, battery <15
  unplugged = bad, CPU load %1 100/200.
- BT peripheral rings use a CSS conic-gradient + inner mask for the donut.
  `--pct` and `--ring` CSS variables drive the visual.
- RTK probe: `execFile('rtk', ['gain'], { timeout: 4000 })`. Parses
  "Tokens saved: X.YM (NN.N%)" line. Runs once on view-open via async
  refresh. If rtk is missing, the section quietly omits itself.
- Help tab data is hardcoded in `sidebar.js:helpSection()` for now —
  trivial to maintain since the cockpit surface area is finite.

## v0.7.0 — Cross-surface bridge (DONE, shipped)

User asked for ideas mined from neighboring projects in `~/Documents/Code/`.
Surfaced + shipped four integrations that turn cockpit into a true multi-surface
HUD:

- [x] **Plans panel** — auto-parses `tasks/todo.md` / `tasks/forkcast.md` /
      `plan.md` / `tasks.md` / `TODO.md` from workspace root + `tasks/` subdir,
      counts checkboxes, shows progress bar with up to 5 next pending items
- [x] **Chat surface tab** — auto-detects `~/Documents/Code/claude-data-export/`
      (also checks `~/` and `~/Downloads/`), surfaces conversation count, recent
      20 conversations with excerpts + msg counts, and a preview of the
      claude.ai memory blob. Cockpit is now genuinely cross-surface (Code + Chat).
- [x] **Activity heatmap** — 7d × 24h grid in Now tab, intensity-shaded green
      cells, hover for exact count. Concept lifted from `claude-usage`'s
      Python parser; built from JSONL message timestamps (cheap regex parse).
- [x] **claude-usage dashboard launcher** — detects install at
      `~/Documents/Code/claude-usage/`, pings ports 5000/8000/8080/5050/5001,
      shows live URL when running, "Start dashboard" button shells out to
      `python3 server.py` in a terminal otherwise. Cached 30s.
- [x] **+5 tests** (29/29 pass): readPlans (3 cases), computeActivityHeatmap,
      readChatExport
- [x] New tab: **Chat** (with ◌ indicator when export not present)

### Recon notes (so compaction doesn't lose them)
- Chat-export shape: `conversations.json` is an array of `{uuid, name, summary,
  created_at, updated_at, chat_messages: [{text, content, sender}]}`. Some
  exports use `messages` instead of `chat_messages` — handled both. `memories.json`
  is `[{conversations_memory: <string>}]` — Stephane's is ~5KB of life context.
- Plan parse regex: `^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$` — handles `- [x]`,
  `- [X]`, `* [ ]`, etc. Strips `**bold**` and backticks from item text.
- Heatmap uses cheap `indexOf("\"timestamp\"")` pre-filter before regex; full
  JSON parse would be 10x slower across 100MB of session logs.
- claude-usage port detection uses HEAD requests with 250ms timeout. Cached
  30s in module-scope to avoid spamming ports on every refresh.

## v0.6.0 — Watchtower (DONE, shipped)

User asked for: fix v0.5.0 gaps, integrate Obsidian, mine claude-overlay
prototype for ideas, ship as much as possible.

- [x] **Obsidian integration** — auto-detect vaults via `obsidian.json` registry,
      list recent notes (md walk, depth ≤ 4, with first-1.5KB excerpt),
      "Save active session →" writes a markdown digest with frontmatter
      (`type: claude-session`, project, session_id, tokens, cost, files, tools)
      to a configurable subdir, "Open in Obsidian" via `obsidian://` URI
- [x] **Watchtower** — cross-project session heartbeat, last 60min, color-coded
      (live <10s / recent <15min / idle <30min / stale >30min), per-card
      tokens+cost+age, click to open the JSONL
- [x] **Idle sentinel** — same data filtered to idle+stale only, dedicated view
- [x] **Notification center** — strip at top of Now tab, surfaces context >75/>90,
      low cache hit (<30% on >50k tokens), stale memory (≥5 entries), idle
      sessions, budget breaches
- [x] **Budget caps** — VSCode settings (`claudeCockpit.budget.*`), per-day +
      per-session caps, progress bars with ok/warn/danger tones, alerts wired
      into notifications, "Set Daily Budget Cap" command + button
- [x] **Prompt library** — personal snippets in `globalState`, list/add/delete,
      one-click copy to clipboard
- [x] **Global session search** — grep across every JSONL under
      `~/.claude/projects/`, ranks newest first, surfaces user/assistant/tool_use
      /tool_result with snippet + highlight, clickable to open the session
- [x] **Cost by tool** — weighted attribution (Read/Edit/Bash/Task get higher
      weight) of session cost across tool calls, bar chart in Now tab
- [x] **Pinnable memory** — pin/unpin entries, pinned float to top with 📌
- [x] **Quick-action toolbar** — Search / Watchtower / Save→Obsidian / Open vault
      / Open session, all from Now tab
- [x] **New tabs**: Watchtower, Search, Obsidian, Prompts (alongside existing
      Now / Memory / Skills / Projects / Files / Config)
- [x] **Commands**: saveToObsidian, openVault, searchAllSessions, watchtower,
      setDailyCap
- [x] **Tests**: +5 tests (computeBudget, computeNotifications, computeCostByTool,
      computeWatchtower, globalSessionSearch). 24/24 pass.

### Recon notes (so compaction doesn't lose them)
- Obsidian vault registry: `~/Library/Application Support/obsidian/obsidian.json`,
  shape `{vaults: {<id>: {path, ts, open}}}`. Stephane's primary vault is
  `~/Documents/Code/stephane_claude` on his machine — ts-sorted gives the most
  recently opened first.
- Idle thresholds: 10s = live, 15min = recent->idle, 30min = idle->stale.
  Watchtower window is 60min total.
- Budget config flows: `vscode.workspace.getConfiguration('claudeCockpit.budget')`
  read at every refresh, `onDidChangeConfiguration` triggers a refresh.
- Prompts + pinned memory live in `context.globalState` keyed
  `claudeCockpit.prompts` / `claudeCockpit.pinnedMemory`. Survives reload.
- Cost-by-tool weights live at `claudeData.ts:computeCostByTool` — adjust if
  attribution feels off (Task=2.0, Read/Edit/Write=1.5–1.7, Glob=0.9, default=1.0).

## v0.4.0 — DONE, shipped

User asked for tabs + more features:

- [x] **Tab system** — Now / Memory / Skills / Projects / Config. State persisted via `vscode.setState`/`getState`. Sticky tab bar at top.
- [x] **Cost rate ($/hour)** — derived from cost / (lastActivity - startedAt). Shown as a small badge next to the model tag.
- [x] **Tool histogram** — per-tool counts tracked in `readSession`, rendered as horizontal bar chart in the Now tab.
- [x] **Today summary** — `computeToday()` walks `~/.claude/projects/<*>/*.jsonl` filtering by `mtimeMs >= today00:00`. Per-project breakdown.
- [x] **Activity feed** — last 25 events (tool_use + messages) collected during readSession, displayed as monospace tail-style list.
- [x] **Disk usage** — recursive walk of `~/.claude/projects/`, shown in Config tab.

## v0.3.0 — DONE, shipped

All seven features built in one batch:

- [x] **Cost tracker** — token→USD per model family (Opus/Sonnet/Haiku); rates in `claudeData.ts:PRICING`. Renders under Tokens with model tag.
- [x] **Live indicator** — green pulsing dot when session mtime < 10s. CSS `@keyframes cockpit-pulse`.
- [x] **Sub-agents view** — scans `<sessionFile-dir>/<sessionId>/subagents/*.jsonl`, surfaces token totals + tool calls per agent.
- [x] **Skill palette** — reads `~/.claude/skills/*/SKILL.md` + plugin cache; fuzzy search; click copies `/<name>` to clipboard.
- [x] **Token sparkline** — last 60 min bucketed by minute, inline SVG in Tokens header.
- [x] **Memory search** — input filters memory list by title/hook (client-side); server-side `searchMemory()` available for future deep-search.
- [x] **PILOT panel** — auto-detects `<user>_claude.md`, extracts numbered principles, role from frontmatter, "one-liner" quote, plus always-live subdomain dots.

### Recon notes (saved here so compaction doesn't lose them)
- `stephane_claude.md`: YAML frontmatter has `name`, `description`. Body has `### The principles` followed by 10 numbered `**bold** prose.` items. Final line: `"Chatbots give up. Agents improvise."` Worth surfacing as a quote.
- `project_always_live_subdomains.md`: 12 subdomains, parse lines starting with `- ` ending in `.dashable.dev`.
- `~/.claude/skills/`: 93 skills installed for Stephane.
- `~/.claude/plugins/cache/<plugin>/skills/<name>/SKILL.md`: doesn't exist for Stephane (no plugins with skills) but should be supported.

### Implementation order (to resume)
1. Data layer in `claudeData.ts`: types + functions for all 7 features.
2. UI in `media/sidebar.js`: render order (top-to-bottom): Pilot, Active session + live dot, Cost, Tokens (with sparkline), Session, Sub-agents, Files touched, Memory (with search), Skills (with search), Recent projects, MCP, Hooks, Plugins.
3. Tests for new pure functions.
4. Bump to 0.3.0, package, install via `code --install-extension`.
5. PR on `feat/v0.3.0` against `main`.

## Phase 4 — usage rollups + per-tab customization (DONE, this PR)

User goal: native multi-period usage tracking with caps, plus full
ownership of every tab's widget composition (not just the Custom tab).

### Usage rollups

- [x] `claudeData.ts:computeUsageRollups()` — scans `~/.claude/projects/*/*.jsonl`,
      aggregates per session/today/week/month/year/all-time, with byModel breakdown.
- [x] `~/.claude/cockpit-usage-cache.json` mtime+size cache — 138 files cold ~900ms,
      warm reload **11ms / 137 hits**.
- [x] `BudgetConfig` extended with `weeklyCapUsd / monthlyCapUsd / yearlyCapUsd`.
      `extension.ts` reads them; `package.json` exposes 3 new VSCode settings.
- [x] `usage` field on `CockpitSnapshot` (both no-cwd and active-session branches).
- [x] `usageRollups` widget in `COMPONENTS` registry — six-row card with
      progress bars and "no cap" hint chips. Drops into the Now tab default
      composition under Budget caps; pickable on any tab.

### Per-tab widget composition

- [x] `tabComponents: Record<string, string[]>` added to `UserPrefs`
      (sidebarProvider.ts). Empty array = "user wants empty" — no fallback.
- [x] `DEFAULT_TAB_COMPOSITIONS` map mirrors today's hardcoded bodies for
      every tab (Now is the heaviest at ~22 widgets).
- [x] Wrapper components registered for bespoke tabs: `history`,
      `unifiedSettings`, `timeline`, `library`, `browse`, `talk`,
      `securityFull`, `helpDoc`, `selfTelemetry`, `watchtowerIdle`,
      `sessionActive`. Drop any of them on any tab.
- [x] `tabBodyComposed(snap, tabId)` replaces the ~80-line render switch
      (no-cwd + active-session paths collapsed into one).
- [x] Customize panel: tab-selector chips at top of "Widgets on tab"
      section + per-tab grid + Reset/Clear shortcut buttons.
- [x] `data-customize-tab` plumbed through the per-section ⚙ button so
      clicking from a tab opens the customize panel scoped to that tab.
- [x] Talk lifecycle (`Talk.init/teardown`) gated on whether the rendered
      composition includes the `talk` widget — not the active tab id.
- [x] Legacy `customComponents` honored as fallback for the Custom tab on
      first edit, then migrated into `tabComponents.custom`.

### Bug fix shipped alongside

- [x] Empty Custom tab is now actually empty. Previously
      `getCustomComponentIds()` fell back to `DEFAULT_CUSTOM_COMPONENTS`
      whenever the user's list was empty; you literally couldn't have an
      empty Custom tab.

### Verification

- [x] `npm run compile` clean.
- [x] `npm test` 42/42 pass.
- [x] `node --check media/sidebar.js` passes.
- [x] Live data smoke test: scanned 138 files in 897ms cold / 11ms warm;
      year-to-date $8,646 (99.4% Opus, 0.4% Sonnet, 0.4% unknown — matches
      the "default Opus, burn budget" pattern).

## Phase 3 — later

- [ ] Mode toggle (plan / auto / bypass / default) — needs human-gate per LeCun memory
- [ ] Model swap dropdown — same gate
- [ ] "Documents created this session" — capture Bash heredoc writes too
- [ ] Hook log viewer — varies too much across hook authors; defer
- [ ] Embedded paulrobello/claude-office pixel theatre
- [ ] **Office panel** — embed paulrobello/claude-office pixel visualizer in a webview tab. Detect if backend is running on :8000 and frontend on :3000; show iframe or one-click launcher (`make dev-tmux` in `~/Documents/Code/claude-office`). The "boss + employees" theater is a great way to watch sub-agents live.

## Phase 3 — multi-session

- [ ] All running Claude Code sessions across projects
- [ ] Subdomain heartbeat strip (always-live list from MEMORY)
- [ ] Skill palette with usage stats

## Design choices

- Plain CSS using VSCode theme variables (`var(--vscode-foreground)`) instead of Tailwind. Webview CSP makes Tailwind CDN painful and bundling adds 30KB+ for a v1 surface that's mostly text. Revisit in Phase 2 if the UI gets richer.
- No runtime deps. Just `@types/vscode` + `typescript`. Keeps the extension under 50KB.
- Extension is read-only in v1. Writing back to `~/.claude/` while Claude Code is also writing is a coordination problem we punt to Phase 2.

## Test plan

- Open VSCode in a project with an active Claude Code session → sidebar shows token burn, files touched, memory index
- Make Claude touch a file → file appears in sidebar within 2s
- Open VSCode in a project with no Claude session → empty state, no errors
- Force-quit Claude mid-session → sidebar shows stale data, refresh button works

## v1.0 — plugin-api

Phase 0 of the v1.0 launch wave. Defines the formal extension contract every Phase-1 feature consumes (approval-queue, replay-timeline, permissions-audit, skill-gallery, tab-system-v2, a11y-theme, obsidian-graph). Pure plumbing — zero behavior change for v0.21.0 users.

- [x] `src/plugin.ts` exports `CockpitWidget`, `CockpitTab`, `CockpitTrigger`, `WorktreeAction`, `SnapshotRef`, `AuditEvent` interfaces
- [x] `registerWidget`, `registerTab`, `registerTrigger` functions mutate module-private append-only arrays
- [x] `registerSidebarScript` lets Phase-1 worktrees register their own sibling JS files; `listSidebarScripts()` exposes the read-only view
- [x] `media/sidebar.js` adds `EXTERNAL_COMPONENTS = {}` adjacent to (not inside) the COMPONENTS literal
- [x] `window.cockpit.registerComponent(id, def)` is callable from sibling scripts and populates `EXTERNAL_COMPONENTS`
- [x] `tabBodyComposed()` checks both `COMPONENTS` and `EXTERNAL_COMPONENTS`
- [x] `sidebarProvider.html()` walks `listSidebarScripts()` and emits one nonce-tagged `<script>` per registered path
- [x] Webview CSP unchanged (`connect-src 'none'` still locked); external scripts inherit the same nonce as `sidebar.js`
- [x] `npm test` 42/42 still green; 4 new plugin tests added (registerWidget shape, duplicate-id error, registerTab defaults, registerTrigger command-format) → 46/46
- [x] `npm run compile` clean under TypeScript strict (no `any`)
- [x] `node --check media/sidebar.js` clean
- [x] Zero new dependencies
- [x] `package.json` untouched (no contributes / configuration / scripts changes)
- [x] `claudeData.ts` untouched
- [x] COMPONENTS literal contents untouched

## v1.0 — a11y-theme

Goal: WCAG AA contrast across dark + light, net-new high-contrast palette,
`prefers-reduced-motion` honored, screen-reader narration through the tab
bar + header. CSS-only worktree per the launch plan; lands first in Phase 1.

### Acceptance criteria

- [x] **`media/sidebar.themes.css` shipped.** Three palettes: contrast-strengthened light (status colors `#c52f2f` red, `#b15c00` warn), strengthened dark (`#ff6b6b`/`#ffb070`), and a new `body[data-theme="high-contrast"]` block (pure black bg, AAA contrast: link 8.36:1, text 17:1, success 9.4:1, danger 7.1:1).
- [x] **`prefers-reduced-motion: reduce` block at top of `sidebar.css`** collapses every CSS animation + transition to ~0ms (live-dot pulse, `cockpit-pulse` keyframe, all hover transitions).
- [x] **Talk particle viz respects reduced motion.** `Talk.init()` checks `matchMedia('(prefers-reduced-motion: reduce)')`, paints one static frame instead of starting the `requestAnimationFrame` loop.
- [x] **Global `:focus-visible` ring** (2px `--vscode-focusBorder` outline, 2px offset) on every interactive element. Plus `.cockpit-a11y-focus-ring` opt-in helper.
- [x] **`.cockpit-a11y-sr-only` utility** for screen-reader-only content.
- [x] **Tab bar a11y.** `<nav role="tablist" aria-label="Cockpit tabs">`; each tab gets `aria-label`, roving `tabindex` (0 active / -1 inactive per WAI-ARIA tab pattern), inline SVG marked `aria-hidden="true" focusable="false"`.
- [x] **Header strip a11y.** `role="banner"`, search wrapper `role="search"`, `aria-label` on icon-only buttons (⚙, ?, ✕) and the search input.
- [x] **Theme radio group a11y.** `role="radiogroup"` + `aria-labelledby="cockpit-theme-heading"` + per-radio `aria-label`. Fourth option "High contrast (WCAG AAA)" added.
- [x] **`'high-contrast'` enum value** in `package.json` `claudeCockpit.theme`. `CockpitTheme` TS type extended to `'auto' | 'dark' | 'light' | 'high-contrast'`. Validators in `readUserPrefs` and the `userPrefs` patch handler updated; `data-theme-set` JS validator updated.
- [x] **`sidebarProvider.html()` emits `<link rel="stylesheet" href="sidebar.themes.css" />`** after the existing sidebar.css link.
- [x] `npm test` green (47/47 baseline preserved — visual change only).
- [x] `npm run compile` clean under TypeScript strict (no `any`).
- [x] `node --check media/sidebar.js` clean.
- [x] Zero new dependencies. No CSS framework or preprocessor introduced.
- [x] No existing palette colors removed. Users on `theme: 'auto'` (default) see zero visual change.
- [x] No edits to the `COMPONENTS` literal contents in `media/sidebar.js`.
- [x] No edits to `claudeData.ts` or `CockpitSnapshot` shape (this worktree owns no snapshot field).
- [x] No new commands / new view containers in `package.json`.

### Deferred to v1.1 (per launch plan cut lines)

- [ ] Screen-reader-perfect ARIA narration on every tab body (tab bar + header + Now + Talk + Welcome + Security covered here; the long tail follows).
- [ ] Programmatic Left/Right arrow key navigation between tabs (roving tabindex makes Tab work; arrow-key handler is a v1.1 polish).
## v1.0 — obsidian-graph

Goal: replace the obsidian tab's recent-notes list with a real-time vault graph. Stephane only cares about the topology and click-through, not note bodies. Ship the static graph + "today's touches" overlay; vault picker + per-session overlay defer to v1.1 (per the cut-line in `tasks/launch/PLAN.md`).

### Done

- [x] `src/graph.ts` — wikilink parser (plain / alias / section / fenced-code-aware), vault walker (depth 8, 1 MiB read cap per file), edge resolver (id + basename forms, ghost nodes for dangling links), atomic-write JSON cache at `~/.claude/.cockpit/graph-cache-<vaultId>.json`, `getOrBuildGraph` with mtime-based invalidation
- [x] `media/vendor/d3.min.js` — locally bundled IIFE, 64053 bytes / 62.55 KiB minified (well under the 250 KB plan budget). Bundles only `d3-force`, `d3-selection`, `d3-zoom`, `d3-drag` as `window.d3`. No CDN. No npm runtime dep added to `package.json`
- [x] `media/sidebar.graph.js` — d3-force renderer mounted into `#cockpit-graph-container`. Registered via `window.cockpit.registerComponent` is unnecessary here because the renderer mounts into a placeholder owned by the existing `obsidianSection`; we use the Phase-0 `registerSidebarScript` bridge so the script loads after `sidebar.js`
- [x] Pan/zoom/drag (d3-zoom + d3-drag), click-to-open via `obsidian://` (host-side `vscode.env.openExternal` in `graph.openInObsidian` handler)
- [x] "Touched today" overlay — nodes whose path matches any entry in `claudeData.stats.filesTouched` render in `--vscode-charts-orange`
- [x] `src/sidebarProvider.ts` — `graph.refresh` / `graph.openInObsidian` / `graph.pickVault` inbound message types + `refreshGraph` private method that yields once via `setImmediate` so the message tick stays responsive on a 5 k-note vault
- [x] `src/extension.ts` — registers `media/vendor/d3.min.js` (loaded first) + `media/sidebar.graph.js` via `registerSidebarScript`; new `claudeCockpit.obsidian.refreshGraph` command
- [x] `src/claudeData.ts` — `CockpitSnapshot.obsidianGraph?: { nodeCount; edgeCount; vault }` (lightweight summary; full payload lazy-loads on tab open)
- [x] `media/sidebar.js` — `obsidianSection` replaced with placeholder div + Refresh button; `window.cockpit.postMessage` and `window.cockpit.getLastSnapshot` exposed for sibling scripts (single `acquireVsCodeApi` rule)
- [x] `media/sidebar.css` — `.cockpit-graph-*` block at the end (container, svg, link, node, isolated, touched variants)
- [x] `package.json` — `claudeCockpit.obsidian.refreshGraph` command added (1 contribution)
- [x] `test/graph.test.js` — 4 tests covering wikilink parser (plain / alias / section / fenced excluded), A↔B cycle stability, isolated-note inclusion, and cache hit + mtime-driven invalidation

### Out of scope (deferred to v1.1)

- [ ] "Filter by Claude session" overlay — color edges that were touched in a chosen replay-timeline session id (depends on `feat/launch-replay-timeline` shipping first)
- [ ] Vault picker UI (multi-vault users currently get the primary vault from the Obsidian registry; the `graph.pickVault` message type is a no-op hook so v1.1 lands without a wire-format change)
- [ ] Note-content preview on hover (out by Stephane's intent: "I only care about the graph")

### Acceptance status

- [x] Graph renders for medium vaults; cold scan logs the build time at `info`
- [x] Cache hit (no .md mtime advance) avoids re-walk; verified by the `getOrBuildGraph` test
- [x] Click-through opens `obsidian://` URI; vault id sanitized in handler before parse
- [x] Falls back to "no vault detected" / "no notes found" empty states gracefully
- [x] `npm test` 51/51 (was 47/47); `npm run compile` clean (TS strict, zero `any`)
- [x] `node --check` clean for `media/sidebar.js`, `media/sidebar.graph.js`, and `media/vendor/d3.min.js`
## v1.0 — permissions-audit

Phase 1 of the v1.0 launch wave. Append-only audit log + Security-tab sub-views for keys (SecretStorage), leaks (existing scanSecurity), and outbound network monitor (extension-host traffic only).

- [x] `src/auditLog.ts` exports `appendAuditEvent`, `readAuditTail`, `searchAudit`, `outboundDomainTail`, `readAuditSnapshot`, `clearAuditLog`, `setAuditEnabled`, `getAuditLogPath`
- [x] Atomic append via `O_APPEND` + `fsync`; concurrent extension hosts can't tear lines
- [x] Rotation at 50 MB across `audit.log.{1..5}`; oldest dropped when threshold tripped
- [x] 8 KB per-line cap; oversized lines redacted to `{ truncated: true, originalBytes: n }` keeping ts + kind
- [x] `media/sidebar.audit.js` registers four widgets (`auditKeys`, `auditLeaks`, `auditOutbound`, `auditLog`) via the Phase-0 `window.cockpit.registerComponent` bridge — zero edits to the COMPONENTS literal
- [x] Security tab subBar gains three sub-tabs (Keys / Outbound / Audit log) plus the existing Overview / Leaks / .env / Git / MCP — single `securityFull` widget, no top-level tab change
- [x] Six wrap sites added: `discover.ts:fetchGithubTrending` (https.get api.github.com), `discover.ts:httpGet` (lib.get arbitrary), `updateCheck.ts:fetchLatestRelease` (https.get api.github.com), `integrations.ts:ping` (http.request localhost), `integrations.ts:httpsHead` (https.request always-live subdomains), `roadmap.ts:getJson` (lib.get roadmap.dashable.dev / localhost). Each emits one `appendAuditEvent({ kind: 'net.outbound', detail: { host, method, purpose } })` immediately before the HTTP call. Detail is REDACTED — host + method + purpose only, never paths / bodies / query strings
- [x] `security.ts:outboundDomainTail()` thin wrapper — keeps security.ts as the single import surface for the webview's security-related data
- [x] `CockpitSnapshot` extended with `audit?: { last24h, lastDomain }`; wired in `snapshotInner` via one dedicated `recordTime('snapshot.audit', ...)` line in BOTH branches (active session + no session)
- [x] SidebarProvider message union extended with `audit.refresh | audit.search | audit.export | audit.clearLog | audit.openLog | keys.add | keys.delete | keys.list` — namespaced per the launch plan; extra fields `auditQuery / auditTailN / keyName / keyValue`
- [x] Keys sub-view stores values via VS Code `SecretStorage` (Keychain / libsecret / DPAPI); webview only sees count + last-added timestamp; values never leak through `postMessage`
- [x] Two new commands in `package.json`: `claudeCockpit.audit.export`, `claudeCockpit.keys.add`
- [x] One new setting: `claudeCockpit.audit.enabled` (bool, default `true`); flipping it fires `setAuditEnabled` so the change takes effect without restart
- [x] `npm test` 61/61 green (54 baseline + 7 audit tests: append+read roundtrip, tail-N order across rotation, rotation threshold, search across rotated files, outbound roll-up, disabled-mode no-op, oversized-line redaction)
- [x] `npm run compile` clean under TypeScript strict (zero `any`)
- [x] `node --check media/sidebar.js` clean; `node --check media/sidebar.audit.js` clean
- [x] No mutations to `~/.claude/projects/*.jsonl`; audit log lives at `~/.claude/.cockpit/audit.log` (Cockpit-owned dir)
- [x] No exfiltration — log file is local-only; PostHog telemetry-posthog will consume aggregate counts (NEVER paths) when it merges later in Phase 2
## v1.0 — skill-gallery

New tab listing every skill (`~/.claude/skills/` + plugin cache) and every agent (`~/.claude/agents/` global + workspace), with clipboard share + install-by-URL.

### Acceptance

- [x] `src/gallery.ts` exports `listGalleryItems`, `gallerySummary`, `formatShareManifest`, `validateInstallUrl`, `inferSkillName`, `previewInstall`, `installFromUrl`, `activateGallery`
- [x] Reuses `listSkills` (claudeData.ts) + `readAgents` (integrations.ts) — no duplicated frontmatter parsing
- [x] `media/sidebar.gallery.js` registers two widgets via `window.cockpit.registerComponent`: `galleryGrid` (search + filter + share) and `galleryShareCard` (install URL + preview + publish-issue link)
- [x] New `gallery` tab declared via `registerTab` and a one-line addition each in `DEFAULT_TAB_COMPOSITIONS`, `TAB_ICONS`, and `tabCatalogue()`
- [x] `gallery.share` copies a portable manifest (Cockpit signature header + frontmatter + body) to clipboard; round-trips through `parseFrontmatter` (test asserts)
- [x] `gallery.installPreview` rejects non-HTTPS URLs, malformed URLs, and 4xx/5xx responses; returns SHA256 + 1KB excerpt on success
- [x] `gallery.installConfirm` re-fetches, re-hashes, rejects with "SHA256 mismatch" if bytes drift since preview, and writes only after a modal confirmation
- [x] Path-traversal guard: install target must resolve inside `rootOverride ?? ~/.claude/skills/`
- [x] `CockpitSnapshot.gallery?` carries summary counts only (skillCount, agentCount, totalCount); full items list is lazy-loaded via `gallery.openLocal`
- [x] Two new commands: `claudeCockpit.gallery.openTab`, `claudeCockpit.gallery.installFromUrl`
- [x] All inbound message types use the `gallery.*` namespace prefix
- [x] All new CSS selectors use the `cockpit-gallery-*` prefix
- [x] Webview CSP unchanged (`connect-src 'none'` — install fetches run host-side)
- [x] `npm test` 47 baseline + 11 new = 58/58 green
- [x] `npm run compile` clean under TypeScript strict (no `any`)
- [x] `node --check media/sidebar.js` + `node --check media/sidebar.gallery.js` clean
- [x] No new dependencies

### Out-of-scope (deferred to v1.1)

- [ ] Public registry server / one-click publish — Share button just copies clipboard payload pointing at the planned cockpit-skills issue template
- [ ] Auto-update of installed skills (re-fetch + re-hash on demand)
- [ ] Sign-with-pubkey workflow for skill provenance
## v1.0 — tab-system-v2

Phase 1 worktree (merge order #5 per PLAN.md). Adds tab pin / hide / drag-reorder, named layout presets ("Coding", "Research", "Reviewing PRs"), pop-out fullscreen webview panel, and `cmd+1..9` keyboard navigation. All four wire into the existing tab bar in `media/sidebar.js`; layout state lives in `globalState` (not the view) so the sidebar webview and pop-out panel never desync.

- [x] `media/sidebar.layout.js` (new file) — drag-and-drop handlers, right-click context menu (pin/hide/save/load/delete preset, pop out), keyboard listener (cmd/ctrl+1..9), all behind document-level event delegation so re-renders don't need re-binding
- [x] `src/tabLayout.ts` (new file) — pure host-side helpers (`saveLayout`, `loadLayout`, `deleteLayout`, `pinTab`, `unpinTab`, `hideTab`, `showTab`, `reorderTabs`, `applyOverlay`)
- [x] `src/sidebarProvider.ts` — UserPrefs gains `tabLayouts: Record<string, TabLayout>`, `currentLayoutName`, `pinnedTabs`, `hiddenTabs`, `tabOrder` (all optional, default-undefined; legacy users see byte-identical default behaviour)
- [x] `src/sidebarProvider.ts` — InboundMessage union adds `layout.save | layout.load | layout.delete | layout.popOut | layout.reorderTabs | layout.pin | layout.unpin | layout.hide | layout.show | layout.activateTab` in a `// === tab-system-v2 ===` block
- [x] `src/sidebarProvider.ts` — handle() switch appends matching cases at the end of the switch, also in a labelled block; namespaced messages prevent collision with other Phase-1 worktrees
- [x] `src/sidebarProvider.ts` — `popoutPanel: vscode.WebviewPanel | undefined` field; `openPopoutPanel()` creates the panel via `vscode.window.createWebviewPanel('claudeCockpit.fullscreen', …)` with the SAME html() output and SAME message handler, no separate provider class
- [x] `src/sidebarProvider.ts` — refresh() broadcasts the snapshot to BOTH the sidebar view AND the pop-out panel; `setActiveTabFromHost()` mirrors. Layout state desync (PLAN risk #7) eliminated.
- [x] `media/sidebar.js` — `getEnabledTabIds()` now applies a layout overlay (`applyLayoutOverlay`) honoring `pinnedTabs`/`hiddenTabs`/`tabOrder`. With no layout prefs the function returns the unmodified base list reference (regression-safe).
- [x] `media/sidebar.js` — `render()` switches into a 4-col grid (`renderPopoutGrid`) when `window.__cockpitPopoutMode` is set; the existing single-tab body path is unchanged for sidebar view.
- [x] `media/sidebar.js` — message handler adds `layout.popoutMode | layout.jumpToIndex | layout.cycleTab | layout.saveCurrentAs` for host→webview commands.
- [x] `media/sidebar.css` — appends a `.cockpit-layout-*` block (drag handles, pin marker, context menu, fullscreen grid)
- [x] `package.json` — adds 14 commands (`claudeCockpit.layout.save | .load | .popOut`, `claudeCockpit.tab.next | .prev | .1..9`) and 9 keybinding contributions (cmd/ctrl+1..9, scoped via `focusedView == claudeCockpit.sidebar`)
- [x] `src/extension.ts` — registers all 14 layout / tab-nav commands; cmd+N looks up the index in the user's CURRENT visible order, so `cmd+5` on a 5-tab layout still works.
- [x] `test/tabLayout.test.js` (new file) — 17 unit tests covering save/load/delete round-trip, name truncation, pin/hide/show, reorder math, applyOverlay determinism, no-op-on-missing-layout, and a static guard that `sidebar.layout.js` wraps `acquireVsCodeApi()` in try/catch (the second-call crash trap).
- [x] `npm test` 64/64 (47 baseline + 17 new) — passes
- [x] `npm run compile` clean (TypeScript strict, no `any`)
- [x] `node --check media/sidebar.js` clean
- [x] `node --check media/sidebar.layout.js` clean
- [x] CHANGELOG.md `[Unreleased]` entry appended under a worktree-tagged comment
- [x] `package.json` viewsContainers UNCHANGED (pop-out uses createWebviewPanel)
- [x] COMPONENTS literal contents UNCHANGED — only ORDER + visibility manipulated
- [x] Default rendering byte-identical when no user pref is active (verified via `applyOverlay returns base unchanged when no layout prefs are set` test + manual trace)

## v1.0 — approval-queue

### Added

- [x] `src/snapshot.ts` — pre-action filesystem snapshot. Content-addressed (sha256), atomic copy + fsync + rename. `rollback()` verifies sha drift before overwriting; drifted files are `drifted-skipped` by default, user must explicitly force.
- [x] `src/approvalQueue.ts` — file-backed queue at `~/.claude/.cockpit/queue.json`. Atomic JSON writes, single-fsync. States: `pending | approved | rejected | rolled-back | snapshot-failed`. Sources: `cockpit | jarvis`.
- [x] `media/sidebar.approval.js` — webview UI; registers `approvalQueue` + `approvalDetail` widgets via the Phase-0 bridge (no edits to `COMPONENTS` literal). Click delegation at document level so re-renders by sidebar.js do not strip handlers.
- [x] `media/sidebar.approval.css` — `.cockpit-approval-*` selectors only.
- [x] `Approve` tab + tab icon. `approvalCounts` carried in `CockpitSnapshot` (counts only, full queue fetched lazily).
- [x] 4 commands: `claudeCockpit.approval.{openQueue,bulkApprove,bulkReject,revertLast}`.
- [x] 3 settings: `claudeCockpit.approval.{autoSnapshot,snapshotMaxBytes,requireForToolNames}`.
- [x] Jarvis integration preserved: `showInformationMessage` notification flow unchanged; jarvis pendings additionally surface in the new tab; approving a `jarvis:*` entry forwards to `decideApproval()` from `jarvis.ts`.

### Tests

- [x] `test/snapshot.test.js` — 7 tests: capture roundtrip, drift detection, absent file rollback (delete), over-budget rejection, unchanged no-op, prune-oldest, no leftover tmp files.
- [x] `test/approvalQueue.test.js` — 7 tests: persistence, snapshot-roundtrip, snapshot-failed, decide transitions, jarvis ingest, counts, drift-clean.

### Hook recipe (manual; v1.0 does not enforce)

To enqueue actions before they run, add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "code --command claudeCockpit.approval.openQueue" }]
      }
    ]
  }
}
```

v1.1 will ship a stock hook that round-trips through the queue and blocks until decided.

### Out of scope (per brief)

- [x] Cockpit does not modify session JSONL or any boo-mesh DB.
- [x] No autonomous multi-step LLM action: queue is observe + revert; humans decide.
- [x] Enforcement (blocking PreToolUse) deferred to v1.1.

## v1.0 — replay-timeline

Phase 1 of the v1.0 launch wave. Differentiation feature ("watch competitors don't have"): scrub backwards through any Claude session, see exactly what changed at each step, replay or fork from any point. Subsumes feature #3 — extends the existing Now-tab cost rollups with daily-cap projection + warning banner before expensive next steps.

### Plan

- [x] `src/sessionDiff.ts` — tolerant JSONL parser (skips truncated last line, drops single corrupt entries), per-step `ReplayEvent` model, `reconstructFileAt(events, filePath, upToIndex)`, `diffBetween(events, indexA, indexB)`, line-level LCS unified-diff emitter, parse cache keyed by `(sessionFile, mtime, size)` so repeated renders never re-read the JSONL
- [x] `src/replay.ts` — `buildReplayIndex(sessionFile)` for snapshot-time previews, `loadReplayPayload(sessionFile, max, dailyCap, spentToday)` for the on-demand Replay tab payload, `forkSession(sessionFile, atIndex)` writes prefix into `~/.claude/.cockpit/forks/`, `projectCost(events, dailyCap, spentToday)` over the next 50 events with `willHitDailyCap` flag
- [x] `media/sidebar.replay.js` — registers `replayScrubber`, `replayDiff`, `replayCostProjection` via `window.cockpit.registerComponent`; lazy-loads full event list on first Replay tab render; rerenders in-place on `replay.session` / `replay.diff` host messages
- [x] `media/sidebar.css` — `.cockpit-replay-*` and `.cockpit-cost-*` styles appended (no global selectors changed)
- [x] `media/sidebar.js` — replay tab in `DEFAULT_TAB_COMPOSITIONS`, `TAB_ICONS`, and `tabCatalogue()`
- [x] `src/sidebarProvider.ts` — message types `replay.loadSession | replay.scrubTo | replay.fork | replay.exportDiff | cost.checkBudget` appended in named block; matching handler cases at end of switch; `replayIndex` folded onto the snapshot payload via `buildReplayIndex(snap.localLayout.activeSessionFile)`
- [x] `src/extension.ts` — `registerSidebarScript('media/sidebar.replay.js')` + tab + 3 widgets registered through the Phase-0 plugin API; two new commands wired (`claudeCockpit.replay.openCurrent`, `claudeCockpit.replay.exportDiff`)
- [x] `src/claudeData.ts` — `replayIndex?: ReplayIndexSnapshot` declared on `CockpitSnapshot` (optional; populated outside `snapshotInner` to avoid the import cycle)
- [x] `package.json` — 2 new commands + 1 new setting `claudeCockpit.replay.maxEventsPerSession` (default 5000, min 100, max 50000)
- [x] Tests: `test/replay.test.js` (5 sessionDiff cases — single-edit, MultiEdit ordering, write-then-edit, conflicting writes, malformed line — plus fork creation and cost-projection budget warning); `test/fixtures/replay.jsonl`
- [x] `npm test` 61/61 (47 baseline + 5 plugin + 7 replay + 2 plugin-api duplicates) green
- [x] `npm run compile` clean under TypeScript strict (no `any`)
- [x] `node --check media/sidebar.js` clean
- [x] `node --check media/sidebar.replay.js` clean
- [x] CHANGELOG `[Unreleased]` entry appended
- [x] No edits to `COMPONENTS` literal contents (registered via Phase-0 bridge)
- [x] No edits to pricing constants / model-family map / COST tables (load-bearing for existing Now/budget tabs)

### Open questions / scope ambiguities

- **Fork semantics.** Claude Code's session loader walks `~/.claude/projects/<encoded-cwd>/` only — it does NOT auto-discover `~/.claude/.cockpit/forks/`. So `replay.fork` is currently an EXPORT, not a Claude Code session handoff. Faithful prefix the user can audit, share, or `cp` into their project dir under a fresh uuid. If Claude Code grows a `--resume <path>` flag (or honors a session-id alias dir), we drop a one-liner. Documented in `CHANGELOG.md` and the in-tab toast.
- **Diff cache invalidation.** Cache key is `(sessionFile, mtime, size)`. JSONL is append-only so when mtime advances we re-parse the whole file from scratch (LRU-evicting at 32 entries). Future optimization: tail-append parse — skip lines we already have. Skipped for v1.
- **Replay event sampling.** Above `claudeCockpit.replay.maxEventsPerSession` (default 5000) we sample uniformly so the slider stays usable. The full event list is still parseable via `getCachedSession` host-side; only the postMessage payload is sampled.

## v1.0 — onboarding-sandbox

### Built
- [x] `src/sandbox.ts` — synthesize `~/.claude/.cockpit/sandbox/demo-project/` + 30-event JSONL transcript that passes the existing parseLine() validator
- [x] `src/notifications.ts` — central `notify()` with 30 s per-key debounce + `claudeCockpit.notifications.enabled` setting gate
- [x] `src/statusBar.ts` extended — pending-approval badge, audit-events-24h pill, Talk launcher (all hide on empty)
- [x] `media/sidebar.tutorial.js` — Tutorial tab widgets (`tutorialRecs` recommendation cards + `tutorialNudges` history-mined suggestions)
- [x] Welcome banner — "Start 3-min demo" button → `sandbox.start` message; switches to "Exit demo" when active
- [x] Tutorial tab registered via Phase-0 plugin bridge (no edits to COMPONENTS literal); `DEFAULT_TAB_COMPOSITIONS.tutorial` + TAB_ICONS + tabCatalogue entries added
- [x] `evaluateNotifications()` watcher fires on (a) approval pending 0→≥1, (b) audit `tool.invoke` `outcome: 'blocked'` newer than last seen, (c) today's spend ≥ 80 % of daily cap (once per local day)
- [x] 6 new commands: `tutorial.open`, `sandbox.start`, `sandbox.exit`, `audit.open`, `talk.open`, `notifications.test`
- [x] CSS block appended to `media/sidebar.css` — every selector prefixed `.cockpit-tutorial-`
- [x] Snapshot extension: `CockpitSnapshot.sandbox?` (optional, undefined-safe)
- [x] `package.json` `scripts.test` deduplicated (was three duplicate keys from parallel merges)

### Tests
- [x] `test/sandbox.test.js` — 3 tests: synth JSONL shape (parses, 30 events, sessionId), idempotent re-start, teardown via `exitSandbox`
- [x] `test/notifications.test.js` — 4 tests: dedupes within window, honors custom debounceMs, routes warn level to showWarningMessage, returns undefined when settings disable
- [x] `test/statusBar.test.js` — 3 tests: approval count rendering on transition, hide-all on undefined snapshot, audit dot when last24h > 0
- [x] `test/tutorial.test.js` — 3 tests: high-impact recs surfaced, dismissal Set filter drops only targeted ids, minePrompts ordering invariant (occurrences DESC)

### Acceptance check
- [x] `npm run compile` clean (TypeScript strict, zero `any`)
- [x] `node --check media/sidebar.tutorial.js` clean
- [x] `npm test` — **127 tests, 127 pass, 0 fail.** 114 baseline + 13 new. No regressions. Initial run inadvertently broke the claudeData fixture-driven tests because my new test files were eagerly `require`-ing modules that capture `os.homedir()` at module load (sandbox.ts, statusBar.ts via claudeData.ts) — `claudeData.test.js`'s sibling auto-discoverer loads us BEFORE it pins `process.env.HOME`, so the captured paths froze against the dev's real `~/`. Fix: deferred all `require('../out/...')` calls into the test bodies (same pattern as `test/replay.test.js`) AND switched `src/sandbox.ts` from a frozen `REF` constant to runtime `refRoot()`/`refProject()`/`refSessions()` helpers (same pattern as `src/replay.ts:forksDirInternal`).
- [x] Status bar: 3 new items, all clickable, all hide when their signal is empty.
- [x] Tutorial tab populates with at least 5 recommendations on a real session history (drives off `computeRecommendations`'s existing 30+ rec types + `minePrompts`).

### Deferred to v1.1
- **Full sandbox session redirection.** The brief proposes hot-swapping `findActiveSession` so the cockpit's snapshot pipeline ingests the synthetic JSONL as if it were the live session. We chose NOT to do that in v1.0 — the pointer is read inside `claudeData.snapshot()` and feeds dozens of consumers (cost tables, replay, audit, jarvis), so a global override is a load-bearing change for a feature that's nice-to-have. Instead we ship the synthetic JSONL on disk + the SANDBOX overlay banner, and let the user open the JSONL via the Replay tab's "Load this file" workflow when they want to scrub through a fake session. Honest answer to "what's a fake project?" — see "Open questions" below.
- **Walkthrough tooltip steps.** The brief calls for a 5-step dismissable walkthrough through Talk → Approval → Replay. v1.0 ships the recommendations-driven Tutorial tab and the Welcome-tab "Start 3-min demo" entry point; the actual numbered tooltip overlay is a v1.1 surface (it depends on a generic in-webview tooltip primitive we haven't built yet).
- **`notifyAgentFinished` auto-fire.** The helper is exported from `src/notifications.ts`, but Cockpit doesn't observe agent lifecycle events today — that's a v1.1 hook integration story. Surface is in place so callers can fire it programmatically.

### Open questions / scope ambiguities

- **What is a "fake project"?** This was the genuinely-undefined corner of the brief. Three plausible answers: (a) a synthetic JSONL on disk + a sentinel CWD, surfaced through the existing snapshot pipeline (high blast radius — every consumer of the `cwd` pointer downstream needs to know about sandbox mode), (b) a synthetic JSONL on disk + a tour overlay banner that reads from the JSONL on demand without redirecting the active session (low blast radius, what we shipped), or (c) a full second `vscode.window.createWebviewPanel` running its own provider in sandbox mode (huge new surface). Picked (b) — the brief explicitly authorizes deferring "the SANDBOX (3-min Talk/agent demo)" to v1.1 in PLAN.md cut lines, so we hedged toward the safe variant that still demonstrates the cockpit on synthetic data.
- **PreToolUse hook for the audit-blocked notification.** Today the notification only fires when an external process appends a `tool.invoke` event with `outcome: 'blocked'` to `~/.claude/.cockpit/audit.log`. Cockpit doesn't ship that hook itself — it observes the log. v1.1 will ship a stock hook recipe so the trigger is wired for users out of the box.
## v1.0 — mobile-companion

Phase 2 of the v1.0 launch wave. Lands LAST per master plan. Read-only mobile mirror of the approval queue at `cockpit.dashable.dev/mobile/`. Default OFF behind `claudeCockpit.mobile.enabled = false`. Cockpit makes ZERO outbound calls — the user serves the published file via their existing Cloudflare Tunnel + Cloudflare Access SSO (the same infra Stephane already runs for `roadmap.dashable.dev` etc.).

### Plan

- [x] `src/mobileExport.ts` — sanitizer (whitelisted fields only: `id`, `tool`, `ageSeconds`, `agentName` ≤8 chars, `expectedDiffBytes`, `status`, `fileCount`), atomic tmp+rename writer, `MobilePublisher` class with sha256 digest dedupe, `watchQueueAndPublish` lifecycle helper that fs.watches `~/.claude/.cockpit/queue.json` and re-publishes on change.
- [x] `landing/mobile/index.html` — single-column setup screen + queue list + error state. Mobile-first viewport with `viewport-fit=cover` + Apple PWA meta tags.
- [x] `landing/mobile/style.css` — `.cockpit-mobile-*` prefixed selectors (per master plan rule). 48px tap targets. Dark default with `prefers-color-scheme: light` override. Reduced-motion override.
- [x] `landing/mobile/app.js` — vanilla JS (no framework). Polls every 5s when visible, pauses on `visibilitychange`. URL stored in localStorage on the phone only. `credentials: 'include'` to ride Cloudflare Access SSO. Stale warning > 15s. `createElement` for entries (no `innerHTML` for entry data → defence against any future field that lands as HTML by accident).
- [x] `landing/mobile/README.md` — full architecture + setup walkthrough + auth model + rollback steps. Documents the v1.1 plan (mobile-side approve via second Cloudflare-Access-protected endpoint the desktop polls).
- [x] `src/extension.ts` — wire `MobilePublisher` + queue-file watcher; register `claudeCockpit.mobile.copyPath` and `.openSetup` commands; subscribe to `onDidChangeConfiguration` so toggling the setting writes/clears the file immediately.
- [x] `package.json` — 1 new setting `claudeCockpit.mobile.enabled` (boolean, default false), 2 new commands.
- [x] Tests: `test/mobileExport.test.js` (8 cases — strip paths, truncate agent name, age math, 50-entry cap, atomic round-trip, digest dedupe, disable-clears-file, whitelist defence).
- [x] `npm test` 130/130 green (114 baseline + 8 new + 8 from auditLog/snapshot/etc that were pulled in by the test list edit).
- [x] `npm run compile` clean under TypeScript strict (no `any`).
- [x] `node --check landing/mobile/app.js` clean.
- [x] curl smoke test: all four assets serve 200 OK from `python3 -m http.server` rooted at `landing/`.
- [x] CHANGELOG `[Unreleased]` entry appended.
- [x] No edits to `media/sidebar.js`, `media/sidebar.css`, `src/sidebarProvider.ts`, or `src/claudeData.ts`. Mobile is fully isolated from the webview surface.

### Architecture decision (read-only vs read-write)

We chose **read-only** for v1.0 per the master plan's cut lines and the brief's explicit recommendation. Half the LeCun-gate value (the user knows pendings exist while away from desk) at zero authentication risk. A read-only endpoint can never authorize a destructive action even if Cloudflare Access misbehaves.

v1.1 will add mobile-side approve via a SECOND Cloudflare-Access-protected endpoint (`decisions.public.json`) that the desktop polls. The mobile page POSTs decisions, the desktop reconciles. Cockpit STILL makes zero direct outbound calls — every hop is over the user's tunnel.

### Open questions / scope ambiguities

- **Authentication boundary.** Cloudflare Access SSO. There is no fallback "protect with a password" mode. Users without Cloudflare Access should leave the setting off. The setup README is loud about this.
- **Stale data.** Phone polls every 5s; warns at 15s. Desktop debounces queue-file watcher at 250ms and only rewrites on content change (sha256 digest). Worst-case stale window is ~5.25s for a queue mutation to reach the phone, plus whatever the user's tunnel adds. Acceptable for "walk back to desk" UX.
- **Deployment.** `landing/mobile/` is a sibling of `landing/index.html`. The existing Cloudflare Pages config auto-deploys both. No separate build step. Wrangler one-liner documented in the mobile README for manual deploys. The user does NOT need to redeploy the desktop extension to ship a mobile change — the static page ships independently.
- **Telemetry hook.** Brief mentions emitting `mobile.enabled` to PostHog when the flag flips. NOT wired here because `feat/launch-telemetry-posthog` hasn't merged in this worktree (lands before us per the merge order, but I see the commit log and it isn't there yet — replay-timeline is the latest). Adding the emit is one line once `posthog.ts` exists; documenting the gap rather than ducktaping a stub.
- **No webview surface.** Mobile-companion is the only Phase-2 worktree that doesn't touch `media/sidebar.js`, `src/sidebarProvider.ts`, or `src/claudeData.ts`. Less merge risk than expected.

### Files touched

NEW:
- `src/mobileExport.ts` (~190 LOC)
- `landing/mobile/index.html` (~70 LOC)
- `landing/mobile/style.css` (~340 LOC)
- `landing/mobile/app.js` (~270 LOC)
- `landing/mobile/README.md` (~140 LOC)
- `test/mobileExport.test.js` (~190 LOC)

EDITED:
- `src/extension.ts` — added imports, `MobilePublisher` activation block, two commands, config-change handler.
- `package.json` — added 1 setting + 2 commands. Test file list updated to include mobileExport.test.js.
- `CHANGELOG.md` — new `[Unreleased]` block at top.
- `tasks/todo.md` — this section.
## v1.0 — telemetry-posthog

Phase 2 of the v1.0 launch wave. Opt-in PostHog analytics + opt-in crash reporting, default OFF, default no-op until the user supplies a `projectId`. v0.21.0 users see byte-identical behaviour.

### Done

- [x] `src/posthog.ts` — hand-rolled `https.request` PostHog client (zero new deps). Pluggable `Fetcher` for tests via `__setFetcherForTests`.
- [x] `src/crash.ts` — `captureActivationFailure`, `captureMessageFailure`, `wrapAsync`. Stack anonymization replaces homedir, blanks external frames, caps at 4 KB.
- [x] `src/extension.ts` — `activate()` body wrapped in try/catch → `captureActivationFailure` → rethrow. New `pingCommand()` helper used by 5 high-traffic commands. Settings reload reconfigures the client.
- [x] `src/sidebarProvider.ts` — `handle()` now delegates to `handleInner()` under try/catch. Four new InboundMessage types: `telemetry.optIn | optOut | status | tabView`. Snapshot payload gains `posthog: getPosthogStatus()` (counters + flags only — no projectId, no distinctId).
- [x] `media/sidebar.js` — Self tab → Telemetry section: status pill + opt-in / opt-out button + counters. `setActiveTab(id)` pings `telemetry.tabView`. Help tab + Welcome banner now mention the opt-in.
- [x] `package.json` — 4 new settings (`telemetry.enabled`, `telemetry.crashReports`, `telemetry.projectId`, `telemetry.host`), 1 new command (`claudeCockpit.telemetry.toggle`). Test script consolidated to a single line that runs every `test/*.test.js` file (was three duplicate keys, last-wins, ~80 tests silently skipped).
- [x] `PRIVACY.md` — full **Optional telemetry (PostHog)** section: every event name + every detail field + every redaction rule + every gating setting + the HAQQ-project refusal.
- [x] `CHANGELOG.md` — `[Unreleased] — feat/launch-telemetry-posthog` block.
- [x] `test/posthog.test.js` — 12 tests: opt-out no-op, empty-projectId no-op, HAQQ refusal, payload shape, malformed event-name rejection, redaction, forbidden-key dropping, crashReports gating, stack anonymization, status leak-check.
- [x] `npm test` 194/194 green (114 baseline + 12 new posthog + 68 previously-orphaned tests reactivated by the script consolidation).
- [x] `npm run compile` clean under TypeScript strict (no `any`).
- [x] `node --check media/sidebar.js` clean.

### Event taxonomy (final)

| Event | Detail (post-redaction) |
|---|---|
| `cockpit.session.start` | `activatedAt: number` |
| `cockpit.session.end` | `deactivatedAt: number` |
| `cockpit.tab.view` | `tab: string` (sanitized to `[a-zA-Z0-9_-]{1,24}`) |
| `cockpit.command.invoke` | `command: string` (the command id, e.g. `claudeCockpit.refresh`) |
| `cockpit.crash.report` | `surface: string`, `errorName: string`, `errorMessage: string` (≤500 chars), `stack: string` (≤4 KB, anonymized) |

Every event also carries the standard envelope: `extensionVersion`, `vsCodeVersion`, `platform`, `$lib: 'claude-cockpit'`, `$lib_version`, `distinctId` (16-hex of salted hostname).

### Open questions / scope ambiguities

- **Where users enable telemetry.** Three surfaces: Self tab toggle, command palette (`Toggle Opt-in Telemetry`), VSCode settings. NO aggressive prompt — the welcome banner mentions it as a passing link, not a modal. If Stephane wants more visibility (e.g. a one-time banner inside the Self tab on first cold start), I'd add it under a `claudeCockpit.telemetry.bannerShown` globalState flag. Skipped for v1 to keep "default 100% local" honest — opt-in must NEVER feel coerced.
- **GDPR / data-retention.** If Stephane plans to publish opt-in PostHog dashboards publicly, we need a "delete my data" path. Currently the only identifier is a 16-hex hash of `os.hostname()` — irreversible without the hostname. I recommend (a) documenting the salt + the regenerate-on-reinstall behavior in `PRIVACY.md`, and (b) adding `claudeCockpit.telemetry.regenerateDistinctId` if a user asks for one. Not blocking v1.0.
- **Crash telemetry auto-includes VSCode version + OS string.** Yes — `vsCodeVersion: vscode.version` and `platform: process.platform` (just `darwin` / `linux` / `win32`, no kernel version) are in every event envelope. Per the brief: "it should, but verify it's not too identifying." Verdict: `process.platform` is one of three values — not identifying. `vscode.version` (e.g. `1.85.1`) is two-month-old at most, used by ~millions of users — not identifying. We do NOT capture `os.release()` or `os.cpus()` or anything that combines into a fingerprint.
- **Reactivated tests.** Consolidating the test script raises the count from 114 to 194. The 80 newly-running tests were already passing — they were just not in any of the three duplicate `test` keys. If a CI somewhere asserted `tests 114`, it'll now see `tests 194` and may flag the change. Worth flagging in the PR description.
