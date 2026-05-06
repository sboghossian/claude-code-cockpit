import { execFile } from 'child_process';
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

// ===========================================================================
// Stats grid — streak, active days, peak hour, favorite model, week cost.
// ===========================================================================

export interface CockpitStats {
  streakDays: number;
  activeDays30: number;
  peakHour: number | undefined;
  peakHourLabel: string;
  favoriteModel: string | undefined;
  weekUsdRaw: number;
  totalSessions: number;
}

interface StatsInput {
  byHour: number[];
  byDay: number[];
  watchtower: { lastActivityMs: number; modelFamily: string; totalUsd: number }[];
  todayUsdRaw: number;
}

export function computeStats(input: StatsInput): CockpitStats {
  // Active days: count days in last 30 with any activity.
  const claudeHome = path.join(os.homedir(), '.claude', 'projects');
  const days30 = new Set<string>();
  let streak = 0;
  let weekUsd = 0;
  let totalSessions = 0;
  const modelTokens: Record<string, number> = {};
  if (fs.existsSync(claudeHome)) {
    let projects: string[] = [];
    try {
      projects = fs.readdirSync(claudeHome);
    } catch {
      /* ignore */
    }
    const now = Date.now();
    const cutoff30 = now - 30 * 86_400_000;
    const cutoff7 = now - 7 * 86_400_000;
    for (const proj of projects) {
      const dir = path.join(claudeHome, proj);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = path.join(dir, f);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.mtimeMs < cutoff30) continue;
        totalSessions += 1;
        const dayKey = new Date(stat.mtimeMs).toISOString().slice(0, 10);
        days30.add(dayKey);
        if (stat.mtimeMs >= cutoff7) {
          // Tally model + tokens cheaply for favorite/cost.
          let raw: string;
          try {
            raw = fs.readFileSync(full, 'utf8');
          } catch {
            continue;
          }
          let lastModel: string | undefined;
          for (const line of raw.split('\n')) {
            const mModel = line.match(/"model"\s*:\s*"([^"]+)"/);
            if (mModel) lastModel = mModel[1];
            const usage = line.match(
              /"usage"\s*:\s*\{[^}]*"input_tokens"\s*:\s*(\d+)[^}]*"output_tokens"\s*:\s*(\d+)/,
            );
            if (usage && lastModel) {
              const fam = lastModel.toLowerCase().includes('opus')
                ? 'opus'
                : lastModel.toLowerCase().includes('sonnet')
                  ? 'sonnet'
                  : lastModel.toLowerCase().includes('haiku')
                    ? 'haiku'
                    : 'unknown';
              modelTokens[fam] = (modelTokens[fam] ?? 0) + Number(usage[1]) + Number(usage[2]);
            }
          }
        }
      }
    }
    // Streak: count consecutive days back from today.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const k = d.toISOString().slice(0, 10);
      if (days30.has(k)) {
        streak += 1;
      } else {
        // Allow today to be empty — streak only breaks if a *prior* day has none.
        if (i === 0) continue;
        break;
      }
    }
  }

  let peakHour: number | undefined;
  let peakCount = -1;
  input.byHour.forEach((c, h) => {
    if (c > peakCount) {
      peakCount = c;
      peakHour = h;
    }
  });
  const peakHourLabel =
    peakHour === undefined || peakCount <= 0
      ? '—'
      : peakHour === 0
        ? '12 AM'
        : peakHour < 12
          ? `${peakHour} AM`
          : peakHour === 12
            ? '12 PM'
            : `${peakHour - 12} PM`;

  let favoriteModel: string | undefined;
  let favCount = 0;
  for (const [fam, count] of Object.entries(modelTokens)) {
    if (count > favCount) {
      favCount = count;
      favoriteModel = fam;
    }
  }

  // Week cost: rough sum across watchtower-tracked sessions in last 7d.
  // Most accurate signal we have without re-walking everything.
  weekUsd = input.watchtower.reduce((a, b) => a + b.totalUsd, 0) + input.todayUsdRaw;

  return {
    streakDays: streak,
    activeDays30: days30.size,
    peakHour,
    peakHourLabel,
    favoriteModel,
    weekUsdRaw: weekUsd,
    totalSessions,
  };
}

// ===========================================================================
// Inbox — aggregated "needs you" items for glance-at-a-time triage.
// ===========================================================================

