# Changelog

All notable changes to Claude Cockpit are tracked here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.20.1] — 2026-05-06

### Changed
- **Repo renamed.** GitHub repo is now [`sboghossian/claude-code-cockpit`](https://github.com/sboghossian/claude-code-cockpit) so it matches the marketplace listing (`dashable.claude-code-cockpit`). GitHub auto-redirects every old `sboghossian/claude-cockpit` URL.
- All source-baked URLs (`updateCheck.ts`, `sidebarProvider.ts`, sidebar.js release-link buttons, README, PRIVACY, landing page, `package.json` repository/badges/qna/bugs/configuration descriptions) now point at the new repo path so the next snapshot doesn't depend on redirect-following.
- Title in README and the marketplace listing renamed to **Claude Code Cockpit** to match the unique marketplace identity (`yurman.claude-cockpit` already owns "Claude Cockpit"; we differentiate to keep listings distinct).

## [0.20.0] — 2026-05-06

### Added
- **Welcome tab + first-run flow.** Brand new users land on a `Welcome` tab with a system-check checklist (Claude data on disk · active session · usage rollups · budget caps · theme) and one-click "Next steps" buttons (Customize widgets · Open settings · Go to Now · Read the docs). Auto-hides after dismissal; restorable via Customize → Visible tabs, or the "Reset welcome" button on the tab itself.
- New extension messages: `markFirstRunComplete`, `resetFirstRun`, `openSettings` (opens VSCode Settings filtered to `@ext:dashable.claude-cockpit`).
- `welcomeBanner` widget registered in the component registry — droppable on any tab.
- `LICENSE` file (MIT, matches `package.json`) so GitHub correctly reports the license.

### Changed
- README install path rewritten as a 90-second quick start (download · install · open Cockpit · run `claude`). Optional-setup section pulls every opt-in toggle into one place.

## [0.19.0] — 2026-05-06

### Added
- **Usage rollups widget** — native multi-period token + cost aggregation across every JSONL under `~/.claude/projects/`, broken into Session / Today / This week / This month / This year / All-time. Progress bars when caps are set; "no cap" hint chip otherwise. Drops into the Now tab under Budget caps and is pickable on any tab.
- **Per-tab widget customization** — every tab is now a composition of widgets the user chooses, not just the Custom tab. New `tabComponents` user-pref (per-tab widget lists). Customize panel grew tab-selector chips + "Reset to default" / "Clear all" buttons per tab. Bespoke tabs (History, Settings, Talk, Library, Browse, etc.) are exposed as composite widgets so any of them can be dropped on any tab.
- 3 new VSCode settings: `claudeCockpit.budget.weeklyCapUsd`, `monthlyCapUsd`, `yearlyCapUsd`.
- mtime+size cache at `~/.claude/cockpit-usage-cache.json` so multi-period rollups reload in ~10ms after the first scan.

### Fixed
- Custom tab now respects "0 widgets selected" — previously emptying the list silently fell back to defaults so you could never have an empty Custom tab.

### Changed
- The big tab-render switch in `sidebar.js` is gone — every tab body is now produced by `tabBodyComposed(snap, tabId)`. No-cwd / active-session paths converged into one renderer; per-component `requiresCwd` plus the auto-blocked-list note replace the old per-tab empty-state copy.
- Talk tab lifecycle (`Talk.init/teardown`) follows the rendered composition, not the active tab id, so you can drop the Talk widget anywhere.

## [0.18.0] — 2026-05-06

### Added

- **Talk tab — Jarvis-grade visualization rewrite.** Multi-layer renderer: drifting parallax dust, two segmented HUD rings, 520-particle Fibonacci sphere, particle streams that emit outward when speaking, soft core glow, scanline highlight. Four modes with distinct color palettes — IDLE (muted blue), LISTENING (cyan), THINKING (violet), SPEAKING (Jarvis amber/gold). Mode indicator overlaid on canvas with monospace label.
- **Speak preview.** New "▶ Speak preview" button drives the speaking-mode viz from a synthetic speech envelope and routes the textarea through `speechSynthesis` so you both *see* the AI-speaking effect and *hear* the text. Works even when the mic API is blocked.
- **Mic-blocked banner.** When VSCode webviews block `getUserMedia` (the default), the Talk tab now shows a clear amber banner telling the user to use Wispr Flow / system dictation, instead of silently failing.

### Fixed

- **RSS folder discovery.** `readRssFromObsidian()` was looking at `rss/`, `Inbox/RSS/`, `50-Inbox/rss/` only. Added the actual path Stephane's vault uses (`30-Knowledge/rss-feeds/`) plus several common variants, and a depth-3 fallback scan that matches any folder named `rss`, `rss-feed`, or `rss-feeds`. Scanner perf hardened for 10k+ file folders: name-sorted DESC slice top-200 then stat, instead of stat-every-file.
- **Prompts auto-mine.** First time you land on the Prompts sub-view of the Library tab with an empty library, mining now kicks off automatically (deferred 100ms so the empty-state UI paints first). Eliminates the "always 0, no idea what to do" footgun.

### Notes

- Local security scan across `~/Documents/Code/` (run once to seed Security tab improvements) found no real leaks. Three repos track non-`.example` `.env` files (`agip-spark`, `haqq-ai`, `haqq-case-theory-sim`) but they contain only `VITE_*` Supabase publishable keys, which are public by design. No private SSH keys, no API tokens, no credentialed URLs.

## [0.17.0] — 2026-05-06

### Added

- **Prompt mining + categories.** The Prompts library was always 0 because nothing populated it. New "Mine recent prompts" button walks `~/.claude/projects/*.jsonl` to surface user prompts that recur across sessions or are substantial one-shots, dedupes by 80-char fingerprint, and lets you bulk-save selected ones. Each prompt now carries a category (legal / build / review / plan / research / infra / other), auto-classified on save by keyword heuristics with per-prompt manual override. Filter chips on the Library tab narrow the list by category.
- **Library tab.** Memory and Prompts merged into one tab with sub-views — both surfaced "reusable text Claude pulls from" and the split was making the user track them separately. Default sub-view is Prompts.
- **Settings tab.** Manage and Config merged into one tab with 8 sub-views: Budget / RTK / Tunnels / Office / Manage / Usage / Disk / Hooks. Both prior tabs were "all the settings" — the split was arbitrary.
- **Timeline tab.** Roadmap (planned) and Changelog (shipped) merged into one tab with two sub-views.
- **History tab.** Search (grep across session JSONL) and Chat (claude.ai exports) merged. Default sub-view is Session search.
- **Browse tab.** Projects (recent project list) and Files (`~/.claude/` browser) merged.
- **Discover expansion.** Discover added Hacker News (Algolia API with day/week/month windowing, hnrss fallback), Product Hunt (Atom feed), and Custom RSS feeds. Custom feeds let the user wire X/LinkedIn via Nitter or RSS-Bridge. All sources stay opt-in — Discover must be enabled before any HTTP call goes out.
- **Security tab.** Local-only audit for tracked `.env` files, hardcoded API keys/tokens in source (14 patterns: AWS, GitHub PAT/OAuth, Stripe, Anthropic, OpenAI, Slack, Google, Cloudflare, Bearer, private keys), MCP servers with inline secrets, and git remote exposure. Findings always show redacted excerpts (first 6 + last 4 chars), never full secrets. "/cso" button launches the gstack `/cso` skill in a terminal for deeper audits (deps CVEs, repo settings, OWASP Top 10).
- **Talk tab.** Voice + text → Claude. 420-particle Fibonacci-distributed sphere on canvas, audio-reactive (radius / hue / rotation respond to mic level). Web Audio API for level capture, Web Speech API for transcription (when available in your VSCode build). Send button pipes the message to a fresh Claude session in a terminal — three modes: new session, --continue, --print background. Optional Wispr Flow handoff via `claudeCockpit.wisprShortcut` config (macOS osascript). Voice never leaves your machine.

### Changed

- Tab count: 23 → 18 (with the two new tabs added). Persisted `enabledTabs` prefs are migrated transparently — old IDs (`memory`, `prompts`, `manage`, `config`, `roadmap`, `changelog`, `chat`, `search`, `projects`, `files`) all route to their merged equivalents. Search index entries now carry `librarySubview` / `settingsSubview` so search hits jump to the right sub-view.
- Webview CSP now allows `media-src 'self' blob:` to enable mic access for the Talk tab. `connect-src 'none'` unchanged — no telemetry path opens.

## [0.16.0] — 2026-05-06

### Added

- **Office floor tab.** Live grid of every Claude Code project active in the last hour, with one card per project showing the agent's current activity: subagent type (general-purpose, code-reviewer, Plan, etc.), last tool call with args + result (ok/error/pending), current file under edit, model family, and live-pulse status dot. Click any card to jump to that session. Built on a 64KB tail-read of each project's session JSONL — cheap enough to refresh every snapshot. Sits next to Watchtower and shows the "what's happening right now" view that Watchtower's row layout couldn't.
- New `OfficeFloorTile` interface and `computeOfficeFloor()` extractor in `claudeData.ts`. Tail-reads only, walks blocks forward, reconciles tool_use ↔ tool_result by id.
- New `officeFloor` component registered in the section catalogue under category `Cross`. Available in Custom tab.

### Changed

- Cross-element click handler for `[data-watch-session]` no longer requires a `<button>` wrapper — any element with the attribute (e.g. floor cards) is now clickable.

## [0.15.0] — 2026-05-06

### Added

- **PILOT card "now flying" strip.** Session-aware row inside the pilot card showing live/idle status with last-activity age, plus chips for `cwd` (basename), `branch` (parsed from `.git/HEAD`), `model` family, context fill `%`, and pending todo count. Updates on every snapshot tick.
- **Live "always-live" subdomain dots.** The decorative dots in the PILOT card are now real health indicators: green + pulse for up, red for down, dimmed gray for unknown. Background HTTPS HEAD probes refresh every 60s with a 3s timeout per host. Hover any dot to see HTTP status code and last check time.

### Changed

- PRIVACY.md note: when the PILOT card has at least one "always-live" subdomain entry, Cockpit issues HTTPS HEAD probes against those hosts every 60s. No bodies, no auth, no telemetry.

## [0.14.0] — 2026-05-06

### Added

- **Roadmap tab.** Mirrors `roadmap.dashable.dev` directly inside Cockpit. Lists every project across HAQQ, AI Frameworks, AI Visualization, AI Simulation, AI Research, AI Desktop, Developer Tools, Fintech, Knowledge Management, Meta, and Other. Filter by category, filter by stage (concept / active / shipped / etc.), live search across name + description + tech stack. Each project card shows emoji, stage badge, description, top tech, next steps, and Open / GitHub buttons. Session counts roll in from the same scanner the live site uses.
- **Local-first roadmap fetch.** Tries `http://localhost:3000/api/projects` first (when the Roadmap server is running on this machine), falls back to `https://roadmap.dashable.dev/api/projects`, then falls back to a disk cache at `~/.claude/.cache/cockpit-roadmap.json`. Auto-fetches on first view and refreshes if the cache is older than 10 minutes.
- New `Roadmap` widget available in the Custom tab.

### Changed

- PRIVACY.md note: when the Roadmap tab is opened, Cockpit fetches `roadmap.dashable.dev` (or `localhost:3000`) for project metadata. No telemetry, no auth.

## [0.13.0] — 2026-05-06

### Added

- **Changelog tab.** Renders this file inside the cockpit so you see what shipped without leaving VSCode. Each version shows date and notes, with a deep-link to the matching GitHub release.
- **Self-update check.** Cockpit periodically polls `api.github.com/repos/sboghossian/claude-code-cockpit/releases/latest` (when `claudeCockpit.updateCheck.enabled = true`, default on). When a newer version is detected, an **Update available** pill appears in the header with a one-click link to the release page.
- New setting `claudeCockpit.updateCheck.enabled` (default `true`). Disable to make the extension fully local with zero update-check traffic.

### Changed

- PRIVACY.md updated to disclose the opt-out update-check network call (`api.github.com`).
- README documents the Changelog tab and the update-check setting.

## [0.12.0] — 2026-05-06

### Added

- **Routines tab actions**: per-routine **▶ Run now** opens a terminal that pipes the routine's `SKILL.md` into a fresh `claude` session for on-demand execution. Header **+ New routine** prompts for name + description and writes a starter `~/.claude/scheduled-tasks/<slug>/SKILL.md`.
- **Global search** in the header. Searches across tabs, widgets, memory, skills, prompts, agents, routines, projects, plans, tunnels, and settings. Type-filter chips with per-type counts; click any hit to jump to the right tab.
- **Discover tab** (opt-in, `claudeCockpit.discover.enabled`): top trending GitHub repos (filterable today / week / month, fetches `api.github.com` only on Refresh) + recent RSS notes pulled from your Obsidian vault `rss/` folder (no network).
- **`requiresCwd` indicator** on tabs that are most useful with an active Claude Code session (orange dot + tooltip + dim when no cwd).
- **Tab filter chips** in the Customize panel: "All tabs / Needs session / Standalone".

### Changed

- PRIVACY.md updated to disclose:
  - The opt-in `api.github.com` fetch from the Discover tab.
  - User-initiated writes scoped to `~/.claude/scheduled-tasks/<slug>/SKILL.md` from the **+ New routine** action.

## [0.11.0] — 2026-05-06

### Added

- **Header strip** above the tab bar — brand mark `◐ Claude Cockpit`, tagline, **Customize** gear (⚙), **Help** (?). Always visible.
- **Custom tab** as the new default first tab. User picks which widgets appear from a 40-widget registry. Defaults: greeting, inbox, stats grid, quick actions, tokens, cost, routines.
- **Customize panel** (gear in header): toggle which tabs are visible (Custom / Now / Help pinned), pick widgets for the Custom tab grouped by category, switch theme.
- **Theme**: `claudeCockpit.theme = auto | dark | light`. `auto` inherits VSCode's theme via CSS variables (default and lightest-touch). `dark` / `light` ship explicit palettes that override hardcoded semantic colors. Runtime override available in the Customize panel.
- Per-machine preference persistence in VSCode `globalState` (`claudeCockpit.userPrefs`).

## [0.10.0] — 2026-05-06

### Added

- **Routines tab**. Reads `~/.claude/scheduled-tasks/<name>/SKILL.md` to surface scheduled Claude Code runs (name, description, cadence hint inferred from description, last edit, size). Click to open `SKILL.md` or reveal the directory in the OS file browser. Live filter input.
- Cloud routines section gated behind `claudeCockpit.cloudRoutines.enabled` (default off). Surfaces a deep-link to manage scheduled remote agents on `claude.ai/settings/automations` — no API state read since Anthropic doesn't expose a routines API to extensions yet.

## [0.9.0] — 2025-12-15

### Added

- **Recommendations tab**. Surfaces actionable suggestions (memory cleanup, skill usage, prompt library, budget caps) inferred from your session state.

## [0.8.0] — 2025-12-13

### Added

- **Personal OS HUD.** Mac tab — disk, memory pressure, battery, CPU load, Wi-Fi throughput, external drives, Bluetooth peripheral battery rings, application time today (per-app focus tracker with hourly bar chart, sampled while VSCode is running).
- **Help tab.** Plain-language explanations of every tab, every metric, where each data point comes from, and the privacy model.
- Greeting strip + at-a-glance stats grid (streak, active days, peak hour, favorite model, week cost).

## [0.7.0] — 2025-12-12

### Added

- **Plans.** Reads `tasks/todo.md` (and any `tasks/*.md` plan files) and renders checkbox progress per project.
- **Chat surface.** Surfaces Claude.ai conversations from a `claude-data-export/` folder, unifying Chat + Code in one view.
- **Activity heatmap.** 24-hour × 7-day grid showing when you actually code with Claude.
- **Usage dashboard launcher.** Detects whether [phuryn/claude-usage](https://github.com/phuryn/claude-usage) is installed/running and surfaces a one-click launch.

## [0.6.0] — 2025-12-11

### Added

- **Watchtower.** Every Claude Code session touched in the last hour, color-coded green (live) → grey (stale). Click a session to inspect its JSONL.
- **Obsidian integration.** Auto-detects vaults from `~/Library/Application Support/obsidian/obsidian.json`, lists recent notes, save-session-as-markdown action.
- **Recent projects browser** + `~/.claude/` filesystem panel.
- **Cost-by-tool table.** Approximate USD per tool call across the active session.
- **Sub-agent listing** + sub-agent token totals.
- **Pinned memory** with stale-entry flagging.

## [0.5.0]

Skipped — no shipped artifact under this version number.

## [0.4.0] — 2025-12-09

### Added

- **Tabbed UI.** Replaces the single-scroll layout with proper tabs (Now / Watchtower / Memory / Skills / Projects / Files / Config / Help) plus per-tab body composition.
- Five additional widgets: tool histogram, files-touched list, today's totals, MCP server panel, hooks inspector.

## [0.3.0] — 2025-12-08

### Added

- **PILOT card** that auto-detects `<user>_claude.md`, extracts numbered principles, role from frontmatter, "one-liner" quote, plus always-live subdomain dots.
- **Cost tracking.** Token → USD per model family (Opus / Sonnet / Haiku); rates centralized in `claudeData.ts:PRICING`.
- **Live indicator.** Green pulsing dot when session mtime < 10s.
- **Sub-agents view.** Scans `<sessionFile-dir>/<sessionId>/subagents/*.jsonl`.
- **Skill palette.** Reads `~/.claude/skills/*/SKILL.md` + plugin cache; click copies `/<name>` to clipboard.
- **Token sparkline.** Last 60 min bucketed by minute, inline SVG.
- **Memory search.** Filter the memory list by title/hook + a server-side `searchMemory()` for deeper queries.

## [0.2.0]

Skipped — no shipped artifact under this version number.

## [0.1.0] — 2025-12-06

### Added

- **Projects browser.** Cross-project session list (also fixes empty-state when no folder is open).
- **MCP server panel.** Reads `~/.claude/settings.json` (no `~/.claude.json` to avoid credential exposure).
- **Hooks inspector.** Event types + count + command bin names.
- **Sessions are first-class, not workspace folders.** v0.2.0-style refactor for multi-session awareness.

## [0.0.1] — 2025-12-05

### Added

- **Phase 1 — read-only sidebar.** Read active session JSONL from `~/.claude/projects/<encoded-cwd>/*.jsonl`, compute token burn from `usage` blocks, extract files touched from Edit/Write/MultiEdit blocks, parse `MEMORY.md` index. Sidebar webview in the Activity Bar; status bar items for cwd basename, total tokens, files touched. Live updates via `fs.watch`. First public release.
