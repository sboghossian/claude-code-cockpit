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
