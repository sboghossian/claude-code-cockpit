# Changelog

All notable changes to Claude Cockpit are tracked here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
- **Self-update check.** Cockpit periodically polls `api.github.com/repos/sboghossian/claude-cockpit/releases/latest` (when `claudeCockpit.updateCheck.enabled = true`, default on). When a newer version is detected, an **Update available** pill appears in the header with a one-click link to the release page.
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

## Earlier versions

Prior versions covered the foundational tabs: Now, Mac, Watchtower, Agents, Chat, Search, Obsidian, Memory, Prompts, Skills, Projects, Files, Config, and Help. See git history for details.
