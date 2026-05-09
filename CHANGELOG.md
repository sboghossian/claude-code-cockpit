# Changelog

All notable changes to Claude Cockpit are tracked here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-05-09

### Added — jcode-inspired features (Phase 3)

- **Memory Vector visualization (Memvec tab)** — surfaces the persistent semantic store maintained by the `/memory-vector` skill (`~/.gstack/memory/vectors.db`). Two widgets: `memvecStats` (chunk count, source-type breakdown, recency) and `memvecSearch` (semantic search box with similarity-bar hits, click-through to source). Cockpit shells out to the skill's CLI rather than taking on the native `sqlite-vec` dep — zero new runtime dependencies.
- **Swarm topology (Swarm tab)** — derives a session-overlap topology from `~/.claude/projects/<cwd>/` JSONL tails. Lists every Claude session touched in the last hour, shows file-overlap edges between pairs, and flags conflict severity (high = both sessions active right now, medium = one active, low = both idle). Answers "are two of my sessions about to step on each other?"
- **Agent hot-reload feed (Approval category)** — `vscode.workspace.createFileSystemWatcher` on global + workspace `agents/` dirs. SHA256-tracked diffs surface as pending events for human acknowledgement before any agent change is treated as authoritative for the running session. Honors the LeCun world-model stance: no autonomous multi-step LLM action without lookahead + scoring + rollback + human gate.

### Changed

- `InboundMessage` union extended with five new types (`memvec.fetchStats`, `memvec.query`, `swarm.fetch`, `agentReload.fetch`, `agentReload.markReviewed`).
- `extension.ts` registers the new tabs/widgets via the existing plugin API; activation order matters (`registerJcodeFeaturesSurface()` runs alongside `registerReplaySurface()` and `registerOnboardingSandboxSurface()`).
- `AgentReloadWatcher` is owned by the extension context and injected into `sidebarProvider` via `setAgentReloadWatcher()`.

### Notes

- All 139 v1.0.0 tests still pass byte-identically. No breaking changes to existing widgets, tabs, or message types.
- All three new surfaces are read-only by default; they don't write to the vector DB, don't reshape session JSONLs, and don't reload agents — they only observe and surface.

## [1.0.0] — 2026-05-07

The v1.0 launch wave. 11 feature PRs landed across three phases (foundation → parallel features → polish). Every new feature is opt-in or default-off where safety matters; v0.21.0 users see byte-identical behavior until they enable a feature.

### Added — Phase 0 (foundation)

- **Plugin API (`src/plugin.ts`)** — formal extension contract. `CockpitWidget`, `CockpitTab`, `CockpitTrigger` extension points. Shared `WorktreeAction`, `SnapshotRef`, `AuditEvent` types. `registerWidget` / `registerTab` / `registerTrigger` / `registerSidebarScript` / `registerSidebarStyle`. Webview bridge: `window.cockpit.registerComponent(id, def)` populates an `EXTERNAL_COMPONENTS` map adjacent to the existing `COMPONENTS` registry. Sibling scripts are emitted as nonce-tagged `<script>` tags by `sidebarProvider.html()`. CSP `connect-src 'none'` preserved.

### Added — Phase 1 (seven parallel features)

- **Approval queue (Approve tab) + content-addressed snapshots + atomic revert.** `~/.claude/.cockpit/queue.json` (atomic write + fsync), `~/.claude/.cockpit/snapshots/<id>/files/<sha256>` for content-addressed pre-action blobs. Per-action sha256 drift detection on revert; drifted files skipped unless user explicitly forces. The existing jarvis.ts boo-mesh approval flow becomes one of N sources — approve/reject from the new tab forwards to `decideApproval()` so v0.21.0 notification path keeps working. The trust-gate feature aligning with the LeCun world-model stance: no autonomous multi-step LLM action without lookahead + scoring + rollback + human gate. New commands: `claudeCockpit.approval.openQueue`, `bulkApprove`, `bulkReject`, `revertLast`. New settings: `claudeCockpit.approval.autoSnapshot`, `snapshotMaxBytes`, `requireForToolNames`.
- **Session replay timeline + diff + cost projection (Replay tab).** Scrub backwards through every event of the active session JSONL. Reconstructs file states at each step from `Edit` / `Write` / `MultiEdit` blocks. Unified diffs between any two scrub points. Forks the JSONL prefix into `~/.claude/.cockpit/forks/` (read-only — never mutates the original session JSONL). Subsumes the launch wave's "cost telemetry + budgets": `replayCostProjection` widget surfaces spent / per-event / projected USD over the next 50 events with a warning banner against `claudeCockpit.budget.dailyCapUsd`. Diff engine caches by `(sessionFile, mtime, size)` so repeated renders never re-read the JSONL. Tolerates truncated last-line. New setting: `claudeCockpit.replay.maxEventsPerSession` (default 5000). New commands: `replay.openCurrent`, `replay.exportDiff`.
- **Permissions audit log + Security sub-views (Keys / Outbound / Audit-log).** NDJSON log at `~/.claude/.cockpit/audit.log` with append-and-fsync atomicity, 50 MB rotation across five archives, 8 KB per-line cap, redaction enforced at call sites. Six outbound wrap sites (`discover.fetchGithubTrending`, `discover.httpGet`, `updateCheck.fetchLatestRelease`, `integrations.ping`, `integrations.httpsHead`, `roadmap.getJson`) emit `kind: 'net.outbound'` with host + method + purpose only. Keys sub-view backed by VSCode SecretStorage — values never serialized to webview. Setting `claudeCockpit.audit.enabled` (default `true`); zero-cost no-op when off.
- **Skill / agent gallery + clipboard share + install-by-URL (Gallery tab).** Lists every skill in `~/.claude/skills/` and agent in `~/.claude/agents/` (global + workspace). Reuses existing `listSkills` and `readAgents` readers. Search by name/description/origin, filter by kind. Share button copies a portable manifest to clipboard. Install-from-URL: HTTPS only, SHA256 + 1 KB excerpt preview before write, drift-detection on confirm. New commands: `gallery.openTab`, `gallery.installFromUrl`. Public registry deferred to v1.1.
- **Tab system v2 — pin / hide / drag-reorder + named layout presets + pop-out fullscreen + cmd+1..9.** Right-click any tab for `Pin tab` / `Hide tab` / `Save current layout as…` / `Load <preset>` / `Pop out fullscreen`. Drag any tab onto another to reorder; persists via globalState. Layout presets capture order + pin set + hidden set under a name. Pop-out via `vscode.window.createWebviewPanel` (no new viewsContainer); both views share one provider + globalState-backed prefs so a preset loaded in either updates both. `cmd/ctrl+1..9` jumps tabs in current visible order. 14 new commands.
- **Obsidian graph view (Obsidian tab).** Replaces the old recent-notes list with a real-time d3-force vault graph. Vendored 63 KB d3 build at `media/vendor/d3.min.js` (no CDN, no new npm runtime dep). Wikilink parser handles `[[link]]`, `[[link|alias]]`, `[[link#section]]`, fenced-code-block exclusion. `~/.claude/.cockpit/graph-cache-<vaultId>.json` keyed on highest `.md` mtime — sub-10 ms warm loads on 5 k-note vaults. Pan/zoom/drag. Click-through opens in Obsidian via `obsidian://`. Files Claude touched in the active session render in the accent color. New command: `obsidian.refreshGraph`.
- **WCAG AA palettes + reduced-motion + screen-reader pass.** New `media/sidebar.themes.css` with three palettes: contrast-strengthened light (AA on white), strengthened dark, brand-new `high-contrast` palette (AA+ across the board, AAA on most pairs). `prefers-reduced-motion: reduce` honored across all CSS animations + Talk's `requestAnimationFrame` particle viz (paints a static frame instead). Global `:focus-visible` ring. Tab bar gets `role="tablist"` + `aria-label`s; header gets `role="banner"` + `role="search"`; theme picker gets `role="radiogroup"`. New `.cockpit-a11y-sr-only` utility class for Phase-1 features.

