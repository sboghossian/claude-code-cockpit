// =============================================================================
// Claude Cockpit — onboarding sandbox (Phase 2, feat/launch-onboarding-sandbox).
//
// Synthesizes a fake project and a synthetic 30-event JSONL session so a
// first-run user can see the cockpit working *before* pointing it at real code.
//
// Trade-off documented up front:
//
//   We do NOT redirect `findActiveSession`. The session pointer is read deep
//   inside `claudeData.snapshot()` and is wired through dozens of consumers
//   (cost tables, replay, audit, jarvis, etc.). Hot-swapping it would either
//   require a global pointer override (risky for an extension that's supposed
//   to be a read-only HUD) or rewriting the snapshot pipeline. Instead we
//   stand up a tour-mode flag in globalState. When the flag is on, the
//   webview-side tutorial overlay surfaces guidance that walks the user
//   through Talk / Approval / Replay using their real (or empty) state, with
//   a sentinel SANDBOX banner so they know the tour is on.
//
//   The synthetic JSONL is still written to disk because the user can open
//   it in an editor, fork it via the replay tab (point replay at the file),
//   or copy it into ~/.claude/projects/ if they want Claude Code itself to
//   pick it up. That preserves the spirit of the brief (`a fake project the
//   user can interact with`) without us mutating Claude Code's own state.
//
// Files we own:
//   ~/.claude/.cockpit/sandbox/demo-project/         (the project root)
//   ~/.claude/.cockpit/sandbox/demo-project/CLAUDE.md
//   ~/.claude/.cockpit/sandbox/demo-project/README.md
//   ~/.claude/.cockpit/sandbox/sessions/<uuid>.jsonl (the synthetic transcript)
//
// Removable: the whole `~/.claude/.cockpit/sandbox/` tree is safe to delete
// at any point. exit() walks it for the user.
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

// Mutable override for tests — when set, ALL paths derive from this root.
// When undefined, paths are recomputed from `os.homedir()` on every call so a
// test that pins HOME via process.env.HOME after this module loads still gets
// the right resolution. (Same pattern as src/replay.ts:forksDirInternal.)
const TEST_OVERRIDE: { root: string | undefined } = { root: undefined };

function refRoot(): string {
  return TEST_OVERRIDE.root ?? path.join(os.homedir(), '.claude', '.cockpit', 'sandbox');
}
function refProject(): string {
  return path.join(refRoot(), 'demo-project');
}
function refSessions(): string {
  return path.join(refRoot(), 'sessions');
}

export interface SandboxState {
  /** True while the user is inside the tour. */
  active: boolean;
  /** Absolute path to the synthesized project root. */
  projectRoot: string;
  /** Absolute path to the synthetic session JSONL. */
  sessionFile: string;
  /** Synthetic uuid; matches sessionFile basename. */
  sessionId: string;
  /** When the sandbox was provisioned (ms). */
  createdAt: number;
}

export interface SandboxStartResult {
  ok: boolean;
  state?: SandboxState;
  error?: string;
}

