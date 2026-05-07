# feat/launch-a11y-theme  (Phase 1, M, ~400 LOC)

## Goal

(15) Themes + accessibility. WCAG AA contrast across both dark + light
themes. Screen-reader pass: every interactive element has a label,
focus order is logical, all SVG icons have `<title>` or `aria-label`.
Plus high-contrast palette and reduced-motion media query.

## In-scope files

- NEW `media/sidebar.themes.css` — three palettes (dark / light /
  high-contrast), all using existing VS Code CSS variables as the base
  layer + project-level overrides. ~300 LOC.
- `media/sidebar.css` — minimal edits (add `:focus-visible` rule, add
  `prefers-reduced-motion` block at the top). ~30 LOC.
- `media/sidebar.js` — add `aria-label` and `role` attributes on every
  interactive element (tabs, buttons, list items). ~70 LOC of small
  edits scattered. The 5099-line file is the conflict risk; this PR
  goes first in merge order to claim the field.
- `src/sidebarProvider.ts:1109–1132 (html())` — add a
  `<link rel="stylesheet" href="sidebar.themes.css">` line.
- `package.json:154–162 (claudeCockpit.theme)` — add `'high-contrast'`
  to the enum.
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT introduce a CSS framework or preprocessor.
- Do NOT remove existing palette colors. Add the high-contrast palette;
  tweak dark/light only where contrast fails AA (target ≥4.5:1 for body
  text, ≥3:1 for large text + UI components).
- Do NOT modify component HTML structure.

## Dependencies

- None. Lands FIRST in Phase 1 merge order to take the sidebar.css
  conflict cost.

## Acceptance criteria

- [ ] WebAIM contrast checker (or equivalent automated tool, manual
  spot-check) reports AA pass on every text element in dark, light,
  and high-contrast themes.
- [ ] VS Code "Accessibility: Tab Through Webview" walks every
  interactive element in a logical order.
- [ ] `prefers-reduced-motion: reduce` disables Talk's particle
  animation, the live-dot pulse, and all CSS keyframe animations.
- [ ] All 20 v0.21.0 tabs still pixel-correct (compare against
  `media/screenshots/now.png` etc.).
- [ ] `npm test` green; no new tests required (visual change only).

## Test plan

Unit: none.

Manual:
- Compare every tab with v0.21.0 screenshots.
- Run with `Reduce Motion` macOS pref on; verify Talk doesn't animate.
- Test screen reader narration on the Now tab + Welcome tab + Talk tab.

## Rollback plan

Revert.
