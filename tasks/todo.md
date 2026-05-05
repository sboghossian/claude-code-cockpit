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

## Phase 2 — quick actions (DONE, shipped v0.2.0)

- [x] Cross-project sessions browser (also fixes empty-state when no folder open)
- [x] MCP server names panel (read `~/.claude/settings.json` only — no `~/.claude.json` to avoid credential exposure)
- [x] Hooks inspector — event types + count + command bin names
- [x] Enabled plugins panel
- [x] Sessions are first-class, not workspace folders (v0.2.0 refactor)

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