export interface InboxItem {
  id: string;
  level: 'info' | 'warn' | 'danger';
  category: 'idle' | 'error' | 'memory' | 'plan' | 'subagent' | 'budget';
  title: string;
  detail: string;
  action: 'openSession' | 'openMemory' | 'openFile' | 'none';
  actionPayload: string | undefined;
}

interface InboxContext {
  watchtower: { name: string; ageSeconds: number; status: string; sessionFile: string }[];
  toolHistory: { tool: string; result: string; errorMessage?: string }[];
  memory: { isStale: boolean; title: string; filename: string }[];
  plans: { name: string; pendingCount: number; nextItems: string[]; path: string }[];
  subAgents: { agentId: string; jsonlFile: string; toolCallCount: number }[];
  budgetTone: 'ok' | 'warn' | 'danger';
}

export function computeInbox(ctx: InboxContext): InboxItem[] {
  const out: InboxItem[] = [];

  // Idle sessions
  for (const w of ctx.watchtower.filter((x) => x.status === 'idle' || x.status === 'stale').slice(0, 4)) {
    const mins = Math.floor(w.ageSeconds / 60);
    out.push({
      id: `idle-${w.name}`,
      level: 'info',
      category: 'idle',
      title: `${w.name} idle`,
      detail: `Waiting ${mins}min`,
      action: 'openSession',
      actionPayload: w.sessionFile,
    });
  }

  // Errored tools (recent)
  const errs = ctx.toolHistory.filter((t) => t.result === 'error').slice(0, 3);
  for (const e of errs) {
    out.push({
      id: `err-${e.tool}-${out.length}`,
      level: 'danger',
      category: 'error',
      title: `${e.tool} errored`,
      detail: (e.errorMessage ?? 'See tool decisions').slice(0, 100),
      action: 'none',
      actionPayload: undefined,
    });
  }

  // Stale memory
  const stale = ctx.memory.filter((m) => m.isStale);
  if (stale.length > 0) {
    out.push({
      id: 'mem-stale',
      level: 'info',
      category: 'memory',
      title: `${stale.length} stale memor${stale.length === 1 ? 'y' : 'ies'}`,
      detail: stale.slice(0, 3).map((m) => m.title).join(', '),
      action: 'openMemory',
      actionPayload: undefined,
    });
  }

  // Pending plan items
  for (const p of ctx.plans.slice(0, 2)) {
    if (p.pendingCount === 0) continue;
    out.push({
      id: `plan-${p.name}`,
      level: 'info',
      category: 'plan',
      title: `${p.name}: ${p.pendingCount} open`,
      detail: p.nextItems[0] ? p.nextItems[0].slice(0, 100) : 'See file',
      action: 'openFile',
      actionPayload: p.path,
    });
  }

  // Sub-agents that did work
  for (const a of ctx.subAgents.filter((x) => x.toolCallCount > 0).slice(0, 2)) {
    out.push({
      id: `sub-${a.agentId}`,
      level: 'info',
      category: 'subagent',
      title: `${a.agentId}: ${a.toolCallCount} tool calls`,
      detail: 'Click to inspect',
      action: 'openFile',
      actionPayload: a.jsonlFile,
    });
  }

  if (ctx.budgetTone === 'danger') {
    out.push({
      id: 'budget-danger',
      level: 'danger',
      category: 'budget',
      title: 'Budget cap hit',
      detail: 'See Config tab',
      action: 'none',
      actionPayload: undefined,
    });
  }

  return out;
}

// ===========================================================================
// Agents — read .claude/agents/*.md from global + workspace.
// ===========================================================================

export interface AgentDef {
  name: string;
  description: string;
  scope: 'global' | 'workspace';
  filePath: string;
  model: string | undefined;
  color: string | undefined;
  tools: string | undefined;
}