### Added — Phase 2 (polish)

- **Tutorial tab + status bar + desktop notifications + first-run sandbox demo.** New Tutorial tab with `tutorialRecs` (re-renders `snap.recommendations` as actionable cards) and `tutorialNudges` (synthesizes prompt-pattern suggestions from `minePrompts`). Status bar gains pending-approval badge, audit-events-24h pill, Talk launcher (each hides when its signal is empty). `notify()` helper with 30 s per-key debounce — three triggers: pending approvals 0 → ≥ 1, audit `tool.invoke` blocked, today's spend crossing 80 % of daily cap. `claudeCockpit.notifications.enabled` (default `true`) gates the surface. First-run sandbox synthesizes a fake project at `~/.claude/.cockpit/sandbox/demo-project/` with a 30-event JSONL transcript that passes the existing parser; tour-mode flag in globalState; SANDBOX pill at the top of every tab while active. Six new commands.
- **Mobile companion — read-only phone mirror via Cloudflare Access.** Static page at `landing/mobile/` deployable to `cockpit.dashable.dev/mobile/`. When `claudeCockpit.mobile.enabled = true` (default `false`), the extension writes a strict-whitelist sanitized snapshot to `~/.claude/.cockpit/queue.public.json` (atomic, mode 0600). Output fields: id, tool, ageSeconds, agentName (≤ 8 chars), expectedDiffBytes, status, fileCount. Never written: file paths, args, decision notes, secrets. User serves the file via their existing Cloudflare Tunnel + Access SSO; the mobile page rides the Access cookie via `credentials: 'include'`. Cockpit makes zero outbound calls. v1.0 is read-only; mobile-side approve lands in v1.1. Two new commands: `mobile.copyPath`, `mobile.openSetup`.
- **Opt-in PostHog telemetry + crash reporting.** Default OFF on three independent gates: `claudeCockpit.telemetry.enabled`, `crashReports`, `projectId`. Until all three are non-default the module is byte-identical no-op. Hand-rolled `https.request` client (zero new deps). Event taxonomy: `cockpit.session.start/end`, `cockpit.tab.view`, `cockpit.command.invoke`, `cockpit.crash.report`. Envelope: extensionVersion, vsCodeVersion, platform, $lib, salted-SHA256-of-hostname distinctId. Detail redaction at module boundary (paths → `~`, API key shapes stripped, forbidden keys hard-dropped at depth ≤ 5). Activation + message handler now wrapped in try/catch under `wrapAsync` — a single bad message no longer crashes the webview message bus. Every PostHog POST is mirrored to `~/.claude/.cockpit/audit.log`. Project ID 92178 (HAQQ Legal AI customer telemetry) explicitly refused. New command: `telemetry.toggle`. PRIVACY.md updated.

### Changed

- **`media/sidebar.js`** — adds `EXTERNAL_COMPONENTS` map adjacent to `COMPONENTS`. `tabBodyComposed`, `getTabComponentIds`, and `customizePanel` consult both maps so externally-registered widgets are first-class. Tab system v2 preserves byte-identical default rendering when no layout pref is active.
- **Obsidian tab** replaces the recent-notes list with the new graph view. This is the only intentional v0.21.0 → v1.0.0 visible default-state change.

### Removed

- Nothing.

### Notes

- Total diff: ~16,400 LOC added across 11 feature PRs + housekeeping. 139 tests passing.
- `.vscodeignore` now excludes `.claude/`, `.gstack/`, `.wrangler/` so the `.vsix` ships only the production tree.
- Approval queue is observability + revert; ENFORCEMENT (blocking the underlying agent at PreToolUse) is left to user-configured hooks. v1.1 will ship a stock hook recipe.
- Replay's "fork" is an EXPORT, not a Claude Code session handoff — the user must `cp` the file into `~/.claude/projects/<encoded-cwd>/` under a new uuid to actually resume from a fork.
- Manual cleanup if rolling back v1.0: `rm -rf ~/.claude/.cockpit/`. The dir is self-contained and inert without the extension running.

<details>
<summary>Original per-worktree drafts (kept for archaeology — collapsed)</summary>

## [Unreleased] — feat/launch-onboarding-sandbox

### Added

- **Tutorial tab + recommendation cards (`media/sidebar.tutorial.js`)** — Phase 2 of the v1.0 launch wave. New `Tutorial` tab (registered via the Phase-0 plugin bridge, never edits the COMPONENTS literal) hosts two widgets: `tutorialRecs` re-renders every entry in `snap.recommendations` as an actionable card (impact-coloured left border, "Try it" + "Dismiss" buttons), and `tutorialNudges` synthesizes prompt-pattern suggestions from the existing `minePrompts` output ("You ran `/qa` 4 times — try `/qa --report-only` first"). Dismissed ids live in an in-memory Set on the provider so the user never re-sees the same nudge in a session, but they reset across reloads (no persisted nag list).
- **First-run sandbox (`src/sandbox.ts`)** — synthesizes a fake project at `~/.claude/.cockpit/sandbox/demo-project/` with a `CLAUDE.md`, `README.md`, and a 30-event JSONL transcript that passes the existing `parseLine()` validator (every line carries `type`, `timestamp`, `sessionId`). Tour-mode flag lives in globalState; when on, the Welcome banner shows an "Exit demo" button and every webview render injects a `SANDBOX` pill at the top of the active tab so the user never forgets the cockpit is showing synthetic data. The whole `~/.claude/.cockpit/sandbox/` tree is self-contained — `Exit demo` `rm -rf`'s it; rolling back the feature leaves zero residue.
- **Desktop notifications (`src/notifications.ts`)** — central `notify()` helper wrapping `vscode.window.showInformationMessage` / `showWarningMessage` with a 30 s per-key debounce window. Three triggers wired into `CockpitSidebarProvider.evaluateNotifications()` (called after every snapshot push): pending approvals 0 → ≥ 1, audit `tool.invoke` events with `outcome: 'blocked'` newer than the last seen one, and today's spend crossing 80 % of `claudeCockpit.budget.dailyCapUsd`. Each fires at most once per debounce window per key. The new setting `claudeCockpit.notifications.enabled` (default `true`) gates the entire surface — when off, every `notify()` call is a synchronous no-op.
- **Status bar widget extensions (`src/statusBar.ts`)** — three new `StatusBarItem`s alongside the existing cwd + token + files items: pending-approval badge (clickable → opens the Approval queue), audit-events-this-24h pill (clickable → opens Security tab), and a Talk launcher (clickable → opens Talk tab). All three hide when their underlying signal is empty, so the bar stays uncluttered for users without active approvals or audit events.
- **Six new commands** — `claudeCockpit.tutorial.open`, `claudeCockpit.sandbox.start`, `claudeCockpit.sandbox.exit`, `claudeCockpit.audit.open`, `claudeCockpit.talk.open`, `claudeCockpit.notifications.test`.
- **Snapshot extension** — `CockpitSnapshot.sandbox?: { active, projectRoot, sessionFile, sessionId }` (all optional). Drives the SANDBOX banner and the Exit-demo button. Field is undefined-safe — every existing tab renders byte-identical when the sandbox is off.

