# feat/launch-onboarding-sandbox  (Phase 2, L, ~800 LOC)

## Goal

Combines four originally-separate items because they all share the same
"first impression / activation" surface:
- (6) First-run interactive demo: a 3-min Talk + agent + obsidian-graph
  flow on a FAKE project so the user sees the cockpit working before
  pointing it at their real code.
- (7) Status bar widget + command palette: extend statusBar.ts (already
  55 lines) with approval-queue count, audit count, replay shortcut.
  Add 6 high-value command palette commands.
- (8) Desktop notifications: `vscode.window.showInformationMessage` for
  agent finishing, approvals waiting, builds failing. Pattern lifted
  from sidebarProvider.ts:300–319 jarvis flow.
- (9) Tutorial tab with action recommendations: pulls from existing
  `computeRecommendations` (claudeData.ts:2758) and the prompt-mining
  output (`minePrompts`); surfaces "You ran /qa 4 times this week — try
  /qa --report-only" style nudges. New TAB.

## In-scope files

- NEW `src/sandbox.ts` — synthesizes a fake project at
  `~/.claude/.cockpit/sandbox/demo-project/`, populates a 30-event
  fake session JSONL, then redirects `findActiveSession` to point at
  it for the duration of the demo. Uses an env override flag set in
  globalState. ~300 LOC.
- NEW `src/notifications.ts` — central registry for desktop
  notifications, debouncing, "don't ask again" memory. ~200 LOC.
- NEW `media/sidebar.tutorial.js` — Tutorial tab UI (recommendation
  cards + "try this command" buttons). ~300 LOC.
- `src/statusBar.ts:1–55` — extend with three more StatusBarItems:
  `approvalCountItem` (shows pending count + click → approval tab),
  `auditAlertItem` (shows red dot if last 24h audit had a blocked
  action), `talkLauncherItem` (click → talk tab). Keep existing items.
- `src/extension.ts:26–231` — register 6 more commands, wire
  notifications watcher.
- `src/sidebarProvider.ts:55–131` — append messages: `tutorial.dismiss |
   tutorial.runCommand | sandbox.start | sandbox.exit`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `media/sidebar.js:welcomeBannerSection (line 401)` — add a "Start
  3-min demo" button that triggers `sandbox.start`.
- `media/sidebar.js:3525–3553` — add `tutorial: ['tutorialRecs']`.
- `media/sidebar.js:3589–3611` — append Tutorial tab catalog entry.
- `package.json:76–110` — add 6 commands:
  `claudeCockpit.sandbox.start`, `claudeCockpit.tutorial.open`,
  `claudeCockpit.replay.open`, `claudeCockpit.approval.open`,
  `claudeCockpit.audit.open`, `claudeCockpit.gallery.open`.
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT auto-launch the sandbox. User must click "Start 3-min demo"
  in welcome tab.
- Do NOT create new VS Code views; the sandbox repurposes the existing
  sidebar. The "fake project" simply makes the active session point at
  the synthesized JSONL.
- Do NOT introduce new keybindings here — feat/launch-tab-system-v2
  owns the keyboard-first nav.

## Dependencies

- approval-queue: read `pendingApprovalsCount` for status bar widget.
- permissions-audit: read `auditCounts.last24h` for the alert dot.
- replay-timeline: status-bar Talk button + tutorial recommends "scrub
  yesterday's session" action.
- All Phase-0 contracts.

## Acceptance criteria

- [ ] First-run user clicks "Start 3-min demo" in Welcome → sandbox
  loads, sees Now/Talk/Watchtower populated with synthetic data,
  walkthrough tooltip steps user through Talk (says hi to a fake echo
  agent), Approval (one fake action queued), Replay (scrubs the fake
  session). 5 steps, dismissable.
- [ ] Status bar adds 3 new items, all clickable.
- [ ] Desktop notifications fire when: a non-empty approval queue
  goes from 0→1, an audit `kind: 'tool.invoke'` with `outcome: 'blocked'`
  fires, a replay session ends with `cost > daily cap * 0.8`. All
  debounced 30s.
- [ ] Tutorial tab populates with at least 5 recommendations on Stephane's
  real session history (his computeRecommendations output).
- [ ] `npm test` green; 4 new tests (sandbox synth shape, notifications
  debounce, tutorial recommendation ordering, status-bar update on
  approval-count change).

## Test plan

Unit:
- Sandbox JSONL passes the existing parseLine() validator.
- Notifications fire at most once per 30s window.

Manual:
- Cold install on a fresh user (no prior cockpit state). Click "Start
  3-min demo." Walk the 5 steps. Confirm "exit demo" returns to the
  user's real project state.

## Rollback plan

Revert. Sandbox dir at `~/.claude/.cockpit/sandbox/` is removable.
