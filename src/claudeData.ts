import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { ObsidianStatus, readObsidianStatus } from './obsidian';
import { MacHealthSnapshot, readMacHealthSync } from './macHealth';
import {
  ActivityHeatmap,
  AgentDef,
  ChatExportStatus,
  CockpitStats,
  InboxItem,
  PlanFile,
  RtkStatus,
  TunnelConfig,
  UsageDashboardStatus,
  computeActivityHeatmap,
  computeInbox,
  computeStats,
  detectUsageDashboardSync,
  readAgents,
  readChatExport,
  readPlans,
  readRTKSavingsSync,
  readTunnels,
} from './integrations';

export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  filesTouched: FileTouch[];
  toolCallCount: number;
  messageCount: number;
  startedAt: string | undefined;
  lastActivityAt: string | undefined;
  lastModel: string | undefined;
  modelFamily: ModelFamily;
  isActive: boolean;
  cost: CostBreakdown;
  sparkline: SparklinePoint[];
  subAgents: SubAgentSummary[];
  toolHistogram: ToolHistogramEntry[];
  costPerHourUsd: number;
  activityFeed: ActivityEntry[];
  contextWindowMax: number;
  contextFillPct: number;
  cacheHitRate: number;
  toolHistory: ToolHistoryEntry[];
}

export interface ToolHistoryEntry {
  timestamp: string;
  tool: string;
  argsSummary: string;
  result: 'ok' | 'error' | 'pending';
  errorMessage: string | undefined;
}

export interface ClaudeMdEntry {
  path: string;
  scope: 'global' | 'project' | 'ancestor';
  sizeBytes: number;
}

export interface OfficeStatus {
  installPath: string | undefined;
  hookConfigured: boolean;
  port: number;
}

export interface ToolHistogramEntry {
  tool: string;
  count: number;
}

export interface ActivityEntry {
  timestamp: string;
  kind: 'message' | 'tool_use';
  summary: string;
}

export interface TodaySummary {
  sessions: number;
  totalTokens: number;
  totalUsd: number;
  perProject: { name: string; sessions: number; tokens: number; usd: number }[];
  topFiles: { path: string; touches: number }[];
  topTools: { tool: string; count: number }[];
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'unknown';

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
}

export interface SparklinePoint {
  minute: number;
  tokens: number;
}

export interface SubAgentSummary {
  agentId: string;
  jsonlFile: string;
  totalTokens: number;
  toolCallCount: number;
  messageCount: number;
  lastActivityAt: string | undefined;
  lastActivityMs: number;
}

export interface SkillEntry {
  name: string;
  description: string;
  source: 'user' | 'plugin';
  pluginName: string | undefined;
  useCount: number;
}

export interface PilotProfile {
  name: string;
  role: string | undefined;
  principles: string[];
  oneLiner: string | undefined;
  alwaysLive: string[];
  sourceFile: string;
}

export interface MemorySearchHit {
  filename: string;
  title: string;
  hook: string;
  matchSnippet: string | undefined;
}

export interface FileTouch {
  filePath: string;
  tool: string;
  count: number;
  lastTouchedAt: string;
}

export interface MemoryEntry {
  title: string;
  filename: string;
  hook: string;
  lastModifiedAt: string | undefined;
  lastModifiedMs: number;
  isStale: boolean;
}

export interface ProjectSummary {
  name: string;
  encodedPath: string;
  decodedPath: string;
  projectDir: string;
  sessionCount: number;
  lastActivityAt: string | undefined;
  lastActivityMs: number;
  totalTokens: number;
}

export interface HookEventSummary {
  event: string;
  count: number;
  commands: string[];
}

export interface SettingsSummary {
  settingsExists: boolean;
  mcpServerNames: string[];
  hooks: HookEventSummary[];
  enabledPlugins: string[];
}

export interface CockpitSnapshot {
  cwd: string | undefined;
  projectDir: string | undefined;
  stats: SessionStats;
  memory: MemoryEntry[];
  projects: ProjectSummary[];
  settings: SettingsSummary;
  skills: SkillEntry[];
  pilot: PilotProfile | undefined;
  today: TodaySummary;
  diskUsageBytes: number;
  localLayout: LocalLayout;
  claudeMdStack: ClaudeMdEntry[];
  office: OfficeStatus;
  watchtower: WatchtowerSession[];
  obsidian: ObsidianStatus;
  costByTool: CostByToolEntry[];
  notifications: Notification[];
  budget: BudgetStatus;
  plans: PlanFile[];
  chatExport: ChatExportStatus;
  heatmap: ActivityHeatmap;
  usageDashboard: UsageDashboardStatus;
  cockpitStats: CockpitStats;
  inbox: InboxItem[];
  agents: AgentDef[];
  tunnels: TunnelConfig[];
  rtk: RtkStatus;
  greeting: string;
  macHealth: MacHealthSnapshot;
}

export interface WatchtowerSession {
  decodedPath: string;
  projectDir: string;
  sessionFile: string;
  sessionId: string | undefined;
  name: string;
  lastActivityAt: string;
  lastActivityMs: number;
  ageSeconds: number;
  status: 'live' | 'recent' | 'idle' | 'stale';
  totalTokens: number;
  totalUsd: number;
  model: string | undefined;
  modelFamily: ModelFamily;
}

export interface CostByToolEntry {
  tool: string;
  count: number;
  approxUsd: number;
  approxTokens: number;
}

export interface Notification {
  id: string;
  level: 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
  action: 'openMemory' | 'openSession' | 'openSettings' | 'openVault' | 'none';
  actionPayload: string | undefined;
}

export interface BudgetStatus {
  enabled: boolean;
  dailyCapUsd: number;
  sessionCapUsd: number;
  spentTodayUsd: number;
  spentSessionUsd: number;
  dailyPct: number;
  sessionPct: number;
  dailyTone: 'ok' | 'warn' | 'danger';
  sessionTone: 'ok' | 'warn' | 'danger';
}

export interface BudgetConfig {
  enabled: boolean;
  dailyCapUsd: number;
  sessionCapUsd: number;
}

export interface LocalEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  itemCount: number | undefined;
  lastModifiedAt: string | undefined;
  lastModifiedMs: number;
}

export interface LocalLayout {
  motherFolder: string;
  motherEntries: LocalEntry[];
  sessionFolder: string | undefined;
  sessionEntries: LocalEntry[];
  globalSettingsFile: string | undefined;
  activeSessionFile: string | undefined;
}

const claudeHome = path.join(os.homedir(), '.claude', 'projects');
const claudeSettingsFile = path.join(os.homedir(), '.claude', 'settings.json');

export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