### Notes

- The brief's third sandbox trigger ("agent finishing") is a passthrough helper exported as `notifyAgentFinished` but not yet auto-fired — Cockpit doesn't observe agent lifecycle events directly today; that's a v1.1 hook story. The helper is in place so Phase-3 worktrees can import it.
- 13 new tests: `test/sandbox.test.js` (3, JSONL shape + idempotency + teardown), `test/notifications.test.js` (4, debounce + window + level + settings gate), `test/statusBar.test.js` (3, approval count rendering + hide-on-undefined + audit dot), `test/tutorial.test.js` (3, recommendation ordering + dismissal filter + minePrompts shape). All four files defer their `require('../out/...')` calls into the test bodies — same pattern as `test/replay.test.js` — because `claudeData.test.js`'s sibling auto-discoverer loads them BEFORE it pins `process.env.HOME` to a tmp dir. Eager top-level requires of any module that captures `os.homedir()` at load time would freeze the wrong HOME and break every claudeData fixture-driven test downstream.
- `src/sandbox.ts` defers its `os.homedir()` lookup to runtime via `refRoot()` / `refProject()` / `refSessions()` helpers + a `TEST_OVERRIDE` mutable ref. Same pattern as `src/replay.ts:forksDirInternal`. Eager `path.join(os.homedir(), ...)` at module load would freeze the wrong HOME for tests that pin `process.env.HOME` AFTER our module is required.
- `npm test` reports **127 tests / 127 pass / 0 fail** (114 baseline + 13 new). No regressions. The `package.json` `scripts.test` command is left unchanged from main (`claudeData.test.js + replay.test.js`); the auto-discoverer in `claudeData.test.js` picks up our new sibling test files automatically per the explicit comment in that file ("Phase-1 worktrees can drop a new `test/<feature>.test.js` and have it picked up without touching this file or package.json").
## [Unreleased] — feat/launch-mobile-companion

### Added

