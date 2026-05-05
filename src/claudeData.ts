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

export interface CockpitSnapshot {
  cwd: string;
  projectDir: string | undefined;
  stats: SessionStats;
  memory: MemoryEntry[];
}

const claudeHome = path.join(os.homedir(), '.claude', 'projects');

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

export function readSession(file: string | undefined, cwd: string): SessionStats {
  const empty: SessionStats = {
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
  };
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
    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use' || !block.name) {
          continue;
        }
        stats.toolCallCount += 1;
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
    }
  }
  stats.filesTouched = Array.from(touches.values()).sort(
    (a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt),
  );
  stats.totalTokens =
    stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;
  void cwd;
  return stats;
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

export function snapshot(cwd: string): CockpitSnapshot {
  const dir = projectDirFor(cwd);
  const projectDir = fs.existsSync(dir) ? dir : undefined;
  const sessionFile = findActiveSession(cwd);
  const stats = readSession(sessionFile, cwd);
  const memory = readMemoryIndex(cwd);
  return { cwd, projectDir, stats, memory };
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
