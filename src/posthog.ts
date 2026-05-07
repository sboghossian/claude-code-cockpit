// =============================================================================
// Claude Cockpit — Opt-in PostHog telemetry client (Phase 2,
// feat/launch-telemetry-posthog).
//
// Default OFF. Until the user opts in via `claudeCockpit.telemetry.enabled` AND
// supplies a `claudeCockpit.telemetry.projectId`, every public function in this
// module is a zero-cost no-op — there is NO outbound traffic, no allocations,
// no fs writes. v0.21.0 users see byte-identical behaviour.
//
// Why not @posthog/node? Two reasons:
//   1. Cockpit ships with ZERO runtime deps; adding posthog-node + its tree
//      (axios, uuid, ...) would bloat the .vsix from ~120KB to >2MB.
//   2. Stephane's HAQQ Legal AI runs on PostHog project 92178. Cockpit MUST
//      use a different project (or the user's own project) so customer
//      telemetry from HAQQ is never co-mingled with extension diagnostics.
//      Hand-rolling the client makes it impossible to accidentally point at
//      the HAQQ project — the user has to type the projectId in.
//
// Wire shape: PostHog's HTTP capture endpoint accepts a single-event POST to
//   https://app.posthog.com/i/v0/e/
// with body { api_key, event, distinct_id, properties, timestamp }. We follow
// that shape literally; no batching, no retries (a dropped extension-diagnostics
// event is not worth the complexity).
//
// Redaction is enforced at THIS module's boundary. Callers must pre-redact, but
// we run a final regex pass over `properties.detail` and any string fields to
// strip absolute paths (`/Users/<u>/...` → `~/...`), repo paths, and obvious
// secret-shaped tokens. Defense in depth — the audit log contract requires
// pre-redaction at every emit site, but a misbehaving caller cannot leak a
// home-directory path through us.
// =============================================================================

import * as https from 'https';
import * as os from 'os';
import { logger } from './logger';
import { appendAuditEvent } from './auditLog';

const DEFAULT_HOST = 'app.posthog.com';
const CAPTURE_PATH = '/i/v0/e/';
const REQUEST_TIMEOUT_MS = 5_000;

// HAQQ Legal AI's PostHog project. Hard-coded refusal: if the user mistakenly
// enters this id Cockpit will refuse to capture and warn them. Stephane's
// customer telemetry must NEVER be polluted with extension diagnostics.
const HAQQ_PROJECT_ID = '92178';

// -----------------------------------------------------------------------------
// Public types.
// -----------------------------------------------------------------------------

/**
 * Wire shape of every event Cockpit captures. Properties is a flat record of
 * primitives (no nested objects beyond `detail`, which is a redacted record).
 * `cockpit.<namespace>.<verb>` naming convention enforced by isValidEventName.
 */
export interface CockpitEvent {
  event: string;
  distinctId: string;
  properties: {
    extensionVersion: string;
    vsCodeVersion: string | undefined;
    platform: string;
    detail?: Record<string, unknown>;
  };
  timestamp: number;
}

export interface PosthogConfig {
  /** Master kill switch. Default false. */
  enabled: boolean;
  /** Crash-report sub-toggle. Default false. */
  crashReportsEnabled: boolean;
  /** PostHog project id (numeric string). Empty = forced off. */
  projectId: string;
  /** PostHog host. Default app.posthog.com. */
  host: string;
  /** Stable, anonymous-ish identifier — a salted hash of os.hostname(). */
  distinctId: string;
  /** Cockpit version, e.g. "0.21.0". Reported on every event. */
  extensionVersion: string;
  /** VS Code version, optional — useful for crash diagnostics, not identifying. */
  vsCodeVersion: string | undefined;
}

/**
 * Pluggable HTTP transport so tests can capture wire payloads without making
 * real network calls. Production uses `defaultFetcher` (https.request).
 */
export type Fetcher = (
  url: string,
  body: string,
) => Promise<{ status: number; bodyText: string }>;

// -----------------------------------------------------------------------------
// Module state — set lazily via configure(). Stays empty until opt-in.
// -----------------------------------------------------------------------------

let config: PosthogConfig | undefined;
let fetcher: Fetcher = defaultFetcher;
// Counters for the Self tab pill — incremented on every capture attempt.
const counters = { sent: 0, failed: 0, dropped: 0 };

