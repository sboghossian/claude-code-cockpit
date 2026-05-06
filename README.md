# Claude Cockpit

A VSCode extension that surfaces Claude Code's hidden state directly in the editor — token burn, files touched, persistent memory — without leaving your workspace.

> Sibling to [`claude-overlay`](https://github.com/sboghossian/claude-overlay) (macOS menubar, cross-surface). Cockpit is VSCode-native and focused on the Code surface.

Landing page: [claude-cockpit.pages.dev](https://claude-cockpit.pages.dev)

## What it does

Read-only. Watches `~/.claude/projects/<your-cwd>/` and renders:

- **Status bar**: workspace name, total tokens this session, files touched
- **Sidebar webview** (Activity Bar) — tabbed:
  - **Now**: greeting (time-aware), notifications, **Inbox** (aggregated needs-you items: idle sessions, errored tools, stale memories, pending plan items), at-a-glance stats grid (streak, active days, peak hour, favorite model, week cost), PILOT card, plans, tokens + sparkline, activity heatmap, cost (with $/hr + cache hit rate), context fill, cost-by-tool, budget caps, session metadata, CLAUDE.md stack, tool histogram, sub-agents, tool decisions, activity feed, files touched, today
  - **Mac**: macOS system health — disk, memory pressure, battery, CPU load, Wi-Fi throughput, external drives, **Bluetooth peripheral battery rings**, plus **Application time today** (per-app focus tracker with hourly bar chart, sampled while VSCode is running)
  - **Watchtower**: every Claude session touched in the last hour, color-coded
  - **Agents**: your specialist council — agent definitions from `~/.claude/agents/` (global) and `.claude/agents/` (workspace) with description, model, tools
  - **Chat**: conversations + memory from claude.ai (parsed from `claude-data-export/`)
  - **Search**: global grep across every session JSONL
  - **Obsidian**: auto-detects vaults, lists recent notes, save-session-as-markdown
  - **Memory / Prompts / Skills / Projects / Files**: pinnable memory, prompt library, skill palette, project browser, `~/.claude/` filesystem
  - **Config**: budget caps, RTK token-killer stats, Cloudflare tunnels, MCP servers, hooks, plugins, disk usage, dashboard launchers
  - **? Help**: plain-language explanations of every tab, every metric, where each data point comes from, and the privacy model

Updates live as Claude works (filesystem watcher + 400ms debounce).

## Privacy

100% local. No network calls, no telemetry, no analytics. Read-only against `~/.claude/projects/<encoded-cwd>/`. Zero runtime dependencies. Webview runs under a strict CSP that blocks `connect-src` and `form-action`. See [`PRIVACY.md`](./PRIVACY.md).

## Why

Claude Code stores rich session state on disk. The CLI doesn't surface most of it. Cockpit reads the JSONL session log + memory directory and gives you a passive HUD instead of `tail -f`-ing files yourself.

## Install (dev)

```bash
git clone https://github.com/sboghossian/claude-cockpit.git
cd claude-cockpit
npm install
npm run compile
```

Then open the folder in VSCode and press `F5` to launch an Extension Development Host.

## Architecture

- `src/extension.ts` — activation, command registration
- `src/claudeData.ts` — reads `~/.claude/projects/<encoded-cwd>/*.jsonl`, parses tokens + tool calls
- `src/sidebarProvider.ts` — webview view provider, fs watcher
- `src/statusBar.ts` — three status bar items
- `src/logger.ts` — OutputChannel-backed logger (no `console.log`)
- `media/` — webview HTML/CSS/JS (vanilla, no build step)

No runtime dependencies. Just `@types/vscode` and `typescript`.

## Commands

- `Claude Cockpit: Refresh`
- `Claude Cockpit: Open MEMORY.md`
- `Claude Cockpit: Open Active Session JSONL`
- `Claude Cockpit: Save Session to Obsidian`
- `Claude Cockpit: Open Obsidian Vault`
- `Claude Cockpit: Search All Sessions`
- `Claude Cockpit: Watchtower (cross-project sessions)`
- `Claude Cockpit: Set Daily Budget Cap`

## Settings

- `claudeCockpit.budget.enabled` — turn budget alerts on/off
- `claudeCockpit.budget.dailyCapUsd` — daily spend cap, 0 disables
- `claudeCockpit.budget.sessionCapUsd` — per-session cap, 0 disables

## Roadmap

See [`tasks/todo.md`](./tasks/todo.md). Highlights:

- Hook log viewer (event stream)
- Mode/model swap with human gate (per LeCun world-model rule)
- Embedded [`claude-office`](https://github.com/paulrobello/claude-office) pixel-art visualizer iframe
- Diff drawer for files touched (link to git history)

## License

MIT
