import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export interface JarvisIdentity {
  selfName: string;
  peerName: string;
  selfHost: string;
  peerHost: string;
  tailnet: string;
  httpPort: number;
  webPort: number;
  approvalTimeoutMs: number;
  rateLimits: Record<string, { perHour: number }>;
}

export interface JarvisApproval {
  id: string;
  requestedAt: number;
  requestedBy: string;
  tool: string;
  payload: string;
  status: string;
  decidedAt: number | null;
  decidedBy: string | null;
  result: string | null;
}

export interface JarvisMessage {
  id: string;
  ts: number;
  direction: 'in' | 'out' | 'sys';
  from: string;
  to: string;
  kind: string;
  body: string;
  meta: string | null;
}

export interface JarvisRateBucket {
  tool: string;
  count: number;
  perHour: number;
  windowStart: number;
}

export interface JarvisAllowlistEntry {
  pattern: string;
  note?: string;
}

export interface JarvisLaunchd {
  loaded: boolean;
  pid: number | null;
  exitStatus: number | null;
  label: string;
}

export interface JarvisData {
  available: boolean;
  rootPath: string;
  identity: JarvisIdentity | undefined;
  presence: {
    selfLastMessageTs: number | null;
    serverPortsBound: { http: boolean; web: boolean };
  };
  pendingApprovals: JarvisApproval[];
  recentApprovals: JarvisApproval[];
  recentMessages: JarvisMessage[];
  rateBuckets: JarvisRateBucket[];
  allowlist: Record<string, JarvisAllowlistEntry[]>;
  offline: boolean;
  launchd: JarvisLaunchd | undefined;
  fetchedAt: number;
  error: string | undefined;
}

const DEFAULT_ROOT = path.join(os.homedir(), 'Documents', 'Code', 'boo-mesh');
const LAUNCHD_LABEL = 'dev.dashable.boo';

function rootPath(): string {
  return process.env.BOO_MESH_DIR || DEFAULT_ROOT;
}

function exists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

