import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { logger } from './logger';

export interface RoadmapProject {
  name: string;
  category: string;
  emoji: string | undefined;
  desc: string | undefined;
  longDesc: string | undefined;
  url: string | null;
  git: string | null;
  milestones: string[];
  nextSteps: string[];
  techStack: string[];
  obsidianSessions: number;
  stage: string | undefined;
  label: string | undefined;
  color: string | undefined;
}

export interface RoadmapCategory {
  key: string;
  label: string;
  projects: RoadmapProject[];
}

export interface RoadmapData {
  scannedAt: string;
  totalProjects: number;
  categories: RoadmapCategory[];
  sessionStats: { total: number; byProject: Record<string, number> } | undefined;
  fetchedAt: number;
  source: string;
  error: string | undefined;
}

const CACHE_PATH = path.join(os.homedir(), '.claude', '.cache', 'cockpit-roadmap.json');
const DEFAULT_REMOTE = 'https://roadmap.dashable.dev/api/projects';
const DEFAULT_LOCAL = 'http://localhost:3000/api/projects';

function ensureDir(p: string): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  } catch {
    /* ignore */
  }
}

function readCache(): RoadmapData | undefined {
  try {
    if (!fs.existsSync(CACHE_PATH)) return undefined;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw) as RoadmapData;
  } catch (err) {
    logger.info(`roadmap: cache read failed: ${String(err)}`);
    return undefined;
  }
}

function writeCache(data: RoadmapData): void {
  try {
    ensureDir(CACHE_PATH);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data), 'utf8');
  } catch (err) {
    logger.info(`roadmap: cache write failed: ${String(err)}`);
  }
}

function getJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': 'claude-cockpit-vscode', Accept: 'application/json' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

function shapeProject(raw: Record<string, unknown>): RoadmapProject {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    name: String(raw.name ?? ''),
    category: String(raw.category ?? 'other'),
    emoji: typeof raw.emoji === 'string' ? raw.emoji : undefined,
    desc: typeof raw.desc === 'string' ? raw.desc : undefined,
    longDesc: typeof raw.longDesc === 'string' ? raw.longDesc : undefined,
    url: typeof raw.url === 'string' ? raw.url : null,
    git: typeof raw.git === 'string' ? raw.git : null,
    milestones: arr(raw.milestones),
    nextSteps: arr(raw.nextSteps),
    techStack: arr(raw.techStack),
    obsidianSessions: typeof raw.obsidianSessions === 'number' ? raw.obsidianSessions : 0,
    stage: typeof raw.stage === 'string' ? raw.stage : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
  };
}

function shape(raw: unknown, source: string): RoadmapData {
  const o = (raw ?? {}) as Record<string, unknown>;
  const cats = Array.isArray(o.categories) ? o.categories : [];
  const categories: RoadmapCategory[] = cats.map((c) => {
    const cat = c as Record<string, unknown>;
    const projects = Array.isArray(cat.projects) ? cat.projects : [];
    return {
      key: String(cat.key ?? ''),
      label: String(cat.label ?? cat.key ?? ''),
      projects: projects.map((p) => shapeProject(p as Record<string, unknown>)),
    };
  });
  const sessionStats = o.sessionStats as RoadmapData['sessionStats'];
  return {
    scannedAt: typeof o.scannedAt === 'string' ? o.scannedAt : new Date().toISOString(),
    totalProjects: typeof o.totalProjects === 'number' ? o.totalProjects : categories.reduce((s, c) => s + c.projects.length, 0),
    categories,
    sessionStats,
    fetchedAt: Date.now(),
    source,
    error: undefined,
  };
}

export async function fetchRoadmap(): Promise<RoadmapData> {
  const sources = [DEFAULT_LOCAL, DEFAULT_REMOTE];
  let lastErr: string | undefined;
  for (const src of sources) {
    try {
      const raw = await getJson(src, 4000);
      const data = shape(raw, src);
      writeCache(data);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      logger.info(`roadmap: ${src} failed: ${lastErr}`);
    }
  }
  const cached = readCache();
  if (cached) {
    return { ...cached, error: `live fetch failed (${lastErr ?? 'unknown'}); showing cached snapshot` };
  }
  return {
    scannedAt: new Date().toISOString(),
    totalProjects: 0,
    categories: [],
    sessionStats: undefined,
    fetchedAt: Date.now(),
    source: '',
    error: lastErr ?? 'roadmap unreachable',
  };
}

export function readCachedRoadmap(): RoadmapData | undefined {
  return readCache();
}
