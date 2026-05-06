# Claude Cockpit

> The personal-OS HUD for Claude Code. VSCode-native. 100% local.

![Claude Cockpit — Now and Mac tabs](media/screenshots/hero.png)

Surfaces the state Claude Code already writes to disk. Plus your Mac. Plus your Obsidian. Plus claude.ai. **Customizable**: a header strip with logo + actions sits above a tab bar you control — pick which tabs are visible, build a **Custom** tab from any of 30+ widgets, and switch between auto / dark / light theme.

**Available tabs**: Custom · Now · Mac · Watchtower · Agents · Routines · Discover · Chat · Search · Obsidian · Memory · Prompts · Skills · Projects · Files · Config · Help. The Custom, Now, and Help tabs are pinned; the rest can be hidden via the Customize panel.

**Global search** (in the header): type any string to search across tabs, widgets, memory, skills, prompts, agents, routines, projects, plans, tunnels, and settings — with type-filter chips to narrow results. Click any hit to jump to the right tab.

Landing page: [claude-cockpit.pages.dev](https://claude-cockpit.pages.dev) · Sibling: [`claude-overlay`](https://github.com/sboghossian/claude-overlay) (macOS menubar, cross-surface).

## What it does

Read-only. Watches `~/.claude/projects/<your-cwd>/` and renders:

- **Header strip**: brand mark + tagline + Customize gear (⚙) + Help (?). Always visible; the gear opens an in-panel editor for tabs, widgets, and theme.
- **Status bar**: workspace name, total tokens this session, files touched
- **Sidebar webview** (Activity Bar) — tabbed:
  - **Custom** (default): you pick which widgets appear here. Composable from any of 30+ registered components — greeting, inbox, tokens, cost, heatmap, routines, watchtower, sub-agents, etc. Defaults: greeting, inbox, stats grid, quick actions, tokens, cost, routines.
  - **Now**: greeting (time-aware), notifications, **Inbox** (aggregated needs-you items: idle sessions, errored tools, stale memories, pending plan items), at-a-glance stats grid (streak, active days, peak hour, favorite model, week cost), PILOT card, plans, tokens + sparkline, activity heatmap, cost (with $/hr + cache hit rate), context fill, cost-by-tool, budget caps, session metadata, CLAUDE.md stack, tool histogram, sub-agents, tool decisions, activity feed, files touched, today
  - **Mac**: macOS system health — disk, memory pressure, battery, CPU load, Wi-Fi throughput, external drives, **Bluetooth peripheral battery rings**, plus **Application time today** (per-app focus tracker with hourly bar chart, sampled while VSCode is running)
  - **Watchtower**: every Claude session touched in the last hour, color-coded
  - **Agents**: your specialist council — agent definitions from `~/.claude/agents/` (global) and `.claude/agents/` (workspace) with description, model, tools
  - **Routines**: scheduled Claude Code runs. Local section reads `~/.claude/scheduled-tasks/<name>/SKILL.md` (name, description, cadence hint inferred from description, last edit, size, click to open or reveal). Each routine gets a **▶ Run now** button that opens a terminal piping the SKILL.md into a fresh `claude` session for on-demand execution. The header **+ New routine** button prompts for a name + description and writes a starter `SKILL.md`. Cloud section is opt-in (`claudeCockpit.cloudRoutines.enabled`) and surfaces a deep-link to manage scheduled remote agents on claude.ai — Cockpit doesn't read cloud-routine state because Anthropic doesn't expose a routines API to extensions yet.
  - **Discover** (opt-in): top trending GitHub projects (filterable by today / this week / this month) and recent RSS notes pulled from your Obsidian vault's `rss/` folder. GitHub fetches `api.github.com` only when you click Refresh; RSS is purely local. Disabled by default — toggle `claudeCockpit.discover.enabled` or click "Enable Discover (opt-in)" inside the tab.
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
- `claudeCockpit.cloudRoutines.enabled` — show a deep-link to manage cloud routines on claude.ai (off by default; doesn't make network calls)
- `claudeCockpit.theme` — initial theme: `auto` (default; follows VSCode), `dark`, or `light`. Can also be changed at runtime in the Customize panel.
- `claudeCockpit.discover.enabled` — enable the Discover tab (off by default; allows opt-in `api.github.com` fetches when you click Refresh).

User preferences (which widgets appear in the Custom tab, which tabs are visible, runtime theme override) are stored per-machine in VSCode `globalState` (key `claudeCockpit.userPrefs`). They never leave the machine.

## Roadmap

See [`tasks/todo.md`](./tasks/todo.md). Highlights:

- Hook log viewer (event stream)
- Mode/model swap with human gate (per LeCun world-model rule)
- Embedded [`claude-office`](https://github.com/paulrobello/claude-office) pixel-art visualizer iframe
- Diff drawer for files touched (link to git history)

## License

MIT
