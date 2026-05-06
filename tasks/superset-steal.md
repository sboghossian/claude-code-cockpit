# Cockpit ← Superset Feature Steal (separate task, PR-bound)

Scan `superset-sh/superset` and propose what to port into Cockpit (VSCode
extension, read-only HUD, 100% local).

## Constraints

- Stay VSCode extension. No desktop app. Don't run Superset itself.
- Cockpit's working session is on `feat/cockpit-v0.12.0-uplift`.
- This worktree (`feat/superset-feature-steal`) lands as a PR for human merge.

## Cockpit baseline (don't re-propose)

Tabs: Custom · Now · Mac · Watchtower · Agents · Routines · Discover · Chat ·
Search · Obsidian · Memory · Prompts · Skills · Projects · Files · Config · Help

30+ widgets. Global search across tabs. Customize panel. Theme switcher.
Budget caps. Mac health (BT peripherals, app usage). Cloudflare tunnels.
RTK token-killer. Cost-by-tool. Activity heatmap. Watchtower. Pinnable
memory. Prompt library. Sub-agents. Idle sentinel. Notification center.
Plans parser. claude-data-export integration. claude-usage launcher.

## What we will NOT propose to add

- Multi-agent orchestration UI (Superset's whole product, out of scope)
- Worktree management UI (VSCode git already covers it)
- Built-in terminal pane (VSCode has one)
- Electron shell (Cockpit is a webview)
- Caddy / Electric SQL / cloud sync infra

## Plan

1. ✅ Clone Superset (~/Documents/Code/superset-scan)
2. ✅ Worktree off origin/main (~/Documents/Code/claude-cockpit-steal)
3. ⏳ 4 parallel Explore scans (apps / packages / plans+docs / plugins+skills+scripts)
4. ⏳ Synthesize → STEAL_FROM_SUPERSET.md (design doc, not impl)
5. ⏳ Commit, push, open PR

## Output

`STEAL_FROM_SUPERSET.md` at repo root. For each candidate feature:
- What Superset does
- What to port (calibrated to Cockpit's read-only / local / VSCode constraints)
- Where it fits (which tab/widget)
- Implementation cost (S/M/L)
- Verdict (port / skip / watch)