export function projectDirFor(cwd: string): string {
  return path.join(claudeHome, encodeCwd(cwd));
}

export function findActiveSession(cwd: string): string | undefined {
  const dir = projectDirFor(cwd);
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  let best: { file: string; mtime: number } | undefined;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.jsonl')) {
      continue;
    }
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (!best || stat.mtimeMs > best.mtime) {
        best = { file: full, mtime: stat.mtimeMs };
      }
    } catch (err) {
      logger.warn(`stat failed for ${full}: ${String(err)}`);
    }
  }
  return best?.file;
}

interface UsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ContentBlock {
  type?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  input?: {
    file_path?: string;
    path?: string;
    command?: string;
    description?: string;
    pattern?: string;
    query?: string;
    [k: string]: unknown;
  };
}

interface SessionLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    model?: string;
    usage?: UsageBlock;
    content?: ContentBlock[] | string;
  };
}

function parseLine(raw: string): SessionLine | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as SessionLine;
  } catch {
    return undefined;
  }
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const EMPTY_COST: CostBreakdown = {
  inputUsd: 0,
  outputUsd: 0,
  cacheReadUsd: 0,
  cacheCreationUsd: 0,
  totalUsd: 0,
};

function emptyStatsFor(file: string | undefined): SessionStats {
  return {
    sessionFile: file,
    sessionId: undefined,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    filesTouched: [],
    toolCallCount: 0,
    messageCount: 0,
    startedAt: undefined,
    lastActivityAt: undefined,
    lastModel: undefined,
    modelFamily: 'unknown',
    isActive: false,
    cost: { ...EMPTY_COST },
    sparkline: [],
    subAgents: [],
    toolHistogram: [],
    costPerHourUsd: 0,
    activityFeed: [],
    contextWindowMax: 0,
    contextFillPct: 0,
    cacheHitRate: 0,
    toolHistory: [],
  };
}

export function readSession(file: string | undefined, cwd: string): SessionStats {
  const empty = emptyStatsFor(file);
  if (!file || !fs.existsSync(file)) {
    return empty;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    logger.error(`readSession: failed to read ${file}`, err);
    return empty;
  }
  const stats = { ...empty };
  const touches = new Map<string, FileTouch>();
  const toolCounts = new Map<string, number>();
  const activity: ActivityEntry[] = [];
  const toolHistoryMap = new Map<string, ToolHistoryEntry>();
  let lastWorkingSet = 0;
  for (const line of raw.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }
    if (parsed.type === 'user' || parsed.type === 'assistant') {
      stats.messageCount += 1;
    }
    if (!stats.startedAt && parsed.timestamp) {
      stats.startedAt = parsed.timestamp;
    }
    if (parsed.timestamp) {
      stats.lastActivityAt = parsed.timestamp;
    }
    if (parsed.sessionId && !stats.sessionId) {
      stats.sessionId = parsed.sessionId;
    }
    const usage = parsed.message?.usage;
    if (usage) {
      stats.inputTokens += usage.input_tokens ?? 0;
      stats.outputTokens += usage.output_tokens ?? 0;
      stats.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      stats.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      if (parsed.type === 'assistant') {
        // Capture working-set size at the most recent assistant call.
        const cur =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        if (cur > 0) lastWorkingSet = cur;
      }
    }
    const model = parsed.message?.model;
    if (typeof model === 'string') {
      stats.lastModel = model;
    }
    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const entry = toolHistoryMap.get(block.tool_use_id);
          if (entry) {
            entry.result = block.is_error ? 'error' : 'ok';
            if (block.is_error && typeof block.content === 'string') {
              entry.errorMessage = block.content.slice(0, 200);
            }
          }
          continue;
        }
        if (block.type !== 'tool_use' || !block.name) {
          continue;
        }
        stats.toolCallCount += 1;
        toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
        const argsSummary = summarizeToolArgs(block);
        if (block.id) {
          toolHistoryMap.set(block.id, {
            timestamp: parsed.timestamp ?? '',
            tool: block.name,
            argsSummary,
            result: 'pending',
            errorMessage: undefined,
          });
        }
        if (parsed.timestamp) {
          const filePath = block.input?.file_path ?? block.input?.path;
          activity.push({
            timestamp: parsed.timestamp,
            kind: 'tool_use',
            summary: filePath ? `${block.name}: ${filePath}` : block.name,
          });
        }
        if (!FILE_TOOLS.has(block.name)) {
          continue;
        }
        const filePath = block.input?.file_path ?? block.input?.path;
        if (!filePath) {
          continue;
        }
        const key = `${block.name}::${filePath}`;
        const existing = touches.get(key);
        if (existing) {
          existing.count += 1;
          existing.lastTouchedAt = parsed.timestamp ?? existing.lastTouchedAt;
        } else {
          touches.set(key, {
            filePath,
            tool: block.name,
            count: 1,
            lastTouchedAt: parsed.timestamp ?? '',
          });
        }
      }
    } else if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.timestamp) {
      activity.push({
        timestamp: parsed.timestamp,
        kind: 'message',
        summary: parsed.type === 'user' ? 'user message' : 'assistant message',
      });
    }
  }
  stats.filesTouched = Array.from(touches.values()).sort(
    (a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt),
  );
  stats.totalTokens =
    stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;
  stats.modelFamily = modelFamilyOf(stats.lastModel);
  stats.cost = computeCost(stats);
  try {
    const fStat = fs.statSync(file);
    stats.isActive = Date.now() - fStat.mtimeMs < 10_000;
  } catch {
    stats.isActive = false;
  }
  stats.sparkline = computeSparkline(file);
  if (stats.sessionId) {
    stats.subAgents = listSubAgents(file, stats.sessionId);
  }
  stats.toolHistogram = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);
  stats.activityFeed = activity.slice(-25).reverse();
  stats.costPerHourUsd = computeCostPerHour(stats);
  stats.contextWindowMax = contextWindowFor(stats.lastModel);
  // If working set blew past the assumed 200k window, the user is on a 1M
  // context plan we couldn't detect from the model string. Promote.
  if (lastWorkingSet > stats.contextWindowMax) {
    stats.contextWindowMax = 1_000_000;
  }
  stats.contextFillPct = stats.contextWindowMax
    ? Math.min(100, (lastWorkingSet / stats.contextWindowMax) * 100)
    : 0;
  const cacheable = stats.cacheReadTokens + stats.inputTokens;
  stats.cacheHitRate = cacheable > 0 ? stats.cacheReadTokens / cacheable : 0;
  stats.toolHistory = Array.from(toolHistoryMap.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 30);
  void cwd;
  return stats;
}

