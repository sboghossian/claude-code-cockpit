// =============================================================================
// Claude Cockpit — desktop notifications (Phase 2, feat/launch-onboarding-sandbox).
//
// Central registry for vscode.window.showInformationMessage / showWarningMessage
// triggers. Three event sources today:
//
//   - approval-queue: pending count goes 0 → 1 (or higher).
//   - permissions-audit: a tool.invoke event lands with `outcome: blocked`
//     in the last 24h.
//   - replay-timeline (cost): a session ends with cost > daily cap * 0.8.
//
// Every fire is debounced through `notify()` — 30s window per `key`. Anything
// fired again inside that window is dropped silently. State is in-memory on
// purpose; we don't want to persist "I already nagged you about this" across
// extension reloads (the user would lose the safety alert).
//
// Setting `claudeCockpit.notifications.enabled` (default true) gates the
// entire surface. `notify()` is a no-op when disabled.
// =============================================================================

import * as vscode from 'vscode';
import { logger } from './logger';

export type NotificationKind = 'approval' | 'audit-blocked' | 'cost-warn' | 'agent-finished';
export type NotificationLevel = 'info' | 'warn';

export interface NotificationRequest {
  /** Stable key — same key inside the debounce window is a no-op. */
  key: string;
  level: NotificationLevel;
  message: string;
  /** Optional action labels surfaced as buttons. Returns the chosen label. */
  actions?: string[];
  /** Per-call debounce override; default 30_000 ms. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 30_000;
const lastFiredAt = new Map<string, number>();

function settingsEnabled(): boolean {
  try {
    return (
      vscode.workspace
        .getConfiguration('claudeCockpit')
        .get<boolean>('notifications.enabled', true) === true
    );
  } catch {
    // In tests / when vscode.workspace is stubbed, default to disabled so
    // unit tests don't accidentally pop dialogs.
    return false;
  }
}

/**
 * Fire a desktop notification, respecting the per-key debounce window and the
 * `claudeCockpit.notifications.enabled` toggle. Returns the user's chosen
 * action label (or undefined). Returns `undefined` synchronously when
 * dropped by the debounce filter.
 */
export async function notify(req: NotificationRequest): Promise<string | undefined> {
  if (!settingsEnabled()) {
    return undefined;
  }
  const now = Date.now();
  const window = req.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const last = lastFiredAt.get(req.key) ?? 0;
  if (now - last < window) {
    return undefined;
  }
  lastFiredAt.set(req.key, now);

  try {
    const fn = req.level === 'warn'
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
    const labels = (req.actions ?? []).slice(0, 3);
    const choice = labels.length > 0
      ? await fn(req.message, ...labels)
      : await fn(req.message);
    return typeof choice === 'string' ? choice : undefined;
  } catch (err) {
    logger.warn(`notifications: showMessage failed: ${String(err)}`);
    return undefined;
  }
}

/** Test-only: clear the debounce map. */
export function __resetForTests(): void {
  lastFiredAt.clear();
}

// -----------------------------------------------------------------------------
// Higher-level helpers — used by sidebarProvider so call sites stay short.
// Each helper picks a stable key + level + reasonable defaults.
// -----------------------------------------------------------------------------

export function notifyApprovalQueueLanded(pending: number): Promise<string | undefined> {
  return notify({
    key: 'approval.pending',
    level: 'warn',
    message: `Cockpit: ${pending} approval${pending === 1 ? '' : 's'} waiting on you.`,
    actions: ['Open queue', 'Dismiss'],
  });
}

export function notifyAuditBlocked(tool: string, byAgent: string | undefined): Promise<string | undefined> {
  const who = byAgent ? ` (${byAgent})` : '';
  return notify({
    key: `audit.blocked.${tool}`,
    level: 'warn',
    message: `Cockpit: ${tool}${who} was blocked by your permissions policy.`,
    actions: ['Open audit', 'Dismiss'],
  });
}

export function notifyCostWarning(spentUsd: number, capUsd: number): Promise<string | undefined> {
  const pct = capUsd > 0 ? Math.min(100, Math.round((spentUsd / capUsd) * 100)) : 0;
  return notify({
    key: 'cost.warn',
    level: 'warn',
    message: `Cockpit: $${spentUsd.toFixed(2)} spent today (${pct}% of $${capUsd.toFixed(2)} cap).`,
    actions: ['Open replay', 'Adjust cap'],
  });
}

export function notifyAgentFinished(agentName: string, durationMs: number): Promise<string | undefined> {
  const sec = Math.max(1, Math.round(durationMs / 1000));
  return notify({
    key: `agent.finished.${agentName}`,
    level: 'info',
    message: `Cockpit: ${agentName} finished in ${sec}s.`,
  });
}
