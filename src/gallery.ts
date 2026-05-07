// =============================================================================
// Claude Cockpit — Skill / Agent Gallery (Phase 1, M, ~400 LOC).
//
// Local-first browser of every skill in `~/.claude/skills/` and every agent
// in `~/.claude/agents/`. Reuses listSkills (claudeData.ts) + readAgents
// (integrations.ts) to avoid re-implementing frontmatter parsing.
//
// v1.0 ships three operations:
//   - browse:   list local entries with metadata + counts (snapshot summary)
//   - share:    format a portable manifest of one entry for clipboard paste
//   - install:  download a skill from a public HTTPS URL after SHA256 preview
//
// Out-of-scope for v1.0 (per launch plan cut lines): a public registry,
// one-click publish. The "share" payload includes a header pointing at the
// future cockpit-skills registry repo's issue template — that's the publish
// path for now.
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import { listSkills, SkillEntry } from './claudeData';
import { readAgents } from './integrations';
import { logger } from './logger';
import {
  registerSidebarScript,
  registerTab,
  registerTrigger,
  registerWidget,
} from './plugin';

// -----------------------------------------------------------------------------
// Public types — the webview consumes GallerySnapshot via the message bus.
// -----------------------------------------------------------------------------

export type GalleryItemKind = 'skill-user' | 'skill-plugin' | 'agent';

export interface GalleryItem {
  /** Stable id — e.g. `skill-user:office-hours`, `agent:planner`. */
  id: string;
  kind: GalleryItemKind;
  name: string;
  description: string;
  /** Source plugin name for plugin-cached skills, scope for agents. */
  origin: string;
  filePath: string;
  /** Times this entry was invoked in the active session, when known. */
  useCount: number;
}

export interface GallerySnapshot {
  /** Cheap counts only — full items list lives behind a message round-trip. */
  skillCount: number;
  agentCount: number;
  totalCount: number;
}

export interface GallerySharePayload {
  /** Clean clipboard text — frontmatter + body + Cockpit signature header. */
  text: string;
  /** Inferred publish URL (always the registry issue template for now). */
  publishUrl: string;
}

export interface InstallPreview {
  url: string;
  bytes: number;
  sha256: string;
  /** First ~1KB of the body, lossily decoded for human review. */
  excerpt: string;
  /** Inferred skill directory name (slug) — pre-validated. */
  inferredName: string;
}

// -----------------------------------------------------------------------------
// Constants — keep in sync with the launch brief. Skill manifests live next
// to SKILL.md; we read up to 256KB which covers every real skill we've seen.
// -----------------------------------------------------------------------------

const REGISTRY_ISSUE_URL =
  'https://github.com/sboghossian/cockpit-skills/issues/new?template=publish-skill.md';
const MAX_SKILL_BYTES = 256 * 1024;
const HTTP_TIMEOUT_MS = 8_000;
const SLUG_RX = /^[a-z][a-z0-9-]{0,63}$/;

// Override-able at test time. Production never touches this.
function skillsRoot(): string {
  return process.env.COCKPIT_SKILLS_ROOT_OVERRIDE ?? path.join(os.homedir(), '.claude', 'skills');
}

// -----------------------------------------------------------------------------
// Listing — uses the existing readers verbatim. Adds stable id + filePath so
// the webview can drive open/copy/share without re-deriving paths.
// -----------------------------------------------------------------------------