function parseAgentFrontmatter(raw: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function readAgentsFromDir(dir: string, scope: 'global' | 'workspace'): AgentDef[] {
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: AgentDef[] = [];
  for (const e of entries) {
    if (!e.endsWith('.md')) continue;
    const full = path.join(dir, e);
    let raw: string;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const fm = parseAgentFrontmatter(raw);
    out.push({
      name: fm.name || e.replace(/\.md$/, ''),
      description: fm.description || '',
      scope,
      filePath: full,
      model: fm.model || undefined,
      color: fm.color || undefined,
      tools: fm.tools || undefined,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function readAgents(cwd: string | undefined): AgentDef[] {
  const out: AgentDef[] = [];
  out.push(...readAgentsFromDir(path.join(os.homedir(), '.claude', 'agents'), 'global'));
  if (cwd) {
    out.push(...readAgentsFromDir(path.join(cwd, '.claude', 'agents'), 'workspace'));
  }
  return out;
}

// ===========================================================================
// Tunnels — Cloudflare config files at ~/.cloudflared/.
// ===========================================================================

export interface TunnelConfig {
  name: string;
  hostname: string | undefined;
  service: string | undefined;
  configPath: string;
}

export function readTunnels(): TunnelConfig[] {
  const dir = path.join(os.homedir(), '.cloudflared');
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: TunnelConfig[] = [];
  for (const e of entries) {
    if (!e.endsWith('.yml')) continue;
    if (e.includes('.bak')) continue;
    const full = path.join(dir, e);
    let raw: string;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const tunnel = (/^\s*tunnel:\s*(.+)$/m.exec(raw) ?? [])[1]?.trim();
    const host = (/hostname:\s*([^\s]+)/.exec(raw) ?? [])[1]?.trim();
    const service = (/service:\s*(http[^\s]+)/.exec(raw) ?? [])[1]?.trim();
    out.push({
      name: tunnel || e.replace(/\.ya?ml$/, ''),
      hostname: host,
      service,
      configPath: full,
    });
  }
  // Also walk a subdir if present (e.g. ~/.cloudflared/dashable/config.yml).
  let dirEntries: fs.Dirent[] = [];
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    /* ignore */
  }
  for (const ent of dirEntries) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(dir, ent.name);
    let subFiles: string[] = [];
    try {
      subFiles = fs.readdirSync(sub);
    } catch {
      continue;
    }
    for (const sf of subFiles) {
      if (sf !== 'config.yml' && sf !== 'config.yaml') continue;
      const full = path.join(sub, sf);
      let raw: string;
      try {
        raw = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const tunnel = (/^\s*tunnel:\s*(.+)$/m.exec(raw) ?? [])[1]?.trim();
      const host = (/hostname:\s*([^\s]+)/.exec(raw) ?? [])[1]?.trim();
      const service = (/service:\s*(http[^\s]+)/.exec(raw) ?? [])[1]?.trim();
      out.push({
        name: tunnel || ent.name,
        hostname: host,
        service,
        configPath: full,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ===========================================================================
// RTK savings — `rtk gain` if installed.
// ===========================================================================

export interface RtkStatus {
  installed: boolean;
  totalCommands: number | undefined;
  tokensSaved: string | undefined;
  efficiencyPct: number | undefined;
  topCommand: string | undefined;
  raw: string | undefined;
}

let cachedRtk: { status: RtkStatus; ts: number } | undefined;

export async function readRTKSavings(): Promise<RtkStatus> {
  if (cachedRtk && Date.now() - cachedRtk.ts < 60_000) {
    return cachedRtk.status;
  }
  const empty: RtkStatus = {
    installed: false,
    totalCommands: undefined,
    tokensSaved: undefined,
    efficiencyPct: undefined,
    topCommand: undefined,
    raw: undefined,
  };
  return new Promise((resolve) => {
    execFile('rtk', ['gain'], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) {
        cachedRtk = { status: empty, ts: Date.now() };
        resolve(empty);
        return;
      }
      const totalCmds = (/Total commands:\s*(\d+)/.exec(stdout) ?? [])[1];
      const saved = (/Tokens saved:\s*([\d.]+[KMB]?)\s*\(([\d.]+)%/.exec(stdout) ?? [])[1];
      const pct = (/Tokens saved:\s*[\d.]+[KMB]?\s*\(([\d.]+)%/.exec(stdout) ?? [])[1];
      const top = (/^\s*1\.\s+(\S.+?)\s{2}/m.exec(stdout) ?? [])[1];
      const status: RtkStatus = {
        installed: true,
        totalCommands: totalCmds ? Number(totalCmds) : undefined,
        tokensSaved: saved,
        efficiencyPct: pct ? Number(pct) : undefined,
        topCommand: top?.trim(),
        raw: stdout.slice(0, 600),
      };
      cachedRtk = { status, ts: Date.now() };
      resolve(status);
    });
  });
}

export function readRTKSavingsSync(): RtkStatus {
  if (cachedRtk) return cachedRtk.status;
  return {
    installed: false,
    totalCommands: undefined,
    tokensSaved: undefined,
    efficiencyPct: undefined,
    topCommand: undefined,
    raw: undefined,
  };
}