// -----------------------------------------------------------------------------
// Configuration / state predicates.
// -----------------------------------------------------------------------------

export function configure(next: PosthogConfig): void {
  if (next.projectId === HAQQ_PROJECT_ID) {
    logger.warn(
      'posthog: refusing projectId 92178 — that is HAQQ Legal AI customer telemetry. Pick a separate Cockpit project.',
    );
    config = { ...next, enabled: false, crashReportsEnabled: false };
    return;
  }
  config = next;
}

export function isEnabled(): boolean {
  return !!config && config.enabled && config.projectId.length > 0;
}

export function isCrashEnabled(): boolean {
  return isEnabled() && !!config && config.crashReportsEnabled;
}

export function getCounters(): { sent: number; failed: number; dropped: number } {
  return { ...counters };
}

export function getStatusForSnapshot(): {
  enabled: boolean;
  crashReportsEnabled: boolean;
  projectIdSet: boolean;
  host: string;
  sent: number;
  failed: number;
  dropped: number;
} {
  return {
    enabled: isEnabled(),
    crashReportsEnabled: isCrashEnabled(),
    projectIdSet: !!(config && config.projectId.length > 0),
    host: config ? config.host : DEFAULT_HOST,
    sent: counters.sent,
    failed: counters.failed,
    dropped: counters.dropped,
  };
}

/** Test-only injection seam. */
export function __setFetcherForTests(f: Fetcher): () => void {
  const prev = fetcher;
  fetcher = f;
  return () => {
    fetcher = prev;
  };
}

/** Test-only reset. */
export function __resetForTests(): void {
  config = undefined;
  fetcher = defaultFetcher;
  counters.sent = 0;
  counters.failed = 0;
  counters.dropped = 0;
}

// -----------------------------------------------------------------------------
// Capture API. The verb is `cockpit.<namespace>.<verb>` enforced below.
// -----------------------------------------------------------------------------

