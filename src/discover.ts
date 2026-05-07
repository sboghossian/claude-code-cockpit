import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { logger } from './logger';
import { readObsidianStatus } from './obsidian';
import { appendAuditEvent } from './auditLog';

export type DiscoverWindow = 'day' | 'week' | 'month';
export type DiscoverSource = 'github' | 'hn' | 'producthunt' | 'obsidian' | 'custom';

export interface FeedItem {
  title: string;
  url: string;
  source: string;
  description: string | undefined;
  publishedAt: number | undefined;
  // Source-specific signal — HN points, PH votes, GH stars. Used for ranking.
  score: number | undefined;
}

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
    appendAuditEvent({ ts: Date.now(), kind: 'net.outbound', detail: { host: 'api.github.com', method: 'GET', purpose: 'discover.trending' }, worktree: 'permissions-audit' });
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
  // Common locations across PARA / Johnny.Decimal / inbox-driven vaults.
  const candidates = [
    '30-Knowledge/rss-feeds',
    '30-Knowledge/rss',
    'Knowledge/rss-feeds',
    'Knowledge/rss',
    'rss-feeds',
    'rss',
    'RSS',
    'Inbox/RSS',
    'Inbox/rss',
    '50-Inbox/rss',
    '50-Inbox/RSS',
    '00-Inbox/rss',
    '00-Inbox/RSS',
  ];
  for (const v of status.vaults) {
    for (const cand of candidates) {
      const folder = path.join(v.path, cand);
      try {
        if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
          return { folder, entries: scanRssFolder(folder, v.name), error: undefined };
        }
      } catch {
        /* try next candidate */
      }
    }
  }
  // Fallback: shallow scan for any folder with "rss" in the name (≤3 deep).
  for (const v of status.vaults) {
    const found = findRssFolder(v.path, 3);
    if (found) {
      return { folder: found, entries: scanRssFolder(found, v.name), error: undefined };
    }
  }
  return {
    folder: undefined,
    entries: [],
    error: 'No RSS folder found in vault. Looked under common paths and did a shallow scan. Create a folder named "rss" or "rss-feeds" in your vault.',
  };
}

function findRssFolder(root: string, maxDepth: number): string | undefined {
  const stack: { p: string; depth: number }[] = [{ p: root, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.depth > maxDepth) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur.p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      if (/^rss(-?feeds?)?$/i.test(e.name)) {
        return path.join(cur.p, e.name);
      }
      if (cur.depth < maxDepth) {
        stack.push({ p: path.join(cur.p, e.name), depth: cur.depth + 1 });
      }
    }
  }
  return undefined;
}

