import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { ObsidianStatus, readObsidianStatus } from './obsidian';
import { readGraphSummaryForPrimaryVault } from './graph';
import { MacHealthSnapshot, readMacHealthSync } from './macHealth';
import { RoutinesStatus, readRoutinesStatus } from './routines';
import { record as recordTime } from './telemetry';
import { readAuditSnapshot } from './auditLog';
import {
  ActivityHeatmap,
  AgentDef,
  ChatExportStatus,
  CockpitStats,
  InboxItem,
  PlanFile,
  RtkStatus,
  SubdomainHealthEntry,
  TunnelConfig,
  UsageDashboardStatus,
  computeActivityHeatmap,
  computeInbox,
  computeStats,
  detectUsageDashboardSync,
  readAgents,
  readChatExport,
  readGitBranchSync,
  readPlans,
  readRTKSavingsSync,
  readSubdomainHealthSync,
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
  permissionMode: string | undefined;
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
  officeFloor: OfficeFloorTile[];
  watchtower: WatchtowerSession[];
  obsidian: ObsidianStatus;
  costByTool: CostByToolEntry[];
  notifications: Notification[];
  recommendations: Recommendation[];
  budget: BudgetStatus;
  usage: UsageRollups;
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
  routines: RoutinesStatus;
  gitBranch: string | undefined;
  subdomainHealth: SubdomainHealthEntry[];
  // === obsidian-graph ===
  // Lightweight summary only — the full {nodes, edges} payload is potentially
  // megabytes for large vaults, so the webview lazy-loads it on tab open.
  obsidianGraph?: { nodeCount: number; edgeCount: number; vault: string } | undefined;
  // === replay-timeline (forward-declared; replay-timeline PR provides values) ===
  // Small, postMessage-friendly index of the active session JSONL. Full event
  // list + per-step file diffs are pulled lazily via `replay.loadSession`.
  replayIndex?: ReplayIndexSnapshot;
  // === permissions-audit ===
  // Optional rollup so the Security tab can render "X events / 24h,
  // last: api.github.com" without a round-trip; full log is fetched on demand
  // via audit.refresh.
  audit?: { last24h: number; lastDomain: string | undefined };
}

/**
 * Mirror of replay.ReplayIndex, declared here to keep claudeData.ts free of
 * upward imports. Wire-compatible with replay.ReplayIndex by shape.
 */
export interface ReplayIndexSnapshot {
  available: boolean;
  totalEvents: number;
  touchedFiles: string[];
  tailEvents: ReplayTailEvent[];
  lastIndex: number;
  sessionId: string | undefined;
  totalTokens: number;
}

export interface ReplayTailEvent {
  index: number;
  kind: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'meta';
  timestamp: string | undefined;
  toolName: string | undefined;
  filePath: string | undefined;
  summary: string;
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

export interface OfficeFloorTile {
  decodedPath: string;
  projectDir: string;
  sessionFile: string;
  name: string;
  status: 'live' | 'recent' | 'idle' | 'stale';
  ageSeconds: number;
  lastActivityAt: string;
  lastTool: string | undefined;
  lastToolArgs: string | undefined;
  lastToolResult: 'ok' | 'error' | 'pending' | undefined;
  currentFile: string | undefined;
  subAgentName: string | undefined;
  subAgentDescription: string | undefined;
  recentFiles: string[];
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

export type RecommendationCategory =
  | 'memory'
  | 'skills'
  | 'prompts'
  | 'agents'
  | 'session'
  | 'budget'
  | 'health'
  | 'workflow';

export type RecommendationImpact = 'high' | 'med' | 'low';

export type RecommendationAction =
  | 'gotoTab'
  | 'openMemory'
  | 'openSession'
  | 'openFile'
  | 'copySkill'
  | 'openExternal'
  | 'setDailyCap'
  | 'none';

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  impact: RecommendationImpact;
  title: string;
  why: string;
  action: RecommendationAction;
  actionLabel: string | undefined;
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
  burnUsdPerHour: number;
  projected30MinUsd: number;
  projectedDailyHitsCap: boolean;
  minutesToDailyCap: number | undefined;
}

export interface BudgetConfig {
  enabled: boolean;
  dailyCapUsd: number;
  sessionCapUsd: number;
  weeklyCapUsd: number;
  monthlyCapUsd: number;
  yearlyCapUsd: number;
}

export interface UsagePeriodTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  totalUsd: number;
  turns: number;
  byModel: { family: ModelFamily; tokens: number; usd: number }[];
}

export interface UsageRollupPeriod extends UsagePeriodTotals {
  capUsd: number;
  pct: number;
  tone: 'ok' | 'warn' | 'danger';
  rangeLabel: string;
}

