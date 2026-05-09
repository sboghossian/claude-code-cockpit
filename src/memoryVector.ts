// =============================================================================
// Claude Cockpit — Memory Vector Visualization (jcode-inspired feature 1).
//
// Surfaces the persistent semantic memory store maintained by the
// `/memory-vector` skill at `~/.claude/skills/memory-vector/`. The skill
// owns the SQLite + sqlite-vec store at `~/.gstack/memory/vectors.db`
// (chunks table + chunk_vecs vec0 384-dim). Cockpit doesn't take on the
// native sqlite-vec dep — we shell out to the skill's CLI for stats and
// queries. Read-only by design.
//
// jcode's pitch was "embeds conversations as vectors for automatic
// context recall." Cockpit already has /memory-vector for the recall
// part. What was missing was a *visualization* — what's actually in
// there, how it's distributed across source types, and what neighbors
// exist around any given query. This module is that visualization.
//
// Wiring:
//   - registerSidebarScript('media/sidebar.memvec.js')
//   - registerWidget x2 (stats + search/neighbors)
//   - sidebarProvider handles `memvec.fetchStats` and `memvec.query`
//     by calling fetchStats() / runQuery() in this module.
// =============================================================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

const SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', 'memory-vector');
const CLI_PATH = path.join(SKILL_DIR, 'cli.js');
const DB_PATH = path.join(os.homedir(), '.gstack', 'memory', 'vectors.db');
const QUERY_TIMEOUT_MS = 8000;
const MAX_K = 25;

export interface MemvecStats {
  available: boolean;
  dbPath: string;
  totalChunks: number;
  bySourceType: Record<string, number>;
  bySourcePath: { path: string; count: number }[];
  newestIndexedAt: string | null;
  /** When `available` is false, why. */
  reason?: string;
}

export interface MemvecHit {
  id: number;
  sourcePath: string;
  sourceType: string;
  chunkIndex: number;
  distance: number;
  snippet: string;
}

export interface MemvecQueryResult {
  query: string;
  backend: string;
  results: MemvecHit[];
  /** Empty when ok; populated when the CLI errored or timed out. */
  error?: string;
}

export function isAvailable(): boolean {
  try {
    return fs.existsSync(CLI_PATH);
  } catch {
    return false;
  }
}

function unavailable(reason: string): MemvecStats {
  return {
    available: false,
    dbPath: DB_PATH,
    totalChunks: 0,
    bySourceType: {},
    bySourcePath: [],
    newestIndexedAt: null,
    reason,
  };
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd: SKILL_DIR,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve({ stdout, stderr: stderr + '\n[timeout]', code: -1 });
    }, QUERY_TIMEOUT_MS);
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + '\n' + String(err), code: -1 });
    });
  });
}

export async function fetchStats(): Promise<MemvecStats> {
  if (!isAvailable()) {
    return unavailable('memory-vector skill not installed at ' + SKILL_DIR);
  }
  if (!fs.existsSync(DB_PATH)) {
    return unavailable('vector DB not yet built at ' + DB_PATH + ' — run `/memory-vector` to index');
  }
  const { stdout, stderr, code } = await runCli(['stats']);
  if (code !== 0) {
    logger.warn(`memvec stats exit=${code} stderr=${stderr.slice(0, 300)}`);
    return unavailable('stats CLI failed (exit ' + code + ')');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    logger.warn(`memvec stats parse failed: ${String(err)}`);
    return unavailable('stats CLI returned non-JSON');
  }
  return normalizeStats(parsed);
}

function normalizeStats(raw: unknown): MemvecStats {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const total = numberOr(r.totalChunks ?? r.total_chunks, 0);
  const bySourceType = readMap(r.bySourceType ?? r.by_source_type);
  const bySourcePathRaw = r.bySourcePath ?? r.by_source_path;
  const bySourcePath: { path: string; count: number }[] = [];
  if (Array.isArray(bySourcePathRaw)) {
    for (const entry of bySourcePathRaw.slice(0, 20)) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const p = String(e.path ?? e.sourcePath ?? '');
        const c = numberOr(e.count, 0);
        if (p) bySourcePath.push({ path: p, count: c });
      }
    }
  }
  const newest = r.newestIndexedAt ?? r.newest_indexed_at ?? null;
  return {
    available: true,
    dbPath: DB_PATH,
    totalChunks: total,
    bySourceType,
    bySourcePath,
    newestIndexedAt: typeof newest === 'string' ? newest : null,
  };
}

function numberOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = numberOr(val, 0);
  }
  return out;
}

export async function runQuery(query: string, k = 8, type?: string): Promise<MemvecQueryResult> {
  const safeQuery = String(query ?? '').slice(0, 1000).trim();
  if (!safeQuery) {
    return { query: '', backend: '', results: [], error: 'empty query' };
  }
  const safeK = Math.max(1, Math.min(MAX_K, Math.floor(k) || 8));
  if (!isAvailable()) {
    return { query: safeQuery, backend: '', results: [], error: 'memory-vector not installed' };
  }
  const args = ['query', safeQuery, '--json', '--k', String(safeK)];
  if (type && /^[a-z0-9_-]{1,32}$/i.test(type)) {
    args.push('--type', type);
  }
  const { stdout, stderr, code } = await runCli(args);
  if (code !== 0) {
    return { query: safeQuery, backend: '', results: [], error: `cli exit ${code}: ${stderr.slice(0, 200)}` };
  }
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const backend = String(parsed.backend ?? '');
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    const results: MemvecHit[] = rawResults.slice(0, MAX_K).map((r): MemvecHit => {
      const e = (r && typeof r === 'object') ? r as Record<string, unknown> : {};
      return {
        id: numberOr(e.id, 0),
        sourcePath: String(e.sourcePath ?? e.source_path ?? ''),
        sourceType: String(e.sourceType ?? e.source_type ?? ''),
        chunkIndex: numberOr(e.chunkIndex ?? e.chunk_index, 0),
        distance: numberOr(e.distance, 0),
        snippet: String(e.snippet ?? ''),
      };
    });
    return { query: safeQuery, backend, results };
  } catch (err) {
    return { query: safeQuery, backend: '', results: [], error: 'JSON parse: ' + String(err) };
  }
}
