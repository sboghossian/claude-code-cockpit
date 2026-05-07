# Privacy

Claude Cockpit is **100% local by default**. The extension runs entirely on your machine. Optional opt-in PostHog analytics is documented below; nothing else leaves the machine.

## Guarantees

- **Network calls are bounded and disclosed.** The only outbound calls the extension can make are:
  1. `api.github.com/repos/sboghossian/claude-code-cockpit/releases/latest` — the update check, **on by default** (controlled by `claudeCockpit.updateCheck.enabled`). Runs once on activation and every 6 hours while the sidebar is mounted. Sends only a default `User-Agent` header; receives only the GitHub release JSON. Set the setting to `false` to disable entirely.
  2. `api.github.com/search/repositories` — the Discover tab's GitHub trending fetch, **off by default** (controlled by `claudeCockpit.discover.enabled`), only when you click Refresh.
  3. `roadmap.dashable.dev/api/projects` (or `localhost:3000/api/projects` if you run the roadmap server locally) — the Roadmap tab's project metadata fetch, **on by default**. Auto-fetches when the Roadmap tab is opened if the disk cache (`~/.claude/.cache/cockpit-roadmap.json`) is older than 10 minutes, or when you click Refresh. This endpoint is owned by the same operator as this extension; no third-party service is involved. Set `claudeCockpit.roadmap.enabled` to `false` to disable (the tab will show only cached data).
  4. `app.posthog.com/i/v0/e/` (or your configured `claudeCockpit.telemetry.host`) — opt-in usage analytics, **off by default**. See **Optional telemetry** below.
  RSS reads from your local Obsidian vault and makes no network call.
- **Telemetry is opt-in and surfaced.** Default OFF. When enabled, only aggregate counters (tab views, command invocations, session start/end, redacted crash stacks) are sent. Detail is redacted at the module boundary: home directory replaced with `~`, absolute file paths anonymized, API-key shaped tokens dropped, forbidden keys (`apiKey`, `secret`, `password`, `token`, `prompt`, `body`, `content`) hard-dropped. Every outbound POST is also written to `~/.claude/.cockpit/audit.log` so you can inspect exactly what left the machine.
- **Bounded writes — user-initiated only.** The default mode is read-only. The only writes are: (a) creating new routine files at `~/.claude/scheduled-tasks/<slug>/SKILL.md` when you click **+ New routine**, and (b) `globalState` for your preferences (custom widgets, visible tabs, theme). No file outside `~/.claude/scheduled-tasks/` is ever written. Verify in `src/discover.ts` (`createRoutineSkill`) and `src/sidebarProvider.ts`.
- **Bounded reads.** The extension reads only from `~/.claude/projects/<encoded-cwd>/` (Claude Code's own per-project session directory), its `memory/MEMORY.md` index, `~/.claude/agents/`, `~/.claude/scheduled-tasks/<name>/SKILL.md` (for the Routines tab), the configured Obsidian vault (specifically the `rss/` or `Inbox/RSS/` folder for the Discover tab's RSS view), and a few system-info commands on macOS for the Mac tab. Nothing else on disk is touched.
- **Webview is sandboxed.** The sidebar webview runs under a strict CSP: `default-src 'none'; connect-src 'none'; form-action 'none'`. It cannot make XHR/fetch calls, submit forms, or load remote resources.
- **Logging is path-only.** The logger writes to a VSCode `OutputChannel`. It logs file paths and error messages — never file contents or session bodies. See `src/logger.ts`.
- **Zero runtime dependencies.** Only `@types/vscode` and `typescript` (devDeps). No supply chain to audit at runtime. See `package.json`.

## Cloud routines opt-in

The Routines tab has a "Cloud" section behind `claudeCockpit.cloudRoutines.enabled` (default: **off**). Turning it on does **not** make Cockpit issue any network calls — it simply unhides a button that, when clicked, opens `claude.ai/settings/automations` in your browser via VSCode's standard external-URL handler. Cockpit itself reads zero cloud-routine state.

## Optional telemetry (PostHog)

Default OFF. Three settings gate this surface — all three default to a state that produces zero outbound traffic:

