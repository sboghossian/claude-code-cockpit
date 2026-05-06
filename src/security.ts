import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

// Local-only security audit. Read-only, no network, no remote APIs. The
// goal is to flag obvious leaks before they ship: tracked .env files,
// hardcoded API keys in tracked source, MCP servers with exposed creds.
//
// For deeper audits (dependency CVEs, GitHub repo audit, edge-function
// exposure scanning) the user should run the existing /cso gstack skill;
// the UI surfaces a button to launch it in a terminal.

export interface SecretFinding {
  file: string;        // Path relative to scan root.
  absoluteFile: string;
  line: number;
  excerpt: string;     // Redacted preview — only the first 6 + last 4 chars of the secret.
  rule: string;        // Which detector fired.
  severity: 'high' | 'medium';
}

export interface EnvFileFinding {
  file: string;
  absoluteFile: string;
  ignored: boolean;
  trackedInGit: boolean;
  sizeBytes: number;
}

export interface GitRemoteFinding {
  name: string;
  url: string;
  isGithub: boolean;
  isPublic: boolean | undefined;  // Undefined when we can't tell offline.
}

export interface McpCredentialFinding {
  serverName: string;
  envKeys: string[];           // Env-var names referenced (KEYS only, never values).
  hasInlineSecret: boolean;    // True if a value looks like it's a literal secret in settings.json.
}

export interface SecuritySnapshot {
  scannedAt: number;
  scanRoot: string | undefined;
  secrets: SecretFinding[];
  envFiles: EnvFileFinding[];
  gitRemotes: GitRemoteFinding[];
  mcpServers: McpCredentialFinding[];
  truncated: boolean;
  errors: string[];
}

// Detection rules — name + regex. Patterns are anchored loose enough to
// catch common leaks without exploding on every base64 string. Confidence
// tier (severity) reflects false-positive risk.
const SECRET_RULES: Array<{ rule: string; rx: RegExp; severity: 'high' | 'medium' }> = [
  { rule: 'AWS Access Key', rx: /\bAKIA[0-9A-Z]{16}\b/, severity: 'high' },
  { rule: 'AWS Secret Key', rx: /\b[A-Za-z0-9/+=]{40}\b/, severity: 'medium' }, // High FP, scoped below
  { rule: 'GitHub Token (classic)', rx: /\bghp_[A-Za-z0-9]{36,}\b/, severity: 'high' },
  { rule: 'GitHub Token (fine-grained)', rx: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/, severity: 'high' },
  { rule: 'GitHub OAuth', rx: /\bgho_[A-Za-z0-9]{36,}\b/, severity: 'high' },
  { rule: 'Stripe Secret Key', rx: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/, severity: 'high' },
  { rule: 'Stripe Publishable', rx: /\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/, severity: 'medium' },
  { rule: 'Anthropic API Key', rx: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{32,}\b/, severity: 'high' },
  { rule: 'OpenAI API Key', rx: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b/, severity: 'high' },
  { rule: 'Slack Token', rx: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, severity: 'high' },
  { rule: 'Google API Key', rx: /\bAIza[A-Za-z0-9_-]{35}\b/, severity: 'high' },
  { rule: 'Cloudflare API Token', rx: /\bcf-[A-Za-z0-9_-]{20,}\b/, severity: 'medium' },
  { rule: 'Generic Bearer Token', rx: /\bBearer\s+[A-Za-z0-9._-]{40,}\b/, severity: 'medium' },
  { rule: 'Private Key', rx: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/, severity: 'high' },
];

// Files we always skip — generated, vendored, binary, or massive.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'venv', '.cache', '.turbo',
  '.expo', 'target', 'vendor', '.gradle', '.idea', '.vscode-test',
]);
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp4', '.mov', '.mp3', '.wav', '.ogg',
  '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.lock', '.snap', '.map',
]);

const MAX_FILES = 600;
const MAX_FILE_BYTES = 256 * 1024;

