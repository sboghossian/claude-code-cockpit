import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

export interface ObsidianVault {
  id: string;
  name: string;
  path: string;
  isOpen: boolean;
  lastOpenedMs: number;
  exists: boolean;
}

export interface ObsidianNote {
  vaultPath: string;
  vaultName: string;
  relPath: string;
  filename: string;
  lastModifiedAt: string;
  lastModifiedMs: number;
  sizeBytes: number;
  excerpt: string | undefined;
}

export interface ObsidianStatus {
  installed: boolean;
  registryPath: string | undefined;
  vaults: ObsidianVault[];
  primaryVault: ObsidianVault | undefined;
  recentNotes: ObsidianNote[];
}

const REGISTRY_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'obsidian',
  'obsidian.json',
);

interface RegistryEntry {
  path?: string;
  ts?: number;
  open?: boolean;
}

interface RegistryFile {
  vaults?: Record<string, RegistryEntry>;
}

export function readVaultRegistry(): ObsidianVault[] {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return [];
  }
  let raw: string;
  try {
    raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  } catch (err) {
    logger.warn(`obsidian: failed to read registry: ${String(err)}`);
    return [];
  }
  let parsed: RegistryFile;
  try {
    parsed = JSON.parse(raw) as RegistryFile;
  } catch {
    return [];
  }
  const out: ObsidianVault[] = [];
  for (const [id, entry] of Object.entries(parsed.vaults ?? {})) {
    if (!entry?.path) continue;
    const exists = fs.existsSync(entry.path);
    out.push({
      id,
      name: path.basename(entry.path),
      path: entry.path,
      isOpen: Boolean(entry.open),
      lastOpenedMs: entry.ts ?? 0,
      exists,
    });
  }
  out.sort((a, b) => b.lastOpenedMs - a.lastOpenedMs);
  return out;
}

function readExcerpt(filePath: string, max = 140): string | undefined {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    let raw = buf.slice(0, n).toString('utf8');
    if (raw.startsWith('---')) {
      const end = raw.indexOf('\n---', 3);
      if (end > 0) raw = raw.slice(end + 4);
    }
    const cleaned = raw.replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return undefined;
    return cleaned.slice(0, max);
  } catch {
    return undefined;
  }
}

export function listRecentNotes(vault: ObsidianVault, limit = 12): ObsidianNote[] {
  if (!vault.exists) return [];
  const out: ObsidianNote[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!ent.name.toLowerCase().endsWith('.md')) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({
        vaultPath: vault.path,
        vaultName: vault.name,
        relPath: path.relative(vault.path, full),
        filename: ent.name,
        lastModifiedAt: stat.mtime.toISOString(),
        lastModifiedMs: stat.mtimeMs,
        sizeBytes: stat.size,
        excerpt: undefined,
      });
    }
  }
  walk(vault.path, 0);
  out.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const trimmed = out.slice(0, limit);
  for (const note of trimmed) {
    note.excerpt = readExcerpt(path.join(note.vaultPath, note.relPath));
  }
  return trimmed;
}

export function obsidianUriFor(vault: ObsidianVault, relPath: string): string {
  const v = encodeURIComponent(vault.name);
  const f = encodeURIComponent(relPath.replace(/\.md$/i, ''));
  return `obsidian://open?vault=${v}&file=${f}`;
}

export function readObsidianStatus(): ObsidianStatus {
  const installed = fs.existsSync(REGISTRY_PATH);
  if (!installed) {
    return {
      installed: false,
      registryPath: undefined,
      vaults: [],
      primaryVault: undefined,
      recentNotes: [],
    };
  }
  const vaults = readVaultRegistry().filter((v) => v.exists);
  const primaryVault = vaults[0];
  const recentNotes = primaryVault ? listRecentNotes(primaryVault, 12) : [];
  return {
    installed: true,
    registryPath: REGISTRY_PATH,
    vaults,
    primaryVault,
    recentNotes,
  };
}

export interface SessionDigest {
  cwd: string | undefined;
  sessionId: string | undefined;
  startedAt: string | undefined;
  lastActivityAt: string | undefined;
  totalTokens: number;
  totalUsd: number;
  filesTouched: { filePath: string; tool: string; count: number }[];
  topTools: { tool: string; count: number }[];
  pilotName: string | undefined;
}

export function buildSessionMarkdown(digest: SessionDigest): { filename: string; body: string } {
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 16).replace(':', '');
  const proj = digest.cwd ? path.basename(digest.cwd) : 'session';
  const filename = `Claude session — ${proj} — ${stamp} ${time}.md`;
  const lines: string[] = [];
  lines.push('---');
  lines.push(`type: claude-session`);
  lines.push(`project: ${proj}`);
  lines.push(`cwd: ${digest.cwd ?? ''}`);
  lines.push(`session_id: ${digest.sessionId ?? ''}`);
  lines.push(`started_at: ${digest.startedAt ?? ''}`);
  lines.push(`last_activity_at: ${digest.lastActivityAt ?? ''}`);
  lines.push(`tokens: ${digest.totalTokens}`);
  lines.push(`cost_usd: ${digest.totalUsd.toFixed(4)}`);
  if (digest.pilotName) lines.push(`pilot: ${digest.pilotName}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Claude session — ${proj}`);
  lines.push('');
  lines.push(`> Saved by Claude Cockpit on ${date.toISOString()}.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Project**: ${proj} (\`${digest.cwd ?? '—'}\`)`);
  lines.push(`- **Session**: \`${digest.sessionId ?? '—'}\``);
  lines.push(`- **Started**: ${digest.startedAt ?? '—'}`);
  lines.push(`- **Last activity**: ${digest.lastActivityAt ?? '—'}`);
  lines.push(`- **Tokens**: ${digest.totalTokens.toLocaleString()}`);
  lines.push(`- **Cost**: $${digest.totalUsd.toFixed(2)}`);
  lines.push('');
  if (digest.filesTouched.length) {
    lines.push('## Files touched');
    lines.push('');
    for (const f of digest.filesTouched.slice(0, 25)) {
      lines.push(`- \`${f.filePath}\` — ${f.tool} ×${f.count}`);
    }
    lines.push('');
  }
  if (digest.topTools.length) {
    lines.push('## Tools used');
    lines.push('');
    for (const t of digest.topTools.slice(0, 12)) {
      lines.push(`- ${t.tool} — ${t.count}×`);
    }
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('');
  lines.push('_Add your reflections here._');
  lines.push('');
  return { filename, body: lines.join('\n') };
}

export function saveSessionToVault(
  vault: ObsidianVault,
  digest: SessionDigest,
  subdir = 'Claude sessions',
): string | undefined {
  if (!vault.exists) return undefined;
  const targetDir = path.join(vault.path, subdir);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    logger.error(`obsidian: mkdir failed for ${targetDir}`, err);
    return undefined;
  }
  const { filename, body } = buildSessionMarkdown(digest);
  const safeName = filename.replace(/[\/:]/g, '-');
  const full = path.join(targetDir, safeName);
  try {
    fs.writeFileSync(full, body, 'utf8');
  } catch (err) {
    logger.error(`obsidian: write failed for ${full}`, err);
    return undefined;
  }
  return full;
}
