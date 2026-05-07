// =============================================================================
// Claude Cockpit — Plugin API (Phase 0 of the v1.0 launch wave).
//
// This module declares the formal extension contract that every Phase-1 feature
// (approval-queue, replay-timeline, permissions-audit, skill-gallery,
// tab-system-v2, a11y-theme, obsidian-graph) consumes. It is the single point
// of truth for the shared types so we don't end up with three near-identical
// `WorktreeAction` / `Snapshot` definitions sprinkled across feature modules.
//
// Phase 0 is pure plumbing — registering anything via these functions has no
// behavioral effect on v0.21.0. The webview-side bridge lives in
// `media/sidebar.js` (EXTERNAL_COMPONENTS map). Until a Phase-1 worktree
// actually populates the registries, every existing tab still renders byte-
// for-byte the same.
// =============================================================================

import { logger } from './logger';

// -----------------------------------------------------------------------------
// Public types — every Phase-1 worktree imports these directly.
// -----------------------------------------------------------------------------

export interface CockpitWidget {
  id: string;
  label: string;
  category:
    | 'Now'
    | 'Session'
    | 'Cross'
    | 'System'
    | 'Config'
    | 'Memory'
    | 'Approval'
    | 'Replay'
    | 'Audit'
    | 'Gallery';
  requiresCwd: boolean;
  // The widget's `id` doubles as the lookup key in EXTERNAL_COMPONENTS on the
  // webview side. The sibling script registers the render fn via
  // `window.cockpit.registerComponent(id, { label, category, requiresCwd, render })`.
  // No separate function-name field is needed.
}

export interface CockpitTab {
  id: string;
  label: string;
  /** 24×24 stroke-only currentColor svg. */
  iconSvg: string;
  pinned: boolean;
  requiresCwd: boolean;
  hint: string;
  defaultWidgets: string[];
}

export interface CockpitTrigger {
  /** e.g. 'claudeCockpit.approval.openQueue'. */
  command: string;
  title: string;
  /** e.g. 'cmd+1'. */
  keybinding?: string;
  /** e.g. 'view == claudeCockpit.sidebar'. */
  whenClause?: string;
}

/** Shared by approval-queue + audit. */
export interface WorktreeAction {
  id: string;
  /** e.g. 'approval-queue', 'permissions-audit'. */
  worktree: string;
  tool: string;
  argsRedacted: string;
  filesAffected: string[];
  requestedAt: number;
  byAgent: string | undefined;
  expectedDiffBytes: number;
  rollbackable: boolean;
}

/** Shared by approval-queue + replay. */
export interface SnapshotRef {
  id: string;
  cwd: string;
  takenAt: number;
  reason: 'pre-action' | 'manual' | 'session-checkpoint';
  paths: string[];
  totalBytes: number;
}

/** Shared by audit + telemetry. Detail must be redacted, no secrets. */
export interface AuditEvent {
  ts: number;
  kind: 'file.read' | 'mcp.call' | 'key.access' | 'net.outbound' | 'tool.invoke';
  detail: Record<string, unknown>;
  worktree?: string;
}

// -----------------------------------------------------------------------------
// Module-private registries — Phase-1 worktrees push into these on activation.
// Read-only views are exposed via list*() so consumers can't mutate them.
// -----------------------------------------------------------------------------

const widgets: CockpitWidget[] = [];
const tabs: CockpitTab[] = [];
const triggers: CockpitTrigger[] = [];

// e.g. 'claudeCockpit.approval.openQueue' — a non-empty namespace, then a verb.
const COMMAND_FORMAT = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

// -----------------------------------------------------------------------------
// Registration functions.
// -----------------------------------------------------------------------------

export function registerWidget(widget: CockpitWidget): void {
  if (!widget.id || typeof widget.id !== 'string') {
    throw new Error('registerWidget: id must be a non-empty string');
  }
  if (!widget.label || typeof widget.label !== 'string') {
    throw new Error('registerWidget: label must be a non-empty string');
  }
  if (widgets.some((w) => w.id === widget.id)) {
    throw new Error(`registerWidget: duplicate id "${widget.id}"`);
  }
  widgets.push(widget);
  logger.info(`plugin: registered widget "${widget.id}" (${widget.category})`);
}

