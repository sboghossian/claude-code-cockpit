# Claude Cockpit

A VSCode extension that surfaces Claude Code's hidden state directly in the editor — token burn, files touched, persistent memory — without leaving your workspace.

> Sibling to [`claude-overlay`](https://github.com/sboghossian/claude-overlay) (macOS menubar, cross-surface). Cockpit is VSCode-native and focused on the Code surface.

Landing page: [claude-cockpit.pages.dev](https://claude-cockpit.pages.dev)

## What it does

Read-only. Watches `~/.claude/projects/<your-cwd>/` and renders:

- **Status bar**: workspace name, total tokens this session, files touched
- **Sidebar webview** (Activity Bar) — tabbed:
  - **Now**: PILOT card, notifications strip, plans (auto-parsed from `tasks/todo.md` / `tasks/forkcast.md`), tokens + sparkline, 7-day activity heatmap, cost (with $/hr + cache hit rate), context fill, cost-by-tool breakdown, budget caps, session metadata, CLAUDE.md stack, tool histogram, sub-agents, tool decisions (✓/✗/·), activity feed, files touched, today summary
  - **Watchtower**: every Claude session touched in the last hour, color-coded (live/recent/idle/stale) — plus a dedicated idle-sentinel view for stalled sessions
  - **Chat**: cross-surface bridge — auto-detects your `claude-data-export` folder and surfaces conversations + memory from claude.ai
  - **Search**: global grep across every session JSONL on this machine
  - **Obsidian**: auto-detects your vaults from `~/Library/Application Support/obsidian/obsidian.json`, lists recent notes, "Save active session →" writes a markdown digest, "Open vault" hands off to Obsidian via `obsidian://`
  - **Memory**: pinnable index (📌), per-entry stale flag, instant filter
  - **Prompts**: personal prompt library backed by VSCode globalState — copy to clipboard with one click
  - **Skills / Projects / Files / Config**: skill palette with usage counts, recent projects, full `~/.claude/` layout, MCP/hooks/plugins, disk usage, office visualizer launcher, claude-usage dashboard launcher, budget config

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