export interface UsageRollups {
  session: UsageRollupPeriod;
  today: UsageRollupPeriod;
  week: UsageRollupPeriod;
  month: UsageRollupPeriod;
  year: UsageRollupPeriod;
  allTime: UsageRollupPeriod;
  scannedFiles: number;
  cacheHits: number;
  scanMs: number;
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
  permissionMode?: string;
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
    permissionMode: undefined,
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
  // TODO: lossy — Claude encodes project paths by replacing every `/` with
  // `-`, so a literal hyphen in the original path becomes indistinguishable
  // from a separator. A correct fix requires reading the session JSONL's cwd
  // field and cross-referencing per session; punted for now.
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
      // Use the lighter parser — listProjects only needs totalTokens, not
      // activity feed / sparkline / subagents.
      const summary = readSessionLight(bestSessionFile);
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

// ===== Usage rollups ==========================================================
// Multi-period usage aggregations (session/today/week/month/year/all-time)
// computed across every JSONL under ~/.claude/projects/. The full scan is
// heavy on first run; subsequent runs use a (mtime, size)-keyed cache at
// ~/.claude/cockpit-usage-cache.json so only changed JSONLs re-parse.

interface UsageCacheFileEntry {
  mtimeMs: number;
  size: number;
  // Key shape: `${YYYY-MM-DD}|${family}` so each model on a given day gets
  // its own bucket. v1 used only `${YYYY-MM-DD}` and lost attribution when
  // a session spanned multiple models.
  byDate: Record<string, {
    iT: number;
    oT: number;
    cR: number;
    cC: number;
    fam: ModelFamily;
    turns: number;
  }>;
}

interface UsageCacheV2 {
  version: 2;
  files: Record<string, UsageCacheFileEntry>;
}
type UsageCache = UsageCacheV2;

const USAGE_CACHE_FILE = path.join(os.homedir(), '.claude', 'cockpit-usage-cache.json');

function readUsageCache(): UsageCache {
  try {
    const raw = fs.readFileSync(USAGE_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && parsed.files && typeof parsed.files === 'object') {
      return parsed as UsageCache;
    }
  } catch {
    /* ignore */
  }
  return { version: 2, files: {} };
}

function writeUsageCache(cache: UsageCache): void {
  try {
    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(cache));
  } catch (err) {
    logger.warn(`usage cache write failed: ${String(err)}`);
  }
}

function readSessionByDate(file: string): UsageCacheFileEntry['byDate'] {
  const out: UsageCacheFileEntry['byDate'] = {};
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  let lastFamily: ModelFamily = 'unknown';
  for (const line of raw.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const m = parsed.message?.model;
    if (typeof m === 'string') lastFamily = modelFamilyOf(m);
    const usage = parsed.message?.usage;
    if (!usage) continue;
    const ts = parsed.timestamp;
    if (!ts) continue;
    const dt = new Date(ts);
    if (isNaN(dt.getTime())) continue;
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const dateKey = `${y}-${mo}-${d}`;
    // Key by date+family so each model gets its own bucket.
    const key = `${dateKey}|${lastFamily}`;
    const entry = out[key] ?? { iT: 0, oT: 0, cR: 0, cC: 0, fam: lastFamily, turns: 0 };
    entry.iT += usage.input_tokens ?? 0;
    entry.oT += usage.output_tokens ?? 0;
    entry.cR += usage.cache_read_input_tokens ?? 0;
    entry.cC += usage.cache_creation_input_tokens ?? 0;
    entry.fam = lastFamily;
    if (parsed.type === 'assistant') entry.turns += 1;
    out[key] = entry;
  }
  return out;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function isoWeekStart(d: Date): Date {
  // Monday as week start (matches ISO weeks).
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

function emptyPeriod(rangeLabel: string, capUsd: number): UsageRollupPeriod {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalUsd: 0,
    turns: 0,
    byModel: [],
    capUsd,
    pct: 0,
    tone: 'ok',
    rangeLabel,
  };
}

type FamilyTotals = Record<ModelFamily, { tokens: number; usd: number }>;
function emptyFamily(): FamilyTotals {
  return {
    opus: { tokens: 0, usd: 0 },
    sonnet: { tokens: 0, usd: 0 },
    haiku: { tokens: 0, usd: 0 },
    unknown: { tokens: 0, usd: 0 },
  };
}

function addToPeriod(
  period: UsagePeriodTotals,
  fam: FamilyTotals,
  d: { iT: number; oT: number; cR: number; cC: number; fam: ModelFamily; turns: number },
  cost: CostBreakdown,
  tokens: number,
): void {
  period.inputTokens += d.iT;
  period.outputTokens += d.oT;
  period.cacheReadTokens += d.cR;
  period.cacheCreationTokens += d.cC;
  period.totalTokens += tokens;
  period.totalUsd += cost.totalUsd;
  period.turns += d.turns;
  fam[d.fam].tokens += tokens;
  fam[d.fam].usd += cost.totalUsd;
}

export interface UsageRollupOptions {
  sessionCapUsd?: number;
  dailyCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  yearlyCapUsd?: number;
  activeSessionFile?: string | undefined;
}

export function computeUsageRollups(opts: UsageRollupOptions = {}): UsageRollups {
  const t0 = Date.now();
  const rollups: UsageRollups = {
    session: emptyPeriod('current session', opts.sessionCapUsd ?? 0),
    today: emptyPeriod('today', opts.dailyCapUsd ?? 0),
    week: emptyPeriod('this week (Mon–Sun)', opts.weeklyCapUsd ?? 0),
    month: emptyPeriod('this month', opts.monthlyCapUsd ?? 0),
    year: emptyPeriod('this year', opts.yearlyCapUsd ?? 0),
    allTime: emptyPeriod('all time', 0),
    scannedFiles: 0,
    cacheHits: 0,
    scanMs: 0,
  };
  if (!fs.existsSync(claudeHome)) {
    rollups.scanMs = Date.now() - t0;
    return rollups;
  }

  const cache = readUsageCache();
  const now = new Date();
  const todayKey = localDateKey(now);
  const weekStartKey = localDateKey(isoWeekStart(now));
  const monthKey = todayKey.slice(0, 7);
  const yearKey = todayKey.slice(0, 4);

  const famAccum: Record<
    'session' | 'today' | 'week' | 'month' | 'year' | 'allTime',
    FamilyTotals
  > = {
    session: emptyFamily(),
    today: emptyFamily(),
    week: emptyFamily(),
    month: emptyFamily(),
    year: emptyFamily(),
    allTime: emptyFamily(),
  };

  const seenFiles = new Set<string>();
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    rollups.scanMs = Date.now() - t0;
    return rollups;
  }

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
      let fStat;
      try {
        fStat = fs.statSync(full);
      } catch {
        continue;
      }
      seenFiles.add(full);
      const cached = cache.files[full];
      let byDate: UsageCacheFileEntry['byDate'];
      if (cached && cached.mtimeMs === fStat.mtimeMs && cached.size === fStat.size) {
        byDate = cached.byDate;
        rollups.cacheHits += 1;
      } else {
        byDate = readSessionByDate(full);
        cache.files[full] = { mtimeMs: fStat.mtimeMs, size: fStat.size, byDate };
      }
      rollups.scannedFiles += 1;
      const isActiveSession = !!opts.activeSessionFile && full === opts.activeSessionFile;

      for (const bucketKey of Object.keys(byDate)) {
        const d = byDate[bucketKey];
        // bucketKey is `${YYYY-MM-DD}|${family}` (cache v2). Tolerate v1
        // entries (just date) for in-memory upgrades during the same run.
        const pipeIdx = bucketKey.indexOf('|');
        const dateKey = pipeIdx >= 0 ? bucketKey.slice(0, pipeIdx) : bucketKey;
        const cost = computeCost({
          inputTokens: d.iT,
          outputTokens: d.oT,
          cacheReadTokens: d.cR,
          cacheCreationTokens: d.cC,
          modelFamily: d.fam,
        });
        const tokens = d.iT + d.oT + d.cR + d.cC;

        addToPeriod(rollups.allTime, famAccum.allTime, d, cost, tokens);
        if (dateKey.slice(0, 4) === yearKey) {
          addToPeriod(rollups.year, famAccum.year, d, cost, tokens);
        }
        if (dateKey.slice(0, 7) === monthKey) {
          addToPeriod(rollups.month, famAccum.month, d, cost, tokens);
        }
        if (dateKey >= weekStartKey && dateKey <= todayKey) {
          addToPeriod(rollups.week, famAccum.week, d, cost, tokens);
        }
        if (dateKey === todayKey) {
          addToPeriod(rollups.today, famAccum.today, d, cost, tokens);
        }
        if (isActiveSession) {
          addToPeriod(rollups.session, famAccum.session, d, cost, tokens);
        }
      }
    }
  }

  for (const cachedPath of Object.keys(cache.files)) {
    if (!seenFiles.has(cachedPath)) delete cache.files[cachedPath];
  }
  writeUsageCache(cache);

  for (const periodKey of ['session', 'today', 'week', 'month', 'year', 'allTime'] as const) {
    const period = rollups[periodKey];
    const fam = famAccum[periodKey];
    period.byModel = (Object.entries(fam) as [ModelFamily, { tokens: number; usd: number }][])
      .filter(([, v]) => v.tokens > 0)
      .map(([family, v]) => ({ family, tokens: v.tokens, usd: v.usd }))
      .sort((a, b) => b.usd - a.usd);
    period.pct = period.capUsd > 0 ? Math.min(100, (period.totalUsd / period.capUsd) * 100) : 0;
    period.tone = period.pct >= 100 ? 'danger' : period.pct >= 80 ? 'warn' : 'ok';
  }

  rollups.scanMs = Date.now() - t0;
  return rollups;
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
  cloudRoutinesEnabled?: boolean,
): CockpitSnapshot {
  return recordTime('snapshot.total', () =>
    snapshotInner(cwd, budgetConfig, cloudRoutinesEnabled),
  );
}

