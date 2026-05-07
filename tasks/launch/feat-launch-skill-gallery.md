# feat/launch-skill-gallery  (Phase 1, M, ~600 LOC)

## Goal

A new tab listing every skill in `~/.claude/skills/` and every agent in
`~/.claude/agents/`, with a "Share" button that copies the skill markdown
+ frontmatter to clipboard with a header comment about the public registry.
"Install" button accepts a public URL (HTTPS only, GitHub raw or registry
URL) and downloads to `~/.claude/skills/<name>/SKILL.md` after a confirmation
dialog showing the SHA256 and the source URL. The "registry" itself is a
v1.1 deliverable — v1.0 ships browse + share + install-by-URL.

## In-scope files

- NEW `src/gallery.ts` — list local skills + agents with metadata
  (uses existing `listSkills` and `readAgents`); install-from-URL
  function with SHA256 confirmation; share-to-clipboard formatter.
  ~400 LOC.
- NEW `media/sidebar.gallery.js` — Gallery tab UI. ~200 LOC.
- `src/sidebarProvider.ts:55–131` — append messages:
  `gallery.share | gallery.installUrl | gallery.openLocal`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `src/claudeData.ts:191–230` — no change (uses existing skills/agents).
- `media/sidebar.js:3525–3553` — add
  `gallery: ['galleryGrid', 'galleryShareCard']`.
- `media/sidebar.js:3589–3611` — append tab catalog entry.
- `package.json:76–110` — add 2 commands.
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT build a public registry server. v1.0 is local-browse +
  share-via-clipboard + install-by-URL. The "publish" button copies a
  formatted message to clipboard pointing at the GitHub issues template
  for the eventual cockpit-skills registry repo.
- Do NOT write to `~/.claude/skills/` without user confirmation.

## Dependencies

- `plugin.ts:registerExternalComponent` (Phase 0).
- Existing `listSkills` (claudeData.ts:1134), `readAgents` (integrations.ts).

## Acceptance criteria

- [ ] Gallery tab lists Stephane's 93 installed skills + N agents,
  searchable + filterable by source (user / plugin / agent).
- [ ] Share: clicking copies a clean markdown payload (frontmatter +
  body + signature header). Toast confirms.
- [ ] Install: paste URL, see preview (first 1KB + SHA256 + source).
  Confirm installs to `~/.claude/skills/<inferred-name>/SKILL.md`.
- [ ] Install rejects non-HTTPS URLs and 5xx responses.
- [ ] `npm test` green; 3 new tests (share formatter, install-URL
  validation, SHA256 mismatch rejection).

## Test plan

Unit:
- Reject http:// URL.
- Reject URL whose response sha256 doesn't match (test fixture).
- Share output round-trips through parseFrontmatter.

Manual:
- Install a real skill from a github raw URL into a TEMPORARY
  ~/.claude.test/skills/ dir (override via env), verify file exists.

## Rollback plan

Revert. Installed skills stay on disk (intended; they're user content
the user explicitly installed).
