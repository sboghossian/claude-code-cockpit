# Claude Cockpit

A VSCode extension that surfaces Claude Code's hidden state directly in the editor — token burn, files touched, persistent memory — without leaving your workspace.

> Sibling to [`claude-overlay`](https://github.com/sboghossian/claude-overlay) (macOS menubar, cross-surface). Cockpit is VSCode-native and focused on the Code surface.

Landing page: [cockpit.dashable.dev](https://cockpit.dashable.dev) (or [claude-cockpit.pages.dev](https://claude-cockpit.pages.dev) while the custom domain CNAME propagates)

## What it does (Phase 1)

Read-only. Watches `~/.claude/projects/<your-cwd>/` and renders:

- **Status bar**: workspace name, total tokens this session, files touched
- **Sidebar webview** (Activity Bar):
  - Token breakdown (input / output / cache read / cache write)
  - Session metadata (ID, message count, tool call count, last activity)
  - Files Claude has edited this session — click to open
  - Persistent memory index from `MEMORY.md` — click any entry to open

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

## Roadmap

See [`tasks/todo.md`](./tasks/todo.md). Highlights:

- **Phase 2**: mode toggle, model swap, MCP health, hooks inspector, embedded [`claude-office`](https://github.com/paulrobello/claude-office) pixel-art visualizer
- **Phase 3**: cross-project session search, multi-session dashboard, skill palette

## License

MIT