/** Idempotent: provision the sandbox dir + JSONL if missing, return the state. */
export function startSandbox(): SandboxStartResult {
  try {
    fs.mkdirSync(refProject(), { recursive: true, mode: 0o755 });
    fs.mkdirSync(refSessions(), { recursive: true, mode: 0o755 });
  } catch (err) {
    return { ok: false, error: `mkdir failed: ${String(err)}` };
  }

  const claudeMd = path.join(refProject(), 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    fs.writeFileSync(
      claudeMd,
      [
        '# Demo project — Claude Cockpit sandbox',
        '',
        'This is a synthesized project the cockpit uses to walk first-run users',
        'through the main flows (Talk · Approval · Replay) without touching real',
        'code. Safe to delete this whole directory at any time:',
        '',
        '    rm -rf ~/.claude/.cockpit/sandbox',
        '',
        '## What is here',
        '',
        '- `CLAUDE.md` — this file',
        '- `README.md` — a fake project README so the file-touched widget has',
        '  something to point at',
        '- `../sessions/<uuid>.jsonl` — a 30-event synthetic transcript',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const readme = path.join(refProject(), 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      '# Demo Project\n\nA synthetic project for the Claude Cockpit onboarding tour.\n',
      'utf8',
    );
  }

  // One synthetic session per sandbox lifetime. We keep the same id across
  // restarts of `startSandbox` so users don't accumulate orphaned files.
  let sessionFile: string | undefined;
  try {
    const existing = fs.readdirSync(refSessions()).filter((f) => f.endsWith('.jsonl'));
    if (existing.length > 0) {
      // Newest wins.
      const newest = existing
        .map((f) => ({
          file: path.join(refSessions(), f),
          mtime: fs.statSync(path.join(refSessions(), f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      sessionFile = newest.file;
    }
  } catch {
    /* fall through to fresh create */
  }
  const sessionId = sessionFile
    ? path.basename(sessionFile, '.jsonl')
    : crypto.randomUUID();
  if (!sessionFile) {
    sessionFile = path.join(refSessions(), `${sessionId}.jsonl`);
    try {
      fs.writeFileSync(sessionFile, synthSessionLines(sessionId, refProject()), 'utf8');
    } catch (err) {
      return { ok: false, error: `session write failed: ${String(err)}` };
    }
  }

  const state: SandboxState = {
    active: true,
    projectRoot: refProject(),
    sessionFile,
    sessionId,
    createdAt: Date.now(),
  };
  logger.info(`sandbox: started at ${refProject()} (session id ${sessionId.slice(0, 8)})`);
  return { ok: true, state };
}

/** Walk the sandbox dir; preserves nothing. */
export function exitSandbox(): { ok: boolean; error?: string } {
  if (!fs.existsSync(refRoot())) {
    return { ok: true };
  }
  try {
    fs.rmSync(refRoot(), { recursive: true, force: true });
    logger.info('sandbox: removed sandbox tree');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `rm failed: ${String(err)}` };
  }
}

/** True iff the sandbox dir + session jsonl exist. */
export function sandboxExists(): boolean {
  if (!fs.existsSync(refProject())) return false;
  try {
    const sessions = fs.readdirSync(refSessions()).filter((f) => f.endsWith('.jsonl'));
    return sessions.length > 0;
  } catch {
    return false;
  }
}

export function sandboxRoot(): string {
  return refRoot();
}

export function sandboxProjectDir(): string {
  return refProject();
}

// -----------------------------------------------------------------------------
// Synthetic JSONL generator. Shape mirrors the lines parseLine() in
// claudeData.ts already accepts: `type` + `timestamp` + an optional message
// block with usage + content. Numbers are deliberately small so the cost
// tables show "$0.0X" instead of garbage.
// -----------------------------------------------------------------------------

function synthSessionLines(sessionId: string, projectRoot: string): string {
  const start = Date.now() - 30 * 60 * 1000; // 30 minutes ago
  const lines: string[] = [];
  const at = (i: number): string => new Date(start + i * 60 * 1000).toISOString();

  // Tiny session digest: 30 events, ~5 file edits, two tool calls, modest
  // token usage. The user only ever sees this through the cockpit UI; no
  // claim is made that it's a "real" Claude transcript.
  const readmePath = path.join(projectRoot, 'README.md');
  const claudePath = path.join(projectRoot, 'CLAUDE.md');

  let i = 0;
  // 1. user opens session
  lines.push(
    JSON.stringify({
      type: 'user',
      timestamp: at(i++),
      sessionId,
      message: { content: 'Welcome to the Cockpit demo. I am a synthetic agent.' },
    }),
  );
  // 2. assistant greeting
  lines.push(
    JSON.stringify({
      type: 'assistant',
      timestamp: at(i++),
      sessionId,
      message: {
        model: 'claude-opus-4-7-sandbox',
        content: [{ type: 'text', text: 'Hi! I am the demo agent. I will pretend to read two files.' }],
        usage: {
          input_tokens: 120,
          output_tokens: 40,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }),
  );
  // 3-7. five tool_use blocks: 2 reads + 3 edits, alternating
  const toolEvents: { tool: string; file: string; }[] = [
    { tool: 'Read', file: readmePath },
    { tool: 'Read', file: claudePath },
    { tool: 'Edit', file: readmePath },
    { tool: 'Write', file: path.join(projectRoot, 'NOTES.md') },
    { tool: 'Edit', file: claudePath },
  ];
  for (const ev of toolEvents) {
    const id = `toolu_${crypto.randomBytes(6).toString('hex')}`;
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: at(i++),
        sessionId,
        message: {
          model: 'claude-opus-4-7-sandbox',
          content: [
            {
              type: 'tool_use',
              id,
              name: ev.tool,
              input: { file_path: ev.file },
            },
          ],
        },
      }),
    );
    lines.push(
      JSON.stringify({
        type: 'user',
        timestamp: at(i++),
        sessionId,
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: ev.tool === 'Read' ? `# ${path.basename(ev.file)}\nfake content` : 'ok',
              is_error: false,
            },
          ],
        },
      }),
    );
  }
  // Filler text turns to round it out to 30 events.
  while (lines.length < 30) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        timestamp: at(i++),
        sessionId,
        message: {
          model: 'claude-opus-4-7-sandbox',
          content: [{ type: 'text', text: `Demo step ${lines.length + 1} — narrating progress.` }],
          usage: {
            input_tokens: 200 + lines.length * 5,
            output_tokens: 60 + lines.length * 3,
            cache_read_input_tokens: 100 * lines.length,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    );
  }
  return lines.join('\n') + '\n';
}

// Test helpers — redirect the sandbox dirs without touching the user's real
// ~/.claude/.cockpit/sandbox/. Returns a restore fn. Pass undefined to clear
// the override (back to os.homedir()-derived paths, recomputed on each call).
export function __setSandboxRootForTests(p: string | undefined): () => void {
  const orig = TEST_OVERRIDE.root;
  TEST_OVERRIDE.root = p;
  return () => {
    TEST_OVERRIDE.root = orig;
  };
}
