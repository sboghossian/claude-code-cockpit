# feat/launch-permissions-audit  (Phase 1, M, ~600 LOC)

## Goal

Two things:
1. **Audit log**: append-only log of every file Claude reads, every MCP
   call, every API key access, every outbound network domain the
   extension hits. Lives at `~/.claude/.cockpit/audit.log` (newline-
   delimited JSON). Rendered as a sub-tab inside the existing Security
   tab.
2. **Tools/MCP/API keys monitoring** (feature 18): inside Security tab,
   add three sub-views — Keys (locally stored, encrypted via VS Code
   `SecretStorage` API), Leaks (extends existing `scanSecurity`), and
   Outbound (every domain the extension itself hits, derived from the
   audit log).

## In-scope files

- NEW `src/auditLog.ts` — append/read log; rotation at 50MB; helpers
  `appendAuditEvent(ev: AuditEvent)`, `readAuditTail(n)`, `searchAudit(q)`.
  ~250 LOC.
- NEW `media/sidebar.audit.js` — three sub-views (Keys / Leaks / Outbound)
  + audit log table widget. Registers via Phase-0 API. ~300 LOC.
- `src/security.ts:1–368` — KEEP all current logic. ADD a thin wrapper
  `outboundDomainTail(n)` that reads the audit log and filters
  `kind === 'net.outbound'`. ~30 LOC at the end of the file.
- `src/discover.ts`, `src/updateCheck.ts`, `src/integrations.ts`,
  `src/roadmap.ts` — wherever `https.get` is called (12 sites total),
  wrap with `auditLog.appendAuditEvent({ kind: 'net.outbound', detail: { host, path }})`.
  ~12 lines added across files. Do NOT change request semantics.
- `src/sidebarProvider.ts:55–131` — append messages:
  `audit.refresh | audit.search | audit.exportLog | audit.clearLog |
   keys.add | keys.delete | keys.list`.
- `src/sidebarProvider.ts:574–1063` — append cases.
- `src/claudeData.ts:191–230` (CockpitSnapshot) — add OPTIONAL
  `auditCounts?: { last24h: number; lastDomain?: string }`.
- `media/sidebar.js:3550` — keep `security: ['securityFull']`. The audit
  sub-views are children of `securityFull`; no top-level tab change.
- `package.json:76–110` — add 2 commands: `claudeCockpit.audit.export`,
  `claudeCockpit.keys.add`.
- `package.json:111–199` — add 1 setting:
  `claudeCockpit.audit.enabled` (bool, default true).
- `CHANGELOG.md`, `tasks/todo.md` — append.

## Out-of-scope

- Do NOT log Claude's own JSONL contents — that's already in
  `~/.claude/projects/`. We log meta-events, not raw content.
- Do NOT exfiltrate the audit log anywhere. PostHog telemetry-posthog
  is the ONLY worktree that may consume audit aggregates; even then
  only counts, never paths.

## Dependencies

- `plugin.ts:AuditEvent` (Phase 0).
- `vscode.SecretStorage` (built-in API; no new dep).

## Acceptance criteria

- [ ] Audit log captures every outbound domain the extension hits
  (verified by grepping the log after a 5-min cockpit session).
- [ ] Keys sub-view: add a key (e.g. ANTHROPIC_API_KEY value), it stores
  via SecretStorage, never serialized to disk in plaintext, never sent
  to the webview (only "stored: 4 keys, last added 3m ago" surfaces).
- [ ] Leaks sub-view: continues to render existing
  `summarizeFindings(security)` output unchanged.
- [ ] Outbound sub-view: lists every unique domain hit in last 24h with
  count + last-seen timestamp.
- [ ] `npm test` green; 4 new tests for auditLog.ts (append, rotate at
  50MB, tail-n, search).

## Test plan

Unit:
- Write 1000 events, verify file size, rotation, tail-N order.
- Search for a substring across 5 rotated files.

Manual:
- Open Cockpit, click around; reload; outbound list shows api.github.com
  (update check) etc.
- Add an API key via the Keys sub-view, restart VS Code, verify it
  persists and the value is unreadable from disk.

## Rollback plan

Revert. Log file is self-contained at `~/.claude/.cockpit/audit.log`;
keys are in VS Code SecretStorage and persist across rollback (intended;
they're encrypted).
