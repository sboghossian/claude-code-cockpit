// =============================================================================
// Claude Cockpit — Obsidian graph builder.
//
// Walks an Obsidian vault, parses [[wikilinks]] out of every .md, and emits a
// {nodes, edges} pair the d3-force renderer in media/sidebar.graph.js consumes.
//
// Stephane only cares about the graph, not the body of the notes — so we keep
// nothing but title, path, and link metadata in memory. Bodies are read into a
// scratch buffer, scanned, and dropped.
//
// The full graph for ~5k notes is too big to ship inside the regular cockpit
// snapshot (postMessage cost), so the snapshot only carries
// {nodeCount, edgeCount, vault}. The webview asks for the full graph via a
// `graph.refresh` round-trip when its tab opens.
//
// Cache: ~/.claude/.cockpit/graph-cache-<vaultId>.json keyed by the latest
// .md mtime in the vault. A 100ms cold load on Stephane's vault becomes <10ms
// on warm runs.
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { ObsidianVault, readVaultRegistry } from './obsidian';

export interface GraphNode {
  id: string; // canonical relative path (no .md, forward-slash) — also the d3 node id
  label: string; // basename without extension
  relPath: string; // original relative path with extension preserved
  mtimeMs: number;
  /** True when no other note links to this node and this node has no outbound links. */
  isolated: boolean;
}

export interface GraphEdge {
  /** Source node id. */
  source: string;
  /** Target node id. May not exist as a node when the wikilink points at a missing note (we resolve those to the literal target id; renderer treats them as ghost nodes). */
  target: string;
}

export interface VaultGraph {
  vaultId: string;
  vaultName: string;
  vaultPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAt: number;
  /** Highest .md mtime observed during the walk; cache key. */
  vaultMtimeMs: number;
}

export interface GraphSummary {
  vaultId: string;
  vaultName: string;
  nodeCount: number;
  edgeCount: number;
  builtAt: number;
}

// -----------------------------------------------------------------------------
// Wikilink parser.
//
// Obsidian's syntax handles four tricky forms we MUST support cleanly:
//   [[Note]]                — plain
//   [[Note|alias]]          — pipe alias
//   [[Note#section]]        — header anchor
//   [[Note#section|alias]]  — both
//
// We strip the alias and section to get the canonical target. Extension is
// optional in source but we normalize to no-extension because nodes are keyed
// without the .md.
// -----------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function parseWikilinks(body: string): string[] {
  if (!body) return [];
  // Strip fenced code blocks first; users routinely paste markdown samples
  // that include literal [[link]] inside a fence and we shouldn't follow them.
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(stripped)) !== null) {
    let raw = m[1];
    // Drop alias.
    const pipe = raw.indexOf('|');
    if (pipe >= 0) raw = raw.slice(0, pipe);
    // Drop header anchor.
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash);
    // Embedded ![[link]] — the leading bang sits OUTSIDE the brackets so it
    // doesn't reach us; nothing extra to do.
    const target = raw.trim();
    if (!target) continue;
    out.push(normalizeTarget(target));
  }
  return out;
}

function normalizeTarget(target: string): string {
  // Obsidian links can be a basename OR a relative path. Either way we strip
  // a trailing .md and normalize separators so two link forms collapse to one
  // graph id.
  let t = target.replace(/\\/g, '/');
  t = t.replace(/\.md$/i, '');
  // Trim leading "./".
  t = t.replace(/^\.\//, '');
  return t;
}

// -----------------------------------------------------------------------------
// Vault walk.
// -----------------------------------------------------------------------------

const MAX_DEPTH = 8; // listRecentNotes uses 4; graph wants the whole tree.
const MAX_FILE_BYTES = 1 << 20; // 1 MiB read cap per .md — protects against pathological notes.

interface RawNote {
  id: string;
  relPath: string;
  basename: string;
  mtimeMs: number;
  links: string[];
}

function walkVault(vaultPath: string): RawNote[] {
  const out: RawNote[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: vaultPath, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    if (depth > MAX_DEPTH) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`graph: readdir failed for ${dir}: ${String(err)}`);
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // skip .obsidian, .trash, etc.
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.name.toLowerCase().endsWith('.md')) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const rel = path.relative(vaultPath, full).replace(/\\/g, '/');
      const id = rel.replace(/\.md$/i, '');
      const basename = ent.name.replace(/\.md$/i, '');
      const links = readAndParse(full, stat.size);
      out.push({ id, relPath: rel, basename, mtimeMs: stat.mtimeMs, links });
    }
  }
  return out;
}

