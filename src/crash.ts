// =============================================================================
// Claude Cockpit — Crash reporting glue (Phase 2,
// feat/launch-telemetry-posthog).
//
// Wraps the three crash surfaces the brief calls out:
//   1. activate() body — extension fails to mount.
//   2. webview message handler (sidebarProvider.handle) — a single bad message
//      should not bring down every other tab.
//   3. recordAsync callsites — long-running async work like graph builds,
//      release fetches, security scans.
//
// Every wrapper anonymizes the stack BEFORE handing it to posthog.captureCrash:
//   - Replace homedir with `~`
//   - Replace tmpdir with `<tmp>`
//   - Strip absolute path frames that don't live under the extension's `out/`
//     directory (the brief is explicit: "The stack must include only paths
//     starting with `/extension/out/`").
//   - Cap stack at 4 KB.
//
// Default OFF: if the user hasn't opted in to telemetry.crashReports the
// wrappers still RUN (they catch + log via the project logger), they just
// don't post to PostHog. This means a crash never escapes the host process
// regardless of telemetry settings — a behavioural improvement over v0.21.0
// which had bare try/catch only around specific async paths.
// =============================================================================

import * as os from 'os';
import { logger } from './logger';
import { captureCrash, isCrashEnabled } from './posthog';

let extensionRoot = ''; // populated by setExtensionRoot()

export function setExtensionRoot(rootDir: string): void {
  extensionRoot = rootDir.replace(/[\\/]+$/, '');
}

/**
 * Build a redacted stack trace string. Public for testing — given any Error,
 * returns at most `MAX_STACK_BYTES` of stack with:
 *   - Home/tmp dirs replaced.
 *   - Frames OUTSIDE the extension's compiled out/ dir replaced with
 *     `<external-frame>` (we don't ship debugging diagnostics for, e.g., the
 *     vscode core stack).
 *   - Each frame trimmed to remove leading column/whitespace noise.
 */
const MAX_STACK_BYTES = 4 * 1024;

export function anonymizeStack(err: unknown): string {
  if (!(err instanceof Error) || !err.stack) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  const home = os.homedir();
  const tmpdir = os.tmpdir();
  const rawLines = err.stack.split('\n');
  const headerLine = rawLines[0];
  const lines = rawLines.map((line, idx) => {
    let l = line;
    if (home) l = l.split(home).join('~');
    if (tmpdir) l = l.split(tmpdir).join('<tmp>');
    // First line is the message header — keep it as-is post-replace.
    if (idx === 0 && line === headerLine) return l;
    // Strip frames not under our extension's compiled out/ dir.
    const isCockpitFrame =
      (extensionRoot && l.includes(extensionRoot.split(home).join('~'))) ||
      l.includes('out/') ||
      l.includes('out\\');
    if (!isCockpitFrame) {
      return l.replace(/\(([^)]+)\)/, '(<external-frame>)');
    }
    // For cockpit frames, strip the absolute prefix before `out/`.
    return l
      .replace(/\(([^)]*?)(\/out\/)/, '(out/')
      .replace(/\(([^)]*?)(\\out\\)/, '(out\\');
  });
  let joined = lines.join('\n');
  if (joined.length > MAX_STACK_BYTES) {
    joined = `${joined.slice(0, MAX_STACK_BYTES)}…[truncated]`;
  }
  return joined;
}

/**
 * Wrap the extension's `activate()` body. If activation throws (which would
 * normally mean a user-visible "extension failed to activate" toast), we
 * report the crash and re-throw so VSCode's host still surfaces the failure.
 *
 * Telemetry-OFF callers see a plain try/catch + logger.warn. NO behavioural
 * change for v0.21.0 users.
 */
export function captureActivationFailure(err: unknown): void {
  const stack = anonymizeStack(err);
  logger.warn(`crash.activate: ${stack}`);
  if (!isCrashEnabled()) return;
  void captureCrash('activate', err, stack);
}

/**
 * Wrap a webview message handler. Returns a promise; never rejects (a thrown
 * handler error is reported and swallowed so the rest of the extension keeps
 * receiving messages).
 */
export async function captureMessageFailure(
  msgType: string,
  err: unknown,
): Promise<void> {
  const stack = anonymizeStack(err);
  logger.warn(`crash.message(${msgType}): ${stack}`);
  if (!isCrashEnabled()) return;
  await captureCrash('message', err, stack, { messageType: msgType });
}

/**
 * Wrap an arbitrary async surface. Use as: `await wrapAsync('graph.build',
 * async () => { ... })`. If the inner function throws, the error is reported
 * and re-thrown — the surface decides whether to swallow.
 */
export async function wrapAsync<T>(
  surface: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const stack = anonymizeStack(err);
    logger.warn(`crash.${surface}: ${stack}`);
    if (isCrashEnabled()) {
      await captureCrash(surface, err, stack);
    }
    throw err;
  }
}