export function registerTab(tab: Partial<CockpitTab> & Pick<CockpitTab, 'id' | 'label'>): CockpitTab {
  if (!tab.id || typeof tab.id !== 'string') {
    throw new Error('registerTab: id must be a non-empty string');
  }
  if (!tab.label || typeof tab.label !== 'string') {
    throw new Error('registerTab: label must be a non-empty string');
  }
  if (tabs.some((t) => t.id === tab.id)) {
    throw new Error(`registerTab: duplicate id "${tab.id}"`);
  }
  const filled: CockpitTab = {
    id: tab.id,
    label: tab.label,
    iconSvg: tab.iconSvg ?? '',
    pinned: tab.pinned ?? false,
    requiresCwd: tab.requiresCwd ?? false,
    hint: tab.hint ?? '',
    defaultWidgets: tab.defaultWidgets ?? [],
  };
  tabs.push(filled);
  logger.info(`plugin: registered tab "${filled.id}"`);
  return filled;
}

export function registerTrigger(trigger: CockpitTrigger): void {
  if (!trigger.command || typeof trigger.command !== 'string') {
    throw new Error('registerTrigger: command must be a non-empty string');
  }
  if (!COMMAND_FORMAT.test(trigger.command)) {
    throw new Error(
      `registerTrigger: command "${trigger.command}" must match namespaced format (e.g. "claudeCockpit.approval.openQueue")`,
    );
  }
  if (!trigger.title || typeof trigger.title !== 'string') {
    throw new Error('registerTrigger: title must be a non-empty string');
  }
  if (triggers.some((t) => t.command === trigger.command)) {
    throw new Error(`registerTrigger: duplicate command "${trigger.command}"`);
  }
  triggers.push(trigger);
  logger.info(`plugin: registered trigger "${trigger.command}"`);
}

// -----------------------------------------------------------------------------
// Read-only accessors (defensive copies — registries are append-only at runtime
// but we don't want a misbehaving consumer to splice them in place).
// -----------------------------------------------------------------------------

export function listWidgets(): readonly CockpitWidget[] {
  return widgets.slice();
}

export function listTabs(): readonly CockpitTab[] {
  return tabs.slice();
}

export function listTriggers(): readonly CockpitTrigger[] {
  return triggers.slice();
}

/**
 * Reset all registries. Test-only. Not exported through index — direct import
 * from `./plugin` only.
 */
export function __resetForTests(): void {
  widgets.length = 0;
  tabs.length = 0;
  triggers.length = 0;
  sidebarScripts.length = 0;
  sidebarStyles.length = 0;
}

// -----------------------------------------------------------------------------
// Webview bridge: scripts that the host should inject as siblings to
// `media/sidebar.js`. Each script must call `window.cockpit.registerComponent`
// to populate EXTERNAL_COMPONENTS. Phase-1 worktrees push their script paths
// here on activation; until then this stays empty and the html() scaffold
// emits zero extra <script> tags.
// -----------------------------------------------------------------------------

const sidebarScripts: string[] = [];

/**
 * Path is relative to the extension root (e.g. 'media/sidebar.approval.js').
 * The sidebar provider rewrites it to a webview-safe URI at render time.
 */
export function registerSidebarScript(relPath: string): void {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('registerSidebarScript: path must be a non-empty string');
  }
  if (relPath.includes('..')) {
    throw new Error('registerSidebarScript: path must not contain ".."');
  }
  if (sidebarScripts.includes(relPath)) {
    return;
  }
  sidebarScripts.push(relPath);
  logger.info(`plugin: registered sidebar script "${relPath}"`);
}

export function listSidebarScripts(): readonly string[] {
  return sidebarScripts.slice();
}

// -----------------------------------------------------------------------------
// Webview bridge: stylesheets registered as siblings to media/sidebar.css.
// Phase-1 worktrees push their CSS path here on activation.
// -----------------------------------------------------------------------------

const sidebarStyles: string[] = [];

export function registerSidebarStyle(relPath: string): void {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('registerSidebarStyle: path must be a non-empty string');
  }
  if (relPath.includes('..')) {
    throw new Error('registerSidebarStyle: path must not contain ".."');
  }
  if (sidebarStyles.includes(relPath)) {
    return;
  }
  sidebarStyles.push(relPath);
  logger.info(`plugin: registered sidebar style "${relPath}"`);
}

export function listSidebarStyles(): readonly string[] {
  return sidebarStyles.slice();
}