function snapshotInner(
  cwd: string | undefined,
  budgetConfig?: BudgetConfig,
  cloudRoutinesEnabled?: boolean,
): CockpitSnapshot {
  const projects = recordTime('snapshot.listProjects', () => listProjects());
  const settings = recordTime('snapshot.readGlobalSettings', () => readGlobalSettings());
  const local = cwd ? locationForCwd(cwd) : undefined;
  const global = recordTime('snapshot.findGlobalActiveSession', () => findGlobalActiveSession());

  // Pick whichever session has the more recent mtime — sessions are first
  // class, not workspace folders. If a sub-agent in a different project just
  // wrote, that's the active session even when a folder is open.
  let active: ActiveLocation | undefined;
  if (local && global) {
    active = local.mtime >= global.mtime ? local : global;
  } else {
    active = local ?? global;
  }

  const today = recordTime('snapshot.computeToday', () => computeToday());
  const diskUsageBytes = recordTime('snapshot.computeDiskUsage', () => computeDiskUsage());
  const office = detectOffice(settings);
  const officeFloor = recordTime('snapshot.computeOfficeFloor', () => computeOfficeFloor());
  const watchtower = recordTime('snapshot.computeWatchtower', () => computeWatchtower());
  const obsidian = recordTime('snapshot.readObsidian', () => readObsidianStatus());
  const plans = recordTime('snapshot.readPlans', () => readPlans(cwd));
  const chatExport = recordTime('snapshot.readChatExport', () => readChatExport());
  const heatmap = recordTime('snapshot.computeActivityHeatmap', () => computeActivityHeatmap());
  const usageDashboard = detectUsageDashboardSync();
  const agents = recordTime('snapshot.readAgents', () => readAgents(cwd));
  const tunnels = recordTime('snapshot.readTunnels', () => readTunnels());
  const rtk = readRTKSavingsSync();
  const macHealth = readMacHealthSync();
  const routines = recordTime('snapshot.readRoutines', () => readRoutinesStatus(cloudRoutinesEnabled === true));
  // permissions-audit: cheap rollup of recent audit events so the Security
  // tab can show a 24h count without a separate round-trip. The full log is
  // fetched lazily on demand via the audit.refresh message.
  const audit = recordTime('snapshot.audit', () => readAuditSnapshot());
  const greeting = computeGreeting();
  const gitBranch = readGitBranchSync(cwd ?? (active ? active.decodedPath : undefined));
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
    const usage = recordTime('snapshot.computeUsageRollups', () =>
      computeUsageRollups({
        sessionCapUsd: budgetConfig?.sessionCapUsd ?? 0,
        dailyCapUsd: budgetConfig?.dailyCapUsd ?? 0,
        weeklyCapUsd: budgetConfig?.weeklyCapUsd ?? 0,
        monthlyCapUsd: budgetConfig?.monthlyCapUsd ?? 0,
        yearlyCapUsd: budgetConfig?.yearlyCapUsd ?? 0,
        activeSessionFile: undefined,
      }),
    );
    const skillsEmpty = listSkills();
    return {
      cwd: undefined,
      projectDir: undefined,
      stats,
      memory: [],
      projects,
      settings,
      skills: skillsEmpty,
      pilot: undefined,
      today,
      diskUsageBytes,
      localLayout: computeLocalLayout(undefined, undefined),
      claudeMdStack: [],
      office,
      officeFloor,
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
      recommendations: computeRecommendations({
        stats,
        memory: [],
        skills: skillsEmpty,
        prompts: [],
        agents,
        watchtower,
        budget,
        settings,
        rtk,
        obsidian,
        diskUsageBytes,
        cwd: undefined,
      }),
      budget,
      usage,
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
      routines,
      gitBranch: undefined,
      subdomainHealth: readSubdomainHealthSync([]),
      obsidianGraph: recordTime('snapshot.obsidianGraph', () => {
        const summary = readGraphSummaryForPrimaryVault();
        return summary
          ? { nodeCount: summary.nodeCount, edgeCount: summary.edgeCount, vault: summary.vaultName }
          : undefined;
      }),
      audit,
    };
  }

  const stats = recordTime('snapshot.readSession', () => readSession(active!.sessionFile, active!.decodedPath));
  const memory = recordTime('snapshot.readMemoryIndex', () => readMemoryIndex(active!.decodedPath));
  const pilot = recordTime('snapshot.readPilotProfile', () => readPilotProfile(active!.decodedPath));
  const skills = recordTime('snapshot.listSkills', () => listSkills(active!.sessionFile));
  const claudeMdStack = readClaudeMdStack(active.decodedPath);
  const costByTool = computeCostByTool(stats);
  const budget = computeBudget(budgetConfig, today.totalUsd, stats.cost.totalUsd, stats.costPerHourUsd);
  const usage = recordTime('snapshot.computeUsageRollups', () =>
    computeUsageRollups({
      sessionCapUsd: budgetConfig?.sessionCapUsd ?? 0,
      dailyCapUsd: budgetConfig?.dailyCapUsd ?? 0,
      weeklyCapUsd: budgetConfig?.weeklyCapUsd ?? 0,
      monthlyCapUsd: budgetConfig?.monthlyCapUsd ?? 0,
      yearlyCapUsd: budgetConfig?.yearlyCapUsd ?? 0,
      activeSessionFile: active.sessionFile,
    }),
  );
  const notifications = computeNotifications({
    stats,
    memory,
    watchtower,
    obsidian,
    budget,
  });
  const recommendations = computeRecommendations({
    stats,
    memory,
    skills,
    prompts: [],
    agents,
    watchtower,
    budget,
    settings,
    rtk,
    obsidian,
    diskUsageBytes,
    cwd: active.decodedPath,
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
    officeFloor,
    watchtower,
    obsidian,
    costByTool,
    notifications,
    recommendations,
    budget,
    usage,
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
    routines,
    gitBranch,
    subdomainHealth: readSubdomainHealthSync(pilot ? pilot.alwaysLive : []),
    obsidianGraph: recordTime('snapshot.obsidianGraph', () => {
      const summary = readGraphSummaryForPrimaryVault();
      return summary
        ? { nodeCount: summary.nodeCount, edgeCount: summary.edgeCount, vault: summary.vaultName }
        : undefined;
    }),
    audit,
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

// Office Floor — for each project with a recently-touched session, surface
// the *current activity*: last tool call, target file, active sub-agent.
// Built on top of the same project scan as Watchtower but reads each session's
// tail to extract the live "what is the agent doing right now" signal.
const OFFICE_FLOOR_MAX_AGE_MS = 60 * 60 * 1000; // 1h, same as Watchtower
const OFFICE_FLOOR_TAIL_BYTES = 64 * 1024; // last 64KB is plenty for last activity

function readSessionTail(file: string, fileSize: number): string {
  const start = Math.max(0, fileSize - OFFICE_FLOOR_TAIL_BYTES);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const len = fileSize - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

interface FloorActivity {
  lastTool: string | undefined;
  lastToolArgs: string | undefined;
  lastToolResult: 'ok' | 'error' | 'pending' | undefined;
  currentFile: string | undefined;
  recentFiles: string[];
  subAgentName: string | undefined;
  subAgentDescription: string | undefined;
}

function readSessionLastActivity(file: string): FloorActivity {
  const out: FloorActivity = {
    lastTool: undefined,
    lastToolArgs: undefined,
    lastToolResult: undefined,
    currentFile: undefined,
    recentFiles: [],
    subAgentName: undefined,
    subAgentDescription: undefined,
  };
  let stat;
  try { stat = fs.statSync(file); } catch { return out; }
  const raw = readSessionTail(file, stat.size);
  if (!raw) return out;
  const lines = raw.split('\n');
  // Single forward pass. Track:
  //   - latest tool_use → becomes lastTool/lastToolArgs/lastToolId
  //   - latest subagent (Task/Agent) tool_use → subAgentName/Description
  //   - all file_paths from FILE_TOOLS in order, deduped → recentFiles + currentFile
  //   - tool_use_id → outcome map for result reconciliation at the end
  const fileBag: string[] = [];
  const seen = new Set<string>();
  let latestToolId: string | undefined;
  const resultById = new Map<string, 'ok' | 'error'>();
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.name) {
        out.lastTool = block.name;
        out.lastToolArgs = summarizeToolArgs(block);
        out.lastToolResult = 'pending';
        latestToolId = typeof block.id === 'string' ? block.id : undefined;
        if (block.name === 'Task' || block.name === 'Agent') {
          const sa = block.input?.subagent_type;
          const desc = block.input?.description;
          if (typeof sa === 'string') out.subAgentName = sa;
          if (typeof desc === 'string') out.subAgentDescription = desc;
        }
        if (FILE_TOOLS.has(block.name)) {
          const fp = block.input?.file_path ?? block.input?.path;
          if (typeof fp === 'string' && !seen.has(fp)) {
            seen.add(fp);
            fileBag.push(fp);
            out.currentFile = fp;
          }
        }
      }
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        resultById.set(block.tool_use_id, block.is_error === true ? 'error' : 'ok');
      }
    }
  }
  if (latestToolId) {
    const r = resultById.get(latestToolId);
    if (r) out.lastToolResult = r;
  }
  // Newest files first — fileBag was filled forward, so reverse + dedupe was
  // already maintained. Re-dedupe to put the most recent edit at index 0.
  out.recentFiles = fileBag.slice(-5).reverse();
  if (out.recentFiles.length) out.currentFile = out.recentFiles[0];
  return out;
}