export function scanSecurity(scanRoot: string | undefined): SecuritySnapshot {
  const errors: string[] = [];
  const out: SecuritySnapshot = {
    scannedAt: Date.now(),
    scanRoot,
    secrets: [],
    envFiles: [],
    gitRemotes: [],
    mcpServers: scanMcpServers(errors),
    truncated: false,
    errors,
  };
  if (!scanRoot || !fs.existsSync(scanRoot)) {
    return out;
  }
  const stat = fs.statSync(scanRoot);
  if (!stat.isDirectory()) return out;

  // 1. Walk the tree, collecting candidate files. Hard cap on file count.
  const files: string[] = [];
  let truncated = false;
  walk(scanRoot, files, () => files.length >= MAX_FILES);
  if (files.length >= MAX_FILES) truncated = true;
  out.truncated = truncated;

  // 2. Identify .env files.
  for (const f of files) {
    const base = path.basename(f);
    if (/^\.env(\.|$)/.test(base) || base === '.env' || base.startsWith('.env.')) {
      out.envFiles.push({
        file: path.relative(scanRoot, f),
        absoluteFile: f,
        ignored: isIgnoredByGit(scanRoot, f),
        trackedInGit: isTrackedByGit(scanRoot, f),
        sizeBytes: safeSize(f),
      });
    }
  }

  // 3. Scan files for secret patterns. Skip .env files themselves (those are
  //    flagged separately) and skip files that look like fixtures/tests
  //    holding test values. Restrict AWS-secret-shaped match to lines that
  //    also mention 'aws', 'secret', or 'key' to cut false positives.
  for (const f of files) {
    if (out.secrets.length >= 200) {
      truncated = true;
      break;
    }
    const base = path.basename(f);
    if (base.startsWith('.env')) continue;
    if (safeSize(f) > MAX_FILE_BYTES) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(f, 'utf8');
    } catch (err) {
      errors.push(`read ${f}: ${String(err instanceof Error ? err.message : err)}`);
      continue;
    }
    if (!raw) continue;
    if (looksBinary(raw)) continue;
    const lines = raw.split('\n');
    const WINDOW = 2000;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Long minified lines (bundles, sourcemaps) used to be skipped entirely
      // — that hid embedded secrets. Scan in 2000-char overlapping windows so
      // anchored regexes still catch leading tokens. 200-char overlap covers
      // the longest secret patterns we look for.
      const windows: { offset: number; chunk: string }[] = [];
      if (line.length <= WINDOW) {
        windows.push({ offset: 0, chunk: line });
      } else {
        for (let off = 0; off < line.length; off += WINDOW - 200) {
          windows.push({ offset: off, chunk: line.slice(off, off + WINDOW) });
          if (off + WINDOW >= line.length) break;
        }
      }
      let matched = false;
      for (const win of windows) {
        if (matched) break;
        for (const r of SECRET_RULES) {
          // exec is stateful for /g regex but our rules are not /g; safe.
          const m = r.rx.exec(win.chunk);
          if (!m) continue;
          // AWS Secret Key is high-FP — only flag if the line ALSO mentions
          // an AWS-y context word.
          if (r.rule === 'AWS Secret Key' && !/aws|secret|access/i.test(line)) continue;
          const hit = m[0];
          const redacted = hit.length > 12 ? `${hit.slice(0, 6)}…${hit.slice(-4)}` : '••••';
          const absIdx = win.offset + m.index;
          const before = line.slice(0, absIdx).slice(-30);
          const after = line.slice(absIdx + hit.length).slice(0, 30);
          out.secrets.push({
            file: path.relative(scanRoot, f),
            absoluteFile: f,
            line: i + 1,
            excerpt: `${before}${redacted}${after}`.replace(/\s+/g, ' ').trim(),
            rule: r.rule,
            severity: r.severity,
          });
          matched = true; // One finding per line is plenty.
          break;
        }
      }
    }
  }
  out.truncated = out.truncated || truncated;

  // 4. Git remotes.
  out.gitRemotes = readGitRemotes(scanRoot, errors);

  return out;
}

function walk(root: string, acc: string[], stopFn: () => boolean): void {
  if (stopFn()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (stopFn()) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(root, e.name), acc, stopFn);
    } else if (e.isFile()) {
      const name = e.name;
      const ext = path.extname(name).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) continue;
      acc.push(path.join(root, name));
    }
  }
}