function readAndParse(filePath: string, sizeBytes: number): string[] {
  if (sizeBytes <= 0) return [];
  const cap = Math.min(sizeBytes, MAX_FILE_BYTES);
  let body: string;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(cap);
    const n = fs.readSync(fd, buf, 0, cap, 0);
    fs.closeSync(fd);
    body = buf.slice(0, n).toString('utf8');
  } catch (err) {
    logger.info(`graph: read failed for ${filePath}: ${String(err)}`);
    return [];
  }
  return parseWikilinks(body);
}

// -----------------------------------------------------------------------------
// Edge resolution.
//
// A wikilink target may be:
//   1. An exact id we already have a node for (path-style or basename match);
//   2. A basename ambiguous between several files (we pick the lexicographically
//      first by path — Obsidian's own resolver uses proximity but for the graph
//      "any consistent pick" is fine);
//   3. A name that matches no file — a "ghost" / dangling link; we still emit
//      the edge so the renderer can show dangling nodes if the user wants.
// -----------------------------------------------------------------------------

function buildResolver(notes: RawNote[]): {
  byId: Map<string, RawNote>;
  byBasename: Map<string, RawNote>;
} {
  const byId = new Map<string, RawNote>();
  const byBasename = new Map<string, RawNote>();
  for (const n of notes) {
    byId.set(n.id, n);
    // Basename collisions: keep the lexicographically smallest path so the
    // map is deterministic across runs (matters for the cache hit ratio).
    const existing = byBasename.get(n.basename);
    if (!existing || n.id < existing.id) {
      byBasename.set(n.basename, n);
    }
  }
  return { byId, byBasename };
}

function resolveTarget(
  target: string,
  resolver: { byId: Map<string, RawNote>; byBasename: Map<string, RawNote> },
): string {
  if (resolver.byId.has(target)) return target;
  // Try without a directory prefix.
  const baseOnly = target.split('/').pop() ?? target;
  const hit = resolver.byBasename.get(baseOnly);
  if (hit) return hit.id;
  return target; // ghost — leave as-is.
}

// -----------------------------------------------------------------------------
// Public API: build the graph for a given vault. Cycles are fine — d3-force
// handles A→B→A without infinite looping. We just don't dedupe self-edges so
// the renderer can show "self-references" if the user wants (it filters in JS).
// -----------------------------------------------------------------------------

export function buildVaultGraph(vault: ObsidianVault): VaultGraph {
  const start = Date.now();
  const notes = walkVault(vault.path);
  const resolver = buildResolver(notes);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const ghostIds = new Set<string>();

  for (const n of notes) {
    nodes.push({
      id: n.id,
      label: n.basename,
      relPath: n.relPath,
      mtimeMs: n.mtimeMs,
      isolated: false, // computed below
    });
    for (const linkRaw of n.links) {
      const target = resolveTarget(linkRaw, resolver);
      if (target === n.id) continue; // drop self-links
      edges.push({ source: n.id, target });
      outDegree.set(n.id, (outDegree.get(n.id) ?? 0) + 1);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      if (!resolver.byId.has(target)) ghostIds.add(target);
    }
  }

  // Add ghost nodes so the renderer can choose to show them. They carry an
  // empty mtime so the "touched today" overlay never picks them up.
  for (const ghostId of ghostIds) {
    if (resolver.byId.has(ghostId)) continue;
    nodes.push({
      id: ghostId,
      label: ghostId.split('/').pop() ?? ghostId,
      relPath: ghostId,
      mtimeMs: 0,
      isolated: false,
    });
  }

  // Mark isolated (zero in + zero out).
  for (const node of nodes) {
    const inD = inDegree.get(node.id) ?? 0;
    const outD = outDegree.get(node.id) ?? 0;
    if (inD === 0 && outD === 0) node.isolated = true;
  }

  const vaultMtimeMs = nodes.reduce((max, n) => (n.mtimeMs > max ? n.mtimeMs : max), 0);
  const elapsed = Date.now() - start;
  logger.info(
    `graph: built ${nodes.length} nodes / ${edges.length} edges for "${vault.name}" in ${elapsed}ms`,
  );

  return {
    vaultId: vault.id,
    vaultName: vault.name,
    vaultPath: vault.path,
    nodes,
    edges,
    builtAt: Date.now(),
    vaultMtimeMs,
  };
}