function summarizeToolArgs(block: ContentBlock): string {
  const i = block.input;
  if (!i) return '';
  if (block.name === 'Bash' && typeof i.command === 'string') {
    return i.command.slice(0, 120);
  }
  if (typeof i.file_path === 'string') return i.file_path;
  if (typeof i.path === 'string') return i.path;
  if (typeof i.pattern === 'string') return i.pattern;
  if (typeof i.query === 'string') return i.query;
  if (typeof i.description === 'string') return i.description.slice(0, 120);
  // Fallback: stringify first key/value
  const entries = Object.entries(i).slice(0, 1);
  if (entries.length === 0) return '';
  const [key, value] = entries[0];
  if (typeof value === 'string') return `${key}=${value.slice(0, 80)}`;
  return key;
}

function computeCostPerHour(stats: SessionStats): number {
  if (!stats.startedAt || !stats.lastActivityAt) return 0;
  const start = new Date(stats.startedAt).getTime();
  const end = new Date(stats.lastActivityAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  const hours = (end - start) / 3_600_000;
  if (hours < 1 / 60) return 0; // under one minute, rate is unstable
  return stats.cost.totalUsd / hours;
}

export function readMemoryIndex(cwd: string): MemoryEntry[] {
  const file = path.join(projectDirFor(cwd), 'memory', 'MEMORY.md');
  if (!fs.existsSync(file)) {
    return [];
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    logger.error(`readMemoryIndex: failed to read ${file}`, err);
    return [];
  }
  const entries: MemoryEntry[] = [];
  const linkPattern = /^- \[(.+?)\]\((.+?)\)\s*[—-]\s*(.+)$/;
  const memDir = path.join(projectDirFor(cwd), 'memory');
  const staleThresholdMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const now = Date.now();
  for (const line of raw.split('\n')) {
    const match = linkPattern.exec(line.trim());
    if (match) {
      const filename = match[2];
      let mtime = 0;
      let mtimeIso: string | undefined;
      try {
        const st = fs.statSync(path.join(memDir, filename));
        mtime = st.mtimeMs;
        mtimeIso = st.mtime.toISOString();
      } catch {
        /* file missing — leave mtime 0 */
      }
      entries.push({
        title: match[1],
        filename,
        hook: match[3],
        lastModifiedAt: mtimeIso,
        lastModifiedMs: mtime,
        isStale: mtime > 0 && now - mtime > staleThresholdMs,
      });
    }
  }
  return entries;
}

export function memoryFilePath(cwd: string, filename: string): string {
  return path.join(projectDirFor(cwd), 'memory', filename);
}

export function memoryIndexPath(cwd: string): string {
  return path.join(projectDirFor(cwd), 'memory', 'MEMORY.md');
}

function decodeProjectName(encoded: string): string {
  return '/' + encoded.replace(/^-/, '').replace(/-/g, '/');
}

export function listProjects(limit = 20): ProjectSummary[] {
  if (!fs.existsSync(claudeHome)) {
    return [];
  }
  const out: ProjectSummary[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(claudeHome);
  } catch (err) {
    logger.error(`listProjects: failed to read ${claudeHome}`, err);
    return [];
  }
  for (const entry of entries) {
    const dir = path.join(claudeHome, entry);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    let sessions: string[] = [];
    try {
      sessions = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    let lastMs = 0;
    let lastIso: string | undefined;
    let bestSessionFile: string | undefined;
    for (const s of sessions) {
      const full = path.join(dir, s);
      try {
        const sStat = fs.statSync(full);
        if (sStat.mtimeMs > lastMs) {
          lastMs = sStat.mtimeMs;
          lastIso = sStat.mtime.toISOString();
          bestSessionFile = full;
        }
      } catch {
        continue;
      }
    }
    if (sessions.length === 0) {
      continue;
    }
    const decoded = decodeProjectName(entry);
    let totalTokens = 0;
    if (bestSessionFile) {
      const summary = readSession(bestSessionFile, decoded);
      totalTokens = summary.totalTokens;
    }
    out.push({
      name: path.basename(decoded),
      encodedPath: entry,
      decodedPath: decoded,
      projectDir: dir,
      sessionCount: sessions.length,
      lastActivityAt: lastIso,
      lastActivityMs: lastMs,
      totalTokens,
    });
  }
  out.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  return out.slice(0, limit);
}

export function readGlobalSettings(): SettingsSummary {
  const empty: SettingsSummary = {
    settingsExists: false,
    mcpServerNames: [],
    hooks: [],
    enabledPlugins: [],
  };
  if (!fs.existsSync(claudeSettingsFile)) {
    return empty;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(claudeSettingsFile, 'utf8');
  } catch (err) {
    logger.error(`readGlobalSettings: failed to read ${claudeSettingsFile}`, err);
    return empty;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`readGlobalSettings: settings.json is not valid JSON: ${String(err)}`);
    return empty;
  }
  const mcp = parsed.mcpServers;
  const mcpServerNames =
    mcp && typeof mcp === 'object' && !Array.isArray(mcp) ? Object.keys(mcp).sort() : [];

  const hooksRaw = parsed.hooks;
  const hooks: HookEventSummary[] = [];
  if (hooksRaw && typeof hooksRaw === 'object' && !Array.isArray(hooksRaw)) {
    for (const [event, value] of Object.entries(hooksRaw)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const commands: string[] = [];
      let count = 0;
      for (const matcher of value) {
        if (matcher && typeof matcher === 'object' && Array.isArray((matcher as { hooks?: unknown }).hooks)) {
          const hookList = (matcher as { hooks: unknown[] }).hooks;
          for (const h of hookList) {
            if (h && typeof h === 'object') {
              const cmd = (h as { command?: unknown }).command;
              if (typeof cmd === 'string') {
                commands.push(cmd.split(/\s+/)[0]);
              }
              count += 1;
            }
          }
        }
      }
      if (count > 0) {
        hooks.push({ event, count, commands: Array.from(new Set(commands)) });
      }
    }
  }
  hooks.sort((a, b) => a.event.localeCompare(b.event));

  const pluginsRaw = parsed.enabledPlugins;
  const enabledPlugins =
    pluginsRaw && typeof pluginsRaw === 'object' && !Array.isArray(pluginsRaw)
      ? Object.keys(pluginsRaw).sort()
      : [];

  return {
    settingsExists: true,
    mcpServerNames,
    hooks,
    enabledPlugins,
  };
}

// === v0.3.0 additions =====================================================

// Cost tracker. Prices in USD per million tokens, current as of 2026-05.
// Refresh against https://www.anthropic.com/pricing if these go stale.
const PRICING: Record<ModelFamily, {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
  unknown: { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
};

export function modelFamilyOf(model: string | undefined): ModelFamily {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function contextWindowFor(model: string | undefined): number {
  if (!model) return 200_000;
  const m = model.toLowerCase();
  if (m.includes('[1m]') || m.includes('-1m') || m.endsWith('1m')) return 1_000_000;
  if (m.includes('haiku')) return 200_000;
  return 200_000;
}

export function computeCost(
  stats: Pick<
    SessionStats,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'modelFamily'
  >,
): CostBreakdown {
  const rate = PRICING[stats.modelFamily];
  const inputUsd = (stats.inputTokens / 1_000_000) * rate.input;
  const outputUsd = (stats.outputTokens / 1_000_000) * rate.output;
  const cacheReadUsd = (stats.cacheReadTokens / 1_000_000) * rate.cacheRead;
  const cacheCreationUsd = (stats.cacheCreationTokens / 1_000_000) * rate.cacheCreation;
  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheCreationUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheCreationUsd,
  };
}

export function formatUsd(n: number): string {
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

// Sparkline. Bucket the last 60 minutes by minute, count tokens per bucket.
export function computeSparkline(file: string): SparklinePoint[] {
  if (!fs.existsSync(file)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const now = Date.now();
  const buckets = new Map<number, number>();
  for (const line of raw.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed?.timestamp) continue;
    const ts = new Date(parsed.timestamp).getTime();
    if (Number.isNaN(ts)) continue;
    const ageMin = Math.floor((now - ts) / 60_000);
    if (ageMin < 0 || ageMin > 59) continue;
    const usage = parsed.message?.usage;
    if (!usage) continue;
    const t =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (t === 0) continue;
    buckets.set(ageMin, (buckets.get(ageMin) ?? 0) + t);
  }
  const points: SparklinePoint[] = [];
  for (let m = 59; m >= 0; m--) {
    points.push({ minute: m, tokens: buckets.get(m) ?? 0 });
  }
  return points;
}

// Sub-agents live at <projectDir>/<sessionId>/subagents/*.jsonl
export function listSubAgents(sessionFile: string, sessionId: string): SubAgentSummary[] {
  const dir = path.join(path.dirname(sessionFile), sessionId, 'subagents');
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: SubAgentSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let totalTokens = 0;
    let toolCallCount = 0;
    let messageCount = 0;
    let lastActivityAt: string | undefined;
    for (const line of raw.split('\n')) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (parsed.type === 'user' || parsed.type === 'assistant') messageCount += 1;
      if (parsed.timestamp) lastActivityAt = parsed.timestamp;
      const usage = parsed.message?.usage;
      if (usage) {
        totalTokens +=
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
      }
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') toolCallCount += 1;
        }
      }
    }
    out.push({
      agentId: entry.replace(/\.jsonl$/, ''),
      jsonlFile: full,
      totalTokens,
      toolCallCount,
      messageCount,
      lastActivityAt,
      lastActivityMs: stat.mtimeMs,
    });
  }
  out.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  return out;
}

