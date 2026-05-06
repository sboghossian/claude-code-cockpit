import * as https from 'https';
import { logger } from './logger';

export interface UpdateStatus {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | undefined;
  hasUpdate: boolean;
  releaseUrl: string | undefined;
  releaseTitle: string | undefined;
  publishedAt: number | undefined;
  fetchedAt: number | undefined;
  error: string | undefined;
}

const RELEASE_URL = 'https://api.github.com/repos/sboghossian/claude-code-cockpit/releases/latest';
const REPO_RELEASES_PAGE = 'https://github.com/sboghossian/claude-code-cockpit/releases';

export async function fetchLatestRelease(): Promise<{
  version: string;
  htmlUrl: string;
  name: string | undefined;
  publishedAt: number | undefined;
}> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      RELEASE_URL,
      {
        headers: {
          'User-Agent': 'claude-cockpit-vscode',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode === 404) {
          reject(new Error('No releases published yet on GitHub.'));
          res.resume();
          return;
        }
        if (res.statusCode === 403) {
          reject(new Error('GitHub rate limit (60 req/h unauthenticated). Try again later.'));
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
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const tagName = String(parsed.tag_name ?? '');
            const version = tagName.replace(/^v/, '');
            const htmlUrl = String(parsed.html_url ?? REPO_RELEASES_PAGE);
            const name = typeof parsed.name === 'string' ? parsed.name : undefined;
            const publishedAt = typeof parsed.published_at === 'string'
              ? Date.parse(parsed.published_at)
              : undefined;
            if (!version) {
              reject(new Error('GitHub response missing tag_name.'));
              return;
            }
            resolve({ version, htmlUrl, name, publishedAt });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', (err) => reject(err));
    req.setTimeout(8000, () => {
      req.destroy(new Error('GitHub release fetch timeout'));
    });
  });
}

// Returns -1 if a < b, 0 if equal, 1 if a > b. Pre-release tags are treated
// as lower than the release version (semver-ish, good enough for our case).
export function compareSemver(a: string, b: string): number {
  const splitA = a.split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const splitB = b.split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(splitA.length, splitB.length);
  for (let i = 0; i < len; i++) {
    const av = splitA[i] || 0;
    const bv = splitB[i] || 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  // Equal numerics — a release ranks higher than a pre-release.
  const preA = a.includes('-');
  const preB = b.includes('-');
  if (preA === preB) return 0;
  return preA ? -1 : 1;
}

let cache: UpdateStatus | undefined;

export function getCachedUpdateStatus(): UpdateStatus | undefined {
  return cache;
}

export function setCachedUpdateStatus(s: UpdateStatus | undefined): void {
  cache = s;
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateStatus> {
  const status: UpdateStatus = {
    enabled: true,
    currentVersion,
    latestVersion: undefined,
    hasUpdate: false,
    releaseUrl: REPO_RELEASES_PAGE,
    releaseTitle: undefined,
    publishedAt: undefined,
    fetchedAt: Date.now(),
    error: undefined,
  };
  try {
    const r = await fetchLatestRelease();
    status.latestVersion = r.version;
    status.releaseUrl = r.htmlUrl;
    status.releaseTitle = r.name;
    status.publishedAt = r.publishedAt;
    status.hasUpdate = compareSemver(currentVersion, r.version) < 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status.error = msg;
    logger.warn(`update check failed: ${msg}`);
  }
  cache = status;
  return status;
}

export function disabledStatus(currentVersion: string): UpdateStatus {
  return {
    enabled: false,
    currentVersion,
    latestVersion: undefined,
    hasUpdate: false,
    releaseUrl: REPO_RELEASES_PAGE,
    releaseTitle: undefined,
    publishedAt: undefined,
    fetchedAt: undefined,
    error: undefined,
  };
}
