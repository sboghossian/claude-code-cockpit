import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

// ===========================================================================
// Plans panel — parse tasks/*.md checkboxes from workspace + ancestors.
// ===========================================================================

export interface PlanFile {
  path: string;
  name: string;
  totalCount: number;
  doneCount: number;
  pendingCount: number;
  pct: number;
  nextItems: string[];
  lastModifiedAt: string;
  lastModifiedMs: number;
}

const PLAN_NAMES = new Set(['todo.md', 'forkcast.md', 'plan.md', 'tasks.md', 'TODO.md']);

export function readPlans(cwd: string | undefined): PlanFile[] {
  if (!cwd) return [];
  const out: PlanFile[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];
  // Look in <cwd>/tasks/ and <cwd>/ for plan files.
  candidates.push(path.join(cwd, 'tasks'));
  candidates.push(cwd);
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!PLAN_NAMES.has(e)) continue;
      const full = path.join(dir, e);
      if (seen.has(full)) continue;
      seen.add(full);
      const plan = parsePlanFile(full);
      if (plan) out.push(plan);
    }
  }
  out.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  return out;
}

function parsePlanFile(file: string): PlanFile | undefined {
  let raw: string;
  let stat: fs.Stats;
  try {
    raw = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch {
    return undefined;
  }
  let total = 0;
  let done = 0;
  const pending: string[] = [];
  for (const line of raw.split('\n')) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] === 'x' || m[1] === 'X') {
      done += 1;
    } else {
      const text = m[2].replace(/\*\*/g, '').replace(/`/g, '').trim();
      if (pending.length < 8) pending.push(text);
    }
  }
  if (total === 0) return undefined;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    path: file,
    name: path.basename(file),
    totalCount: total,
    doneCount: done,
    pendingCount: total - done,
    pct,
    nextItems: pending,
    lastModifiedAt: stat.mtime.toISOString(),
    lastModifiedMs: stat.mtimeMs,
  };
}

// ===========================================================================
// Activity heatmap — 7 days x 24 hours, from session JSONL mtimes.
// Concept borrowed from claude-usage (Python parser).
// ===========================================================================

export interface HeatmapCell {
  day: number; // 0 = oldest (6 days ago), 6 = today
  hour: number; // 0..23
  count: number;
}

export interface ActivityHeatmap {
  cells: HeatmapCell[];
  max: number;
  byHour: number[]; // length 24, total counts per hour-of-day across last 7d
  byDay: number[]; // length 7, total counts per day
}

export function computeActivityHeatmap(): ActivityHeatmap {
  const claudeHome = path.join(os.homedir(), '.claude', 'projects');
  const empty: ActivityHeatmap = {
    cells: [],
    max: 0,
    byHour: new Array(24).fill(0),
    byDay: new Array(7).fill(0),
  };
  if (!fs.existsSync(claudeHome)) return empty;
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return empty;
  }
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime() - 6 * 86_400_000; // 7 days inclusive

  const counts: Record<string, number> = {};
  for (const proj of projects) {
    const dir = path.join(claudeHome, proj);
    let dStat;
    try {
      dStat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!dStat.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      let raw: string;
      try {
        raw = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // Sample timestamps from message lines (cheap parse — first field).
      for (const line of raw.split('\n')) {
        const idx = line.indexOf('"timestamp"');
        if (idx < 0) continue;
        const tsMatch = line.slice(idx, idx + 64).match(/"timestamp"\s*:\s*"([^"]+)"/);
        if (!tsMatch) continue;
        const ts = new Date(tsMatch[1]).getTime();
        if (Number.isNaN(ts) || ts < cutoff) continue;
        const dayIdx = Math.floor((ts - cutoff) / 86_400_000);
        if (dayIdx < 0 || dayIdx > 6) continue;
        const hour = new Date(ts).getHours();
        const key = `${dayIdx}:${hour}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  const cells: HeatmapCell[] = [];
  const byHour = new Array(24).fill(0);
  const byDay = new Array(7).fill(0);
  let max = 0;
  for (const [key, count] of Object.entries(counts)) {
    const [day, hour] = key.split(':').map(Number);
    cells.push({ day, hour, count });
    byHour[hour] += count;
    byDay[day] += count;
    if (count > max) max = count;
  }
  return { cells, max, byHour, byDay };
}

// ===========================================================================
// claude-data-export — read claude.ai (Chat surface) export JSON files.
// ===========================================================================

export interface ChatConversationSummary {
  uuid: string;
  name: string;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  messageCount: number;
  excerpt: string | undefined;
}

export interface ChatMemorySummary {
  preview: string;
  fullPath: string;
  bytes: number;
}

export interface ChatExportStatus {
  installed: boolean;
  exportPath: string | undefined;
  conversationCount: number;
  recentConversations: ChatConversationSummary[];
  memoryPreview: ChatMemorySummary | undefined;
  projectCount: number;
}

const CHAT_EXPORT_CANDIDATES = [
  path.join(os.homedir(), 'Documents', 'Code', 'claude-data-export'),
  path.join(os.homedir(), 'claude-data-export'),
  path.join(os.homedir(), 'Downloads', 'claude-data-export'),
];

function findChatExport(): string | undefined {
  for (const c of CHAT_EXPORT_CANDIDATES) {
    if (fs.existsSync(path.join(c, 'conversations.json'))) return c;
  }
  return undefined;
}

interface RawChatMessage {
  text?: string;
  content?: { text?: string }[];
  sender?: string;
  created_at?: string;
}

interface RawChatConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: RawChatMessage[];
  messages?: RawChatMessage[];
}

