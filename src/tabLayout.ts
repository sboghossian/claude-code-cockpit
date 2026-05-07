// =============================================================================
// Claude Cockpit — Tab system v2 host-side helpers (pure functions).
//
// All logic that mutates UserPrefs in response to a layout.* message lives
// here so it can be unit-tested without booting the VSCode extension host.
// sidebarProvider.ts thin-wraps these calls; the webview-side mirrors the
// reorder logic in media/sidebar.layout.js.
//
// Contracts (copied from PLAN.md and the worktree brief):
//   - Saving a layout snapshots the CURRENT pinned/hidden/order state under
//     a name, sets currentLayoutName, and persists.
//   - Loading a non-existent name is a no-op (caller logs a warning).
//   - Deleting the active layout clears currentLayoutName but keeps the
//     pinned/hidden/order arrays intact (the user's last-seen layout is
//     preserved; the preset just stops being a labelled preset).
//   - Reorder/pin/hide are append-only on the user's CURRENT layout, NOT
//     on the active preset. Saving snapshots the current state.
// =============================================================================

export interface TabLayout {
  tabOrder: string[];
  pinnedTabs: string[];
  hiddenTabs: string[];
  tabComponents: Record<string, string[]>;
}

export interface LayoutAwarePrefs {
  tabComponents?: Record<string, string[]> | undefined;
  tabLayouts?: Record<string, TabLayout> | undefined;
  currentLayoutName?: string | undefined;
  pinnedTabs?: string[] | undefined;
  hiddenTabs?: string[] | undefined;
  tabOrder?: string[] | undefined;
}

/**
 * Save the user's current layout state (order/pinned/hidden) under `name`.
 * Returns the new prefs object — pure, callers persist it.
 */
export function saveLayout(prefs: LayoutAwarePrefs, name: string): LayoutAwarePrefs {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return prefs;
  const layouts: Record<string, TabLayout> = { ...(prefs.tabLayouts ?? {}) };
  layouts[trimmed] = {
    tabOrder: (prefs.tabOrder ?? []).slice(),
    pinnedTabs: (prefs.pinnedTabs ?? []).slice(),
    hiddenTabs: (prefs.hiddenTabs ?? []).slice(),
    tabComponents: { ...(prefs.tabComponents ?? {}) },
  };
  return { ...prefs, tabLayouts: layouts, currentLayoutName: trimmed };
}

/**
 * Load a saved layout. Returns the prefs object with overlay arrays set;
 * if `name` doesn't exist, returns prefs unchanged.
 */
export function loadLayout(prefs: LayoutAwarePrefs, name: string): LayoutAwarePrefs {
  const layout = prefs.tabLayouts?.[name];
  if (!layout) return prefs;
  return {
    ...prefs,
    currentLayoutName: name,
    tabOrder: layout.tabOrder.slice(),
    pinnedTabs: layout.pinnedTabs.slice(),
    hiddenTabs: layout.hiddenTabs.slice(),
    tabComponents: { ...(prefs.tabComponents ?? {}), ...layout.tabComponents },
  };
}

/** Delete a saved layout. Active layout? Clear currentLayoutName too. */
export function deleteLayout(prefs: LayoutAwarePrefs, name: string): LayoutAwarePrefs {
  if (!prefs.tabLayouts || !prefs.tabLayouts[name]) return prefs;
  const layouts = { ...prefs.tabLayouts };
  delete layouts[name];
  return {
    ...prefs,
    tabLayouts: layouts,
    currentLayoutName: prefs.currentLayoutName === name ? undefined : prefs.currentLayoutName,
  };
}

/** Pin a tab id. Removes from hidden if present. */
export function pinTab(prefs: LayoutAwarePrefs, id: string): LayoutAwarePrefs {
  const pinned = (prefs.pinnedTabs ?? []).filter((t) => t !== id);
  pinned.push(id);
  const hidden = (prefs.hiddenTabs ?? []).filter((t) => t !== id);
  return { ...prefs, pinnedTabs: pinned, hiddenTabs: hidden };
}

export function unpinTab(prefs: LayoutAwarePrefs, id: string): LayoutAwarePrefs {
  return { ...prefs, pinnedTabs: (prefs.pinnedTabs ?? []).filter((t) => t !== id) };
}

/** Hide a tab id. Removes from pinned if present. */
export function hideTab(prefs: LayoutAwarePrefs, id: string): LayoutAwarePrefs {
  const hidden = (prefs.hiddenTabs ?? []).filter((t) => t !== id);
  hidden.push(id);
  const pinned = (prefs.pinnedTabs ?? []).filter((t) => t !== id);
  return { ...prefs, hiddenTabs: hidden, pinnedTabs: pinned };
}

export function showTab(prefs: LayoutAwarePrefs, id: string): LayoutAwarePrefs {
  return { ...prefs, hiddenTabs: (prefs.hiddenTabs ?? []).filter((t) => t !== id) };
}

/** Reorder via drag: move src in front of target. Pure for tests. */
export function reorderTabs(order: readonly string[], srcId: string, targetId: string): string[] {
  if (!srcId || !targetId || srcId === targetId) return order.slice();
  const next = order.filter((id) => id !== srcId);
  const idx = next.indexOf(targetId);
  if (idx < 0) return order.slice();
  next.splice(idx, 0, srcId);
  return next;
}

/**
 * Apply pin/hide/reorder overlay onto a base list of tab descriptors.
 * Mirrors the webview-side `applyLayoutOverlay` so unit tests can verify the
 * deterministic ordering rules without booting a DOM.
 *
 * Order:
 *   1. User-pinned ids (in declared order)
 *   2. Built-in pinned (catalogue.pinned) that aren't already user-pinned
 *   3. Layout tabOrder (skipping ids already placed or in hiddenTabs)
 *   4. Remainder of base list (catalog order, skipping hidden ids)
 */
export interface TabRef {
  id: string;
  pinned?: boolean;
}

export function applyOverlay<T extends TabRef>(
  base: readonly T[],
  prefs: Pick<LayoutAwarePrefs, 'pinnedTabs' | 'hiddenTabs' | 'tabOrder'>,
): T[] {
  const layoutOrder = Array.isArray(prefs.tabOrder) ? prefs.tabOrder : null;
  const pinned = Array.isArray(prefs.pinnedTabs) ? prefs.pinnedTabs : null;
  const hidden = Array.isArray(prefs.hiddenTabs) ? prefs.hiddenTabs : null;
  if (!layoutOrder && !pinned && !hidden) return base.slice();
  const byId = new Map<string, T>();
  for (const t of base) byId.set(t.id, t);
  const hideSet = new Set(hidden ?? []);
  const result: T[] = [];
  const used = new Set<string>();
  if (pinned) {
    for (const id of pinned) {
      const t = byId.get(id);
      if (!t || used.has(id)) continue;
      result.push(t);
      used.add(id);
    }
  }
  for (const t of base) {
    if (t.pinned && !used.has(t.id)) {
      result.push(t);
      used.add(t.id);
    }
  }
  if (layoutOrder) {
    for (const id of layoutOrder) {
      if (used.has(id)) continue;
      if (hideSet.has(id)) continue;
      const t = byId.get(id);
      if (!t) continue;
      result.push(t);
      used.add(id);
    }
  }
  for (const t of base) {
    if (used.has(t.id)) continue;
    if (hideSet.has(t.id) && !t.pinned) continue;
    result.push(t);
    used.add(t.id);
  }
  return result;
}
