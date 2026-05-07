# feat/launch-mobile-companion  (Phase 2, L, ~700 LOC)

## Goal

(16) Mobile web app at `mobile.cockpit.dashable.dev` that surfaces the
approval queue. Stephane approves/rejects from his phone. Reads the
queue via a tiny exporter the desktop extension publishes to a local
file readable by Cloudflare Tunnel (already set up — the user's
tunnels are read in `integrations.ts:readTunnels`). The mobile page is
read-only by default; "approve" sends a tailscale-bound HTTP POST that
the desktop extension's local server (hidden behind tailscale) accepts.

V1.0 strategy: ship the mobile READ-ONLY view. Approve-from-mobile is
v1.1. v1.0 is "see the queue from your phone" — already a huge win,
half the LeCun-gate value.

## In-scope files

- NEW `landing/mobile/index.html` — minimal Cloudflare-Pages-served
  approval queue viewer. ~150 LOC HTML.
- NEW `landing/mobile/app.js` — fetch `/queue.json` from a known
  Cloudflare Worker route (or directly from the user's tailscale-bound
  cockpit endpoint via env-configured URL). ~250 LOC.
- NEW `landing/mobile/style.css` — mobile-first responsive (single
  column, large tap targets, dark default). ~200 LOC.
- NEW `src/mobileExport.ts` — desktop extension writes
  `~/.claude/.cockpit/queue.public.json` (sanitized snapshot of pending
  approvals — no file paths, just IDs + tool name + age). User opts
  into publication. Reads back nothing (read-only export). ~100 LOC.
- `src/sidebarProvider.ts:55–131` — append messages:
  `mobile.enable | mobile.disable | mobile.copyUrl`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `src/claudeData.ts:191–230` — add OPTIONAL `mobileEnabled?: boolean`.
- `package.json:111–199` — add 1 setting:
  `claudeCockpit.mobile.enabled` (bool, default false).
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT host any new server. mobile.cockpit.dashable.dev is a static
  Cloudflare Pages deploy that fetches from the user's tailscale-bound
  endpoint. v1.0 mobile fetches directly from the user's machine via
  a Cloudflare Tunnel they already configure (Stephane's pattern).
- Do NOT enable by default.
- Do NOT support approve-from-mobile in v1.0. Read-only.
- Do NOT mix this with the existing landing page; it gets its own
  subpath under `landing/mobile/`.

## Dependencies

- approval-queue: `~/.claude/.cockpit/queue.public.json` shape needs
  the WorktreeAction subset.
- telemetry-posthog: emit `mobile.enabled` event when the setting
  flips on (for adoption tracking).

## Acceptance criteria

- [ ] On a phone, opening `mobile.cockpit.dashable.dev` (or wherever
  the user points at) renders the live queue, refreshes every 5s.
- [ ] When desktop has `mobile.enabled = false`, no JSON is published
  and the mobile page shows "no live queue."
- [ ] No PII / file paths in the published JSON. Manual diff confirms
  fields are: { id, tool, ageSeconds, agentName, expectedDiffBytes }.
- [ ] `npm test` green; 2 new tests for the export sanitizer (rejects
  full paths, redacts agent names beyond first 8 chars).

## Test plan

Unit:
- Sanitizer never emits a `/Users/...` path.
- Sanitizer never emits the full payload of a JarvisApproval.

Manual:
- On phone Safari, hit the deployed URL, see queue.
- Toggle desktop OFF; mobile page shows "queue paused."

## Rollback plan

Revert. The mobile.cockpit.dashable.dev deploy is independent; rolling
back the extension just stops publication.
