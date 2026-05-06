# Privacy

Claude Cockpit is **100% local**. The extension runs entirely on your machine. Nothing leaves it.

## Guarantees

- **Network calls are bounded and disclosed.** The only outbound calls the extension can make are:
  1. `api.github.com/repos/sboghossian/claude-cockpit/releases/latest` — the update check, **on by default** (controlled by `claudeCockpit.updateCheck.enabled`). Runs once on activation and every 6 hours while the sidebar is mounted. Sends only a default `User-Agent` header; receives only the GitHub release JSON. Set the setting to `false` to disable entirely.
  2. `api.github.com/search/repositories` — the Discover tab's GitHub trending fetch, **off by default** (controlled by `claudeCockpit.discover.enabled`), only when you click Refresh.
  3. `roadmap.dashable.dev/api/projects` (or `localhost:3000/api/projects` if you run the roadmap server locally) — the Roadmap tab's project metadata fetch, **on by default**. Auto-fetches when the Roadmap tab is opened if the disk cache (`~/.claude/.cache/cockpit-roadmap.json`) is older than 10 minutes, or when you click Refresh. This endpoint is owned by the same operator as this extension; no third-party service is involved. Set `claudeCockpit.roadmap.enabled` to `false` to disable (the tab will show only cached data).
  No telemetry, no analytics, no third-party services. RSS reads from your local Obsidian vault and makes no network call.
- **No telemetry, no analytics, no crash reporting.** Ever.
- **Bounded writes — user-initiated only.** The default mode is read-only. The only writes are: (a) creating new routine files at `~/.claude/scheduled-tasks/<slug>/SKILL.md` when you click **+ New routine**, and (b) `globalState` for your preferences (custom widgets, visible tabs, theme). No file outside `~/.claude/scheduled-tasks/` is ever written. Verify in `src/discover.ts` (`createRoutineSkill`) and `src/sidebarProvider.ts`.
- **Bounded reads.** The extension reads only from `~/.claude/projects/<encoded-cwd>/` (Claude Code's own per-project session directory), its `memory/MEMORY.md` index, `~/.claude/agents/`, `~/.claude/scheduled-tasks/<name>/SKILL.md` (for the Routines tab), the configured Obsidian vault (specifically the `rss/` or `Inbox/RSS/` folder for the Discover tab's RSS view), and a few system-info commands on macOS for the Mac tab. Nothing else on disk is touched.
- **Webview is sandboxed.** The sidebar webview runs under a strict CSP: `default-src 'none'; connect-src 'none'; form-action 'none'`. It cannot make XHR/fetch calls, submit forms, or load remote resources.
- **Logging is path-only.** The logger writes to a VSCode `OutputChannel`. It logs file paths and error messages — never file contents or session bodies. See `src/logger.ts`.
- **Zero runtime dependencies.** Only `@types/vscode` and `typescript` (devDeps). No supply chain to audit at runtime. See `package.json`.

## Cloud routines opt-in

The Routines tab has a "Cloud" section behind `claudeCockpit.cloudRoutines.enabled` (default: **off**). Turning it on does **not** make Cockpit issue any network calls — it simply unhides a button that, when clicked, opens `claude.ai/settings/automations` in your browser via VSCode's standard external-URL handler. Cockpit itself reads zero cloud-routine state.

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

The full source is at [github.com/sboghossian/claude-cockpit](https://github.com/sboghossian/claude-cockpit). Audit it yourself. If you find a violation of any guarantee above, please open an issue — it's a bug.
