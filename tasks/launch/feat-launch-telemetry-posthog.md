# feat/launch-telemetry-posthog  (Phase 2, M, ~500 LOC)

## Goal

Opt-in usage analytics + opt-in crash reporting via PostHog (HAQQ pattern,
but in a NEW PostHog project — `cockpit-extension`, not the HAQQ Legal
AI project 92178). Default OFF. When opted in, captures: extension
version, tab views, command invocations, crash stacks (trimmed to
extension code only), session duration. NEVER captures: file paths,
prompt text, session content, audit log contents, secrets, file diffs.

Also wires "telemetry" into the Self tab as live counters (already exists
via `getTelemetrySnapshot` in telemetry.ts) plus a "PostHog: connected
| disabled" pill.

## In-scope files

- NEW `src/posthog.ts` — minimal PostHog client (no @posthog/node dep
  to keep the .vsix small; raw https.post to /capture/). ~250 LOC.
- NEW `src/crash.ts` — wraps every async entry point with a try/catch
  that captures stack-only via posthog.capture('crash', { ... }).
  Hooks: `activate()` body, every `recordAsync` callsite, the
  webview message handler. ~150 LOC.
- `src/extension.ts:26–231` — wrap `activate()` body in a top-level
  try/catch that calls `crash.captureActivationFailure(err)`.
- `src/sidebarProvider.ts:574` — wrap `handle()` body in
  `crash.captureMessageFailure(msg.type, err)`.
- `src/sidebarProvider.ts:55–131` — append messages: `telemetry.optIn |
   telemetry.optOut | telemetry.status`.
- `src/claudeData.ts:191–230` — add OPTIONAL `telemetryEnabled?: boolean`
  to CockpitSnapshot.
- `media/sidebar.js:helpSection / selfTelemetrySection` — add an opt-in
  toggle and a one-paragraph explanation of what's captured.
- `package.json:111–199` — add 2 settings:
  `claudeCockpit.telemetry.enabled` (bool, default false),
  `claudeCockpit.telemetry.crashReports` (bool, default false).
- `package.json:76–110` — add 1 command: `claudeCockpit.telemetry.toggle`.
- `PRIVACY.md` — append a section listing exactly which events are
  captured. (PRIVACY.md exists at the repo root.)
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT enable by default. Do NOT prompt aggressively. The toggle lives
  in Settings + a one-time dismissable banner in the Welcome tab.
- Do NOT capture from inside the webview directly. All events flow:
  webview → postMessage → sidebarProvider → posthog.capture (Node host).
  Webview CSP stays `connect-src 'none'`.
- Do NOT mix with the HAQQ Legal AI PostHog project. New project.

## Dependencies

- `plugin.ts:AuditEvent`, `ExtensionPointEvent` (Phase 0) — every
  feature's significant action emits a typed event; telemetry-posthog
  hooks them.
- `auditLog.ts:appendAuditEvent` (permissions-audit) — telemetry events
  also write to the local audit log so the user can SEE what was sent.

## Acceptance criteria

- [ ] Off by default. Cold install → 0 outbound to PostHog.
- [ ] When enabled, captures `tab.view`, `command.invoke`, `crash`,
  `session.duration` events. Verified by inspecting the audit log
  for `kind: 'net.outbound', detail.host: 'app.posthog.com'` entries.
- [ ] Crash report: forces an exception in activate() (test mode), see
  the stack arrives in PostHog. The stack must include only paths
  starting with `/extension/out/` (no user paths).
- [ ] PRIVACY.md is updated; the WELCOME tab has a one-paragraph
  disclosure linking to PRIVACY.md.
- [ ] `npm test` green; 3 new tests for posthog.ts (opt-out → no-op,
  payload shape, redaction of file paths).

## Test plan

Unit:
- Capture call with telemetry off → returns immediately.
- Capture with file-path argument → path is removed.
- Capture with stack trace containing /Users/... → paths anonymized.

Manual:
- Toggle on, click around 5 tabs, confirm PostHog dashboard shows 5
  `tab.view` events with correct version.
- Toggle off, click around again, confirm no new events.

## Rollback plan

Revert. Settings retain the user's opt-in choice (which is fine — they
chose opt-in deliberately).
