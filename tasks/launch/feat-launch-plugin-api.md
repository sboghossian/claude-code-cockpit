# feat/launch-plugin-api  (Phase 0, S, ~250 LOC)

## Goal

Define the formal extension contract that every Phase-1 feature consumes.
One TypeScript module declares the surface area: tabs, widgets, triggers,
sidebar panels, snapshot keys. Also declare the shared types
(`WorktreeAction`, `Snapshot`, `RollbackPlan`, `AuditEvent`) that
approval-queue, replay-timeline, and permissions-audit will all import,
so we don't end up with three near-identical type definitions.

This worktree exists ENTIRELY to eliminate Phase-1 conflicts on
`media/sidebar.js`'s COMPONENTS registry.

## In-scope files

- NEW `/Users/stephaneboghossian/Documents/Code/claude-cockpit/src/plugin.ts` —
  the public extension API (~150 LOC).
- `src/sidebarProvider.ts:1109–1132` — `html()` method, append a SECOND
  script tag scaffold that walks `EXTERNAL_SIDEBAR_SCRIPTS` registered
  via `plugin.ts`. Must remain CSP-safe (still nonce-tagged). Only edit
  this exact range.
- `media/sidebar.js:3380–3445` — add `const EXTERNAL_COMPONENTS = {};` and
  `function registerExternalComponent(id, def) { EXTERNAL_COMPONENTS[id] = def; }`
  immediately AFTER the COMPONENTS literal. Modify `tabBodyComposed()`
  (3704) to also look up EXTERNAL_COMPONENTS. No other edits.
- `package.json` — no change.
- `CHANGELOG.md` — add `[Unreleased] - Plugin API foundation` block.
- `tasks/todo.md` — add `## v1.0 — plugin-api` section.

## Out-of-scope

- Do NOT add any new tab, widget, or message type. This worktree is pure
  plumbing.
- Do NOT touch the COMPONENTS literal contents.
- Do NOT touch `claudeData.ts`.

## API contract (this is what other worktrees will import)

```ts
// src/plugin.ts
export interface CockpitWidget {
  id: string;
  label: string;
  category: 'Now' | 'Session' | 'Cross' | 'System' | 'Config' | 'Memory'
          | 'Approval' | 'Replay' | 'Audit' | 'Gallery';
  requiresCwd: boolean;
  /** rendered in the webview; receives the snapshot, returns innerHTML. */
  renderFnName: string;        // looked up by name in EXTERNAL_COMPONENTS at runtime
}
export interface CockpitTab {
  id: string;
  label: string;
  iconSvg: string;             // 24×24 stroke-only currentColor svg
  pinned: boolean;
  requiresCwd: boolean;
  hint: string;
  defaultWidgets: string[];
}
export interface CockpitTrigger {
  command: string;             // e.g. 'claudeCockpit.approval.openQueue'
  title: string;
  keybinding?: string;         // e.g. 'cmd+1'
  whenClause?: string;         // e.g. 'view == claudeCockpit.sidebar'
}
export interface WorktreeAction {       // shared by approval-queue + audit
  id: string;
  worktree: string;            // 'approval-queue' etc
  tool: string;
  argsRedacted: string;
  filesAffected: string[];
  requestedAt: number;
  byAgent: string | undefined;
  expectedDiffBytes: number;
  rollbackable: boolean;
}
export interface SnapshotRef {           // shared by approval-queue + replay
  id: string;
  cwd: string;
  takenAt: number;
  reason: 'pre-action' | 'manual' | 'session-checkpoint';
  paths: string[];
  totalBytes: number;
}
export interface AuditEvent {            // shared by audit + telemetry
  ts: number;
  kind: 'file.read' | 'mcp.call' | 'key.access' | 'net.outbound' | 'tool.invoke';
  detail: Record<string, unknown>;       // redacted, no secrets
  worktree?: string;
}
```

## Acceptance criteria

- [ ] `src/plugin.ts` exports the 5 interfaces above plus `registerWidget`,
  `registerTab`, `registerTrigger` functions that mutate module-private
  arrays.
- [ ] `media/sidebar.js` exposes `window.cockpit.registerComponent(id, def)`
  callable from sibling scripts, populating `EXTERNAL_COMPONENTS`.
- [ ] `tabBodyComposed()` checks both COMPONENTS and EXTERNAL_COMPONENTS.
- [ ] `npm test` 42/42 still green.
- [ ] All v0.21.0 tabs render unchanged in a manual cold-boot smoke test.
- [ ] Zero new dependencies.

## Test plan

- Unit: add `test/plugin.test.js` (4 tests): registerWidget shape check,
  duplicate-id error, registerTab default values, registerTrigger
  command-format validation.
- Manual: install the .vsix, open Cockpit, switch through every tab from
  the v0.21.0 list, confirm pixel-identical output.

## Rollback plan

Revert the merge commit. plugin.ts is a single new file; the only edits
to existing files are <30 lines in sidebar.js + ~5 lines in
sidebarProvider.html(). A revert restores v0.21.0 byte-for-byte.

## Dependencies on other worktrees

- None. This is the foundation.