// Skill palette. Reads ~/.claude/skills/<name>/SKILL.md plus plugin caches.
const skillsDir = path.join(os.homedir(), '.claude', 'skills');
const pluginsCacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache');

function parseFrontmatter(raw: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---/m.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const idx = line.indexOf(':');
    if (idx < 0) {
      i += 1;
      continue;
    }
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key) {
      i += 1;
      continue;
    }
    // YAML block scalar (| or >) — gather indented continuation lines.
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      const folded = val.startsWith('>');
      const collected: string[] = [];
      i += 1;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        collected.push(lines[i].replace(/^\s+/, ''));
        i += 1;
      }
      out[key] = folded ? collected.join(' ').trim() : collected.join('\n').trim();
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

function collectSkillsFrom(
  dir: string,
  source: 'user' | 'plugin',
  pluginName: string | undefined,
  out: SkillEntry[],
): void {
  if (!fs.existsSync(dir)) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const skillFile = path.join(dir, entry, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(skillFile, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    const name = fm.name || entry;
    const description = fm.description || '';
    out.push({ name, description, source, pluginName, useCount: 0 });
  }
}

export function listSkills(activeSessionFile?: string): SkillEntry[] {
  const out: SkillEntry[] = [];
  collectSkillsFrom(skillsDir, 'user', undefined, out);
  if (fs.existsSync(pluginsCacheDir)) {
    let plugins: string[];
    try {
      plugins = fs.readdirSync(pluginsCacheDir);
    } catch {
      plugins = [];
    }
    for (const plugin of plugins) {
      collectSkillsFrom(
        path.join(pluginsCacheDir, plugin, 'skills'),
        'plugin',
        plugin,
        out,
      );
    }
  }
  if (activeSessionFile && fs.existsSync(activeSessionFile)) {
    try {
      const raw = fs.readFileSync(activeSessionFile, 'utf8');
      const counts = new Map<string, number>();
      // Match either a literal slash invocation /name or a <command-name>name</command-name> tag.
      const slashRe = /(?:^|[\s"'`,(])\/([a-z][a-z0-9-]{1,40})\b/gim;
      const tagRe = /<command-name>([a-z][a-z0-9-]{1,40})<\/command-name>/gi;
      let m: RegExpExecArray | null;
      while ((m = slashRe.exec(raw)) !== null) {
        counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) ?? 0) + 1);
      }
      while ((m = tagRe.exec(raw)) !== null) {
        counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) ?? 0) + 1);
      }
      for (const skill of out) {
        const k = skill.name.toLowerCase();
        skill.useCount = counts.get(k) ?? 0;
      }
    } catch {
      /* ignore — counts stay 0 */
    }
  }
  out.sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// CLAUDE.md stack — every CLAUDE.md file in scope for the active cwd.