export function computeOfficeFloor(): OfficeFloorTile[] {
  if (!fs.existsSync(claudeHome)) return [];
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return [];
  }
  const now = Date.now();
  const out: OfficeFloorTile[] = [];
  for (const proj of projects) {
    const dir = path.join(claudeHome, proj);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
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
    if (ageMs > OFFICE_FLOOR_MAX_AGE_MS) continue;
    const decoded = decodeProjectName(proj);
    const light = readSessionLight(best.file);
    const activity = readSessionLastActivity(best.file);
    const status: OfficeFloorTile['status'] =
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
      name: path.basename(decoded) || decoded,
      status,
      ageSeconds: Math.floor(ageMs / 1000),
      lastActivityAt: new Date(best.mtime).toISOString(),
      lastTool: activity.lastTool,
      lastToolArgs: activity.lastToolArgs,
      lastToolResult: activity.lastToolResult,
      currentFile: activity.currentFile,
      subAgentName: activity.subAgentName,
      subAgentDescription: activity.subAgentDescription,
      recentFiles: activity.recentFiles,
      totalTokens: light.totalTokens,
      totalUsd: cost.totalUsd,
      model: light.lastModel,
      modelFamily: family,
    });
  }
  out.sort((a, b) => {
    const order: Record<OfficeFloorTile['status'], number> = {
      live: 0, recent: 1, idle: 2, stale: 3,
    };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
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
  burnUsdPerHour = 0,
): BudgetStatus {
  const enabled = Boolean(cfg?.enabled);
  const dailyCapUsd = cfg?.dailyCapUsd ?? 0;
  const sessionCapUsd = cfg?.sessionCapUsd ?? 0;
  const dailyPct = dailyCapUsd > 0 ? Math.min(100, (spentTodayUsd / dailyCapUsd) * 100) : 0;
  const sessionPct = sessionCapUsd > 0 ? Math.min(100, (spentSessionUsd / sessionCapUsd) * 100) : 0;
  const tone = (pct: number): 'ok' | 'warn' | 'danger' =>
    pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
  // Forward-looking: extrapolate from current burn rate. Only meaningful
  // when there's an active session producing measurable cost-per-hour.
  const burn = burnUsdPerHour > 0 ? burnUsdPerHour : 0;
  const projected30MinUsd = burn / 2;
  const remainingDaily = dailyCapUsd > 0 ? Math.max(0, dailyCapUsd - spentTodayUsd) : 0;
  const minutesToDailyCap =
    burn > 0 && dailyCapUsd > 0 && remainingDaily > 0
      ? Math.round((remainingDaily / burn) * 60)
      : undefined;
  const now = new Date();
  const hoursLeftToday = Math.max(0, 24 - (now.getHours() + now.getMinutes() / 60));
  const projectedRemainingSpend = burn * hoursLeftToday;
  const projectedDailyHitsCap =
    enabled && dailyCapUsd > 0 && spentTodayUsd + projectedRemainingSpend >= dailyCapUsd;
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
    burnUsdPerHour: burn,
    projected30MinUsd,
    projectedDailyHitsCap,
    minutesToDailyCap,
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

interface RecommendationContext {
  stats: SessionStats;
  memory: MemoryEntry[];
  skills: SkillEntry[];
  prompts: { id: string; title: string; body: string }[];
  agents: AgentDef[];
  watchtower: WatchtowerSession[];
  budget: BudgetStatus;
  settings: SettingsSummary;
  rtk: RtkStatus;
  obsidian: ObsidianStatus;
  diskUsageBytes: number;
  cwd: string | undefined;
}

const SKILL_PICKS = [
  'office-hours',
  'plan-ceo-review',
  'investigate',
  'retro',
  'codex',
  'review',
];

export function computeRecommendations(ctx: RecommendationContext): Recommendation[] {
  const out: Recommendation[] = [];
  const {
    stats,
    memory,
    skills,
    prompts,
    agents,
    watchtower,
    budget,
    settings,
    rtk,
    obsidian,
    diskUsageBytes,
    cwd,
  } = ctx;

  // ---- Session / context health -------------------------------------------
  if (stats.contextWindowMax > 0 && stats.contextFillPct > 75) {
    out.push({
      id: 'rec-context-compact',
      category: 'session',
      impact: stats.contextFillPct > 90 ? 'high' : 'med',
      title: 'Compact the context window',
      why: `Working set is ${stats.contextFillPct.toFixed(0)}% full — Claude starts dropping reasoning quality past 80%. Run /compact or start a fresh session before continuing on tricky work.`,
      action: 'openSession',
      actionLabel: 'Open session',
      actionPayload: undefined,
    });
  }
  if (stats.totalTokens > 50_000 && stats.cacheHitRate > 0 && stats.cacheHitRate < 0.3) {
    out.push({
      id: 'rec-cache-cold',
      category: 'session',
      impact: 'med',
      title: 'Cache hit rate is cold',
      why: `Only ${(stats.cacheHitRate * 100).toFixed(0)}% of tokens hit cache. Each turn is paying full input cost — check that CLAUDE.md / system prompt isn't being rotated, and avoid randomized preambles.`,
      action: 'gotoTab',
      actionLabel: 'See cost breakdown',
      actionPayload: 'now',
    });
  }

  // ---- Memory -------------------------------------------------------------
  const stale = memory.filter((m) => m.isStale);
  if (stale.length >= 5) {
    out.push({
      id: 'rec-memory-prune',
      category: 'memory',
      impact: 'med',
      title: `Prune ${stale.length} stale memory entries`,
      why: 'Entries older than 30 days drift from current truth. Pruning keeps recall sharp and stops Claude from acting on outdated facts.',
      action: 'gotoTab',
      actionLabel: 'Review memory',
      actionPayload: 'memory',
    });
  }
  if (memory.length === 0 && cwd) {
    out.push({
      id: 'rec-memory-empty',
      category: 'memory',
      impact: 'med',
      title: 'Memory is empty — start saving facts',
      why: 'Auto-memory persists across sessions. Tell Claude things like "remember that we deploy via Pages project X" and they stay available next time.',
      action: 'openMemory',
      actionLabel: 'Open MEMORY.md',
      actionPayload: undefined,
    });
  }
  if (memory.length >= 50) {
    out.push({
      id: 'rec-memory-large',
      category: 'memory',
      impact: 'low',
      title: `Memory has grown to ${memory.length} entries`,
      why: 'Past ~40 entries, the index gets noisy and lookups blur together. Consider archiving project-finished memories to your Obsidian vault.',
      action: 'gotoTab',
      actionLabel: 'Review memory',
      actionPayload: 'memory',
    });
  }

  // ---- Skills -------------------------------------------------------------
  const unusedSkills = skills.filter((s) => s.useCount === 0);
  if (skills.length > 20 && unusedSkills.length > skills.length * 0.7) {
    out.push({
      id: 'rec-skills-untried',
      category: 'skills',
      impact: 'low',
      title: `${unusedSkills.length} of ${skills.length} skills never used this session`,
      why: 'Skills only help if you remember they exist. Try one of the high-leverage ones below the next time it fits — even one new skill per week compounds.',
      action: 'gotoTab',
      actionLabel: 'Browse skills',
      actionPayload: 'skills',
    });
  }
  // Suggest a useful skill the user hasn't invoked this session.
  const haveNames = new Set(skills.map((s) => s.name.toLowerCase()));
  const candidates = SKILL_PICKS.filter(
    (n) => haveNames.has(n) && skills.find((s) => s.name.toLowerCase() === n)?.useCount === 0,
  );
  if (candidates.length > 0 && stats.messageCount > 30) {
    const pick = candidates[0];
    out.push({
      id: `rec-skill-try-${pick}`,
      category: 'skills',
      impact: 'low',
      title: `Try /${pick}`,
      why: `You've sent ${stats.messageCount} messages this session without invoking /${pick}. It's one of the most leveraged skills you have installed — copy it, paste it next time it fits.`,
      action: 'copySkill',
      actionLabel: `Copy /${pick}`,
      actionPayload: pick,
    });
  }

  // ---- Prompts ------------------------------------------------------------
  if (prompts.length === 0) {
    out.push({
      id: 'rec-prompts-empty',
      category: 'prompts',
      impact: 'low',
      title: 'Save your most-used prompts',
      why: 'Cockpit\'s Prompts tab stores reusable prompts (review checklists, "ship it" prompts, daily standup templates). One click copies them for paste into Claude.',
      action: 'gotoTab',
      actionLabel: 'Open Prompts tab',
      actionPayload: 'prompts',
    });
  } else if (prompts.length >= 25) {
    out.push({
      id: 'rec-prompts-prune',
      category: 'prompts',
      impact: 'low',
      title: `${prompts.length} saved prompts — prune unused ones`,
      why: 'Long lists make the right prompt slower to find. Delete prompts you haven\'t reused in the last few weeks.',
      action: 'gotoTab',
      actionLabel: 'Open Prompts tab',
      actionPayload: 'prompts',
    });
  }

  // ---- Agents -------------------------------------------------------------
  if (agents.length === 0) {
    out.push({
      id: 'rec-agents-empty',
      category: 'agents',
      impact: 'med',
      title: 'No custom subagents defined',
      why: 'Custom agents in ~/.claude/agents/ encode role-specific behavior (code-reviewer, requirement-parser, ux-designer). They run on Haiku/Sonnet by default — cheaper than Opus for routine work.',
      action: 'gotoTab',
      actionLabel: 'See Agents tab',
      actionPayload: 'agents',
    });
  } else if (agents.length > 15) {
    out.push({
      id: 'rec-agents-many',
      category: 'agents',
      impact: 'low',
      title: `${agents.length} custom agents — consider consolidating`,
      why: 'Past ~10 agents, names start blurring and you forget which to invoke. Merge near-duplicates and delete ones you haven\'t used in a month.',
      action: 'gotoTab',
      actionLabel: 'Review agents',
      actionPayload: 'agents',
    });
  }

  // ---- Budget -------------------------------------------------------------
  if (!budget.enabled) {
    out.push({
      id: 'rec-budget-set',
      category: 'budget',
      impact: 'med',
      title: 'No daily spend cap set',
      why: 'Without a cap, an Opus runaway loop can burn $50+ before you notice. A soft daily cap surfaces a notification — it doesn\'t block work.',
      action: 'setDailyCap',
      actionLabel: 'Set daily cap',
      actionPayload: undefined,
    });
  }

  // ---- Idle sessions ------------------------------------------------------
  const idle = watchtower.filter((s) => s.status === 'idle' || s.status === 'stale');
  if (idle.length >= 3) {
    out.push({
      id: 'rec-idle-sessions',
      category: 'workflow',
      impact: 'low',
      title: `${idle.length} idle sessions across projects`,
      why: 'Each idle session is a parallel train of thought you abandoned. Pick the most valuable one to resume, or close the rest so the watchtower stays signal.',
      action: 'gotoTab',
      actionLabel: 'Open Watchtower',
      actionPayload: 'watchtower',
    });
  }

  // ---- Settings / hooks ---------------------------------------------------
  if (settings.settingsExists && settings.hooks.length === 0) {
    out.push({
      id: 'rec-hooks-none',
      category: 'workflow',
      impact: 'low',
      title: 'No hooks configured',
      why: 'Hooks (UserPromptSubmit, PostToolUse, Stop) let you wire automatic behavior — skill router, lint-on-save, notify-on-done. Most cockpit users have at least UserPromptSubmit.',
      action: 'gotoTab',
      actionLabel: 'Open Config',
      actionPayload: 'config',
    });
  }
  if (!settings.settingsExists) {
    out.push({
      id: 'rec-settings-missing',
      category: 'workflow',
      impact: 'med',
      title: 'No ~/.claude/settings.json',
      why: 'Without settings.json you can\'t configure permissions, env vars, MCP servers, or hooks. Cockpit reads from it — running without one means flying blind.',
      action: 'gotoTab',
      actionLabel: 'Open Config',
      actionPayload: 'config',
    });
  }

  // ---- RTK / token saver --------------------------------------------------
  if (!rtk.installed) {
    out.push({
      id: 'rec-rtk-install',
      category: 'health',
      impact: 'low',
      title: 'Install RTK to cut dev tokens 60–90%',
      why: 'RTK is a CLI proxy that filters noisy command output (git diff, npm install) before it reaches Claude. Pure savings, zero behavior change.',
      action: 'openExternal',
      actionLabel: 'See RTK',
      actionPayload: 'https://github.com/anthropics/rust-token-killer',
    });
  }

  // ---- Obsidian -----------------------------------------------------------
  if (!obsidian.installed) {
    out.push({
      id: 'rec-obsidian-install',
      category: 'workflow',
      impact: 'low',
      title: 'Connect an Obsidian vault',
      why: 'Save sessions, decisions, and learnings to a vault as a long-term brain. Cockpit can index them and surface them when relevant. Auto-capture every 15min keeps it current.',
      action: 'gotoTab',
      actionLabel: 'Open Obsidian tab',
      actionPayload: 'obsidian',
    });
  }

  // ---- Disk hygiene -------------------------------------------------------
  const fiveGb = 5 * 1024 * 1024 * 1024;
  if (diskUsageBytes > fiveGb) {
    out.push({
      id: 'rec-disk-prune',
      category: 'health',
      impact: 'low',
      title: `Session archive is ${formatBytes(diskUsageBytes)}`,
      why: 'Old .jsonl session logs accumulate. They\'re searchable via the Search tab, but past a few GB you\'re just storing dead context. Archive sessions older than 30 days.',
      action: 'gotoTab',
      actionLabel: 'Open Config',
      actionPayload: 'config',
    });
  }

  // Sort: high → med → low; within impact, keep insertion order.
  const rank: Record<RecommendationImpact, number> = { high: 0, med: 1, low: 2 };
  out.sort((a, b) => rank[a.impact] - rank[b.impact]);
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

// ===========================================================================
// Prompt mining — walks recent JSONL to surface reusable prompts the user
// has typed across sessions. Used by the Library tab's "Mine prompts" flow.
// ===========================================================================

export type PromptCategory =
  | 'legal'
  | 'build'
  | 'review'
  | 'plan'
  | 'research'
  | 'infra'
  | 'other';

export interface MinedPrompt {
  fingerprint: string;
  body: string;
  firstSeenAt: string | undefined;
  lastSeenAt: string | undefined;
  occurrences: number;
  category: PromptCategory;
  projectHint: string | undefined;
}

// Order matters — earlier patterns win when multiple match. Research and
// review come before build so prompts like "investigate why the build is
// slow" or "review the build" don't get mis-classified by the broad "build"
// keyword. Build itself is a catch-all for ship/deploy/PR intent.
const PROMPT_CATEGORY_KEYWORDS: Array<[PromptCategory, RegExp]> = [
  ['legal', /\b(legal|contract|clause|nda|haqq|counsel|court|matter|filing|redline|jurisdic|gdpr|privilege)\b/i],
  ['research', /\b(research|investigate|find out|how does|why does|explain|teach|summari[sz]e|compare)\b/i],
  ['review', /\b(review|audit|critique|feedback|second opinion|sanity check|look over)\b/i],
  ['plan', /\b(plan|design|architect|spec|roadmap|brainstorm|think through|explore|approach)\b/i],
  ['infra', /\b(aws|gcp|cloudflare|nginx|kubernetes|docker|terraform|cicd|pipeline|server)\b/i],
  ['build', /\b(ship|deploy|build|implement|refactor|fix|merge|pr|pull request|commit|release)\b/i],
];

export function classifyPrompt(body: string): PromptCategory {
  for (const [cat, rx] of PROMPT_CATEGORY_KEYWORDS) {
    if (rx.test(body)) return cat;
  }
  return 'other';
}

function fingerprintPrompt(body: string): string {
  // Cheap dedupe key — first 80 chars normalized. Same prompt typed twice
  // (with different trailing text) collapses; meaningfully different prompts
  // stay distinct.
  return body
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isInterestingPromptCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (t.length > 4000) return false;
  // Skip pasted file contents / tool output the user piped back.
  if (t.startsWith('{') && t.endsWith('}')) return false;
  if (t.startsWith('[') && t.endsWith(']')) return false;
  // Skip system-reminder and command-name passthroughs.
  if (t.includes('<system-reminder>')) return false;
  if (t.includes('<command-name>')) return false;
  // Skip tool result paste-backs.
  if (t.startsWith('Tool result:')) return false;
  return true;
}

export function minePrompts(limit = 50): MinedPrompt[] {
  if (!fs.existsSync(claudeHome)) return [];
  let projects: string[];
  try {
    projects = fs.readdirSync(claudeHome);
  } catch {
    return [];
  }
  const byFingerprint = new Map<string, MinedPrompt>();
  // Walk most recent files first so firstSeen/lastSeen are accurate.
  type FileRef = { full: string; mtime: number; project: string };
  const files: FileRef[] = [];
  for (const proj of projects) {
    const dir = path.join(claudeHome, proj);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      try {
        const s = fs.statSync(full);
        files.push({ full, mtime: s.mtimeMs, project: proj });
      } catch {
        /* ignore */
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  // Cap files scanned to keep mining fast on large vaults.
  const MAX_FILES = 80;
  for (const ref of files.slice(0, MAX_FILES)) {
    let raw: string;
    try {
      raw = fs.readFileSync(ref.full, 'utf8');
    } catch {
      continue;
    }
    const decodedProj = decodeProjectName(ref.project);
    const projectHint = path.basename(decodedProj) || decodedProj;
    for (const line of raw.split('\n')) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (parsed.type !== 'user') continue;
      const content = parsed.message?.content;
      const texts: string[] = [];
      if (typeof content === 'string') {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
            texts.push((block as { text: string }).text);
          }
        }
      }
      for (const t of texts) {
        if (!isInterestingPromptCandidate(t)) continue;
        const fp = fingerprintPrompt(t);
        const ts = parsed.timestamp;
        const existing = byFingerprint.get(fp);
        if (existing) {
          existing.occurrences += 1;
          if (ts) {
            if (!existing.firstSeenAt || ts < existing.firstSeenAt) existing.firstSeenAt = ts;
            if (!existing.lastSeenAt || ts > existing.lastSeenAt) existing.lastSeenAt = ts;
          }
        } else {
          byFingerprint.set(fp, {
            fingerprint: fp,
            body: t.trim(),
            firstSeenAt: ts,
            lastSeenAt: ts,
            occurrences: 1,
            category: classifyPrompt(t),
            projectHint,
          });
        }
      }
    }
  }
  // Score: reuse signal first (occurrences > 1 wins), then recency.
  const scored = Array.from(byFingerprint.values()).sort((a, b) => {
    if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
    const al = a.lastSeenAt || '';
    const bl = b.lastSeenAt || '';
    return bl.localeCompare(al);
  });
  // Filter: only surface prompts that appeared more than once OR are recent
  // and substantial. One-shot copy-pastes aren't worth saving.
  return scored
    .filter((p) => p.occurrences >= 2 || (p.body.length >= 80 && !!p.lastSeenAt))
    .slice(0, limit);
}