function skillFilePath(entry: SkillEntry): string {
  // SkillEntry.name follows `fm.name || directory_name`. In ~all real skills
  // the two match — but if a skill's frontmatter declares a different `name`
  // than its on-disk directory, the constructed path won't exist. Fall back
  // to a directory scan in that rare case so share/install still work.
  const baseDirs: string[] = [];
  if (entry.source === 'plugin' && entry.pluginName) {
    baseDirs.push(path.join(os.homedir(), '.claude', 'plugins', 'cache', entry.pluginName, 'skills'));
  } else {
    baseDirs.push(skillsRoot());
  }
  for (const root of baseDirs) {
    const direct = path.join(root, entry.name, 'SKILL.md');
    if (fs.existsSync(direct)) return direct;
    // Fallback: scan for a SKILL.md whose frontmatter `name` matches.
    if (fs.existsSync(root)) {
      try {
        for (const subdir of fs.readdirSync(root)) {
          const candidate = path.join(root, subdir, 'SKILL.md');
          if (!fs.existsSync(candidate)) continue;
          try {
            const head = fs.readFileSync(candidate, 'utf8').slice(0, 1024);
            if (new RegExp(`^name:\\s*${escapeRegExp(entry.name)}\\s*$`, 'm').test(head)) {
              return candidate;
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  // Last resort — return the (non-existent) direct path; readers will surface
  // a clear "file not found" error rather than silently misbehave.
  return path.join(baseDirs[0], entry.name, 'SKILL.md');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function listGalleryItems(cwd: string | undefined): GalleryItem[] {
  const skills = listSkills();
  const agents = readAgents(cwd);
  const out: GalleryItem[] = [];
  for (const s of skills) {
    out.push({
      id: `skill-${s.source}:${s.name}`,
      kind: s.source === 'plugin' ? 'skill-plugin' : 'skill-user',
      name: s.name,
      description: s.description,
      origin: s.pluginName ?? (s.source === 'plugin' ? 'plugin' : 'user'),
      filePath: skillFilePath(s),
      useCount: s.useCount,
    });
  }
  for (const a of agents) {
    out.push({
      id: `agent:${a.name}`,
      kind: 'agent',
      name: a.name,
      description: a.description,
      origin: a.scope,
      filePath: a.filePath,
      useCount: 0,
    });
  }
  out.sort((x, y) => x.name.localeCompare(y.name));
  return out;
}

export function gallerySummary(cwd: string | undefined): GallerySnapshot {
  // Cheap path — counts only, no body reads. Snapshot lives on the hot path so
  // we lazy-load full items via gallery.openLocal.
  const skillCount = listSkills().length;
  const agentCount = readAgents(cwd).length;
  return { skillCount, agentCount, totalCount: skillCount + agentCount };
}

// -----------------------------------------------------------------------------
// Share — format a portable manifest for clipboard paste. The output is
// frontmatter + body verbatim, prefixed with a Cockpit signature header so
// recipients know what they're looking at and where to publish. Round-trips
// through parseFrontmatter (asserted by the share-formatter test).
// -----------------------------------------------------------------------------

function readBoundedFile(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(`gallery.share: file not found: ${file}`);
  }
  const stat = fs.statSync(file);
  if (stat.size > MAX_SKILL_BYTES) {
    throw new Error(`gallery.share: file too large (${stat.size} > ${MAX_SKILL_BYTES})`);
  }
  return fs.readFileSync(file, 'utf8');
}

export function formatShareManifest(item: GalleryItem): GallerySharePayload {
  const body = readBoundedFile(item.filePath);
  // The body is markdown (likely with `---` frontmatter). We prepend a HTML
  // comment block — markdown viewers strip it, but a clipboard recipient sees
  // it plain. Comment-only header keeps the file parseable as a skill.
  const ts = new Date().toISOString();
  const header =
    `<!-- claude-cockpit:gallery share v1\n` +
    `   kind: ${item.kind}\n` +
    `   name: ${item.name}\n` +
    `   origin: ${item.origin}\n` +
    `   sharedAt: ${ts}\n` +
    `   publishTo: ${REGISTRY_ISSUE_URL}\n` +
    `-->\n`;
  return { text: `${header}${body}`, publishUrl: REGISTRY_ISSUE_URL };
}

// -----------------------------------------------------------------------------
// Install — accept a public HTTPS URL, fetch the body, compute SHA256, return
// a preview for confirmation. A separate writeInstall() commits the bytes to
// disk only after the host shows the preview to the user.
// -----------------------------------------------------------------------------

export function validateInstallUrl(input: string): { ok: true; href: string } | { ok: false; reason: string } {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'URL is empty' };
  }
  if (input.length > 2048) {
    return { ok: false, reason: 'URL is too long' };
  }
  let parsed: url.URL;
  try {
    parsed = new url.URL(input);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only https:// URLs are accepted' };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'URL has no host' };
  }
  return { ok: true, href: parsed.toString() };
}

export function inferSkillName(href: string): string {
  // Strip query / fragment, take the last meaningful path segment, and slug it.
  // GitHub raw URLs look like /<user>/<repo>/<ref>/<path>/SKILL.md — so we drop
  // SKILL.md and use the parent dir name as the slug.
  const parsed = new url.URL(href);
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return 'unnamed-skill';
  let candidate = segments[segments.length - 1];
  if (/^skill\.md$/i.test(candidate) && segments.length >= 2) {
    candidate = segments[segments.length - 2];
  }
  candidate = candidate
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!candidate || !SLUG_RX.test(candidate)) return 'unnamed-skill';
  return candidate;
}

interface FetchResult {
  status: number;
  body: string;
}

function httpsGetText(href: string): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      href,
      { headers: { 'User-Agent': 'claude-cockpit-vscode' }, timeout: HTTP_TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        // Follow one level of redirect — GitHub occasionally 301s raw URLs.
        if ((status === 301 || status === 302 || status === 307 || status === 308) && res.headers.location) {
          res.resume();
          httpsGetText(new url.URL(res.headers.location, href).toString()).then(resolve, reject);
          return;
        }
        let body = '';
        let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > MAX_SKILL_BYTES) {
            req.destroy(new Error(`gallery.install: response > ${MAX_SKILL_BYTES} bytes`));
            return;
          }
          body += chunk;
        });
        res.on('end', () => resolve({ status, body }));
        res.on('error', (err) => reject(err));
      },
    );
    req.on('timeout', () => req.destroy(new Error('gallery.install: timeout')));
    req.on('error', (err) => reject(err));
  });
}