export function readClaudeMdStack(cwd: string): ClaudeMdEntry[] {
  const out: ClaudeMdEntry[] = [];
  const homeFile = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  if (fs.existsSync(homeFile)) {
    try {
      const st = fs.statSync(homeFile);
      out.push({ path: homeFile, scope: 'global', sizeBytes: st.size });
    } catch {
      /* skip */
    }
  }
  const projectFile = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(projectFile)) {
    try {
      const st = fs.statSync(projectFile);
      out.push({ path: projectFile, scope: 'project', sizeBytes: st.size });
    } catch {
      /* skip */
    }
  }
  // Walk ancestors
  let dir = path.dirname(cwd);
  const root = path.parse(dir).root;
  let safety = 0;
  while (dir !== root && dir !== os.homedir() && safety++ < 20) {
    const f = path.join(dir, 'CLAUDE.md');
    if (fs.existsSync(f)) {
      try {
        const st = fs.statSync(f);
        out.push({ path: f, scope: 'ancestor', sizeBytes: st.size });
      } catch {
        /* skip */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

// Office (paulrobello/claude-office) presence detection.
export function detectOffice(settings: SettingsSummary): OfficeStatus {
  const candidates = [
    path.join(os.homedir(), 'Documents', 'Code', 'claude-office'),
    path.join(os.homedir(), 'claude-office'),
  ];
  let installPath: string | undefined;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      installPath = c;
      break;
    }
  }
  const hookConfigured = settings.hooks.some((h) =>
    h.commands.some((c) => c.toLowerCase().includes('claude-office')),
  );
  return { installPath, hookConfigured, port: 3000 };
}

// Pilot profile. Auto-detect <user>_claude.md in active session memory dir,
// extract identity + principles + always-live subdomains.
export function readPilotProfile(cwd: string): PilotProfile | undefined {
  const memDir = path.join(projectDirFor(cwd), 'memory');
  if (!fs.existsSync(memDir)) return undefined;

  let memFiles: string[];
  try {
    memFiles = fs.readdirSync(memDir);
  } catch {
    return undefined;
  }
  const claudeFile = memFiles.find((f) => /_claude\.md$/.test(f));
  if (!claudeFile) return undefined;

  const claudePath = path.join(memDir, claudeFile);
  let raw: string;
  try {
    raw = fs.readFileSync(claudePath, 'utf8');
  } catch {
    return undefined;
  }
  const fm = parseFrontmatter(raw);
  const username = claudeFile.replace(/_claude\.md$/, '');
  const name = (fm.name || username).split(/['']s\s+/i)[0].trim();

  const principles: string[] = [];
  const principleRegex = /^\s*\d+\.\s+\*\*([^*]+?)\*\*\.?\s*(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = principleRegex.exec(raw)) !== null) {
    const headline = match[1].trim();
    if (headline) principles.push(headline);
  }

  let oneLiner: string | undefined;
  const quoteMatch = /^"([^"]{4,200})"\s*$/m.exec(raw);
  if (quoteMatch) oneLiner = quoteMatch[1];

  const alwaysLive = readAlwaysLiveSubdomains(memDir);

  return {
    name: capitalize(name) || capitalize(username),
    role: fm.description || undefined,
    principles,
    oneLiner,
    alwaysLive,
    sourceFile: claudePath,
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function readAlwaysLiveSubdomains(memDir: string): string[] {
  const candidates = ['project_always_live_subdomains.md', 'always_live_subdomains.md'];
  for (const c of candidates) {
    const full = path.join(memDir, c);
    if (!fs.existsSync(full)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const found: string[] = [];
    for (const line of raw.split('\n')) {
      const m = /^\s*-\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*$/i.exec(line);
      if (m) found.push(m[1]);
    }
    if (found.length) return found;
  }
  return [];
}

// Today summary — sessions/tokens/cost touched today, across all projects.
export function computeToday(): TodaySummary {
  const empty: TodaySummary = {
    sessions: 0,
    totalTokens: 0,
    totalUsd: 0,
    perProject: [],
    topFiles: [],
    topTools: [],
  };
  if (!fs.existsSync(claudeHome)) return empty;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();

  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return empty;
  }

  const out: TodaySummary = { ...empty, perProject: [] };
  const fileTouches = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  for (const proj of projects) {
    const dir = path.join(claudeHome, proj);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    let projectSessions = 0;
    let projectTokens = 0;
    let projectUsd = 0;
    for (const f of files) {
      const full = path.join(dir, f);
      let fStat;
      try {
        fStat = fs.statSync(full);
      } catch {
        continue;
      }
      if (fStat.mtimeMs < cutoff) continue;
      const decoded = decodeProjectName(proj);
      const s = readSessionLight(full, fileTouches, toolCounts);
      if (s.totalTokens === 0 && s.messageCount === 0) continue;
      projectSessions += 1;
      projectTokens += s.totalTokens;
      projectUsd += computeCost({
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        modelFamily: modelFamilyOf(s.lastModel),
      }).totalUsd;
      void decoded;
    }
    if (projectSessions > 0) {
      out.sessions += projectSessions;
      out.totalTokens += projectTokens;
      out.totalUsd += projectUsd;
      out.perProject.push({
        name: path.basename(decodeProjectName(proj)) || proj,
        sessions: projectSessions,
        tokens: projectTokens,
        usd: projectUsd,
      });
    }
  }
  out.perProject.sort((a, b) => b.usd - a.usd);
  out.topFiles = Array.from(fileTouches.entries())
    .map(([p, touches]) => ({ path: p, touches }))
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 10);
  out.topTools = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return out;
}

// Cheaper readSession variant for cross-project scans — skips activity feed,
// sparkline, subagents. Optionally collects file touches and tool counts for
// the today summary.
interface LightSession {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  messageCount: number;
  lastModel: string | undefined;
}
function readSessionLight(
  file: string,
  filesOut?: Map<string, number>,
  toolsOut?: Map<string, number>,
): LightSession {
  const out: LightSession = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    lastModel: undefined,
  };
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.type === 'user' || parsed.type === 'assistant') out.messageCount += 1;
    const usage = parsed.message?.usage;
    if (usage) {
      out.inputTokens += usage.input_tokens ?? 0;
      out.outputTokens += usage.output_tokens ?? 0;
      out.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      out.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    }
    const m = parsed.message?.model;
    if (typeof m === 'string') out.lastModel = m;
    if (filesOut || toolsOut) {
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== 'tool_use' || !block.name) continue;
          if (toolsOut) toolsOut.set(block.name, (toolsOut.get(block.name) ?? 0) + 1);
          if (filesOut && FILE_TOOLS.has(block.name)) {
            const fp = block.input?.file_path ?? block.input?.path;
            if (typeof fp === 'string') filesOut.set(fp, (filesOut.get(fp) ?? 0) + 1);
          }
        }
      }
    }
  }
  out.totalTokens =
    out.inputTokens + out.outputTokens + out.cacheReadTokens + out.cacheCreationTokens;
  return out;
}

// Disk usage — sum of all .jsonl files under ~/.claude/projects/.
export function computeDiskUsage(): number {
  if (!fs.existsSync(claudeHome)) return 0;
  let total = 0;
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        total += stat.size;
      }
    }
  }
  walk(claudeHome);
  return total;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const motherFolder = path.join(os.homedir(), '.claude');

