# Privacy

Claude Cockpit is **100% local**. The extension runs entirely on your machine. Nothing leaves it.

## Guarantees

- **No network requests.** The extension makes zero outbound calls. No `fetch`, no `http`, no `XMLHttpRequest`, no `axios`, no telemetry SDK. Verify with `grep -rE "fetch|XMLHttpRequest|https?://" src/ media/`.
- **No telemetry, no analytics, no crash reporting.** Ever.
- **Read-only.** Phase 1 never writes to `~/.claude/`. The only filesystem APIs used are `fs.readFileSync`, `fs.readdirSync`, `fs.statSync`, `fs.existsSync`, and `fs.watch` — all read-only. Verify with `grep -rE "writeFile|appendFile|unlink|rmdir|mkdir|rename" src/`.
- **Bounded reads.** The extension reads only from `~/.claude/projects/<encoded-cwd>/` (Claude Code's own per-project session directory) and its `memory/MEMORY.md` index. Nothing else on disk is touched.
- **Webview is sandboxed.** The sidebar webview runs under a strict CSP: `default-src 'none'; connect-src 'none'; form-action 'none'`. It cannot make XHR/fetch calls, submit forms, or load remote resources.
- **Logging is path-only.** The logger writes to a VSCode `OutputChannel`. It logs file paths and error messages — never file contents or session bodies. See `src/logger.ts`.
- **Zero runtime dependencies.** Only `@types/vscode` and `typescript` (devDeps). No supply chain to audit at runtime. See `package.json`.

## Where to verify

| Guarantee | File |
|-----------|------|
| Read-only filesystem access | [`src/claudeData.ts`](src/claudeData.ts) |
| No console / no network | [`src/logger.ts`](src/logger.ts) |
| Webview CSP (no `connect-src`, no `form-action`) | [`src/sidebarProvider.ts`](src/sidebarProvider.ts) |
| Webview JS (no fetch / XHR) | [`media/sidebar.js`](media/sidebar.js) |
| Zero runtime deps | [`package.json`](package.json) |

## Why this matters

Stephane runs [HAQQ Legal AI](https://haqq.ai), which handles client-privileged material. The same machine that runs Claude Code may have legal documents, credentials, source for unreleased work. A "developer tool" that phones home — even for "anonymous usage stats" — is unacceptable in that environment. Cockpit is built for that bar.

## Open source

The full source is at [github.com/sboghossian/claude-cockpit](https://github.com/sboghossian/claude-cockpit). Audit it yourself. If you find a violation of any guarantee above, please open an issue — it's a bug.
