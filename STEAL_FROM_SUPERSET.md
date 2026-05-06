# Steal From Superset — Cockpit Feature Proposals

A read of `superset-sh/superset` (the macOS Electron orchestrator for parallel
CLI coding agents — *not* Apache Superset, despite the name collision) and what
might be worth porting into Claude Cockpit.

Constraints honored throughout:

- Cockpit stays a VSCode extension, read-only HUD, 100% local.
- We are not building agent orchestration, worktree management, a desktop
  shell, a built-in terminal, or chat playback.
- We *are* looking for status vocabulary, observability angles, sidebar
  widgets, project-scoped concepts, and external-surface ideas (e.g. an MCP
  server for Cockpit's state).

Source repo cloned at `~/Documents/Code/superset-scan/` for cross-reference.

## Triage table (TL;DR)

| # | Idea | Cost | Verdict |
|---|---|---|---|
| 1 | Agent lifecycle status vocabulary (working / permission / review / done) | S | **Port** |
| 2 | Stuck-state cleanup signal (process-exit, not just mtime) | M | **Port** |
| 3 | Project-scoped routines (`projectIds: string[] \| null`) | S | **Port** |
| 4 | Setup-script card per project (configured? last-run state?) | M | **Port** |
| 5 | Session-diff surface (what changed in files vs session start) | M | **Port** |
| 6 | Skills-loaded-this-session widget | S | **Port** |
| 7 | Suppression rule: skip Inbox alert when active in VSCode | S | **Port** |
| 8 | Cockpit MCP server (read-only state for other agents) | L | **Watch** |
| 9 | Reason-codes on every Inbox/budget event | S | **Port** |
| 10 | Cockpit quick-actions palette via VSCode command palette | S | **Port** |
| 11 | OSC 133 shell-ready detection for `▶ Run now` | M | Skip |
| 12 | Voice agent (push-to-talk worktree creation) | L | Skip |
| 13 | Release channel taxonomy | — | Skip (marketplace handles) |
| 14 | Sound chimes / OS notifications for agent events | S | Skip (read-only HUD) |
| 15 | Hotkey registry with platform-specific bindings | M | Skip (VSCode handles) |

## 1. Agent lifecycle status vocabulary — PORT

**Where it lives in Superset:** `plans/20260422-v2-notification-hooks-client-side.md`,
`packages/host-service/src/trpc/router/notifications/notifications.ts`,
`workspace-client/src/lib/eventBus.ts` — a typed `agent:lifecycle` event bus
with normalized states: `Start`, `Stop`, `PermissionRequest`. Sidebar shows
per-workspace dots: **working**, **permission**, **review**.

**What Cockpit does today:** Watchtower color-codes by mtime alone — `live <10s`,
`recent <15min`, `idle <30min`, `stale >30min`. Inbox aggregates "needs you"
items but the categorization is implicit.

**What to port:** four explicit, named states surfaced in Watchtower + Inbox:

| State | Detection signal |
|---|---|
| `working` | last JSONL line is `tool_use` not yet matched by `tool_result`, mtime < 10s |
| `permission` | last assistant message asks a question and no follow-up user message after Nm |
| `review` | session ended with a final assistant message and unresolved checkboxes in `tasks/todo.md` |
| `idle` | mtime in 15-30min window, no unfinished tool calls |
| `stale` | mtime > 30min |

State takes precedence over color: a session at mtime=5s but stuck on
`permission` should render as ⏸ amber, not ● green. Inbox bucketing
collapses to the named state, not "needs you" generically.

**Why this matters:** "live" green dot is misleading when Claude is actually
blocked waiting on the user. Superset learned this — the v1 lesson in their
plan doc is that pure mtime-based liveness lies.

**Effort:** S. ~50 lines in `claudeData.ts` (state classifier), one render
update in `media/sidebar.js`.

## 2. Stuck-state cleanup — PORT

**Where in Superset:** same notification-hooks plan: *"clear stuck transient
statuses when the underlying terminal/session exits."* They watch terminal exit
events and reset `working`/`permission` flags, so a force-quit Claude doesn't
leave a permanent green dot.

**What Cockpit does today:** mtime-only. A killed session sits as `stale` after
30min but never resolves to "definitely exited."

**What to port:** detect process death via `ps` polling or by spotting a
sentinel pattern in the JSONL tail (`session_end` event, or absence of any
write for >5min while `claude` is no longer in `pgrep`). If detected, rewrite
the state to `done` with a "session ended" badge. Removes false-positive
amber/green dots.

**Effort:** M. New helper that calls `pgrep -f "claude --session"` filtered to
the session ids Cockpit knows about. Cache 30s.

## 3. Project-scoped routines — PORT

**Where in Superset:** `plans/20260321-project-preset-scoping.md`. They added
`projectIds: string[] | null` to terminal presets — `null` = all projects, an
array = scoped. Single store, single editor, runtime resolution at the use
site.

**What Cockpit does today:** Routines tab reads `~/.claude/scheduled-tasks/<name>/SKILL.md`
globally. No way to mark a routine as "only for HAQQ Legal AI" or "only for
Forkcast."

**What to port:** add an optional `projectIds` field to the SKILL.md
frontmatter (Cockpit-specific extension; ignored by Anthropic):

```yaml
---
name: morning-haqq-standup
description: Daily standup digest for HAQQ
projects: [haqq-legal-ai-prototype, haqq-leadgen]
---
```

Routines tab filters by current workspace's basename, with a "Show all" toggle.
The `▶ Run now` action only shows for in-scope routines.

**Effort:** S. ~20 lines in `routines.ts` (parse `projects:` from frontmatter)
+ filter in render.

## 4. Setup-script card per project — PORT

**Where in Superset:** `plans/20260505-setup-teardown-scripts-v2.md`,
`apps/desktop/src/renderer/screens/main/components/WorkspaceSidebar/SetupScriptCard/`.
Sidebar shows a dismissable card when a project has setup scripts configured but
not yet run, or when the run failed. Resolves config from
`.superset/config.json` + `.superset/config.local.json` overlay + per-project override.

**What Cockpit does today:** Plans tab parses `tasks/todo.md` etc. No surface
for `.claude/` setup scripts or workspace-init hooks.

**What to port:** read these per-workspace, surface in a new "Workspace Setup"
section of the Now tab:

- `.claude/agents/*.md` (already covered by Agents tab — link)
- `.claude/hooks/*.sh` — list, with last-modified timestamps
- `.claude/settings.json` — show flag count + last-modified
- `tasks/todo.md` open-checkbox count (already in Plans)
- A "first-run hint" card if Cockpit detects a workspace was opened today
  for the first time and has uncommitted Claude files.

**Effort:** M. New widget; mostly read-only filesystem walks Cockpit already
does for adjacent reasons.

## 5. Session-diff surface — PORT

**Where in Superset:** `docs/V2_WORKSPACE_DIFF_VIEWS.md` — three flavors of
comparison (current main vs me, fork-point vs me, etc.) with explainer prose
for non-git users. The doc is excellent UX writing on its own.

**What Cockpit does today:** "Files touched" lists paths edited via Edit/Write/MultiEdit
tool calls. Doesn't show *what changed*.

**What to port:** a "Session diff" widget on the Now tab that runs
`git diff --stat HEAD~1..HEAD -- <files-touched>` for files Claude wrote in
this session. Click a file → `vscode.diff` URI to open VSCode's native diff
view. No reimplementation of diff UI; Cockpit just routes to VSCode's.

Two comparisons:

- **Since session start** — `git diff <session-start-sha>..HEAD`
  (record SHA at session start in globalState, keyed by session id)
- **Since last commit** — `git diff HEAD~1..HEAD` for unstaged

**Effort:** M. Snapshot SHA at session start (one new write to globalState),
`vscode.diff` command call from webview message handler.

## 6. Skills-loaded-this-session widget — PORT

**Where in Superset:** `docs/skill-preload-feature.md` — when the agent invokes
`load_skill`, chat renders a dedicated `SkillToolCall` row with ZapIcon + "Loading
skill" label.

**What Cockpit does today:** Skills tab is a static palette of 93 installed
skills. No view of *which skills the current session actually loaded*.

**What to port:** scan the active session JSONL for `tool_use` blocks where
`name === "Skill"` (or matches the skill-router hook signature), aggregate by
skill name + count + last-used time. Show as a small panel in the Now tab:
"Skills used this session: caveman ×3, /pick-model ×1, …"

This is a passive observability widget. It tells you what your skill router
actually triggered — pairs perfectly with your TF-IDF skill router project.

**Effort:** S. ~30 lines in `claudeData.ts` (scanner), 10 lines render.

## 7. Suppression rule — PORT

**Where in Superset:** notification plan, *"suppress notifications when the
user is already looking at the relevant pane."*

**What Cockpit does today:** Inbox shows everything regardless of focus.

**What to port:** when computing Inbox, check
`vscode.window.activeTextEditor?.document.uri.fsPath` against session's
"files touched." If the user is currently in a file Claude just edited,
demote that session's Inbox row from "needs review" to silent. Same for
the active session = workspace's session.

**Effort:** S. One subscription to `onDidChangeActiveTextEditor`, one
filter in the Inbox computation.

## 8. Cockpit MCP server — WATCH (don't build yet)

**Where in Superset:** `packages/desktop-mcp/` exposes browser-control tools
(take-screenshot, click, type-text, navigate, inspect-dom, get-console-logs,
evaluate-js, get-window-info) over MCP. The pattern: a desktop app shipping its
own MCP server so external agents can query/drive it.

**What this would mean for Cockpit:** ship a `cockpit-mcp` (separate npm
package or sibling) that exposes Cockpit's state read-only:

- `get_active_session()` — current session JSONL parsed
- `get_budget_status()` — daily/session caps + spend
- `get_watchtower()` — all live sessions
- `get_recent_files()` — files touched
- `search_memory(query)` — global memory search
- `get_inbox()` — aggregated needs-you

This lets *another* Claude (or Codex, or any MCP client) ask Cockpit
questions instead of re-parsing `~/.claude/projects/` itself.

**Why "Watch" not "Port":** real value but L effort, and there's no concrete
ask yet from a remote-agent use case. Defer until you (a) actually pair a
remote agent that wants this, or (b) Anthropic ships a stable Claude Code
state API that supersedes the need to scrape JSONL.

## 9. Reason-codes on Inbox/budget events — PORT

**Where in Superset:** `plans/20260427-posthog-v1-v2-dashboard.md` —
`surface_source: "v2-flag-off" | "opted-out" | "opted-in"`. Every state
ships with the *reason* it's that state, not just the state.

**What Cockpit does today:** Inbox says "3 stale memories" — doesn't say
*why* stale (age threshold? not pinned? superseded?). Budget alerts fire
without telling you which session pushed it over.

**What to port:** every Inbox row carries a `reason` field rendered as a
hover tooltip. Examples:

- `idle session` → reason: `mtime 22m ago, no errors`
- `errored tool` → reason: `Bash exit 1, stderr: <first 80 chars>`
- `budget breach` → reason: `daily cap $X, today $Y, top session: <name> $Z`
- `stale memory` → reason: `last edited 47d ago, never opened since`

100% local; this is just enriching the data Cockpit already computes.
Costs ~20 lines.

**Effort:** S.

## 10. Cockpit quick-actions palette — PORT

**Where in Superset:** `apps/desktop/src/renderer/screens/main/components/CommandPalette/`
plus the `HOTKEYS_REGISTRY` (`hotkeys/registry.ts`) — declarative,
platform-aware, layout-aware (logical vs physical key dispatch for non-US
layouts). One ⌘K palette covers nav, workspace switching, terminal, layout.

**What Cockpit does today:** 8 commands in `package.json`. VSCode's command
palette already surfaces them (`Cmd+Shift+P` → "Claude Cockpit: …").

**What to port:** expand the command surface to cover every widget the
sidebar exposes. Goal: any widget reachable from Custom-tab is also
reachable as a `Claude Cockpit: <action>` command. Examples that *aren't*
commands today but should be:

- `Claude Cockpit: Pin Memory Entry`
- `Claude Cockpit: Add Prompt to Library`
- `Claude Cockpit: Show Cost-by-Tool`
- `Claude Cockpit: Run Routine…` (quick-pick of routines)
- `Claude Cockpit: Open Watchtower in Panel` (focus tab)
- `Claude Cockpit: Toggle Discover`

VSCode handles platform/layout correctness for free. Skip the registry
abstraction; just declare in `package.json`.

**Effort:** S. Mostly mechanical.

## 11. OSC 133 shell-ready detection — SKIP

Superset uses OSC 133 A/C/D markers to know when a shell prompt is ready
before sending init commands (`docs/V2_WORKSPACE_SETUP_SCRIPTS.md`).
Genuinely cool but Cockpit's `▶ Run now` just opens a terminal and pipes
SKILL.md — VSCode owns the terminal lifecycle. Not worth instrumenting.

## 12. Voice agent — SKIP

`plans/voice-agent-plan.md` — push-to-talk → WisprFlow transcription →
Claude Agent SDK with `createWorktree` tool. Cockpit doesn't create
worktrees. Out of scope.

## 13. Release channel taxonomy — SKIP

`plans/release-channels-spec.md` — desktop-stable / desktop-canary /
cli-stable / cli-canary with rolling tags. Cockpit ships through the VSCode
marketplace; channels are handled.

## 14. Sound chimes / OS notifications — SKIP

The notification plan covers ringtone + OS notifications on agent state
changes. Cockpit is a passive read-only HUD by design. Audio + push
notifications break that contract — they're a separate product
(`claude-overlay` could absorb this).

## 15. Hotkey registry — SKIP

`hotkeys/registry.ts` is a beautiful declarative registry with platform-
specific bindings and logical-vs-physical layout dispatch. It exists because
Electron has to roll its own. VSCode handles all of this. Adding a registry
abstraction on top of `package.json` `keybindings` would just duplicate.

## What this PR contains

This branch (`feat/superset-feature-steal`) ships only this design doc and
its task file. Implementation lands in follow-up PRs, one tier-1 item per
PR, in this order:

1. #1 Agent lifecycle states (Watchtower + Inbox)
2. #9 Reason-codes (depends on #1's enriched events)
3. #6 Skills-loaded-this-session
4. #3 Project-scoped routines
5. #7 Suppression rule
6. #5 Session-diff surface
7. #2 Stuck-state cleanup
8. #4 Setup-script card
9. #10 Quick-actions palette expansion

Tier-2 (#8 MCP server) waits for a concrete pairing use case.

## Cross-references

- `~/Documents/Code/superset-scan/plans/20260422-v2-notification-hooks-client-side.md`
- `~/Documents/Code/superset-scan/plans/20260321-project-preset-scoping.md`
- `~/Documents/Code/superset-scan/plans/20260505-setup-teardown-scripts-v2.md`
- `~/Documents/Code/superset-scan/plans/20260427-posthog-v1-v2-dashboard.md`
- `~/Documents/Code/superset-scan/docs/V2_WORKSPACE_DIFF_VIEWS.md`
- `~/Documents/Code/superset-scan/docs/skill-preload-feature.md`
- `~/Documents/Code/superset-scan/apps/desktop/src/renderer/hotkeys/registry.ts`
- `~/Documents/Code/superset-scan/packages/desktop-mcp/src/mcp/tools/`