function readIdentity(root: string): JarvisIdentity | undefined {
  const cfgPath = path.join(root, 'config', 'boo.json');
  if (!exists(cfgPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const policy = raw.policy ?? {};
    return {
      selfName: String(raw.self?.name ?? 'Boo-?'),
      peerName: String(raw.peer?.name ?? 'Boo-?'),
      selfHost: String(raw.self?.tsHost ?? ''),
      peerHost: String(raw.peer?.tsHost ?? ''),
      tailnet: String(raw.tailnet?.suffix ?? ''),
      httpPort: Number(raw.mcp?.httpPort ?? 4411),
      webPort: Number(raw.mcp?.webPort ?? 4412),
      approvalTimeoutMs: Number(policy.approvalTimeoutMs ?? 60000),
      rateLimits: (policy.rateLimits ?? {}) as Record<string, { perHour: number }>,
    };
  } catch (err) {
    logger.info(`jarvis: identity read failed: ${String(err)}`);
    return undefined;
  }
}

function readAllowlist(root: string): Record<string, JarvisAllowlistEntry[]> {
  const p = path.join(root, 'config', 'allowlist.json');
  if (!exists(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const out: Record<string, JarvisAllowlistEntry[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('_')) continue;
      if (Array.isArray(v)) {
        out[k] = (v as Array<Record<string, unknown>>)
          .filter((e) => typeof e.pattern === 'string')
          .map((e) => ({ pattern: String(e.pattern), note: typeof e.note === 'string' ? e.note : undefined }));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAllowlist(root: string, allowlist: Record<string, JarvisAllowlistEntry[]>): void {
  const p = path.join(root, 'config', 'allowlist.json');
  const existingRaw = exists(p) ? fs.readFileSync(p, 'utf8') : '{}';
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(existingRaw); } catch { /* keep empty */ }
  const merged = { ...existing, ...allowlist };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
}

function isOffline(root: string): boolean {
  return exists(path.join(root, '.offline'));
}

function setOffline(root: string, offline: boolean): void {
  const p = path.join(root, '.offline');
  if (offline) fs.writeFileSync(p, '1', 'utf8');
  else if (exists(p)) fs.unlinkSync(p);
}

function sqliteJson(dbPath: string, sql: string): unknown[] {
  if (!exists(dbPath)) return [];
  try {
    const out = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (!out.trim()) return [];
    return JSON.parse(out) as unknown[];
  } catch (err) {
    logger.info(`jarvis: sqlite read failed (${dbPath}): ${String(err)}`);
    return [];
  }
}

function sqliteWrite(dbPath: string, sql: string, params: string[]): void {
  if (!exists(dbPath)) throw new Error(`db not found: ${dbPath}`);
  // sqlite3 CLI doesn't bind params natively; use .parameter set
  // Simpler: use shell escape via -separator with quoted strings.
  // We use a HEREDOC-style escape: each param wrapped in single quotes with '' escape.
  const escaped = params.map((p) => `'${p.replace(/'/g, "''")}'`);
  let i = 0;
  const interpolated = sql.replace(/\?/g, () => escaped[i++] ?? "''");
  execFileSync('/usr/bin/sqlite3', [dbPath, interpolated], { encoding: 'utf8', timeout: 3000 });
}

async function portBound(port: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeout: 1500 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function readLaunchd(label: string): Promise<JarvisLaunchd | undefined> {
  try {
    const { stdout } = await execFileAsync('/bin/launchctl', ['list'], { timeout: 1500 });
    const line = stdout.split('\n').find((l) => l.endsWith(`\t${label}`) || l.includes(`\t${label}`));
    if (!line) return { loaded: false, pid: null, exitStatus: null, label };
    const parts = line.split(/\s+/);
    const pidPart = parts[0];
    const statusPart = parts[1];
    const pid = pidPart === '-' ? null : Number(pidPart);
    const exitStatus = statusPart === '-' ? null : Number(statusPart);
    return { loaded: true, pid, exitStatus, label };
  } catch {
    return undefined;
  }
}

function shapeApproval(row: Record<string, unknown>): JarvisApproval {
  return {
    id: String(row.id ?? ''),
    requestedAt: Number(row.requested_at ?? 0),
    requestedBy: String(row.requested_by ?? ''),
    tool: String(row.tool ?? ''),
    payload: String(row.payload ?? ''),
    status: String(row.status ?? ''),
    decidedAt: row.decided_at == null ? null : Number(row.decided_at),
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    result: row.result == null ? null : String(row.result),
  };
}

function shapeMessage(row: Record<string, unknown>): JarvisMessage {
  const dir = String(row.direction ?? 'sys');
  return {
    id: String(row.id ?? ''),
    ts: Number(row.ts ?? 0),
    direction: dir === 'in' || dir === 'out' || dir === 'sys' ? (dir as 'in' | 'out' | 'sys') : 'sys',
    from: String(row.from ?? ''),
    to: String(row.to ?? ''),
    kind: String(row.kind ?? ''),
    body: String(row.body ?? ''),
    meta: row.meta == null ? null : String(row.meta),
  };
}

export async function readJarvis(): Promise<JarvisData> {
  const root = rootPath();
  const queueDb = path.join(root, 'queue.db');
  const chatDb = path.join(root, 'chat.db');
  const available = exists(queueDb) || exists(chatDb);
  if (!available) {
    return {
      available: false,
      rootPath: root,
      identity: undefined,
      presence: { selfLastMessageTs: null, serverPortsBound: { http: false, web: false } },
      pendingApprovals: [],
      recentApprovals: [],
      recentMessages: [],
      rateBuckets: [],
      allowlist: {},
      offline: false,
      launchd: undefined,
      fetchedAt: Date.now(),
      error: `boo-mesh not found at ${root}`,
    };
  }

  const identity = readIdentity(root);
  const allowlist = readAllowlist(root);
  const offline = isOffline(root);

  const pending = (sqliteJson(
    queueDb,
    `SELECT id, requested_at, requested_by, tool, payload, status, decided_at, decided_by, result
       FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC LIMIT 20`,
  ) as Array<Record<string, unknown>>).map(shapeApproval);

  const recent = (sqliteJson(
    queueDb,
    `SELECT id, requested_at, requested_by, tool, payload, status, decided_at, decided_by, result
       FROM approvals ORDER BY requested_at DESC LIMIT 25`,
  ) as Array<Record<string, unknown>>).map(shapeApproval);

  const messages = (sqliteJson(
    chatDb,
    `SELECT id, ts, direction, "from" as "from", "to" as "to", kind, body, meta
       FROM messages ORDER BY ts DESC LIMIT 30`,
  ) as Array<Record<string, unknown>>).map(shapeMessage);

  const buckets = (sqliteJson(
    queueDb,
    `SELECT key, count, window_start FROM rate_buckets`,
  ) as Array<Record<string, unknown>>).map((r) => ({
    tool: String(r.key ?? ''),
    count: Number(r.count ?? 0),
    perHour: identity?.rateLimits[String(r.key ?? '')]?.perHour ?? 0,
    windowStart: Number(r.window_start ?? 0),
  }));

  // Top up missing rate buckets so the UI shows tools at 0/N too
  if (identity) {
    for (const tool of Object.keys(identity.rateLimits)) {
      if (!buckets.find((b) => b.tool === tool)) {
        buckets.push({ tool, count: 0, perHour: identity.rateLimits[tool].perHour, windowStart: 0 });
      }
    }
  }

  const [httpBound, webBound, launchd] = await Promise.all([
    identity ? portBound(identity.httpPort) : Promise.resolve(false),
    identity ? portBound(identity.webPort) : Promise.resolve(false),
    readLaunchd(LAUNCHD_LABEL),
  ]);

  return {
    available: true,
    rootPath: root,
    identity,
    presence: {
      selfLastMessageTs: messages[0]?.ts ?? null,
      serverPortsBound: { http: httpBound, web: webBound },
    },
    pendingApprovals: pending,
    recentApprovals: recent,
    recentMessages: messages,
    rateBuckets: buckets,
    allowlist,
    offline,
    launchd,
    fetchedAt: Date.now(),
    error: undefined,
  };
}

export function decideApproval(id: string, status: 'approved' | 'rejected', decidedBy: string, reason?: string): void {
  const queueDb = path.join(rootPath(), 'queue.db');
  const ts = Math.floor(Date.now() / 1000);
  sqliteWrite(
    queueDb,
    `UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, result = ? WHERE id = ? AND status = 'pending'`,
    [status, String(ts), decidedBy, reason ?? '', id],
  );
}

export function sendMessageToPeer(text: string, kind: string = 'msg'): void {
  const chatDb = path.join(rootPath(), 'chat.db');
  const identity = readIdentity(rootPath());
  if (!identity) throw new Error('jarvis identity not configured');
  const ts = Math.floor(Date.now() / 1000);
  const id = `${ts}-${Math.random().toString(36).slice(2, 10)}`;
  sqliteWrite(
    chatDb,
    `INSERT OR REPLACE INTO messages (id, ts, direction, "from", "to", kind, body, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, String(ts), 'out', identity.selfName, identity.peerName, kind, text, ''],
  );
}

export function promotePatternToAllowlist(tool: string, pattern: string, note?: string): void {
  const root = rootPath();
  const cur = readAllowlist(root);
  const existing = cur[tool] ?? [];
  if (existing.find((e) => e.pattern === pattern)) return;
  cur[tool] = [...existing, { pattern, note }];
  writeAllowlist(root, cur);
}

export function setJarvisOffline(offline: boolean): void {
  setOffline(rootPath(), offline);
}

export function getQueueDbPath(): string {
  return path.join(rootPath(), 'queue.db');
}

export function getJarvisRoot(): string {
  return rootPath();
}