const EVENT_NAME = /^cockpit\.[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/;

export function isValidEventName(name: string): boolean {
  return EVENT_NAME.test(name);
}

/**
 * Fire-and-forget capture. Returns a promise so tests + the crash handler can
 * await delivery, but the public callsite is `void capture(...)` — we never
 * block the extension host on telemetry.
 *
 * Behavior:
 *   - opt-out → returns immediately (no fetcher invocation, no counter bump
 *     beyond `dropped` if the projectId is missing).
 *   - bad event name → returns immediately (counters.dropped++).
 *   - HTTPS error / non-2xx → counters.failed++, logger.warn, swallows.
 */
export async function capture(
  eventName: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  if (!config || !config.enabled || config.projectId.length === 0) {
    counters.dropped += 1;
    return;
  }
  if (!isValidEventName(eventName)) {
    counters.dropped += 1;
    logger.warn(`posthog: rejecting invalid event name "${eventName}"`);
    return;
  }
  const payload: CockpitEvent = {
    event: eventName,
    distinctId: config.distinctId,
    properties: {
      extensionVersion: config.extensionVersion,
      vsCodeVersion: config.vsCodeVersion,
      platform: process.platform,
      detail: redactDetail(detail),
    },
    timestamp: Date.now(),
  };
  // Mirror to the audit log so the user can SEE what left the machine. Detail
  // is the post-redaction copy — what PostHog actually receives.
  appendAuditEvent({
    ts: payload.timestamp,
    kind: 'net.outbound',
    detail: {
      host: config.host,
      method: 'POST',
      purpose: 'posthog.capture',
      event: eventName,
    },
    worktree: 'telemetry-posthog',
  });
  const body = JSON.stringify({
    api_key: config.projectId,
    event: payload.event,
    distinct_id: payload.distinctId,
    properties: {
      $lib: 'claude-cockpit',
      $lib_version: payload.properties.extensionVersion,
      vsCodeVersion: payload.properties.vsCodeVersion,
      platform: payload.properties.platform,
      ...payload.properties.detail,
    },
    timestamp: new Date(payload.timestamp).toISOString(),
  });
  try {
    const url = `https://${config.host}${CAPTURE_PATH}`;
    const res = await fetcher(url, body);
    if (res.status >= 200 && res.status < 300) {
      counters.sent += 1;
    } else {
      counters.failed += 1;
      logger.warn(`posthog: capture(${eventName}) status=${res.status} body=${truncate(res.bodyText, 200)}`);
    }
  } catch (err) {
    counters.failed += 1;
    logger.warn(`posthog: capture(${eventName}) error: ${String(err)}`);
  }
}

/**
 * Capture an unhandled crash. Gated by BOTH telemetry.enabled AND
 * telemetry.crashReports — many users opt into events but not crash stacks
 * because stack frames can include local file paths even after redaction.
 * The stack passed in is already redacted by `crash.ts:anonymizeStack`.
 */
export async function captureCrash(
  surface: string,
  err: unknown,
  redactedStack: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!isCrashEnabled()) {
    counters.dropped += 1;
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : 'NonError';
  await capture('cockpit.crash.report', {
    surface,
    errorName: errName,
    errorMessage: truncate(redactString(message), 500),
    stack: truncate(redactedStack, 4_000),
    ...extra,
  });
}

// -----------------------------------------------------------------------------
// Redaction. Two passes:
//   1. redactString: applied to every string value in `detail`.
//   2. redactDetail: walks the object once and returns a fresh copy.
// We never mutate the caller's object.
// -----------------------------------------------------------------------------

// Generic absolute-path anchors (Linux/macOS). Captures the segment up to a
// space, paren, or end-of-line, then replaces with `<redacted-path>`.
const ABS_PATH_RE = /(\/Users\/[^\s)'"`]+|\/home\/[^\s)'"`]+|[A-Z]:\\[^\s)'"`]+)/g;
// API-key shaped tokens.
const SECRET_RES: ReadonlyArray<RegExp> = [
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI / Anthropic-style
  /xoxb-[A-Za-z0-9-]{20,}/g, // Slack bot tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
];

export function redactString(s: string): string {
  if (!s) return s;
  let out = s;
  // Re-read homedir + tmpdir per call. Tests set process.env.HOME between
  // test cases (approvalQueue uses a fresh tmp dir per file), so caching the
  // regex at module load would race the env mutation. Cost is one
  // os.homedir() call per redaction — negligible, and only on the opt-in
  // hot path.
  const home = os.homedir();
  const tmp = os.tmpdir();
  if (home) out = out.split(home).join('~');
  if (tmp) out = out.split(tmp).join('<tmp>');
  out = out.replace(ABS_PATH_RE, '<redacted-path>');
  for (const re of SECRET_RES) {
    out = out.replace(re, '<redacted-secret>');
  }
  return out;
}

/**
 * Walk the detail record once, redacting strings. Numbers, booleans, nulls
 * pass through unchanged. Nested objects/arrays are walked recursively but
 * capped at 5 levels deep to avoid runaway recursion on malformed payloads.
 *
 * Forbidden keys (`apiKey`, `secret`, `password`, `token`, `authorization`,
 * `prompt`, `body`, `content`) are dropped entirely — defence in depth.
 */
const FORBIDDEN_KEYS = new Set([
  'apikey',
  'api_key',
  'secret',
  'password',
  'token',
  'authorization',
  'prompt',
  'body',
  'content',
  'filecontents',
  'filebody',
  'sessioncontent',
]);

export function redactDetail(
  detail: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 5 || !detail || typeof detail !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      out[k] = '<dropped>';
      continue;
    }
    if (typeof v === 'string') {
      out[k] = redactString(v);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v
        .slice(0, 50)
        .map((item) =>
          typeof item === 'string'
            ? redactString(item)
            : typeof item === 'object' && item !== null
              ? redactDetail(item as Record<string, unknown>, depth + 1)
              : item,
        );
    } else if (typeof v === 'object') {
      out[k] = redactDetail(v as Record<string, unknown>, depth + 1);
    } else {
      // functions, symbols, undefined → drop.
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Default https fetcher. Pure stdlib — no axios, no fetch polyfill.
// -----------------------------------------------------------------------------

function defaultFetcher(url: string, body: string): Promise<{ status: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const req = https.request(
      {
        host: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'claude-cockpit-vscode',
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          if (buf.length > 16 * 1024) buf = buf.slice(0, 16 * 1024);
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, bodyText: buf });
        });
      },
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('posthog capture timeout'));
    });
    req.write(body);
    req.end();
  });
}

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
