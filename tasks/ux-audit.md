# Cockpit UX/UI audit — 2026-05-10

Captured during the v1.2.0 uplift. Numbers from automated grep on
`media/sidebar.js` (5,548 lines) and `media/sidebar.css` (3,094 lines).

## Inconsistency surface

| Pattern | Count | Severity | Notes |
|---|---:|---|---|
| Inline `style="..."` on JSX-like template strings | 147 | high | Spreads styling across the JS file; impossible to theme cleanly |
| `<p class="empty" style="...">` overrides | 43 | high | Already a class — but every site re-styles font-size |
| `style="font-size: 11px"` (with/without space) | 41 | high | Three different `<p class="empty">` sizes in the wild (default 13px, 11px, 10px) — design fork |
| `style="font-size: 10px"` | 19 | medium | |
| `style="list-style: none; padding: 0;"` on `<ul>` | 13 | medium | Use new `.list-reset` utility instead |
| Off-grid margin values (`6px`, `7px`, `9px`) | 11 | medium | Spacing scale is 2/4/8/12/16; these break rhythm |
| Hardcoded hex colors outside `themes.css` | 4 | low | 3 fixed in v1.2.0 (Bluetooth battery → `--vscode-charts-*`); `#fff` remains in 1 spot |
| Margin-top values (top 3) | 10× `6px`, 10× `2px`, 7× `4px` | medium | Should standardize on 4/8/12/16 |

## Highest-impact migrations (do these first when shipping per-tab work)

### M1 — Replace `<p class="empty" style="font-size: 11px">…</p>` with `<p class="empty empty-hint">…</p>` (43 sites)

Mechanical edit. Lands as one PR. Removes the most common inline style.
After this lands, the next-most-common inline pattern drops to 18 instances.

### M2 — Replace `<ul class="list" style="list-style: none; padding: 0;">` with `<ul class="list list-reset">` (13 sites)

Also mechanical. The `.list` class doesn't do list-reset because some
existing tabs *want* the bullets. Adding `.list-reset` opt-in is safer
than changing `.list`'s defaults.

### M3 — Audit `margin-top: 6px` (10 sites) → either `4px` or `8px`

Each site needs eyeball judgment — pick the closer grid value, screenshot
before/after to confirm no regression.

### M4 — Component primitives

Add render helpers in `media/sidebar.js`:

```js
function card({ title, body, action }) {…}
function stat({ label, value, trend }) {…}
function sectionHead(text, action) {…}
function emptyState({ message, cta }) {…}
```

Then convert one tab at a time (start with **Now** — most-viewed). Each
tab conversion is its own commit so visual regressions are bisectable.

## Per-tab triage (subjective — eyeball needed)

Tabs that feel rough today (per quick scan):

- **Discover** — five separate "Refresh" buttons, no visual hierarchy between sources
- **Manage** — long flat list with no grouping; keys/settings/integrations all run together
- **Roadmap** — search/filter chips wrap awkwardly on narrow widths
- **Approval** — pending count is tiny; the actual queue items are the headline
- **Self / Telemetry** — refresh-cost histogram lives at the bottom; should be top

Tabs that feel solid:

- **Now**, **Today**, **Watchtower** — clean cards, consistent spacing
- **Replay**, **Snapshot** — purpose-built layouts, no inline-style bleed
- **Custom** — composable widget grid is the design north star; other tabs should feel like this

## What v1.2.0 shipped (status)

- ✅ Vertical tab rail with collapse (`⌘B` toggle)
- ✅ `⌘K` global search shortcut
- ✅ Refresh actually re-polls every async source
- ✅ Search v2: recents (10), grouped results (when typeFilter='all'), `↑/↓/Enter` keyboard nav, kbd hints
- ✅ Bluetooth battery colors moved to VS Code chart tokens
- ✅ Utility primitives in CSS (`.empty-hint`, `.empty-mini`, `.list-reset`, `.stack-*`)
- ✅ Brief "Refreshing…" pill in header

## What's still pending (v1.3+)

- Mass migration: M1 + M2 + M3 from above
- Component primitives (M4) + per-tab conversion sweep
- Search v2.5: inline previews on focus (3-line excerpt for memory/session hits)
- Refresh v2: per-source spinner badge on the card whose probe is in flight
- Rail polish: drag-to-reorder validation in collapsed mode, styled tooltips
- Discover/Manage/Roadmap visual rework (tabs called out above)

## Methodology note

Grep audit run from this terminal:

```bash
grep -oE 'style="[^"]+"' media/sidebar.js | sort | uniq -c | sort -rn
grep -oE 'font-size: ?[0-9]+px' media/sidebar.js | sort | uniq -c | sort -rn
grep -oE 'margin-top: ?[0-9]+px' media/sidebar.js | sort | uniq -c | sort -rn
grep -oE '#[0-9a-fA-F]{3,8}' media/sidebar.js | grep -v '&#' | sort -u
```

Re-run after each per-tab migration to track the inline-style count down.
Target for v1.3: under 50 inline `style=` instances. Today: 147.