export function readChatExport(): ChatExportStatus {
  const empty: ChatExportStatus = {
    installed: false,
    exportPath: undefined,
    conversationCount: 0,
    recentConversations: [],
    memoryPreview: undefined,
    projectCount: 0,
  };
  const exportPath = findChatExport();
  if (!exportPath) return empty;
  const out: ChatExportStatus = { ...empty, installed: true, exportPath };

  // Conversations
  const convFile = path.join(exportPath, 'conversations.json');
  if (fs.existsSync(convFile)) {
    let raw: string;
    try {
      raw = fs.readFileSync(convFile, 'utf8');
    } catch (err) {
      logger.warn(`chat-export: read failed ${convFile}: ${String(err)}`);
      return out;
    }
    let parsed: RawChatConversation[];
    try {
      parsed = JSON.parse(raw) as RawChatConversation[];
    } catch {
      return out;
    }
    out.conversationCount = parsed.length;
    const sorted = [...parsed].sort((a, b) => {
      const da = new Date(a.updated_at ?? a.created_at ?? '').getTime();
      const db = new Date(b.updated_at ?? b.created_at ?? '').getTime();
      return (Number.isNaN(db) ? 0 : db) - (Number.isNaN(da) ? 0 : da);
    });
    for (const c of sorted.slice(0, 20)) {
      const msgs = c.chat_messages ?? c.messages ?? [];
      let excerpt: string | undefined;
      for (const m of msgs) {
        const text =
          (typeof m.text === 'string' && m.text) ||
          (Array.isArray(m.content) && m.content[0]?.text) ||
          '';
        if (text && text.length > 10) {
          excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 140);
          break;
        }
      }
      out.recentConversations.push({
        uuid: c.uuid ?? '',
        name: c.name?.trim() || c.summary?.trim() || 'Untitled',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        messageCount: msgs.length,
        excerpt,
      });
    }
  }

  // Memories
  const memFile = path.join(exportPath, 'memories.json');
  if (fs.existsSync(memFile)) {
    try {
      const stat = fs.statSync(memFile);
      const raw = fs.readFileSync(memFile, 'utf8');
      const parsed = JSON.parse(raw) as { conversations_memory?: string }[];
      const first = parsed[0];
      if (first?.conversations_memory) {
        out.memoryPreview = {
          preview: first.conversations_memory.replace(/\s+/g, ' ').trim().slice(0, 280),
          fullPath: memFile,
          bytes: stat.size,
        };
      }
    } catch (err) {
      logger.warn(`chat-export: memory read failed: ${String(err)}`);
    }
  }

  // Projects
  const projFile = path.join(exportPath, 'projects.json');
  if (fs.existsSync(projFile)) {
    try {
      const raw = fs.readFileSync(projFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown[];
      out.projectCount = parsed.length;
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ===========================================================================
// claude-usage — detect dashboard running on common ports.
// ===========================================================================

export interface UsageDashboardStatus {
  installed: boolean;
  installPath: string | undefined;
  runningOnPort: number | undefined;
  url: string | undefined;
}

const USAGE_INSTALL_CANDIDATES = [
  path.join(os.homedir(), 'Documents', 'Code', 'claude-usage'),
  path.join(os.homedir(), 'claude-usage'),
];
const USAGE_PORTS = [5000, 8000, 8080, 5050, 5001];

let cachedUsage: { status: UsageDashboardStatus; ts: number } | undefined;

export async function detectUsageDashboard(): Promise<UsageDashboardStatus> {
  // Cache for 30s — port checks add up.
  if (cachedUsage && Date.now() - cachedUsage.ts < 30_000) {
    return cachedUsage.status;
  }
  let installPath: string | undefined;
  for (const c of USAGE_INSTALL_CANDIDATES) {
    if (fs.existsSync(path.join(c, 'server.py'))) {
      installPath = c;
      break;
    }
  }
  let runningOnPort: number | undefined;
  for (const port of USAGE_PORTS) {
    if (await ping(port)) {
      runningOnPort = port;
      break;
    }
  }
  const status: UsageDashboardStatus = {
    installed: Boolean(installPath),
    installPath,
    runningOnPort,
    url: runningOnPort ? `http://localhost:${runningOnPort}` : undefined,
  };
  cachedUsage = { status, ts: Date.now() };
  return status;
}

function ping(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: 'localhost', port, method: 'HEAD', timeout: 250, path: '/' },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// Synchronous fallback used by snapshot() — only checks the installed flag.
export function detectUsageDashboardSync(): UsageDashboardStatus {
  let installPath: string | undefined;
  for (const c of USAGE_INSTALL_CANDIDATES) {
    if (fs.existsSync(path.join(c, 'server.py'))) {
      installPath = c;
      break;
    }
  }
  return cachedUsage?.status ?? {
    installed: Boolean(installPath),
    installPath,
    runningOnPort: undefined,
    url: undefined,
  };
}
