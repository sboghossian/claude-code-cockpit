# Launch Wave Dispatch Plan

## Phase 0 (alone on main)

| Worktree                   | Agent type                | Why                                          |
|-----------------------------|---------------------------|----------------------------------------------|
| feat/launch-plugin-api      | senior-software-engineer  | Pure architecture / API design.              |

## Phase 1 (run in parallel)

All 7 below branch off the merged Phase-0 commit. Spawn simultaneously.
The merge order in PLAN.md handles linearization back into main.

| Worktree                       | Agent type                | Notes                                                                 |
|---------------------------------|---------------------------|-----------------------------------------------------------------------|
| feat/launch-a11y-theme          | ux-designer               | CSS / WCAG / palette work. Senior-eng for the focus-visible JS edits. |
| feat/launch-permissions-audit   | senior-software-engineer  | New file logger + Security tab sub-views. Touches 12 wrap sites.      |
| feat/launch-skill-gallery       | senior-software-engineer  | New tab. Reuses listSkills, readAgents.                              |
| feat/launch-tab-system-v2       | senior-software-engineer  | Heavy sidebar.js edits. Pop-out via createWebviewPanel.              |
| feat/launch-obsidian-graph      | senior-software-engineer  | d3-force vendored. Replaces obsidianSection.                         |
| feat/launch-approval-queue      | senior-software-engineer  | XL. Filesystem snapshot + watcher + new tab.                         |
| feat/launch-replay-timeline     | senior-software-engineer  | XL. JSONL diff engine + scrubber UI.                                 |

After all 7 merge, run `code-reviewer` agent against the integrated
main branch BEFORE starting Phase 2. Gate: zero TypeScript errors,
all v0.21.0 tabs render, npm test ≥42 green plus all new tests green.

## Phase 2 (sequential, in order)

| Worktree                       | Agent type                | Notes                                                       |
|---------------------------------|---------------------------|-------------------------------------------------------------|
| feat/launch-onboarding-sandbox  | senior-software-engineer  | Wires status bar + notifications + tutorial. Plus ux-designer for the welcome banner copy. |
| feat/launch-telemetry-posthog   | senior-software-engineer  | Wraps every Phase-1 surface. Lands after them.              |
| feat/launch-mobile-companion    | senior-software-engineer  | Lands LAST. Read-only mobile view.                          |

## Final gate (before tagging v1.0.0)

| Agent type                | Task                                               |
|---------------------------|----------------------------------------------------|
| code-reviewer             | /review against main vs origin/v0.21.0.            |
| senior-software-engineer  | /qa report-only across all 22 tabs.                |
| ux-designer               | /design-review across every new tab.               |
| senior-software-engineer  | /cso security audit.                               |
| senior-software-engineer  | Bump VERSION in package.json:5 to 1.0.0, run
                              `vsce package`, smoke-install the .vsix.            |

## Parallel-safety reminder for the dispatcher

- Phase 1 worktrees ALL share these files: sidebarProvider.ts,
  claudeData.ts, package.json, media/sidebar.js, media/sidebar.css,
  CHANGELOG.md, tasks/todo.md.
- Each worktree's brief specifies the EXACT line ranges + the
  EXACT block label its edits live in. Reviewers reject any PR that
  edits outside its declared window.
- Approvers verify: (a) widgets registered via
  `registerExternalComponent`, NOT inserted into the COMPONENTS literal;
  (b) message types use the worktree's namespace prefix
  (`approval.*`, `gallery.*`, `audit.*`, ...); (c) snapshot keys
  optional + lazily computed.
