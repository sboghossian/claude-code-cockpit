import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { readObsidianStatus } from './obsidian';

export type DiscoverWindow = 'day' | 'week' | 'month';

export interface GithubRepo {
  name: string;
  fullName: string;
  url: string;
  description: string;
  language: string | undefined;
  stars: number;
  starsToday: number | undefined;
}

export interface RssEntry {
  title: string;
  source: string;
  vault: string;
  filePath: string;
  mtimeMs: number;
}

export interface DiscoverState {
  enabled: boolean;
  github: {
    window: DiscoverWindow;
    fetchedAt: number;
    repos: GithubRepo[];
    error: string | undefined;
  } | undefined;
  rss: {
    folder: string | undefined;
    entries: RssEntry[];
    error: string | undefined;
  };
}

let cache: DiscoverState['github'] | undefined;

function sinceDate(window: DiscoverWindow): string {
  const d = new Date();
  if (window === 'day') d.setUTCDate(d.getUTCDate() - 1);
  else if (window === 'week') d.setUTCDate(d.getUTCDate() - 7);
  else d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchGithubTrending(window: DiscoverWindow): Promise<GithubRepo[]> {
  const since = sinceDate(window);
  const q = encodeURIComponent(`created:>${since}`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=25`;

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'claude-cockpit-vscode',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode === 403) {
          // GitHub rate-limited unauthenticated requests at 60/hour.
          reject(new Error('GitHub API rate limit (60 req/h unauthenticated). Try again later.'));
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { items?: Array<Record<string, unknown>> };
            const items = parsed.items ?? [];
            const repos: GithubRepo[] = items.slice(0, 25).map((it) => ({
              name: String(it.name ?? ''),
              fullName: String(it.full_name ?? ''),
              url: String(it.html_url ?? ''),
              description: String(it.description ?? ''),
              language: typeof it.language === 'string' ? it.language : undefined,
              stars: Number(it.stargazers_count ?? 0),
              starsToday: undefined,
            }));
            resolve(repos);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error('GitHub API timeout'));
    });
  });
}

// Reads RSS results from Obsidian vault — the rss-feed-obsidian routine
// dumps notes into a vault folder. We surface those without a network call.
export function readRssFromObsidian(): { folder: string | undefined; entries: RssEntry[]; error: string | undefined } {
  const status = readObsidianStatus();
  if (!status.installed || !status.vaults || status.vaults.length === 0) {
    return { folder: undefined, entries: [], error: 'No Obsidian vault detected.' };
  }
  for (const v of status.vaults) {
    const candidates = ['rss', 'RSS', 'Inbox/RSS', 'Inbox/rss', '50-Inbox/rss', '50-Inbox/RSS'];
    for (const cand of candidates) {
      const folder = path.join(v.path, cand);
      if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
        return { folder, entries: scanRssFolder(folder, v.name), error: undefined };
      }
    }
  }
  return { folder: undefined, entries: [], error: 'No RSS folder found in Obsidian vaults (looked for rss/, Inbox/RSS/, 50-Inbox/rss/).' };
}

function scanRssFolder(folder: string, vault: string): RssEntry[] {
  const out: RssEntry[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.md')) continue;
    const full = path.join(folder, e.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    out.push({
      title: e.name.replace(/\.md$/, ''),
      source: inferSource(e.name),
      vault,
      filePath: full,
      mtimeMs: stat.mtimeMs,
    });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, 50);
}

function inferSource(filename: string): string {
  const m = /^([^_-]+)/.exec(filename);
  return m ? m[1] : '';
}

export function getCachedDiscover(): DiscoverState['github'] | undefined {
  return cache;
}

export function setCachedDiscover(state: DiscoverState['github']): void {
  cache = state;
}

export function readScheduledTasksRoot(): string {
  return path.join(os.homedir(), '.claude', 'scheduled-tasks');
}

const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/;

export function slugifyRoutineName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface CreateRoutineResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

export function createRoutineSkill(rawName: string, description: string, body: string): CreateRoutineResult {
  const slug = slugifyRoutineName(rawName);
  if (!slug || !SLUG_OK.test(slug)) {
    return { ok: false, error: 'Routine name must contain letters or digits.' };
  }
  const root = readScheduledTasksRoot();
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  } catch (err) {
    return { ok: false, error: `Failed to create scheduled-tasks dir: ${String(err)}` };
  }
  const dir = path.join(root, slug);
  if (fs.existsSync(dir)) {
    return { ok: false, error: `A routine named "${slug}" already exists.` };
  }
  try {
    fs.mkdirSync(dir, { recursive: false });
  } catch (err) {
    return { ok: false, error: `mkdir failed: ${String(err)}` };
  }
  const safeDesc = description.replace(/\r?\n/g, ' ').slice(0, 300);
  const file = path.join(dir, 'SKILL.md');
  const content = `---\nname: ${slug}\ndescription: ${safeDesc || 'TODO: describe this routine'}\n---\n\n${body || 'TODO: write the instructions Claude Code should follow when this routine fires.'}\n`;
  try {
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    logger.warn(`createRoutineSkill writeFile failed: ${String(err)}`);
    return { ok: false, error: `writeFile failed: ${String(err)}` };
  }
  return { ok: true, filePath: file };
}