export async function previewInstall(
  href: string,
  fetcher: (h: string) => Promise<{ status: number; body: string }> = httpsGetText,
): Promise<InstallPreview> {
  const v = validateInstallUrl(href);
  if (!v.ok) {
    throw new Error(v.reason);
  }
  const result = await fetcher(v.href);
  if (result.status >= 500) {
    throw new Error(`gallery.install: source returned ${result.status}`);
  }
  if (result.status >= 400) {
    throw new Error(`gallery.install: source returned ${result.status}`);
  }
  if (!result.body) {
    throw new Error('gallery.install: empty response body');
  }
  const sha256 = crypto.createHash('sha256').update(result.body, 'utf8').digest('hex');
  const excerpt = result.body.slice(0, 1024);
  const inferredName = inferSkillName(v.href);
  return {
    url: v.href,
    bytes: Buffer.byteLength(result.body, 'utf8'),
    sha256,
    excerpt,
    inferredName,
  };
}

export interface ConfirmedInstall {
  url: string;
  expectedSha256: string;
  /** Override-able for tests. Defaults to the homedir skills root. */
  rootOverride?: string;
  /** Test-only fetcher injection. Production always uses httpsGetText. */
  fetcher?: (href: string) => Promise<{ status: number; body: string }>;
}

export interface InstallResult {
  filePath: string;
  bytes: number;
  sha256: string;
  inferredName: string;
}

export async function installFromUrl(opts: ConfirmedInstall): Promise<InstallResult> {
  const v = validateInstallUrl(opts.url);
  if (!v.ok) {
    throw new Error(v.reason);
  }
  const fetcher = opts.fetcher ?? httpsGetText;
  const result = await fetcher(v.href);
  if (result.status >= 400) {
    throw new Error(`gallery.install: source returned ${result.status}`);
  }
  const sha256 = crypto.createHash('sha256').update(result.body, 'utf8').digest('hex');
  if (opts.expectedSha256 && sha256 !== opts.expectedSha256) {
    throw new Error('gallery.install: SHA256 mismatch — content changed since preview');
  }
  const inferredName = inferSkillName(v.href);
  if (!SLUG_RX.test(inferredName)) {
    throw new Error(`gallery.install: cannot infer safe skill name from ${v.href}`);
  }
  const root = opts.rootOverride ?? skillsRoot();
  const targetDir = path.resolve(root, inferredName);
  // Path-traversal guard. After resolve(), targetDir must still live inside root.
  const resolvedRoot = path.resolve(root);
  if (targetDir !== resolvedRoot && !targetDir.startsWith(resolvedRoot + path.sep)) {
    throw new Error('gallery.install: refusing to write outside skills root');
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(filePath, result.body, { encoding: 'utf8', flag: 'w' });
  logger.info(`gallery.install: wrote ${filePath} (${result.body.length} bytes, sha=${sha256.slice(0, 12)}…)`);
  return {
    filePath,
    bytes: Buffer.byteLength(result.body, 'utf8'),
    sha256,
    inferredName,
  };
}

// -----------------------------------------------------------------------------
// Activation — wires the gallery widgets / tab / sidebar script through the
// Phase-0 plugin API. Idempotent: safe to call multiple times in tests.
// -----------------------------------------------------------------------------

let activated = false;

export function activateGallery(): void {
  if (activated) return;
  activated = true;
  registerSidebarScript('media/sidebar.gallery.js');
  registerWidget({
    id: 'galleryGrid',
    label: 'Skill / agent gallery',
    category: 'Gallery',
    requiresCwd: false,
  });
  registerWidget({
    id: 'galleryShareCard',
    label: 'Gallery · share / install',
    category: 'Gallery',
    requiresCwd: false,
  });
  registerTab({
    id: 'gallery',
    label: 'Gallery',
    iconSvg: '',
    pinned: false,
    requiresCwd: false,
    hint: 'Browse local skills + agents. Share via clipboard. Install by HTTPS URL.',
    defaultWidgets: ['galleryGrid', 'galleryShareCard'],
  });
  registerTrigger({
    command: 'claudeCockpit.gallery.openTab',
    title: 'Claude Cockpit: Open Gallery',
  });
  registerTrigger({
    command: 'claudeCockpit.gallery.installFromUrl',
    title: 'Claude Cockpit: Install Skill from URL',
  });
}

/** Test-only — not exported through any consumer. */
export function __resetGalleryActivation(): void {
  activated = false;
}