function listDirEntries(dir: string): LocalEntry[] {
  if (!fs.existsSync(dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: LocalEntry[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let count = 0;
      try {
        count = fs.readdirSync(full).length;
      } catch {
        /* ignore — count stays 0 */
      }
      out.push({
        name,
        path: full,
        isDirectory: true,
        sizeBytes: 0,
        itemCount: count,
        lastModifiedAt: stat.mtime.toISOString(),
        lastModifiedMs: stat.mtimeMs,
      });
    } else if (stat.isFile()) {
      out.push({
        name,
        path: full,
        isDirectory: false,
        sizeBytes: stat.size,
        itemCount: undefined,
        lastModifiedAt: stat.mtime.toISOString(),
        lastModifiedMs: stat.mtimeMs,
      });
    }
  }
  return out;
}

export function computeLocalLayout(
  activeProjectDir: string | undefined,
  activeSessionFile: string | undefined,
): LocalLayout {
  const motherEntries = listDirEntries(motherFolder).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const sessionEntries = activeProjectDir
    ? listDirEntries(activeProjectDir).sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)
    : [];
  const settingsFile = path.join(motherFolder, 'settings.json');
  return {
    motherFolder,
    motherEntries,
    sessionFolder: activeProjectDir,
    sessionEntries,
    globalSettingsFile: fs.existsSync(settingsFile) ? settingsFile : undefined,
    activeSessionFile,
  };
}

// Memory search — fuzzy across MEMORY.md hooks plus memory file bodies.
export function searchMemory(cwd: string, query: string, limit = 30): MemorySearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const memDir = path.join(projectDirFor(cwd), 'memory');
  const index = readMemoryIndex(cwd);
  const hits: MemorySearchHit[] = [];
  for (const entry of index) {
    const inIndex = entry.title.toLowerCase().includes(q) || entry.hook.toLowerCase().includes(q);
    let snippet: string | undefined;
    let inBody = false;
    const filePath = path.join(memDir, entry.filename);
    if (fs.existsSync(filePath)) {
      try {
        const body = fs.readFileSync(filePath, 'utf8');
        const idx = body.toLowerCase().indexOf(q);
        if (idx >= 0) {
          inBody = true;
          const start = Math.max(0, idx - 40);
          const end = Math.min(body.length, idx + q.length + 80);
          snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
        }
      } catch {
        /* ignore */
      }
    }
    if (inIndex || inBody) {
      hits.push({
        filename: entry.filename,
        title: entry.title,
        hook: entry.hook,
        matchSnippet: snippet,
      });
    }
    if (hits.length >= limit) break;
  }
  return hits;
}


interface ActiveLocation {
  sessionFile: string;
  projectDir: string;
  decodedPath: string;
  mtime: number;
}

export function findGlobalActiveSession(): ActiveLocation | undefined {
  if (!fs.existsSync(claudeHome)) {
    return undefined;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(claudeHome);
  } catch {
    return undefined;
  }
  let best: ActiveLocation | undefined;
  for (const entry of entries) {
    const dir = path.join(claudeHome, entry);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) {
        continue;
      }
      const full = path.join(dir, f);
      try {
        const fStat = fs.statSync(full);
        if (!fStat.isFile()) {
          continue;
        }
        if (!best || fStat.mtimeMs > best.mtime) {
          best = {
            sessionFile: full,
            projectDir: dir,
            decodedPath: decodeProjectName(entry),
            mtime: fStat.mtimeMs,
          };
        }
      } catch {
        continue;
      }
    }
  }
  return best;
}

function locationForCwd(cwd: string): ActiveLocation | undefined {
  const dir = projectDirFor(cwd);
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  const sessionFile = findActiveSession(cwd);
  if (!sessionFile) {
    return undefined;
  }
  let mtime = 0;
  try {
    mtime = fs.statSync(sessionFile).mtimeMs;
  } catch {
    /* fall through with mtime 0 */
  }
  return { sessionFile, projectDir: dir, decodedPath: cwd, mtime };
}

export function snapshot(
  cwd: string | undefined,
  budgetConfig?: BudgetConfig,
): CockpitSnapshot {
  const projects = listProjects();
  const settings = readGlobalSettings();
  const local = cwd ? locationForCwd(cwd) : undefined;
  const global = findGlobalActiveSession();

  // Pick whichever session has the more recent mtime — sessions are first
  // class, not workspace folders. If a sub-agent in a different project just
  // wrote, that's the active session even when a folder is open.
  let active: ActiveLocation | undefined;
  if (local && global) {
    active = local.mtime >= global.mtime ? local : global;
  } else {
    active = local ?? global;
  }

  const today = computeToday();
  const diskUsageBytes = computeDiskUsage();
  const office = detectOffice(settings);
  const watchtower = computeWatchtower();
  const obsidian = readObsidianStatus();
  const plans = readPlans(cwd);
  const chatExport = readChatExport();
  const heatmap = computeActivityHeatmap();
  const usageDashboard = detectUsageDashboardSync();
  const agents = readAgents(cwd);
  const tunnels = readTunnels();
  const rtk = readRTKSavingsSync();
  const macHealth = readMacHealthSync();
  const greeting = computeGreeting();
  const cockpitStats = computeStats({
    byHour: heatmap.byHour,
    byDay: heatmap.byDay,
    watchtower: watchtower.map((w) => ({
      lastActivityMs: w.lastActivityMs,
      modelFamily: w.modelFamily,
      totalUsd: w.totalUsd,
    })),
    todayUsdRaw: today.totalUsd,
  });

  if (!active) {
    const stats = emptyStatsFor(undefined);
    const budget = computeBudget(budgetConfig, today.totalUsd, 0);
    return {
      cwd: undefined,
      projectDir: undefined,
      stats,
      memory: [],
      projects,
      settings,
      skills: listSkills(),
      pilot: undefined,
      today,
      diskUsageBytes,
      localLayout: computeLocalLayout(undefined, undefined),
      claudeMdStack: [],
      office,
      watchtower,
      obsidian,
      costByTool: [],
      notifications: computeNotifications({
        stats,
        memory: [],
        watchtower,
        obsidian,
        budget,
      }),
      budget,
      plans,
      chatExport,
      heatmap,
      usageDashboard,
      cockpitStats,
      inbox: computeInbox({
        watchtower: watchtower.map((w) => ({
          name: w.name,
          ageSeconds: w.ageSeconds,
          status: w.status,
          sessionFile: w.sessionFile,
        })),
        toolHistory: [],
        memory: [],
        plans,
        subAgents: [],
        budgetTone: budget.dailyTone,
      }),
      agents,
      tunnels,
      rtk,
      greeting,
      macHealth,
    };
  }

  const stats = readSession(active.sessionFile, active.decodedPath);
  const memory = readMemoryIndex(active.decodedPath);
  const pilot = readPilotProfile(active.decodedPath);
  const skills = listSkills(active.sessionFile);
  const claudeMdStack = readClaudeMdStack(active.decodedPath);
  const costByTool = computeCostByTool(stats);
  const budget = computeBudget(budgetConfig, today.totalUsd, stats.cost.totalUsd);
  const notifications = computeNotifications({
    stats,
    memory,
    watchtower,
    obsidian,
    budget,
  });
  return {
    cwd: active.decodedPath,
    projectDir: active.projectDir,
    stats,
    memory,
    projects,
    settings,
    skills,
    pilot,
    today,
    diskUsageBytes,
    localLayout: computeLocalLayout(active.projectDir, active.sessionFile),
    claudeMdStack,
    office,
    watchtower,
    obsidian,
    costByTool,
    notifications,
    budget,
    plans,
    chatExport,
    heatmap,
    usageDashboard,
    cockpitStats,
    inbox: computeInbox({
      watchtower: watchtower.map((w) => ({
        name: w.name,
        ageSeconds: w.ageSeconds,
        status: w.status,
        sessionFile: w.sessionFile,
      })),
      toolHistory: stats.toolHistory.map((t) => ({
        tool: t.tool,
        result: t.result,
        errorMessage: t.errorMessage,
      })),
      memory: memory.map((m) => ({
        isStale: m.isStale,
        title: m.title,
        filename: m.filename,
      })),
      plans,
      subAgents: stats.subAgents.map((a) => ({
        agentId: a.agentId,
        jsonlFile: a.jsonlFile,
        toolCallCount: a.toolCallCount,
      })),
      budgetTone: budget.dailyTone,
    }),
    agents,
    tunnels,
    rtk,
    greeting,
    macHealth,
  };
}

function computeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 22) return 'Evening';
  return 'Late';
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

// ===========================================================================
// v0.6.0 — Watchtower additions
// ===========================================================================

const WATCHTOWER_MAX_AGE_MS = 60 * 60 * 1000; // surface sessions touched in last 60min
const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15min = idle sentinel
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30min = stale

export function computeWatchtower(): WatchtowerSession[] {
  if (!fs.existsSync(claudeHome)) return [];
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return [];
  }
  const now = Date.now();
  const out: WatchtowerSession[] = [];
  for (const proj of projects) {
    const dir = path.join(claudeHome, proj);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    let best: { file: string; mtime: number } | undefined;
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const fStat = fs.statSync(full);
        if (!best || fStat.mtimeMs > best.mtime) {
          best = { file: full, mtime: fStat.mtimeMs };
        }
      } catch {
        continue;
      }
    }
    if (!best) continue;
    const ageMs = now - best.mtime;
    if (ageMs > WATCHTOWER_MAX_AGE_MS) continue;
    const decoded = decodeProjectName(proj);
    const light = readSessionLight(best.file);
    let sessionId: string | undefined;
    try {
      const head = fs.readFileSync(best.file, 'utf8').split('\n').slice(0, 5);
      for (const line of head) {
        const parsed = parseLine(line);
        if (parsed?.sessionId) {
          sessionId = parsed.sessionId;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const status: WatchtowerSession['status'] =
      ageMs < 10_000
        ? 'live'
        : ageMs < IDLE_THRESHOLD_MS
          ? 'recent'
          : ageMs < STALE_THRESHOLD_MS
            ? 'idle'
            : 'stale';
    const family = modelFamilyOf(light.lastModel);
    const cost = computeCost({
      inputTokens: light.inputTokens,
      outputTokens: light.outputTokens,
      cacheReadTokens: light.cacheReadTokens,
      cacheCreationTokens: light.cacheCreationTokens,
      modelFamily: family,
    });
    out.push({
      decodedPath: decoded,
      projectDir: dir,
      sessionFile: best.file,
      sessionId,
      name: path.basename(decoded) || decoded,
      lastActivityAt: new Date(best.mtime).toISOString(),
      lastActivityMs: best.mtime,
      ageSeconds: Math.floor(ageMs / 1000),
      status,
      totalTokens: light.totalTokens,
      totalUsd: cost.totalUsd,
      model: light.lastModel,
      modelFamily: family,
    });
  }
  out.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  return out;
}

export function computeCostByTool(stats: SessionStats): CostByToolEntry[] {
  if (!stats.toolHistogram.length || stats.cost.totalUsd === 0) return [];
  const totalCalls = stats.toolHistogram.reduce((a, b) => a + b.count, 0);
  if (totalCalls === 0) return [];
  // Each tool call drives some context growth. Approximate by attributing cost
  // proportional to call count, weighted slightly more toward expensive tools
  // (Read/Edit/Write/Bash) since they often produce large tool_results.
  const weights: Record<string, number> = {
    Read: 1.6,
    Bash: 1.4,
    Edit: 1.5,
    Write: 1.5,
    MultiEdit: 1.7,
    Grep: 1.2,
    Glob: 0.9,
    WebFetch: 1.8,
    WebSearch: 1.4,
    Task: 2.0,
    Agent: 2.0,
  };
  let totalWeight = 0;
  const weighted = stats.toolHistogram.map((t) => {
    const w = (weights[t.tool] ?? 1.0) * t.count;
    totalWeight += w;
    return { ...t, w };
  });
  const out: CostByToolEntry[] = weighted
    .map((t) => {
      const share = totalWeight > 0 ? t.w / totalWeight : 0;
      return {
        tool: t.tool,
        count: t.count,
        approxUsd: stats.cost.totalUsd * share,
        approxTokens: Math.round(stats.totalTokens * share),
      };
    })
    .sort((a, b) => b.approxUsd - a.approxUsd);
  return out;
}

export function computeBudget(
  cfg: BudgetConfig | undefined,
  spentTodayUsd: number,
  spentSessionUsd: number,
): BudgetStatus {
  const enabled = Boolean(cfg?.enabled);
  const dailyCapUsd = cfg?.dailyCapUsd ?? 0;
  const sessionCapUsd = cfg?.sessionCapUsd ?? 0;
  const dailyPct = dailyCapUsd > 0 ? Math.min(100, (spentTodayUsd / dailyCapUsd) * 100) : 0;
  const sessionPct = sessionCapUsd > 0 ? Math.min(100, (spentSessionUsd / sessionCapUsd) * 100) : 0;
  const tone = (pct: number): 'ok' | 'warn' | 'danger' =>
    pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
  return {
    enabled,
    dailyCapUsd,
    sessionCapUsd,
    spentTodayUsd,
    spentSessionUsd,
    dailyPct,
    sessionPct,
    dailyTone: tone(dailyPct),
    sessionTone: tone(sessionPct),
  };
}

interface NotificationContext {
  stats: SessionStats;
  memory: MemoryEntry[];
  watchtower: WatchtowerSession[];
  obsidian: ObsidianStatus;
  budget: BudgetStatus;
}

export function computeNotifications(ctx: NotificationContext): Notification[] {
  const out: Notification[] = [];
  const { stats, memory, watchtower, budget } = ctx;
  // Context window > 90% — risk of degraded quality.
  if (stats.contextWindowMax > 0 && stats.contextFillPct > 90) {
    out.push({
      id: 'context-full',
      level: 'danger',
      title: 'Context window over 90%',
      detail: `Working set ${stats.contextFillPct.toFixed(1)}% of ${formatTokens(stats.contextWindowMax)}. Run /compact or start a fresh session.`,
      action: 'openSession',
      actionPayload: undefined,
    });
  } else if (stats.contextWindowMax > 0 && stats.contextFillPct > 75) {
    out.push({
      id: 'context-high',
      level: 'warn',
      title: 'Context window above 75%',
      detail: `${stats.contextFillPct.toFixed(1)}% used — consider /compact soon.`,
      action: 'openSession',
      actionPayload: undefined,
    });
  }
  // Cache hit rate low — can be costly.
  if (stats.totalTokens > 50_000 && stats.cacheHitRate > 0 && stats.cacheHitRate < 0.3) {
    out.push({
      id: 'cache-low',
      level: 'warn',
      title: 'Low cache hit rate',
      detail: `${(stats.cacheHitRate * 100).toFixed(1)}% — sessions reuse the same prefix; check if you're rotating context unnecessarily.`,
      action: 'none',
      actionPayload: undefined,
    });
  }
  // Stale memory — older than 30 days.
  const staleMem = memory.filter((m) => m.isStale);
  if (staleMem.length >= 5) {
    out.push({
      id: 'memory-stale',
      level: 'info',
      title: `${staleMem.length} memory entries stale`,
      detail: 'Older than 30 days — review or delete to keep memory crisp.',
      action: 'openMemory',
      actionPayload: undefined,
    });
  }
  // Idle sessions across projects.
  const idle = watchtower.filter((s) => s.status === 'idle' || s.status === 'stale');
  if (idle.length > 0) {
    out.push({
      id: 'idle-sessions',
      level: 'info',
      title: `${idle.length} idle session${idle.length === 1 ? '' : 's'}`,
      detail: idle
        .slice(0, 3)
        .map((s) => `${s.name} (${Math.floor(s.ageSeconds / 60)}m)`)
        .join(', '),
      action: 'none',
      actionPayload: undefined,
    });
  }
  // Budget breaches.
  if (budget.enabled) {
    if (budget.dailyTone === 'danger') {
      out.push({
        id: 'budget-day',
        level: 'danger',
        title: 'Daily budget cap hit',
        detail: `Spent ${formatUsd(budget.spentTodayUsd)} of ${formatUsd(budget.dailyCapUsd)}.`,
        action: 'none',
        actionPayload: undefined,
      });
    } else if (budget.dailyTone === 'warn') {
      out.push({
        id: 'budget-day-warn',
        level: 'warn',
        title: 'Daily budget over 80%',
        detail: `${formatUsd(budget.spentTodayUsd)} of ${formatUsd(budget.dailyCapUsd)} (${budget.dailyPct.toFixed(0)}%).`,
        action: 'none',
        actionPayload: undefined,
      });
    }
    if (budget.sessionCapUsd > 0 && budget.sessionTone === 'danger') {
      out.push({
        id: 'budget-session',
        level: 'danger',
        title: 'Session budget hit',
        detail: `This session: ${formatUsd(budget.spentSessionUsd)} of ${formatUsd(budget.sessionCapUsd)}.`,
        action: 'none',
        actionPayload: undefined,
      });
    }
  }
  return out;
}

export interface SessionSearchHit {
  decodedPath: string;
  sessionFile: string;
  projectName: string;
  matchTimestamp: string | undefined;
  matchSnippet: string;
  matchType: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'unknown';
}

export function globalSessionSearch(query: string, limit = 30): SessionSearchHit[] {
  const q = query.trim();
  if (!q || q.length < 2) return [];
  const lower = q.toLowerCase();
  if (!fs.existsSync(claudeHome)) return [];
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return [];
  }
  const out: SessionSearchHit[] = [];
  for (const proj of projects) {
    if (out.length >= limit) break;
    const dir = path.join(claudeHome, proj);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, full: path.join(dir, f), mtime: 0 }))
        .map((x) => {
          try {
            x.mtime = fs.statSync(x.full).mtimeMs;
          } catch {
            /* ignore */
          }
          return x;
        })
        .sort((a, b) => b.mtime - a.mtime)
        .map((x) => x.f);
    } catch {
      continue;
    }
    const decoded = decodeProjectName(proj);
    for (const f of files) {
      if (out.length >= limit) break;
      const full = path.join(dir, f);
      let raw: string;
      try {
        raw = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // Cheap pre-filter — most files won't contain query.
      if (raw.toLowerCase().indexOf(lower) < 0) continue;
      for (const line of raw.split('\n')) {
        if (out.length >= limit) break;
        if (line.toLowerCase().indexOf(lower) < 0) continue;
        const parsed = parseLine(line);
        if (!parsed) continue;
        let snippet = '';
        let kind: SessionSearchHit['matchType'] = 'unknown';
        const content = parsed.message?.content;
        if (typeof content === 'string') {
          snippet = content;
          kind = parsed.type === 'user' ? 'user' : parsed.type === 'assistant' ? 'assistant' : 'unknown';
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
              const text = (block as { text: string }).text;
              if (text.toLowerCase().includes(lower)) {
                snippet = text;
                kind = parsed.type === 'user' ? 'user' : 'assistant';
                break;
              }
            } else if (block.type === 'tool_use') {
              const argText = JSON.stringify(block.input ?? {});
              if (argText.toLowerCase().includes(lower)) {
                snippet = `[${block.name ?? 'tool'}] ${argText}`;
                kind = 'tool_use';
                break;
              }
            } else if (block.type === 'tool_result') {
              const c = block.content;
              if (typeof c === 'string' && c.toLowerCase().includes(lower)) {
                snippet = c;
                kind = 'tool_result';
                break;
              }
            }
          }
        }
        if (!snippet) continue;
        const idx = snippet.toLowerCase().indexOf(lower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(snippet.length, idx + lower.length + 100);
        const trimmed = snippet.slice(start, end).replace(/\s+/g, ' ').trim();
        out.push({
          decodedPath: decoded,
          sessionFile: full,
          projectName: path.basename(decoded) || decoded,
          matchTimestamp: parsed.timestamp,
          matchSnippet: trimmed,
          matchType: kind,
        });
      }
    }
  }
  return out;
}
