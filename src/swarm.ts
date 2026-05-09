// =============================================================================
// Claude Cockpit — Swarm Topology (jcode-inspired feature 2).
//
// jcode's pitch: "spawn multiple agents in the same repo with automatic
// conflict resolution." Cockpit already surfaces every Claude session
// touched in the last hour via the Watchtower tab. What's missing is the
// *topology*: which sessions are touching the same files, and where do
// their changes potentially collide.
//
// This module computes a force-graph-friendly representation from the
// existing snapshot data:
//   - nodes: recent Claude sessions (read from `~/.claude/projects/*/`)
//   - edges: pairs of sessions that have written to overlapping file
//     paths within the same time window
//   - severity: how many files overlap, and whether either session is
//     currently active (mid-tool-call) — active overlap is the real
//     conflict risk; idle overlap is just history.
//
// Read-only. No file watcher of its own — piggybacks on the snapshot
// the sidebar already refreshes.
// =============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const RECENT_WINDOW_MS = 60 * 60 * 1000; // 1h, matches Watchtower
const MAX_SESSIONS = 30;

export interface SwarmNode {
  /** Stable id — basename of the session JSONL minus extension. */
  id: string;
  sessionFile: string;
  projectDir: string;
  cwd: string;
  lastTouchedMs: number;
  filesTouched: string[];
  /** Best-effort: is this session active right now (recent activity)? */
  active: boolean;
}

export interface SwarmEdge {
  source: string;
  target: string;
  overlap: string[];
  /** "high" if both endpoints are active; "medium" if one; "low" otherwise. */
  severity: 'high' | 'medium' | 'low';
}

export interface SwarmTopology {
  generatedAt: number;
  nodes: SwarmNode[];
  edges: SwarmEdge[];
  /** Total active sessions in the window; renders as the swarm size. */
  activeCount: number;
}

const ACTIVE_THRESHOLD_MS = 60_000;

export function computeTopology(): SwarmTopology {
  const now = Date.now();
  const nodes = listRecentSessions(now);
  const edges = computeEdges(nodes);
  const activeCount = nodes.filter((n) => n.active).length;
  return { generatedAt: now, nodes, edges, activeCount };
}

function listRecentSessions(now: number): SwarmNode[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  let projectDirs: string[];
  try {
    projectDirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(PROJECTS_DIR, d.name));
  } catch (err) {
    logger.warn('swarm: failed to read projects dir: ' + String(err));
    return [];
  }
  const candidates: SwarmNode[] = [];
  for (const projectDir of projectDirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const cwd = decodeProjectDir(path.basename(projectDir));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionFile = path.join(projectDir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(sessionFile);
      } catch {
        continue;
      }
      const lastTouchedMs = stat.mtimeMs;
      if (now - lastTouchedMs > RECENT_WINDOW_MS) continue;
      const filesTouched = readFilesTouched(sessionFile);
      candidates.push({
        id: entry.name.replace(/\.jsonl$/, ''),
        sessionFile,
        projectDir,
        cwd,
        lastTouchedMs,
        filesTouched,
        active: now - lastTouchedMs < ACTIVE_THRESHOLD_MS,
      });
    }
  }
  candidates.sort((a, b) => b.lastTouchedMs - a.lastTouchedMs);
  return candidates.slice(0, MAX_SESSIONS);
}

function decodeProjectDir(encoded: string): string {
  // Cockpit's project dirs use `-Path-To-Cwd` format. Reverse the
  // leading-hyphen-as-slash convention as best we can; this is
  // approximate but matches the existing claudeData.ts behavior.
  return '/' + encoded.replace(/^-+/, '').replace(/-/g, '/');
}

const FILES_TOUCHED_TAIL_BYTES = 256 * 1024;
const FILE_PATH_RE = /"file_path"\s*:\s*"([^"\\]+(?:\\.[^"\\]*)*)"/g;

function readFilesTouched(jsonlPath: string): string[] {
  const seen = new Set<string>();
  let buf = '';
  try {
    const stat = fs.statSync(jsonlPath);
    const start = Math.max(0, stat.size - FILES_TOUCHED_TAIL_BYTES);
    const fd = fs.openSync(jsonlPath, 'r');
    try {
      const len = stat.size - start;
      const tmp = Buffer.alloc(len);
      fs.readSync(fd, tmp, 0, len, start);
      buf = tmp.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  let m: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(buf)) !== null) {
    const p = m[1];
    if (p && p.length < 1024) seen.add(p);
    if (seen.size > 200) break;
  }
  return [...seen];
}

function computeEdges(nodes: SwarmNode[]): SwarmEdge[] {
  const edges: SwarmEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a.filesTouched.length) continue;
    const aSet = new Set(a.filesTouched);
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (!b.filesTouched.length) continue;
      const overlap: string[] = [];
      for (const p of b.filesTouched) {
        if (aSet.has(p)) overlap.push(p);
        if (overlap.length > 10) break;
      }
      if (!overlap.length) continue;
      const both = a.active && b.active;
      const either = a.active || b.active;
      edges.push({
        source: a.id,
        target: b.id,
        overlap,
        severity: both ? 'high' : either ? 'medium' : 'low',
      });
    }
  }
  return edges;
}