function looksBinary(raw: string): boolean {
  // Quick heuristic — if first 1KB has many NULs, treat as binary.
  const sample = raw.slice(0, 1024);
  let nulCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nulCount++;
    if (nulCount > 3) return true;
  }
  return false;
}

function safeSize(f: string): number {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}

function isIgnoredByGit(root: string, file: string): boolean {
  try {
    const r = cp.spawnSync('git', ['-C', root, 'check-ignore', '-q', file], { timeout: 1500 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function isTrackedByGit(root: string, file: string): boolean {
  try {
    const r = cp.spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', file], { timeout: 1500 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function readGitRemotes(root: string, errors: string[]): GitRemoteFinding[] {
  try {
    const r = cp.spawnSync('git', ['-C', root, 'remote', '-v'], { encoding: 'utf8', timeout: 1500 });
    if (r.status !== 0) return [];
    const seen = new Map<string, GitRemoteFinding>();
    for (const line of (r.stdout || '').split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line);
      if (!m) continue;
      const name = m[1];
      const url = m[2];
      if (seen.has(name)) continue;
      seen.set(name, {
        name,
        url,
        isGithub: /github\.com/i.test(url),
        isPublic: undefined,
      });
    }
    return Array.from(seen.values());
  } catch (err) {
    errors.push(`git remote: ${String(err instanceof Error ? err.message : err)}`);
    return [];
  }
}

function scanMcpServers(errors: string[]): McpCredentialFinding[] {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    errors.push(`settings.json parse: ${String(err instanceof Error ? err.message : err)}`);
    return [];
  }
  const mcp = (parsed.mcpServers || parsed.mcp_servers) as Record<string, unknown> | undefined;
  if (!mcp || typeof mcp !== 'object') return [];
  const out: McpCredentialFinding[] = [];
  for (const [name, def] of Object.entries(mcp)) {
    if (!def || typeof def !== 'object') continue;
    const env = (def as Record<string, unknown>).env;
    if (!env || typeof env !== 'object') {
      out.push({ serverName: name, envKeys: [], hasInlineSecret: false });
      continue;
    }
    const keys = Object.keys(env as Record<string, unknown>);
    let hasInlineSecret = false;
    for (const k of keys) {
      const v = (env as Record<string, unknown>)[k];
      if (typeof v !== 'string') continue;
      // Inline secret heuristic: value matches a known secret pattern.
      for (const r of SECRET_RULES) {
        if (r.rx.test(v)) {
          hasInlineSecret = true;
          break;
        }
      }
      if (hasInlineSecret) break;
    }
    out.push({ serverName: name, envKeys: keys, hasInlineSecret });
  }
  return out;
}

export function summarizeFindings(snap: SecuritySnapshot): {
  total: number;
  high: number;
  medium: number;
  envTracked: number;
  mcpInline: number;
} {
  const high = snap.secrets.filter((s) => s.severity === 'high').length;
  const medium = snap.secrets.filter((s) => s.severity === 'medium').length;
  const envTracked = snap.envFiles.filter((e) => e.trackedInGit && !e.ignored).length;
  const mcpInline = snap.mcpServers.filter((m) => m.hasInlineSecret).length;
  return {
    total: high + medium + envTracked + mcpInline,
    high,
    medium,
    envTracked,
    mcpInline,
  };
}

// Cheap version of the snapshot — used by the badge in the tab label so we
// don't pay a full scan on every refresh. Counts .env files only.
export function quickSecurityCount(scanRoot: string | undefined): number {
  if (!scanRoot || !fs.existsSync(scanRoot)) return 0;
  let envFiles = 0;
  try {
    walk(scanRoot, [], () => false);
    const acc: string[] = [];
    walk(scanRoot, acc, () => acc.length >= MAX_FILES);
    for (const f of acc) {
      const base = path.basename(f);
      if (/^\.env(\.|$)/.test(base) && isTrackedByGit(scanRoot, f)) envFiles++;
    }
  } catch (err) {
    logger.info(`quickSecurityCount: ${String(err)}`);
  }
  return envFiles;
}
