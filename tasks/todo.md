# Claude Cockpit — Phase 1

VSCode extension that surfaces Claude Code's hidden state directly in the editor. Sibling to `claude-overlay` (macOS menubar, cross-surface) — this one is VSCode-native, focused on the Code surface.

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

## Phase 2 — quick actions

- [ ] Mode toggle (plan / auto / bypass / default)
- [ ] Model swap dropdown
- [ ] Session search across all projects
- [ ] "Documents created this session" with click-to-open
- [ ] MCP server health
- [ ] Hooks inspector (last fire, last error)
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