// Some vaults have 10k+ files — naive readdir+stat freezes the extension
// host. Use Dirent to skip non-files, sort by name DESC (RSS items use
// `YYYY-MM-DD-…` so name order ≈ reverse-chronological), then stat top N.
function scanRssFolder(folder: string, vault: string): RssEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 200);
  const out: RssEntry[] = [];
  for (const name of candidates) {
    const full = path.join(folder, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    out.push({
      title: name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
      source: inferSource(name),
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

// ===========================================================================
// Multi-source feed fetching — Hacker News, Product Hunt, custom RSS URLs.
// All read-only, all opt-in (gated by claudeCockpit.discover.enabled).
// ===========================================================================

function httpGet(
  rawUrl: string,
  timeoutMs = 8000,
  hopsLeft = 5,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    appendAuditEvent({ ts: Date.now(), kind: 'net.outbound', detail: { host: parsed.hostname, method: 'GET', purpose: 'discover.feed' }, worktree: 'permissions-audit' });
    const req = lib.get(
      parsed,
      {
        headers: {
          'User-Agent': 'claude-cockpit-vscode',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8, */*;q=0.5',
        },
      },
      (res) => {
        const code = res.statusCode || 0;
        // Follow redirects up to a hop cap of 5.
        if ([301, 302, 303, 307, 308].includes(code)) {
          const loc = res.headers.location;
          res.resume();
          if (!loc) {
            reject(new Error(`HTTP ${code} without Location header for ${rawUrl}`));
            return;
          }
          if (hopsLeft <= 0) {
            reject(new Error(`HTTP redirect hop cap exceeded for ${rawUrl}`));
            return;
          }
          let next: string;
          try {
            next = new URL(loc, parsed).toString();
          } catch (err) {
            reject(err);
            return;
          }
          httpGet(next, timeoutMs, hopsLeft - 1).then(resolve, reject);
          return;
        }
        let body = '';
        let total = 0;
        const MAX = 2_000_000;
        let aborted = false;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (aborted) return;
          total += chunk.length;
          if (total > MAX) {
            aborted = true;
            res.destroy();
            reject(new Error(`HTTP body exceeded ${MAX} bytes for ${rawUrl}`));
            return;
          }
          body += chunk;
        });
        res.on('end', () => {
          if (aborted) return;
          resolve({ status: code, body });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP timeout for ${rawUrl}`));
    });
  });
}

// Tiny RSS/Atom parser. Pulls <item> or <entry> elements via regex — robust
// enough for the well-formed feeds we target (HN, PH, well-behaved blogs).
// Returns title/link/description/pubDate triples.
export function parseRss(xml: string): Array<{
  title: string;
  link: string;
  description: string;
  pubDate: string | undefined;
}> {
  const out: Array<{ title: string; link: string; description: string; pubDate: string | undefined }> = [];
  const itemRx = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml))) {
    const block = m[2];
    const title = pickFirst(block, ['title']) ?? '';
    let link = pickFirst(block, ['link']) ?? '';
    if (!link) {
      // Atom: <link href="..."/>
      const lh = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
      if (lh) link = lh[1];
    }
    const description = pickFirst(block, ['description', 'summary', 'content']) ?? '';
    const pubDate = pickFirst(block, ['pubDate', 'published', 'updated', 'dc:date']);
    out.push({
      title: stripCdataAndTags(title).trim(),
      link: stripCdataAndTags(link).trim(),
      description: stripCdataAndTags(description).trim(),
      pubDate,
    });
  }
  return out;
}

function pickFirst(block: string, tags: string[]): string | undefined {
  for (const t of tags) {
    const rx = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i');
    const mm = rx.exec(block);
    if (mm) return mm[1];
  }
  return undefined;
}

function stripCdataAndTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Hacker News — uses the official Algolia API for ranking, which supports
// time-window filtering. Falls back to hnrss.org if API errors.
export async function fetchHackerNews(window: DiscoverWindow): Promise<FeedItem[]> {
  const days = window === 'day' ? 1 : window === 'week' ? 7 : 30;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&numericFilters=created_at_i>${since}&hitsPerPage=25`;
  try {
    const { status, body } = await httpGet(url);
    if (status >= 400) throw new Error(`HN API ${status}`);
    const parsed = JSON.parse(body) as { hits?: Array<Record<string, unknown>> };
    return (parsed.hits || []).map((h) => ({
      title: String(h.title || h.story_title || ''),
      url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
      source: 'Hacker News',
      description: undefined,
      publishedAt: typeof h.created_at_i === 'number' ? (h.created_at_i as number) * 1000 : undefined,
      score: typeof h.points === 'number' ? (h.points as number) : undefined,
    }));
  } catch (err) {
    logger.warn(`HN fetch failed, falling back to hnrss: ${String(err)}`);
    const { body } = await httpGet('https://hnrss.org/frontpage');
    return parseRss(body)
      .slice(0, 25)
      .map((r) => ({
        title: r.title,
        url: r.link,
        source: 'Hacker News',
        description: r.description,
        publishedAt: r.pubDate ? Date.parse(r.pubDate) || undefined : undefined,
        score: undefined,
      }));
  }
}

export async function fetchProductHunt(): Promise<FeedItem[]> {
  // Product Hunt's official Atom feed — no auth, no rate limit beyond polite use.
  const { status, body } = await httpGet('https://www.producthunt.com/feed');
  if (status >= 400) throw new Error(`Product Hunt feed returned ${status}`);
  return parseRss(body)
    .slice(0, 25)
    .map((r) => ({
      title: r.title,
      url: r.link,
      source: 'Product Hunt',
      description: r.description.slice(0, 280),
      publishedAt: r.pubDate ? Date.parse(r.pubDate) || undefined : undefined,
      score: undefined,
    }));
}

export interface CustomFeed {
  name: string;
  url: string;
}

// Fetches one user-supplied RSS/Atom URL. The caller passes a sanitized URL;
// we don't fetch arbitrary protocols.
export async function fetchCustomFeed(feed: CustomFeed): Promise<FeedItem[]> {
  if (!/^https?:\/\//i.test(feed.url)) {
    throw new Error(`Refusing to fetch non-http(s) URL: ${feed.url}`);
  }
  const { status, body } = await httpGet(feed.url);
  if (status >= 400) throw new Error(`${feed.name} returned ${status}`);
  return parseRss(body)
    .slice(0, 25)
    .map((r) => ({
      title: r.title,
      url: r.link,
      source: feed.name,
      description: r.description.slice(0, 280),
      publishedAt: r.pubDate ? Date.parse(r.pubDate) || undefined : undefined,
      score: undefined,
    }));
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