- **Mobile companion (read-only, v1.0)** — Phase 2 of the v1.0 launch wave. New static page under `landing/mobile/` (HTML + CSS + JS) deployable via the existing Cloudflare Pages config to `cockpit.dashable.dev/mobile/`. The page polls a user-served `queue.public.json` every 5s and renders a single-column, dark-default mirror of the approval queue: pending count, per-entry tool / age / agent / file count / expected diff. Tab visibility-aware (polling pauses when backgrounded). Stale-data warning if the published snapshot is more than 15s old.
- **Sanitized exporter (`src/mobileExport.ts`)** — when `claudeCockpit.mobile.enabled = true` (default `false`), the extension writes a strict-whitelist snapshot of the approval queue to `~/.claude/.cockpit/queue.public.json` (atomic tmp+rename, mode 0600). Output fields are exactly: `id`, `tool`, `ageSeconds`, `agentName` (truncated to 8 chars), `expectedDiffBytes`, `status`, `fileCount`. Never written: file paths, `argsRedacted`, snapshot ids, decision notes, secrets. Digest-compared against the previous publish so the file's mtime only advances when content actually changes. When the setting flips off, the existing file is deleted so a stale snapshot can't bleed through a still-open Cloudflare Tunnel.
- **Cockpit makes zero outbound calls for mobile.** The user is responsible for serving `queue.public.json` over their existing Cloudflare Tunnel + Cloudflare Access SSO. The mobile page rides the Access cookie via `credentials: 'include'`. Setup is documented in `landing/mobile/README.md`.
- **Two new commands.** `claudeCockpit.mobile.copyPath` copies the published file path to the clipboard (for the user's tunnel config); `claudeCockpit.mobile.openSetup` opens `cockpit.dashable.dev/mobile/` in the browser.
- **One new setting.** `claudeCockpit.mobile.enabled` (boolean, default `false`).
- **8 new tests (`test/mobileExport.test.js`)** covering the sanitizer (rejects full paths, truncates agent names, never emits `argsRedacted` / `snapshotId` / `filesAffected`), the publisher (no-rewrite when digest is stable, file deletion on disable), and the round-trip atomic writer.

### Notes

- v1.0 is **read-only**. The mobile page can never approve, reject, or otherwise mutate the queue. v1.1 will add mobile-side approve via a second Cloudflare-Access-protected endpoint that the desktop polls — Cockpit will still make zero direct outbound calls.
- Per the launch master plan's cut lines, mobile is LOW priority and explicitly defer-able. We shipped it because v1.0 wants the full feature set, but the surface area is bounded: a 240-line TypeScript module, three static files in `landing/mobile/`, one config flag default-off. Disabling the flag returns the extension to byte-identical v0.21.0 behaviour for this surface.
- Authentication boundary: Cloudflare Access SSO. There is no fallback "protect with a password" mode — half-baked auth is worse than no auth. Users who don't run Cloudflare Access should leave the setting off.
- Refresh cadence: 5s on the phone, debounced 250ms on the desktop. The desktop only rewrites the file when the queue **content** changes (sha256 digest match); idle ticks don't bump the mtime.
## [Unreleased] — feat/launch-telemetry-posthog

### Added

- **Opt-in PostHog telemetry (`src/posthog.ts`)** — Phase 2 of the v1.0 launch wave. Default OFF. Hand-rolled `https.request` client (zero new deps) that POSTs `cockpit.<namespace>.<verb>` events to `app.posthog.com/i/v0/e/`. Configured via three settings, all defaulting to a no-op state: `claudeCockpit.telemetry.enabled` (boolean, default `false`), `claudeCockpit.telemetry.crashReports` (boolean, default `false`), `claudeCockpit.telemetry.projectId` (string, default `""`). When all three are zero/empty, the module's public surface is byte-for-byte a no-op — no allocations, no fs writes, no outbound traffic. v0.21.0 users see zero behavior change.
- **Crash glue (`src/crash.ts`)** — `captureActivationFailure`, `captureMessageFailure`, `wrapAsync` wrappers that anonymize stack traces (home dir → `~`, tmpdir → `<tmp>`, frames outside the extension's `out/` dir blanked to `<external-frame>`, capped at 4 KB) before handing them to `posthog.captureCrash`. Wrappers run regardless of telemetry settings — they catch + log via `logger.warn` always; the PostHog post is gated on the opt-in flag. This means a thrown handler error never escapes the host, regardless of telemetry settings — a behavioural improvement over v0.21.0.
- **Activation + message handler now wrapped.** `extension.ts:activate()` body lives in `activateInner()` invoked under a top-level try/catch; if it throws, `captureActivationFailure(err)` reports the redacted stack and rethrows so VSCode's "Extension failed to activate" surface still fires. Similarly `sidebarProvider.handle()` now delegates to `handleInner()` under try/catch — a single bad message no longer crashes the whole webview message bus.
- **Self tab → Telemetry section.** New status pill (`PostHog: connected | disabled | not configured`) plus a one-click opt-in / opt-out toggle. Hooks via `telemetry.optIn`, `telemetry.optOut`, `telemetry.status` messages added to the InboundMessage union. Status payload exposes only counters + flags — never the projectId, never the distinctId, never the host beyond display.
- **Tab-view ping.** `setActiveTab(id)` in `media/sidebar.js` now sends `telemetry.tabView` to the host on actual tab change. The host sanitizes the tab id (`[a-zA-Z0-9_-]{1,24}`) and emits `cockpit.tab.view`. Webview never makes the HTTP call directly — CSP `connect-src 'none'` is unchanged.
- **Command instrumentation.** Five command palette entries (`refresh`, `gallery.openTab`, `replay.openCurrent`, `approval.openQueue`, `telemetry.toggle`) wrap their callbacks with a one-line `pingCommand(id)` that emits `cockpit.command.invoke`. Sends ONLY the command id — never the args, never any user input the command later prompts for.
- **Outbound mirroring.** Every PostHog POST writes a `net.outbound` entry to `~/.claude/.cockpit/audit.log` so users can see exactly what left the machine — same audit-log surface the permissions-audit worktree introduced.
- **Redaction at the module boundary.** `redactString()` strips `os.homedir()`, `/Users/...`, `/home/...`, `C:\\...` paths and `sk-…` / `xoxb-…` / `AKIA…` / `AIza…` / `ghp_…` / `github_pat_…` API-key shapes. `redactDetail()` walks nested objects ≤5 deep and hard-drops `apiKey`, `secret`, `password`, `token`, `authorization`, `prompt`, `body`, `content`, `fileContents`, `fileBody`, `sessionContent` keys. Defense in depth: callers also redact at emit sites.
- **HAQQ project refusal.** `posthog.configure()` explicitly refuses project id `92178` (Stephane's HAQQ Legal AI customer-telemetry project) so extension diagnostics can never co-mingle with HAQQ customer data — even if a user pastes it by mistake.
- **One new command.** `claudeCockpit.telemetry.toggle` flips the master flag from anywhere; if `projectId` is unset, it routes to settings instead.
- **Privacy disclosure** — `PRIVACY.md` gains an **Optional telemetry (PostHog)** section listing every event name, every detail field, every redaction rule, and the three settings that gate the surface. Welcome banner + Help tab now mention the opt-in toggle.

### Tests

- 12 new tests in `test/posthog.test.js`: opt-out → no-op, empty-projectId → no-op, HAQQ project refusal, full payload-shape verification, malformed event-name rejection, redaction (paths + tokens), forbidden-key dropping inside `redactDetail`, crash-report flag gating, stack anonymization (`out/` frames preserved, externals blanked), status snapshot leak-check (must NOT include projectId or distinctId). Tests use a `__setFetcherForTests` injection seam — no real HTTP, no env mutation that would race other test files.
- `package.json:scripts.test` consolidated to a single line that runs every `test/*.test.js` file (the prior version had three duplicate `test` keys; only the last won, leaving 80+ tests silently skipped). Test count grows from 114 (legacy filter) to 194 with this fix + the new posthog suite.

### Notes

- This is the **last** phase-2 worktree (telemetry observes every other worktree's surface). Mobile companion lands next.
- PostHog project setup is the user's responsibility — Cockpit ships no project id. Users opt in by pasting their own `projectId` from a fresh PostHog project.

## [Unreleased] — Plugin API foundation + Approval queue

### Added

- **Plugin API (`src/plugin.ts`)** — Phase 0 of the v1.0 launch wave. Defines the formal extension contract every Phase-1 feature consumes: `CockpitWidget`, `CockpitTab`, `CockpitTrigger` extension points plus the shared `WorktreeAction`, `SnapshotRef`, `AuditEvent` types that approval-queue, replay-timeline, and permissions-audit will all import. Includes `registerWidget`, `registerTab`, `registerTrigger`, and `registerSidebarScript` functions backed by module-private append-only registries. Zero external dependencies.
- **Webview bridge for sibling scripts.** `media/sidebar.js` now exposes `window.cockpit.registerComponent(id, def)` and an `EXTERNAL_COMPONENTS` map adjacent to the existing `COMPONENTS` registry. `tabBodyComposed()` falls back to `EXTERNAL_COMPONENTS` so Phase-1 features can register widgets without editing the COMPONENTS literal. The sidebar provider's `html()` walks `listSidebarScripts()` and emits one nonce-tagged `<script>` per registered path, preserving the existing CSP (`connect-src 'none'`). `registerSidebarStyle()` now ships sibling stylesheets the same way.
- **Approval queue + rollback (`src/approvalQueue.ts`, `src/snapshot.ts`).** Phase 1 trust gate. Every `WorktreeAction` lands in `~/.claude/.cockpit/queue.json` (atomic write + fsync). The new `Approve` tab lists pending entries, expands per-entry to show `filesAffected`, and offers Approve / Reject / Revert buttons. Snapshots cover only the declared files, are content-addressed under `~/.claude/.cockpit/snapshots/<id>/files/<sha256>`, and capture/restore are atomic via tmp + rename. Rollback verifies sha256 drift before overwriting; drifted files are skipped unless the user explicitly forces (modal confirmation). The existing `jarvis.ts` boo-mesh approval flow is now ONE source of N: jarvis pending approvals appear in the queue tab with a `jarvis` pill alongside Cockpit-source entries, and approving / rejecting a `jarvis:*` entry forwards to `decideApproval()` so the v0.21.0 `showInformationMessage` notification path keeps working byte-for-byte. New commands: `claudeCockpit.approval.openQueue`, `bulkApprove`, `bulkReject`, `revertLast`. New settings: `claudeCockpit.approval.autoSnapshot`, `snapshotMaxBytes`, `requireForToolNames`. New widgets registered via the Phase-0 bridge: `approvalQueue`, `approvalDetail` (no edits to the `COMPONENTS` literal). Snapshot payload carries only `approvalCounts: { pending, recent }` — full queue is fetched lazily via the `approval.fetchQueue` round-trip to keep the host→webview JSON small.

<!-- skill-gallery (Phase 1) -->
- **Skill / agent gallery tab (`src/gallery.ts` + `media/sidebar.gallery.js`)** — new Gallery tab listing every skill in `~/.claude/skills/`, every plugin-cached skill, and every agent in `~/.claude/agents/` (global + workspace). Reuses the existing `listSkills` and `readAgents` readers — no duplicated frontmatter parsing. Items are searchable by name/description/origin and filterable by kind (skills vs agents). Lazy-loaded via the `gallery.openLocal` message round-trip; the snapshot itself only carries the `{skillCount, agentCount, totalCount}` summary so payload size stays flat.
- **Share-via-clipboard.** Each row's "Share" button copies a portable manifest to the clipboard: a Cockpit signature header (kind, origin, sharedAt, publishTo URL) followed by the original SKILL.md frontmatter + body verbatim. The header is a markdown comment so it doesn't shadow the `---` frontmatter — recipients can paste the result straight into the eventual cockpit-skills registry issue template.
- **Install from HTTPS URL.** Paste a public URL (GitHub raw, registry mirror); the extension fetches it host-side, computes SHA256, and shows a preview (URL, SHA256, byte count, first 1KB). Confirming pops a modal warning, re-fetches, re-hashes, and rejects with `SHA256 mismatch` if the bytes drift between preview and confirm. Rejects `http://`, malformed URLs, and 4xx/5xx responses. Writes to `~/.claude/skills/<inferred-slug>/SKILL.md` only after the user confirms.
- **Two new commands.** `claudeCockpit.gallery.openTab` jumps to the Gallery tab; `claudeCockpit.gallery.installFromUrl` prompts for an HTTPS URL and routes through the same preview/confirm flow.
- **Snapshot extension.** `CockpitSnapshot.gallery?` (optional) — `{skillCount, agentCount, totalCount}`. Phase-1 worktrees can grow this without breaking pre-existing call sites that build snapshots literally.
<!-- worktree: feat/launch-tab-system-v2 -->

- **Tab system v2 — pin / hide / drag-reorder + named layout presets.** Right-click any tab for `Pin tab` / `Hide tab` / `Save current layout as…` / `Load <preset>` / `Pop out fullscreen`. Drag any tab onto another to reorder; the order persists across reloads via globalState. Layout presets capture the current tab order, pin set, and hidden set under a name (e.g. "Coding", "Research", "Reviewing PRs"). Layout state lives in globalState — the sidebar view and the pop-out fullscreen panel share one source of truth, so a preset loaded in either surface updates both.
- **Pop-out fullscreen panel (`vscode.window.createWebviewPanel`).** Run `Claude Cockpit: Pop Out Fullscreen Grid` from the command palette to open a dedicated webview panel that renders every visible tab as a card in a 4-column grid. Same html() output as the sidebar view, same message bus, same provider — no parallel state. Closing the panel doesn't disturb the sidebar webview.
- **Keyboard nav.** `cmd/ctrl+1..9` jump to tab 1..9 in the user's CURRENT visible order; `claudeCockpit.tab.next` / `.tab.prev` cycle. Bindings are scoped via `when: focusedView == claudeCockpit.sidebar` so they don't conflict with VSCode's tab switcher.
- **`media/sidebar.layout.js`** — sibling script that owns drag handlers, the right-click context menu, and the keyboard-shortcut listener. Loaded as a `<script>` next to `sidebar.js` with the same nonce so the existing CSP (`connect-src 'none'`) is unchanged.
- **`src/tabLayout.ts`** — pure host-side helpers (`saveLayout`, `loadLayout`, `deleteLayout`, `pinTab`, `hideTab`, `reorderTabs`, `applyOverlay`) extracted so layout-state mutations are unit-testable without booting the extension host.
- 12 new commands (`claudeCockpit.layout.save`, `.load`, `.popOut`, `.tab.next`, `.tab.prev`, `.tab.1..9`).
- **Webview bridge for sibling scripts.** `media/sidebar.js` now exposes `window.cockpit.registerComponent(id, def)` and an `EXTERNAL_COMPONENTS` map adjacent to the existing `COMPONENTS` registry. `tabBodyComposed()` falls back to `EXTERNAL_COMPONENTS` so Phase-1 features can register widgets without editing the COMPONENTS literal. The sidebar provider's `html()` walks `listSidebarScripts()` and emits one nonce-tagged `<script>` per registered path, preserving the existing CSP (`connect-src 'none'`).
- **Replay timeline + cost projection** (`src/sessionDiff.ts`, `src/replay.ts`, `media/sidebar.replay.js`) — Phase 1 of the v1.0 launch wave. Adds a Replay tab that scrubs through every event of the active session JSONL, reconstructs file states at each step from `Edit` / `Write` / `MultiEdit` blocks, emits unified diffs between any two scrub points, and forks the JSONL prefix into `~/.claude/.cockpit/forks/<session>-fork-<ts>.jsonl` (read-only — never mutates the original). Subsumes the launch wave's "cost telemetry + budgets" feature: a new `replayCostProjection` widget surfaces spent / per-event / projected USD over the next 50 events, with a warning banner when the projection would push the user past their `claudeCockpit.budget.dailyCapUsd`. Diff engine caches parses by `(sessionFile, mtime, size)` so repeated renders never re-read the JSONL. New setting: `claudeCockpit.replay.maxEventsPerSession` (default 5000). New commands: `claudeCockpit.replay.openCurrent`, `claudeCockpit.replay.exportDiff`. Tolerates truncated last-line in JSONL (Claude Code may be mid-write) and silently drops single corrupt entries.

### Notes

- Phase 0 is pure plumbing — no new tabs, widgets, or message types. Until a Phase-1 worktree registers something, every existing tab renders byte-identical to v0.21.0.
- Skill-gallery v1.0 ships **local browse + clipboard share + install-by-URL** only. The public registry server and one-click publish are deferred to v1.1 (the registry repo doesn't exist yet — the Share button points at the planned `cockpit-skills` GitHub issue template).

## [Unreleased] — feat/launch-permissions-audit

### Added

- **Permissions audit log (`src/auditLog.ts`)** — Phase 1 of the v1.0 launch wave. NDJSON log at `~/.claude/.cockpit/audit.log` with append-and-fsync atomicity, 50 MB rotation across five archives, 8 KB per-line cap, and detail-level redaction guarantees enforced at call sites. Public surface: `appendAuditEvent`, `readAuditTail`, `searchAudit`, `outboundDomainTail`, `readAuditSnapshot`, `clearAuditLog`. Opt-in via `claudeCockpit.audit.enabled` (default `true`); when disabled, every append is a zero-cost no-op so v0.21.0 behaviour is preserved.
- **Security tab Keys / Outbound / Audit-log sub-views** (`media/sidebar.audit.js`). Three new sub-tabs inside the existing Security tab, all rendered through the Phase-0 `EXTERNAL_COMPONENTS` bridge — no edits to the COMPONENTS literal, no new top-level tab. Keys uses VS Code `SecretStorage` (Keychain / libsecret / DPAPI) so values are encrypted at rest and never serialised to the webview; Outbound rolls up `outboundDomainTail()` over the audit log; Audit-log surfaces a searchable, exportable table of recent events.
- **Outbound network monitoring at six call sites** — `discover.ts:fetchGithubTrending`, `discover.ts:httpGet`, `updateCheck.ts:fetchLatestRelease`, `integrations.ts:ping`, `integrations.ts:httpsHead`, `roadmap.ts:getJson`. Each emits a single `appendAuditEvent({ kind: 'net.outbound', ... })` immediately before the underlying `https.get / http.request` call. Detail is restricted to `host`, `method`, and `purpose` — never paths, query strings, or response bodies.
- **Snapshot extension** — `CockpitSnapshot.audit?: { last24h: number; lastDomain?: string }`. Cheap rollup wired through `recordTime('snapshot.audit', ...)` so the Security tab can render the 24h count without a round-trip; full payload is fetched lazily via `audit.refresh`. Optional field — every existing tab in v0.21.0 still renders byte-identical when `claudeCockpit.audit.enabled = false`.
- **Two new commands** — `claudeCockpit.audit.export` (jumps to Security tab) and `claudeCockpit.keys.add` (interactive key add via `vscode.SecretStorage`).
- **One new setting** — `claudeCockpit.audit.enabled` (boolean, default `true`).

## [Unreleased] — feat/launch-a11y-theme

### Added

- **`media/sidebar.themes.css`** — three palettes layered on top of `sidebar.css`: a contrast-strengthened light theme (status colors darkened from `#e25c5c`/`#ffa05a` to `#c52f2f`/`#b15c00` for AA on white), a strengthened dark theme (`#ff6b6b` red and `#ffb070` warn for ≥4.5:1 on `#0d1117`), and a brand-new **`high-contrast` palette** (`body[data-theme="high-contrast"]`) targeting WCAG AAA: pure-black background, pure-white text, `#58a6ff` link (8.36:1), `#2ee066` success (9.4:1), `#ff8080` danger (7.1:1). Linked second in `sidebarProvider.html()` so its rules win on tie. Empty `data-theme="auto"` users see zero change.
- **`high-contrast` enum value** in `claudeCockpit.theme` (package.json) and a corresponding fourth radio in the Customize panel ("High contrast (WCAG AAA)"). The `CockpitTheme` type in `sidebarProvider.ts` and the `data-theme-set` validator in `sidebar.js` accept the new value end-to-end.
- **`prefers-reduced-motion: reduce` honored across the whole sidebar.** Added a universal selector at the top of `sidebar.css` that collapses `animation-duration` and `transition-duration` to ~0ms (per WCAG 2.1 SC 2.3.3). This disables the live-dot pulse, `cockpit-pulse` keyframe, and every CSS transition. Talk's canvas-driven particle visualization (`requestAnimationFrame`) checks `matchMedia('(prefers-reduced-motion: reduce)')` in `Talk.init()` and paints a single static frame instead of starting the rAF loop.
- **Global `:focus-visible` ring.** Keyboard navigation now paints a 2px `--vscode-focusBorder` outline on every interactive element; mouse clicks don't. Plus a `.cockpit-a11y-focus-ring` opt-in helper class for Phase-1 worktrees.
- **`.cockpit-a11y-sr-only` utility class.** Visually-hidden content that stays in the accessibility tree (so screen readers announce it). Available to all Phase-1 features under the `cockpit-a11y-` namespace.

### Changed

- **Tab bar a11y.** `<nav class="tabs" role="tablist">` now carries `aria-label="Cockpit tabs"`. Each tab button gets an `aria-label` (label + `(requires active session)` when applicable), a roving `tabindex` (`0` for active, `-1` for inactive — matches the WAI-ARIA tab pattern), and the inline-SVG icon plus the `requiresCwd` dot are now `aria-hidden="true" focusable="false"` so screen readers announce only the visible label.
- **Header strip a11y.** `<header role="banner">`, search wrapper `role="search"`, search input `aria-label="Search Cockpit"`, and the icon-only buttons (`⚙`, `?`, `✕`) now have `aria-label` attributes (`"Customize widgets, tabs, and theme"` / `"Open Help tab"` / `"Clear search"`) so they're no longer announced as just "button".
- **Theme radio group.** Wrapped in `role="radiogroup"` with `aria-labelledby` pointing at the new `<h3 id="cockpit-theme-heading">Theme</h3>`, and each radio carries an `aria-label`.

### Notes

- Pure additive: zero existing palette colors removed. Users on `theme: 'auto'` (the default) still inherit VSCode's theme via `--vscode-*` variables and see no visual change.
- No new tests required — visual change only. Baseline 47/47 still passes.

## [Unreleased] — feat/launch-obsidian-graph

### Changed (obsidian-graph, Phase 1)

- **Obsidian tab now renders a real-time vault graph** instead of the recent-notes list. Powered by a vendored 63 KB `d3-force` build at `media/vendor/d3.min.js` (no CDN, no new npm runtime dep) and a sibling renderer `media/sidebar.graph.js` registered via the Phase-0 `registerSidebarScript` bridge. Nodes = notes, edges = `[[wikilinks]]`, click any node opens it in Obsidian via `obsidian://open?vault=...&file=...`. Pan/zoom/drag built in. Files Claude touched in the active session render in the accent color.
- **`src/graph.ts`** — vault walker, wikilink parser (handles `[[link]]`, `[[link|alias]]`, `[[link#section]]`, fenced-code-block exclusion), edge resolver (basename + path forms, ghost nodes for dangling links), and a `~/.claude/.cockpit/graph-cache-<vaultId>.json` cache keyed on the highest `.md` mtime so warm loads are sub-10 ms on a 5 k-note vault.
- **Snapshot extension** — `CockpitSnapshot.obsidianGraph` is an OPTIONAL `{ nodeCount, edgeCount, vault }` summary. The full `{ nodes, edges }` payload (potentially megabytes) is lazy-loaded via a `graph.refresh` → `graph.payload` round-trip, so the regular cockpit snapshot stays small.
- **New command** — `claudeCockpit.obsidian.refreshGraph` (Command Palette: "Claude Cockpit: Refresh Obsidian Graph") opens the sidebar, switches to the Obsidian tab, and triggers a fresh build.
- **Inbound message types** — `graph.refresh`, `graph.openInObsidian`, `graph.pickVault` (the last one is a v1.1 placeholder for a vault picker UI; v1.0 ships using the primary vault from `readObsidianStatus`).
- Tab system v2 preserves byte-identical default rendering when no layout pref is active: `getEnabledTabIds()` returns the unmodified base list whenever `pinnedTabs`, `hiddenTabs`, and `tabOrder` are all unset.
- Approval queue is observability + revert; ENFORCEMENT (blocking the underlying agent at PreToolUse) is left to user-configured hooks. v1.1 will ship a stock hook recipe.
- Manual cleanup if reverting the queue feature: `rm -rf ~/.claude/.cockpit/snapshots/ ~/.claude/.cockpit/queue.json`. The dir is self-contained and inert without the extension running.
- Replay's "fork" is an EXPORT, not a Claude Code session handoff. Claude Code's session loader walks `~/.claude/projects/<encoded-cwd>/` only — to actually resume from a fork the user must `cp` the file into their project dir under a new uuid (or wait for `claude --resume <fork-path>` if/when it lands). The fork file is a faithful transcript prefix the user can replay, audit, share, or graft.

</details>

## [0.21.0] — 2026-05-06

### Fixed

- Talk widget no longer leaks ResizeObserver / AudioContext on refresh.
- Recommendations dropdown actions now route to the correct tab ids (library/settings) instead of falling back to a default tab.
- Roadmap auto-fetch fires on the `'timeline'` tab id (tab was renamed in v0.17.0).
- Manage tab no longer renders the literal string `"undefined"` for missing config keys.
- Tab bar sticky positioning fixed — was clipping 12px of content on scroll.
- Welcome dismiss / reset-first-run / goto-tab now re-render the sidebar instantly.
- Per-day cost attribution now correctly splits cost across model families instead of attributing the whole day to whichever model logged last.
- Wispr shortcut config validated against an injection-safe whitelist before AppleScript dispatch.
- `runRoutine` validates the routine name against a strict regex to block path traversal.
- App-usage tracker no longer leaks the polling timer on extension reload; uses local timezone consistently for both the day key and hourly buckets.
- `httpGet` caps response bodies at 2 MB and follows up to 5 redirects.
- Git branch detection now works inside worktrees (parses `gitdir:` from the `.git` file).
- Mac Health network parser tolerates macOS Sequoia layout variations.
- Security scan processes long lines in 2000-char windows instead of skipping them entirely.
- `listProjects` uses the lighter head-only session reader on refresh (was doing one full-file parse per project).
- Health refresh no longer double-runs the full snapshot scan.
- Jarvis dead-code paths removed from the inbound message union.

### Added

- **Tab icons.** Every tab now shows an inline-SVG line icon beside its label. Covers all 20 tabs (now, library, skills, browse, history, timeline, settings, watchtower, search, prompts, talk, security, mac, inbox, agents, chat, discover, welcome, custom, help). Icons use `currentColor` and adapt to both dark and light themes.
- **System Stats cards in the Mac tab.** Five expandable detail cards sit below the existing summary row:
  - **CPU**: total used %, user/sys/idle stacked bar, physical and logical core count, CPU model name (click to copy).
  - **Memory**: pressure %, wired/active/compressed/free stacked bar, swap used and total.
  - **Energy**: battery %, cycle count, design-vs-current health %, AC wattage, time remaining, AC/Battery source pill.
  - **Disk**: main volume percentage plus per-volume mini bars for every mounted volume.
  - **Network**: combined rx/tx KB/s, active interface, SSID, IPv4, and per-interface IP list.
  All cards use the existing tone thresholds (green/amber/red at 75/90 for disk and memory, <15 % unplugged for battery, 100/200 for CPU load). Cards collapse to single column when the sidebar is narrower than 300 px.

## [0.20.2] — 2026-05-06

### Changed
- **Screenshots refreshed.** Hero image now shows the actual v0.20.x surfaces — Welcome (first-run setup), Now (live session with PILOT card + 23 widgets), and the Customize panel (per-tab widget grid). Generated headlessly from a real snapshot via `preview-render.js` + Chromium so the data shown is real, not a mockup. New per-tab archives at `media/screenshots/welcome.png`, `now.png`, `customize.png`.
- Cloudflare Pages site renamed: `claude-cockpit.pages.dev` → `claude-code-cockpit.pages.dev` (matches repo + marketplace identity). Old URL still serves.
- `package.json` `homepage` updated to the new Pages URL.

## [0.20.1] — 2026-05-06

### Changed
- **Repo renamed.** GitHub repo is now [`sboghossian/claude-code-cockpit`](https://github.com/sboghossian/claude-code-cockpit) so it matches the marketplace listing (`dashable.claude-code-cockpit`). GitHub auto-redirects every old `sboghossian/claude-cockpit` URL.
- All source-baked URLs (`updateCheck.ts`, `sidebarProvider.ts`, sidebar.js release-link buttons, README, PRIVACY, landing page, `package.json` repository/badges/qna/bugs/configuration descriptions) now point at the new repo path so the next snapshot doesn't depend on redirect-following.
- Title in README and the marketplace listing renamed to **Claude Code Cockpit** to match the unique marketplace identity (`yurman.claude-cockpit` already owns "Claude Cockpit"; we differentiate to keep listings distinct).

## [0.20.0] — 2026-05-06

### Added
- **Welcome tab + first-run flow.** Brand new users land on a `Welcome` tab with a system-check checklist (Claude data on disk · active session · usage rollups · budget caps · theme) and one-click "Next steps" buttons (Customize widgets · Open settings · Go to Now · Read the docs). Auto-hides after dismissal; restorable via Customize → Visible tabs, or the "Reset welcome" button on the tab itself.
- New extension messages: `markFirstRunComplete`, `resetFirstRun`, `openSettings` (opens VSCode Settings filtered to `@ext:dashable.claude-cockpit`).
- `welcomeBanner` widget registered in the component registry — droppable on any tab.
- `LICENSE` file (MIT, matches `package.json`) so GitHub correctly reports the license.

### Changed
- README install path rewritten as a 90-second quick start (download · install · open Cockpit · run `claude`). Optional-setup section pulls every opt-in toggle into one place.

## [0.19.0] — 2026-05-06

### Added
- **Usage rollups widget** — native multi-period token + cost aggregation across every JSONL under `~/.claude/projects/`, broken into Session / Today / This week / This month / This year / All-time. Progress bars when caps are set; "no cap" hint chip otherwise. Drops into the Now tab under Budget caps and is pickable on any tab.
- **Per-tab widget customization** — every tab is now a composition of widgets the user chooses, not just the Custom tab. New `tabComponents` user-pref (per-tab widget lists). Customize panel grew tab-selector chips + "Reset to default" / "Clear all" buttons per tab. Bespoke tabs (History, Settings, Talk, Library, Browse, etc.) are exposed as composite widgets so any of them can be dropped on any tab.
- 3 new VSCode settings: `claudeCockpit.budget.weeklyCapUsd`, `monthlyCapUsd`, `yearlyCapUsd`.
- mtime+size cache at `~/.claude/cockpit-usage-cache.json` so multi-period rollups reload in ~10ms after the first scan.

### Fixed
- Custom tab now respects "0 widgets selected" — previously emptying the list silently fell back to defaults so you could never have an empty Custom tab.

### Changed
- The big tab-render switch in `sidebar.js` is gone — every tab body is now produced by `tabBodyComposed(snap, tabId)`. No-cwd / active-session paths converged into one renderer; per-component `requiresCwd` plus the auto-blocked-list note replace the old per-tab empty-state copy.
- Talk tab lifecycle (`Talk.init/teardown`) follows the rendered composition, not the active tab id, so you can drop the Talk widget anywhere.

## [0.18.0] — 2026-05-06

### Added

- **Talk tab — Jarvis-grade visualization rewrite.** Multi-layer renderer: drifting parallax dust, two segmented HUD rings, 520-particle Fibonacci sphere, particle streams that emit outward when speaking, soft core glow, scanline highlight. Four modes with distinct color palettes — IDLE (muted blue), LISTENING (cyan), THINKING (violet), SPEAKING (Jarvis amber/gold). Mode indicator overlaid on canvas with monospace label.
- **Speak preview.** New "▶ Speak preview" button drives the speaking-mode viz from a synthetic speech envelope and routes the textarea through `speechSynthesis` so you both *see* the AI-speaking effect and *hear* the text. Works even when the mic API is blocked.
- **Mic-blocked banner.** When VSCode webviews block `getUserMedia` (the default), the Talk tab now shows a clear amber banner telling the user to use Wispr Flow / system dictation, instead of silently failing.

### Fixed

- **RSS folder discovery.** `readRssFromObsidian()` was looking at `rss/`, `Inbox/RSS/`, `50-Inbox/rss/` only. Added the actual path Stephane's vault uses (`30-Knowledge/rss-feeds/`) plus several common variants, and a depth-3 fallback scan that matches any folder named `rss`, `rss-feed`, or `rss-feeds`. Scanner perf hardened for 10k+ file folders: name-sorted DESC slice top-200 then stat, instead of stat-every-file.
- **Prompts auto-mine.** First time you land on the Prompts sub-view of the Library tab with an empty library, mining now kicks off automatically (deferred 100ms so the empty-state UI paints first). Eliminates the "always 0, no idea what to do" footgun.

### Notes

- Local security scan across `~/Documents/Code/` (run once to seed Security tab improvements) found no real leaks. Three repos track non-`.example` `.env` files (`agip-spark`, `haqq-ai`, `haqq-case-theory-sim`) but they contain only `VITE_*` Supabase publishable keys, which are public by design. No private SSH keys, no API tokens, no credentialed URLs.

## [0.17.0] — 2026-05-06

### Added

- **Prompt mining + categories.** The Prompts library was always 0 because nothing populated it. New "Mine recent prompts" button walks `~/.claude/projects/*.jsonl` to surface user prompts that recur across sessions or are substantial one-shots, dedupes by 80-char fingerprint, and lets you bulk-save selected ones. Each prompt now carries a category (legal / build / review / plan / research / infra / other), auto-classified on save by keyword heuristics with per-prompt manual override. Filter chips on the Library tab narrow the list by category.
- **Library tab.** Memory and Prompts merged into one tab with sub-views — both surfaced "reusable text Claude pulls from" and the split was making the user track them separately. Default sub-view is Prompts.
- **Settings tab.** Manage and Config merged into one tab with 8 sub-views: Budget / RTK / Tunnels / Office / Manage / Usage / Disk / Hooks. Both prior tabs were "all the settings" — the split was arbitrary.
- **Timeline tab.** Roadmap (planned) and Changelog (shipped) merged into one tab with two sub-views.
- **History tab.** Search (grep across session JSONL) and Chat (claude.ai exports) merged. Default sub-view is Session search.
- **Browse tab.** Projects (recent project list) and Files (`~/.claude/` browser) merged.
- **Discover expansion.** Discover added Hacker News (Algolia API with day/week/month windowing, hnrss fallback), Product Hunt (Atom feed), and Custom RSS feeds. Custom feeds let the user wire X/LinkedIn via Nitter or RSS-Bridge. All sources stay opt-in — Discover must be enabled before any HTTP call goes out.
- **Security tab.** Local-only audit for tracked `.env` files, hardcoded API keys/tokens in source (14 patterns: AWS, GitHub PAT/OAuth, Stripe, Anthropic, OpenAI, Slack, Google, Cloudflare, Bearer, private keys), MCP servers with inline secrets, and git remote exposure. Findings always show redacted excerpts (first 6 + last 4 chars), never full secrets. "/cso" button launches the gstack `/cso` skill in a terminal for deeper audits (deps CVEs, repo settings, OWASP Top 10).
- **Talk tab.** Voice + text → Claude. 420-particle Fibonacci-distributed sphere on canvas, audio-reactive (radius / hue / rotation respond to mic level). Web Audio API for level capture, Web Speech API for transcription (when available in your VSCode build). Send button pipes the message to a fresh Claude session in a terminal — three modes: new session, --continue, --print background. Optional Wispr Flow handoff via `claudeCockpit.wisprShortcut` config (macOS osascript). Voice never leaves your machine.

### Changed

- Tab count: 23 → 18 (with the two new tabs added). Persisted `enabledTabs` prefs are migrated transparently — old IDs (`memory`, `prompts`, `manage`, `config`, `roadmap`, `changelog`, `chat`, `search`, `projects`, `files`) all route to their merged equivalents. Search index entries now carry `librarySubview` / `settingsSubview` so search hits jump to the right sub-view.
- Webview CSP now allows `media-src 'self' blob:` to enable mic access for the Talk tab. `connect-src 'none'` unchanged — no telemetry path opens.

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
- **Self-update check.** Cockpit periodically polls `api.github.com/repos/sboghossian/claude-code-cockpit/releases/latest` (when `claudeCockpit.updateCheck.enabled = true`, default on). When a newer version is detected, an **Update available** pill appears in the header with a one-click link to the release page.
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

## [0.8.0] — 2025-12-13

### Added

- **Personal OS HUD.** Mac tab — disk, memory pressure, battery, CPU load, Wi-Fi throughput, external drives, Bluetooth peripheral battery rings, application time today (per-app focus tracker with hourly bar chart, sampled while VSCode is running).
- **Help tab.** Plain-language explanations of every tab, every metric, where each data point comes from, and the privacy model.
- Greeting strip + at-a-glance stats grid (streak, active days, peak hour, favorite model, week cost).

## [0.7.0] — 2025-12-12

### Added

- **Plans.** Reads `tasks/todo.md` (and any `tasks/*.md` plan files) and renders checkbox progress per project.
- **Chat surface.** Surfaces Claude.ai conversations from a `claude-data-export/` folder, unifying Chat + Code in one view.
- **Activity heatmap.** 24-hour × 7-day grid showing when you actually code with Claude.
- **Usage dashboard launcher.** Detects whether [phuryn/claude-usage](https://github.com/phuryn/claude-usage) is installed/running and surfaces a one-click launch.

## [0.6.0] — 2025-12-11

### Added

- **Watchtower.** Every Claude Code session touched in the last hour, color-coded green (live) → grey (stale). Click a session to inspect its JSONL.
- **Obsidian integration.** Auto-detects vaults from `~/Library/Application Support/obsidian/obsidian.json`, lists recent notes, save-session-as-markdown action.
- **Recent projects browser** + `~/.claude/` filesystem panel.
- **Cost-by-tool table.** Approximate USD per tool call across the active session.
- **Sub-agent listing** + sub-agent token totals.
- **Pinned memory** with stale-entry flagging.

## [0.5.0]

Skipped — no shipped artifact under this version number.

## [0.4.0] — 2025-12-09

### Added

- **Tabbed UI.** Replaces the single-scroll layout with proper tabs (Now / Watchtower / Memory / Skills / Projects / Files / Config / Help) plus per-tab body composition.
- Five additional widgets: tool histogram, files-touched list, today's totals, MCP server panel, hooks inspector.

## [0.3.0] — 2025-12-08

### Added

- **PILOT card** that auto-detects `<user>_claude.md`, extracts numbered principles, role from frontmatter, "one-liner" quote, plus always-live subdomain dots.
- **Cost tracking.** Token → USD per model family (Opus / Sonnet / Haiku); rates centralized in `claudeData.ts:PRICING`.
- **Live indicator.** Green pulsing dot when session mtime < 10s.
- **Sub-agents view.** Scans `<sessionFile-dir>/<sessionId>/subagents/*.jsonl`.
- **Skill palette.** Reads `~/.claude/skills/*/SKILL.md` + plugin cache; click copies `/<name>` to clipboard.
- **Token sparkline.** Last 60 min bucketed by minute, inline SVG.
- **Memory search.** Filter the memory list by title/hook + a server-side `searchMemory()` for deeper queries.

## [0.2.0]

Skipped — no shipped artifact under this version number.

## [0.1.0] — 2025-12-06

### Added

- **Projects browser.** Cross-project session list (also fixes empty-state when no folder is open).
- **MCP server panel.** Reads `~/.claude/settings.json` (no `~/.claude.json` to avoid credential exposure).
- **Hooks inspector.** Event types + count + command bin names.
- **Sessions are first-class, not workspace folders.** v0.2.0-style refactor for multi-session awareness.

## [0.0.1] — 2025-12-05

### Added

- **Phase 1 — read-only sidebar.** Read active session JSONL from `~/.claude/projects/<encoded-cwd>/*.jsonl`, compute token burn from `usage` blocks, extract files touched from Edit/Write/MultiEdit blocks, parse `MEMORY.md` index. Sidebar webview in the Activity Bar; status bar items for cwd basename, total tokens, files touched. Live updates via `fs.watch`. First public release.
