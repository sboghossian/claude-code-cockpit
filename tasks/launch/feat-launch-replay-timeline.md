# feat/launch-replay-timeline  (Phase 1, XL, ~1300 LOC)

## Goal

Scrub backwards through any Claude session. The session JSONL already
records every tool call, every diff, every prompt — we just need a UI
that lets the user drag a timeline slider and see (a) the cumulative
diff at any point, (b) which files were touched, (c) what tokens/cost
had accumulated, and (d) a "Fork from here" button that copies the
session JSONL up to that index into a new session ID. Also extends the
existing budget telemetry: per-step cost, projected spend on the next
expensive action, daily/monthly cap projections.

## In-scope files

- NEW `src/replay.ts` — session JSONL → timeline events. Reuses the
  existing `parseLine` (claudeData.ts:460) and `readSession`
  (claudeData.ts:512). ~400 LOC.
- NEW `src/sessionDiff.ts` — given two indices into the session events,
  produce a unified diff per touched file. Uses `Edit`/`Write`/`MultiEdit`
  tool_use args directly (they include the literal text). ~350 LOC.
- NEW `media/sidebar.replay.js` — replay scrubber UI + diff viewer.
  Registers `replayScrubber`, `replayDiff`, `replayCostProjection`
  widgets via Phase-0 API. ~400 LOC.
- `src/sidebarProvider.ts:55–131` — append messages:
  `replay.loadSession | replay.scrubTo | replay.fork | replay.exportDiff`.
- `src/sidebarProvider.ts:574–1063` — append handler cases.
- `src/claudeData.ts:191–230` — add OPTIONAL `replayIndex?: ReplayIndex`
  carrying just the count + last 5 events for snapshot-time previews.
- `media/sidebar.js:3525–3553` — add `replay: ['replayScrubber', 'replayDiff', 'replayCostProjection']`.
- `media/sidebar.js:3589–3611` — append tab catalogue entry; reuse
  history icon style.
- `package.json:76–110` — add 2 commands: `claudeCockpit.replay.openCurrent`,
  `claudeCockpit.replay.exportDiff`.
- `package.json:111–199` — add 1 setting:
  `claudeCockpit.replay.maxEventsPerSession` (number, default 5000).
- `CHANGELOG.md`, `tasks/todo.md` — append worktree sections.

## Out-of-scope

- Do NOT mutate session JSONL. Replay is read-only.
- Fork = copy current JSONL to `~/.claude/.cockpit/forks/<sessionId>-fork-<ts>.jsonl`,
  truncated to the chosen index. Do NOT register the fork as an active
  session — surfaces only in the replay tab as a "forked" pill.
- Cost projection is heuristic (avg cost per future tool call ×
  remaining steps in plan); do not implement a full LLM budget simulator.

## Dependencies

- `plugin.ts:registerExternalComponent` (Phase 0).
- Existing `claudeData.ts:readSession`, `parseLine`, `computeCost` —
  already exported.
- SOFT: approvalQueue.ts:`SnapshotRef` for "show snapshot at this point
  in the timeline" — degrades gracefully if approval-queue not merged.

## Acceptance criteria

- [ ] Replay tab loads the active session in <500ms for sessions up to
  10,000 events.
- [ ] Scrubber slider drags through events at 60fps.
- [ ] Selecting two scrub points produces a unified diff for every
  touched file in <300ms.
- [ ] Fork creates a new file under `~/.claude/.cockpit/forks/`; the
  filename is reported as a clickable link.
- [ ] Cost projection card shows: spent-so-far, projected-end-of-session
  (linear extrapolation of cost-per-event over the next 50 events),
  budget cap proximity (using existing `BudgetStatus`).
- [ ] `npm test` green; 5 new tests for sessionDiff.ts (single-edit,
  multi-edit ordering, write-then-edit, conflicting writes, malformed line).

## Test plan

Unit:
- Diff between event 10 and event 50 of a fixture JSONL (test/fixtures/replay.jsonl).
- Forked file truncated to exactly the chosen index.
- Cost projection over a fixture session matches manual computation
  ±10%.

Manual:
- Open a real session with 1k+ events; drag the slider end-to-end.
- Fork; verify the fork JSONL parses cleanly via the existing parser.

## Rollback plan

Revert. The forks dir is self-contained; user can `rm -rf` it.
