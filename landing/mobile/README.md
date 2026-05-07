# Cockpit Mobile Companion (v1.0 read-only)

Read-only mobile mirror of the Claude Cockpit approval queue. Static page
served from Cloudflare Pages at `cockpit.dashable.dev/mobile/`.

## Architecture

```
┌──────────────────┐    file write    ┌──────────────────────────────┐
│  VSCode ext      │ ────────────────▶│ ~/.claude/.cockpit/          │
│  mobileExport.ts │                  │   queue.public.json          │
└──────────────────┘                  │   (sanitized, mode 0600)     │
                                      └──────────────┬───────────────┘
                                                     │ user-owned
                                                     │ Cloudflare Tunnel
                                                     ▼
                                      ┌──────────────────────────────┐
                                      │ queue.cockpit.dashable.dev   │
                                      │ (Cloudflare Access SSO)      │
                                      └──────────────┬───────────────┘
                                                     │ HTTPS GET
                                                     ▼
                                      ┌──────────────────────────────┐
                                      │ Phone:                       │
                                      │ cockpit.dashable.dev/mobile/ │
                                      │ polls every 5s               │
                                      └──────────────────────────────┘
```

Cockpit makes **zero** outbound calls for this feature. The user is
responsible for every hop between the published file and the phone.

## What gets published

When `claudeCockpit.mobile.enabled = true` (default `false`), the extension
writes a sanitized snapshot of the approval queue to
`~/.claude/.cockpit/queue.public.json` whenever the queue changes. The file
contains **only**:

```jsonc
{
  "version": 1,
  "publishedAt": 1746000000000,
  "enabled": true,
  "pendingCount": 3,
  "entries": [
    {
      "id": "act-abc123",       // opaque id, no path
      "tool": "Edit",            // truncated to 24 chars
      "ageSeconds": 42,
      "agentName": "claude-o",   // truncated to 8 chars
      "expectedDiffBytes": 128,
      "status": "pending",
      "fileCount": 2             // count only — no paths
    }
  ]
}
```

What is **never** published:

- File paths (`filesAffected`) — only the count.
- `argsRedacted` content — even if redacted upstream, we don't trust it.
- Snapshot ids.
- Decision notes / decided-by / rollback details.
- Anything from `~/.claude/projects/*.jsonl`.
- Anything from MEMORY.md, secrets, MCP config, or audit log.

The sanitizer is unit-tested (`test/mobileExport.test.js`).

## How to expose the file (user setup)

1. Enable the setting in VSCode:
   `claudeCockpit.mobile.enabled = true`
2. Confirm `~/.claude/.cockpit/queue.public.json` exists.
3. In your existing Cloudflare Tunnel config (`~/.cloudflared/config.yml`),
   add a route that serves this single file. Example:

   ```yaml
   ingress:
     - hostname: queue.cockpit.dashable.dev
       service: http://localhost:8086    # tiny static server you run locally
     - service: http_status:404
   ```

   The simplest static server:

   ```bash
   cd ~/.claude/.cockpit && python3 -m http.server 8086
   ```

4. Lock the route down with **Cloudflare Access** (Zero Trust → Applications):
   - Self-hosted application
   - Hostname: `queue.cockpit.dashable.dev`
   - Policy: allow only your email / your team
   - Session duration: 24h
5. On your phone, visit `https://cockpit.dashable.dev/mobile/`.
6. Paste the URL `https://queue.cockpit.dashable.dev/queue.public.json`
   into the setup screen and tap **Save**. The URL is stored in
   `localStorage` on the phone only — Cockpit never sees it.

If you skip step 4, **anyone who reaches the URL can read your queue.**
The page warns about this in the setup hint.

## Authentication model

Cloudflare Access is the auth boundary. The mobile page:

- Uses `credentials: 'include'` so Access SSO cookies ride the request.
- Has no client secret, no API key, no bearer token. The cookie is the only
  credential, set by Cloudflare.
- Stores only the public URL in localStorage. No PII, no tokens.

If you don't use Cloudflare Access: don't enable mobile. There is no
"protect with a password" fallback in v1.0 by design — half-baked auth is
worse than no auth.

## Refresh cadence

- Phone polls every **5s** when the tab is visible.
- Polling pauses when the tab is backgrounded (`visibilitychange`).
- The page shows a "snapshot is N seconds old" warning if the published
  payload's `publishedAt` is more than 15s in the past — i.e. the desktop
  may have stopped publishing.
- The desktop only rewrites the file when the queue **content** changes
  (digest-compared); periodic ticks alone don't bump the mtime.

## Deployment

`landing/mobile/` is a sibling of `landing/index.html`. Cloudflare Pages
auto-deploys both whenever the `main` branch lands. You don't need to
redeploy the desktop extension to ship a mobile change — the static page
ships independently.

To deploy manually:

```bash
cd landing
wrangler pages deploy . --project-name claude-code-cockpit
```

`cockpit.dashable.dev/mobile/` will be live in ~30s.

## v1.0 scope (and v1.1 plan)

**v1.0 (this release):** read-only. The mobile page shows what is pending
so you know to walk to the desk. Approvals stay desktop-only. This closes
half of the LeCun human-gate value at zero security risk: a read-only
endpoint can never authorize a destructive action.

**v1.1 (planned):** mobile-side approve. The desktop extension polls a
second Cloudflare-Access-protected endpoint
(`queue.cockpit.dashable.dev/decisions.public.json`) the user serves the
same way. The mobile page POSTs decisions; the desktop reconciles.
Cockpit still makes zero direct outbound calls — every hop is over the
user's tunnel + Cloudflare Access. This sequencing was chosen to keep v1.0
shippable today: read-only mobile is correct as soon as the file lands;
write-back requires the user to set up a writable bucket or local POST
endpoint, which we don't want to gate v1.0 on.

## Rollback

To kill the mobile companion entirely:

1. Set `claudeCockpit.mobile.enabled = false`. The extension immediately
   deletes `~/.claude/.cockpit/queue.public.json` so a stale snapshot can't
   leak through a tunnel that's still up.
2. Remove the Cloudflare Tunnel route for `queue.cockpit.dashable.dev`.
3. (Optional) Take the static landing page subdir down via Cloudflare
   Pages dashboard.

The desktop extension and the landing page are independent — rolling back
one does not touch the other.