// -----------------------------------------------------------------------------
// Cache: ~/.claude/.cockpit/graph-cache-<vaultId>.json
//
// Cache key is the highest .md mtime in the vault. We get the cache headers
// without re-reading bodies, compare, and only do the expensive walk when
// it's stale. cacheKeyMtime() is exported so the snapshot path can cheaply
// know whether a cache hit is available without rebuilding.
// -----------------------------------------------------------------------------

function cacheDir(): string {
  return path.join(os.homedir(), '.claude', '.cockpit');
}

function cachePathFor(vaultId: string): string {
  // vault id is a hex string from Obsidian; sanitize regardless to defend
  // against future format drift.
  const safe = vaultId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return path.join(cacheDir(), `graph-cache-${safe}.json`);
}

export function readGraphCache(vault: ObsidianVault): VaultGraph | undefined {
  const file = cachePathFor(vault.id);
  if (!fs.existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: VaultGraph;
  try {
    parsed = JSON.parse(raw) as VaultGraph;
  } catch {
    return undefined;
  }
  if (parsed.vaultId !== vault.id) return undefined;
  return parsed;
}

export function writeGraphCache(graph: VaultGraph): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
  } catch (err) {
    logger.info(`graph: mkdir cache failed: ${String(err)}`);
    return;
  }
  const file = cachePathFor(graph.vaultId);
  // Atomic write: stage to tmp, rename. Avoids leaving truncated cache files
  // behind if the process dies mid-write.
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(graph), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    logger.info(`graph: write cache failed: ${String(err)}`);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/**
 * Return the cached graph if it's still valid, otherwise rebuild and cache.
 * "Valid" means the highest .md mtime in the vault has not advanced since the
 * cache was written.
 */
export function getOrBuildGraph(vault: ObsidianVault): VaultGraph {
  const latestMtime = highestMtime(vault.path);
  const cached = readGraphCache(vault);
  if (cached && cached.vaultMtimeMs === latestMtime && latestMtime > 0) {
    logger.info(
      `graph: cache hit for "${vault.name}" (${cached.nodes.length} nodes)`,
    );
    return cached;
  }
  const fresh = buildVaultGraph(vault);
  writeGraphCache(fresh);
  return fresh;
}

/** Cheap pass: latest .md mtime without reading any bodies. */
function highestMtime(vaultPath: string): number {
  let max = 0;
  const stack: { dir: string; depth: number }[] = [{ dir: vaultPath, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    if (depth > MAX_DEPTH) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.name.toLowerCase().endsWith('.md')) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > max) max = stat.mtimeMs;
      } catch {
        // ignore
      }
    }
  }
  return max;
}

// -----------------------------------------------------------------------------
// Snapshot helper. Lightweight — used by claudeData.snapshotInner so the main
// snapshot carries only nodeCount/edgeCount and the webview lazy-loads the
// real {nodes, edges} via a graph.refresh round-trip when the tab opens.
// -----------------------------------------------------------------------------

export function readGraphSummaryForPrimaryVault(): GraphSummary | undefined {
  const vaults = readVaultRegistry().filter((v) => v.exists);
  const primary = vaults[0];
  if (!primary) return undefined;
  const cached = readGraphCache(primary);
  if (!cached) return undefined;
  return {
    vaultId: cached.vaultId,
    vaultName: cached.vaultName,
    nodeCount: cached.nodes.length,
    edgeCount: cached.edges.length,
    builtAt: cached.builtAt,
  };
}

/** Test-only: clear the cache file for a given vault id. */
export function __clearCacheForTests(vaultId: string): void {
  const file = cachePathFor(vaultId);
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
}
