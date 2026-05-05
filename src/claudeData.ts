import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

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
  input?: { file_path?: string; path?: string };
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
    }
    const model = parsed.message?.model;
    if (typeof model === 'string') {
      stats.lastModel = model;
    }
    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use' || !block.name) {
          continue;
        }
        stats.toolCallCount += 1;
        toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
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
  void cwd;
  return stats;
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
  for (const line of raw.split('\n')) {
    const match = linkPattern.exec(line.trim());
    if (match) {
      entries.push({ title: match[1], filename: match[2], hook: match[3] });
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
    out.push({ name, description, source, pluginName });
  }
}

export function listSkills(): SkillEntry[] {
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
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
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
      const s = readSessionLight(full);
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
  return out;
}

// Cheaper readSession variant for cross-project scans — skips activity feed,
// sparkline, subagents, file-touch tracking.
interface LightSession {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  messageCount: number;
  lastModel: string | undefined;
}
function readSessionLight(file: string): LightSession {
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

export function snapshot(cwd: string | undefined): CockpitSnapshot {
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

  const skills = listSkills();
  const today = computeToday();
  const diskUsageBytes = computeDiskUsage();

  if (!active) {
    return {
      cwd: undefined,
      projectDir: undefined,
      stats: emptyStatsFor(undefined),
      memory: [],
      projects,
      settings,
      skills,
      pilot: undefined,
      today,
      diskUsageBytes,
    };
  }

  const stats = readSession(active.sessionFile, active.decodedPath);
  const memory = readMemoryIndex(active.decodedPath);
  const pilot = readPilotProfile(active.decodedPath);
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
  };
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