| Setting | Default | Effect when OFF |
|---|---|---|
| `claudeCockpit.telemetry.enabled` | `false` | Master kill switch. No HTTP. |
| `claudeCockpit.telemetry.crashReports` | `false` | Uncaught errors are still caught + logged locally; no PostHog post. |
| `claudeCockpit.telemetry.projectId` | `""` (empty) | Forces all telemetry off regardless of the flags above. |

You enable telemetry from one of three places:

1. **Self tab → Telemetry** — one-click opt-in / opt-out toggle with a status pill.
2. **Command palette** → `Claude Cockpit: Toggle Opt-in Telemetry (PostHog)`.
3. **VSCode settings** — search for `claudeCockpit.telemetry`.

### What is captured (and only this)

Every event is `cockpit.<namespace>.<verb>` and carries the same envelope: `extensionVersion`, `vsCodeVersion`, `platform` (`darwin` / `linux` / `win32`), and a `detail` record of primitives.

| Event | Detail | When |
|---|---|---|
| `cockpit.session.start` | `activatedAt` | Extension activates with telemetry on. |
| `cockpit.session.end` | `deactivatedAt` | Extension deactivates. |
| `cockpit.tab.view` | `tab` (sanitized id, e.g. `now`, `replay`, `security`) | User navigates between tabs. |
| `cockpit.command.invoke` | `command` (e.g. `claudeCockpit.refresh`) | A command palette / instrumented command fires. |
| `cockpit.crash.report` | `surface`, `errorName`, `errorMessage` (≤500 chars), `stack` (≤4 KB, anonymized) | An uncaught error is caught by the activation / message-handler / wrapAsync wrappers AND `crashReports` is on. |

### What is NEVER captured

- File paths (home directory replaced with `~`, `/Users/<u>/...` and `/home/<u>/...` replaced with `<redacted-path>`).
- File contents, prompt text, session JSONL bodies, audit log contents.
- API keys / tokens (regex-stripped — `sk-…`, `xoxb-…`, `AKIA…`, `AIza…`, `ghp_…`, `github_pat_…`).
- Hard-dropped keys: `apiKey`, `api_key`, `secret`, `password`, `token`, `authorization`, `prompt`, `body`, `content`, `fileContents`, `fileBody`, `sessionContent`.
- Your PostHog `projectId` (it's only ever sent as the API key on the request you'd make anyway, never echoed back into payload data).
- `os.hostname()` directly. The `distinctId` is a salted SHA256 of the hostname truncated to 16 hex.

### Where the HTTP call lives

All HTTP for telemetry is in the **extension host** (Node side, `src/posthog.ts`). The webview's CSP remains `connect-src 'none'` — the webview cannot fetch PostHog (or anything) directly. Verify in `src/sidebarProvider.ts`'s `html()` and the redacted wire payloads in `src/posthog.ts`.

### HAQQ project refusal

Cockpit explicitly refuses PostHog project id `92178` — the HAQQ Legal AI customer-telemetry project. If you accidentally paste it, the client warns + forces telemetry OFF. This guarantees extension diagnostics can never co-mingle with HAQQ's customer data.

## Where to verify

| Guarantee | File |
|-----------|------|
| Read-only filesystem access | [`src/claudeData.ts`](src/claudeData.ts) |
| No console / no network | [`src/logger.ts`](src/logger.ts) |
| Webview CSP (no `connect-src`, no `form-action`) | [`src/sidebarProvider.ts`](src/sidebarProvider.ts) |
| Webview JS (no fetch / XHR) | [`media/sidebar.js`](media/sidebar.js) |
| Zero runtime deps | [`package.json`](package.json) |

## Why this matters

Stephane runs [HAQQ Legal AI](https://haqq.ai), which handles client-privileged material. The same machine that runs Claude Code may have legal documents, credentials, source for unreleased work. A "developer tool" that phones home — even for "anonymous usage stats" — is unacceptable in that environment. Cockpit is built for that bar.

## Open source

The full source is at [github.com/sboghossian/claude-code-cockpit](https://github.com/sboghossian/claude-code-cockpit). Audit it yourself. If you find a violation of any guarantee above, please open an issue — it's a bug.
