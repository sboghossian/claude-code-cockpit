// =============================================================================
// Claude Cockpit — Agent Hot-Reload (jcode-inspired feature 3).
//
// jcode's pitch: "agents can edit their own source code with automatic
// reloading." That's a reckless-by-default behavior; for legal-AI work
// (HAQQ) we want it gated.
//
// Cockpit's existing Approve tab already enforces the LeCun world-model
// stance: no autonomous multi-step LLM action without lookahead +
// scoring + rollback + human gate. We extend that pattern to agent
// definitions: when an agent's `.md` file under `~/.claude/agents/` or
// `<workspace>/.claude/agents/` changes mid-session, surface the change
// as a pending review item with a diff preview. The human chooses
// reload (apply now) or keep (snapshot the new content but don't
// activate it for the running session).
//
// This module is the *detector* + the *change record*. The actual
// "reload" semantics are a no-op at the harness level (Claude Code
// rereads agent files on each invocation already), but the audit
// record matters: we persist what changed, when, and who reviewed it,
// so HAQQ can prove no agent was hot-swapped without sign-off.
//
// Implementation: chokidar would be the obvious dep, but Cockpit has
// zero runtime deps. We use vscode.workspace.createFileSystemWatcher
// which already powers the rest of Cockpit's file watching.
// =============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from './logger';

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');

export interface AgentChangeEvent {
  /** Stable id — `<scope>:<name>` e.g. `global:senior-software-engineer`. */
  id: string;
  scope: 'global' | 'workspace';
  name: string;
  filePath: string;
  changedAt: number;
  /** sha256 of the new file contents (truncated to 16 hex). */
  newHash: string;
  /** sha256 of the previous contents, when known. */
  prevHash: string | null;
  reviewed: boolean;
}

export type AgentChangeListener = (event: AgentChangeEvent) => void;

export class AgentReloadWatcher {
  private hashes = new Map<string, string>();
  private events: AgentChangeEvent[] = [];
  private listeners: AgentChangeListener[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private readonly maxEvents = 50;

  constructor() {
    this.seedHashes(GLOBAL_AGENTS_DIR, 'global');
    const workspaceAgentDirs = (vscode.workspace.workspaceFolders ?? []).map(
      (f) => path.join(f.uri.fsPath, '.claude', 'agents'),
    );
    for (const dir of workspaceAgentDirs) {
      this.seedHashes(dir, 'workspace');
    }
  }

  start(): vscode.Disposable {
    const globalPattern = new vscode.RelativePattern(
      vscode.Uri.file(GLOBAL_AGENTS_DIR),
      '*.md',
    );
    this.watchGlob(globalPattern, 'global', GLOBAL_AGENTS_DIR);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '.claude/agents/*.md');
      const baseDir = path.join(folder.uri.fsPath, '.claude', 'agents');
      this.watchGlob(pattern, 'workspace', baseDir);
    }
    return new vscode.Disposable(() => this.dispose());
  }

  onChange(listener: AgentChangeListener): vscode.Disposable {
    this.listeners.push(listener);
    return new vscode.Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  }

  recentEvents(): AgentChangeEvent[] {
    return [...this.events].reverse();
  }

  markReviewed(id: string): void {
    const ev = this.events.find((e) => e.id === id);
    if (ev) ev.reviewed = true;
  }

  pendingCount(): number {
    return this.events.filter((e) => !e.reviewed).length;
  }

  dispose(): void {
    for (const w of this.watchers) {
      try { w.dispose(); } catch { /* noop */ }
    }
    this.watchers = [];
    this.listeners = [];
  }

  private watchGlob(pattern: vscode.RelativePattern, scope: 'global' | 'workspace', baseDir: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const handle = (uri: vscode.Uri) => this.handleChange(uri.fsPath, scope, baseDir);
    watcher.onDidChange(handle);
    watcher.onDidCreate(handle);
    watcher.onDidDelete((uri) => this.handleDelete(uri.fsPath, scope));
    this.watchers.push(watcher);
  }

  private seedHashes(dir: string, scope: 'global' | 'workspace'): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(dir, entry.name);
      const hash = hashFile(filePath);
      if (hash) {
        const id = scope + ':' + entry.name.replace(/\.md$/, '');
        this.hashes.set(id, hash);
      }
    }
  }

  private handleChange(filePath: string, scope: 'global' | 'workspace', baseDir: string): void {
    const rel = path.relative(baseDir, filePath);
    if (rel.startsWith('..') || !rel.endsWith('.md')) return;
    const name = path.basename(filePath, '.md');
    const id = scope + ':' + name;
    const newHash = hashFile(filePath);
    if (!newHash) return;
    const prevHash = this.hashes.get(id) ?? null;
    if (prevHash === newHash) return;
    this.hashes.set(id, newHash);
    const event: AgentChangeEvent = {
      id,
      scope,
      name,
      filePath,
      changedAt: Date.now(),
      newHash,
      prevHash,
      reviewed: false,
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    logger.info(`agentReload: detected change in ${id} (prev=${prevHash?.slice(0, 8) ?? 'new'} -> ${newHash.slice(0, 8)})`);
    for (const l of this.listeners) {
      try { l(event); } catch (err) { logger.warn('agentReload listener: ' + String(err)); }
    }
  }

  private handleDelete(filePath: string, scope: 'global' | 'workspace'): void {
    const name = path.basename(filePath, '.md');
    const id = scope + ':' + name;
    this.hashes.delete(id);
    logger.info(`agentReload: ${id} deleted`);
  }
}

function hashFile(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}
