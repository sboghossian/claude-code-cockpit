// =============================================================================
// Claude Cockpit — Tab system v2 (worktree: feat/launch-tab-system-v2).
//
// This sidekick script attaches drag/drop handlers, right-click context menus
// (pin / hide / save layout / load layout), pop-out trigger, and keyboard
// shortcut handling (cmd+1..9) to the existing primary tab bar rendered by
// media/sidebar.js. It runs INSIDE the same webview as sidebar.js (and again
// inside the pop-out fullscreen panel — the html() output is identical).
//
// Design rules from PLAN.md:
//   - Layout state lives in globalState via setUserPrefs / layout.* messages,
//     never in the webview's vscode.getState(). Both sidebar view and pop-out
//     panel see the same pref payload, eliminating the desync risk.
//   - Don't touch the COMPONENTS literal. Only manipulate ORDER + visibility.
//   - Namespaced messages: layout.* (e.g. layout.savePreset, layout.popOut).
//   - Namespaced CSS classes: .cockpit-layout-*.
//
// This file holds NO render code for tabs themselves — sidebar.js still owns
// renderTabBar(). We attach behaviour after each render via a MutationObserver
// + delegated listeners that re-bind on snapshot reflows.
// =============================================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__cockpitLayoutV2) return;
  window.__cockpitLayoutV2 = { version: 1 };

  // Lazy lookup — sidebar.js attaches the vscode handle to its IIFE scope, but
  // also exposes acquireVsCodeApi via the global. We re-acquire here so this
  // script doesn't need a shared closure with sidebar.js.
  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch {
    // sidebar.js already called acquireVsCodeApi() — VSCode forbids a second
    // call. Fall through to using window.postMessage as a no-op shim and let
    // sidebar.js drive the real channel; we'll instead use a tiny relay.
    vscode = {
      postMessage: (msg) => window.postMessage({ __cockpitLayoutRelay: true, msg }, '*'),
      getState: () => ({}),
      setState: () => {},
    };
  }

  // sidebar.js gets the relay messages and forwards them to the host.
  // We also set up a global so sidebar.js can post on our behalf if it owns
  // the real vscode handle.
  window.cockpitLayoutPost = function cockpitLayoutPost(msg) {
    try {
      vscode.postMessage(msg);
    } catch {
      window.postMessage({ __cockpitLayoutRelay: true, msg }, '*');
    }
  };

  // ---------------------------------------------------------------------------
  // State derivation: read the latest snapshot's userPrefs so context-menu
  // actions know what's currently pinned/hidden. sidebar.js stamps the latest
  // snapshot on window.__cockpitLastSnapshot for cross-script access.
  // ---------------------------------------------------------------------------

  function getPrefs() {
    const snap = window.__cockpitLastSnapshot;
    return (snap && snap.userPrefs) || {};
  }

  function getCurrentTabOrder() {
    const bar = document.querySelector('nav.tabs');
    if (!bar) return [];
    return Array.from(bar.querySelectorAll('button[data-tab]'))
      .map((b) => b.getAttribute('data-tab'))
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop reorder. We delegate at document level so re-renders don't
  // need re-binding. Each .tab gets draggable=true + drag handlers when present.
  // ---------------------------------------------------------------------------

  let dragSrcId = null;

  function annotateTabs() {
    const buttons = document.querySelectorAll('nav.tabs button[data-tab]');
    buttons.forEach((btn) => {
      if (btn.__cockpitLayoutAnnotated) return;
      btn.__cockpitLayoutAnnotated = true;
      btn.setAttribute('draggable', 'true');
      btn.classList.add('cockpit-layout-draggable');
      const id = btn.getAttribute('data-tab') || '';
      const prefs = getPrefs();
      const pinned = Array.isArray(prefs.pinnedTabs) ? prefs.pinnedTabs : [];
      if (pinned.includes(id)) btn.classList.add('cockpit-layout-pinned');
    });
  }

  function onDragStart(e) {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    dragSrcId = btn.getAttribute('data-tab');
    btn.classList.add('cockpit-layout-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Set required data so Firefox-derived webview engines treat the drag
      // as valid. The payload is just the tab id.
      try { e.dataTransfer.setData('text/plain', dragSrcId || ''); } catch { /* ignore */ }
    }
  }

  function onDragOver(e) {
    const btn = e.target.closest('button[data-tab]');
    if (!btn || !dragSrcId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    btn.classList.add('cockpit-layout-drag-over');
  }

  function onDragLeave(e) {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    btn.classList.remove('cockpit-layout-drag-over');
  }

  function onDrop(e) {
    const btn = e.target.closest('button[data-tab]');
    if (!btn || !dragSrcId) return;
    e.preventDefault();
    btn.classList.remove('cockpit-layout-drag-over');
    const targetId = btn.getAttribute('data-tab');
    if (!targetId || targetId === dragSrcId) return;
    const order = getCurrentTabOrder();
    const newOrder = computeReorder(order, dragSrcId, targetId);
    window.cockpitLayoutPost({ type: 'layout.reorderTabs', tabOrder: newOrder });
  }

  function onDragEnd() {
    document.querySelectorAll('.cockpit-layout-dragging,.cockpit-layout-drag-over').forEach((el) => {
      el.classList.remove('cockpit-layout-dragging');
      el.classList.remove('cockpit-layout-drag-over');
    });
    dragSrcId = null;
  }

  // Pure reorder fn — extracted so tests can verify drag math without the DOM.
  function computeReorder(order, srcId, targetId) {
    if (!Array.isArray(order)) return [];
    if (!srcId || !targetId || srcId === targetId) return order.slice();
    const next = order.filter((id) => id !== srcId);
    const idx = next.indexOf(targetId);
    if (idx < 0) return order.slice();
    next.splice(idx, 0, srcId);
    return next;
  }

  // Expose for tests.
  window.__cockpitLayoutTesting = { computeReorder };

  // ---------------------------------------------------------------------------
  // Context menu (right-click on a tab → pin/hide/save layout/load).
  // Plain DOM, no popup framework.
  // ---------------------------------------------------------------------------

  let openMenu = null;

  function closeMenu() {
    if (openMenu && openMenu.parentNode) {
      openMenu.parentNode.removeChild(openMenu);
    }
    openMenu = null;
  }

  function buildMenu(tabId, x, y) {
    closeMenu();
    const prefs = getPrefs();
    const pinned = (prefs.pinnedTabs || []).includes(tabId);
    const hidden = (prefs.hiddenTabs || []).includes(tabId);
    const layouts = prefs.tabLayouts ? Object.keys(prefs.tabLayouts) : [];

    const menu = document.createElement('div');
    menu.className = 'cockpit-layout-menu';
    menu.setAttribute('role', 'menu');

    const items = [];
    items.push({
      label: pinned ? 'Unpin tab' : 'Pin tab',
      action: () =>
        window.cockpitLayoutPost({
          type: pinned ? 'layout.unpin' : 'layout.pin',
          tabId,
        }),
    });
    items.push({
      label: hidden ? 'Show tab' : 'Hide tab',
      action: () =>
        window.cockpitLayoutPost({
          type: hidden ? 'layout.show' : 'layout.hide',
          tabId,
        }),
    });
    items.push({ separator: true });
    items.push({
      label: 'Save current layout as…',
      action: () => promptAndSaveLayout(),
    });
    if (layouts.length > 0) {
      items.push({ separator: true });
      for (const name of layouts) {
        const isActive = prefs.currentLayoutName === name;
        items.push({
          label: `${isActive ? '✓ ' : ''}Load: ${name}`,
          action: () =>
            window.cockpitLayoutPost({ type: 'layout.load', layoutName: name }),
        });
      }
      items.push({ separator: true });
      for (const name of layouts) {
        items.push({
          label: `Delete preset: ${name}`,
          action: () =>
            window.cockpitLayoutPost({ type: 'layout.delete', layoutName: name }),
        });
      }
    }
    items.push({ separator: true });
    items.push({
      label: 'Pop out fullscreen',
      action: () => window.cockpitLayoutPost({ type: 'layout.popOut' }),
    });

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'cockpit-layout-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cockpit-layout-menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        try { item.action(); } finally { closeMenu(); }
      });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    // Position; clamp inside viewport.
    const rect = menu.getBoundingClientRect();
    const maxX = Math.min(x, window.innerWidth - rect.width - 4);
    const maxY = Math.min(y, window.innerHeight - rect.height - 4);
    menu.style.left = `${Math.max(0, maxX)}px`;
    menu.style.top = `${Math.max(0, maxY)}px`;
    openMenu = menu;
  }

  function promptAndSaveLayout() {
    // The webview can't open a vscode.window.showInputBox directly; we use a
    // lightweight inline prompt. The host validates + truncates the name.
    const name = window.prompt('Save layout as (e.g. Coding, Research, Reviewing PRs):');
    if (!name || !name.trim()) return;
    const order = getCurrentTabOrder();
    const prefs = getPrefs();
    window.cockpitLayoutPost({
      type: 'layout.save',
      layoutName: name.trim(),
      tabOrder: order,
      pinnedTabs: prefs.pinnedTabs || [],
      hiddenTabs: prefs.hiddenTabs || [],
    });
  }

  // ---------------------------------------------------------------------------
  // Keyboard nav: cmd+1..9 jumps to tab N (in current order). The HOST also
  // registers VS Code keybindings — but that path only fires when the webview
  // has focus and the keybinding is allowed to bubble; we listen on the
  // webview's document as a belt-and-braces fallback.
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    // Use metaKey on macOS; ctrlKey elsewhere. We accept either so a Linux
    // user with the bound shortcut also gets the shortcut.
    const cmd = e.metaKey || e.ctrlKey;
    if (!cmd || e.altKey || e.shiftKey) return;
    const key = e.key;
    if (key < '1' || key > '9') return;
    const idx = Number(key) - 1;
    const order = getCurrentTabOrder();
    if (idx >= order.length) return;
    e.preventDefault();
    e.stopPropagation();
    const tabId = order[idx];
    // Click the existing tab button so sidebar.js's setActiveTab path runs.
    const btn = document.querySelector(`nav.tabs button[data-tab="${cssEscape(tabId)}"]`);
    if (btn) btn.click();
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // ---------------------------------------------------------------------------
  // Wire-up. Document-level delegation so per-render re-binding is unnecessary.
  // ---------------------------------------------------------------------------

  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);
  document.addEventListener('dragend', onDragEnd);

  document.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('nav.tabs button[data-tab]');
    if (!btn) return;
    e.preventDefault();
    const tabId = btn.getAttribute('data-tab');
    if (!tabId) return;
    buildMenu(tabId, e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('keydown', onKeyDown);

  // Re-annotate tab buttons after every render. sidebar.js dispatches a
  // synthetic 'cockpit:rendered' event after each render(); we also use a
  // MutationObserver as a fallback in case sidebar.js predates the event.
  const ro = new MutationObserver(() => annotateTabs());
  ro.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('cockpit:rendered', annotateTabs);
  annotateTabs();

  // Snapshot relay: sidebar.js stamps window.__cockpitLastSnapshot but only
  // on its own `message` listener. We add a second listener so prefs are
  // available even if our script loaded first.
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') {
      window.__cockpitLastSnapshot = msg.snapshot;
    }
    // Pop-out mode flag — sidebar.js reads it on next render to switch into
    // the 4-col grid view.
    if (msg && msg.type === 'layout.popoutMode') {
      window.__cockpitPopoutMode = !!msg.enabled;
      document.body.setAttribute('data-cockpit-popout', msg.enabled ? '1' : '0');
    }
    // Relay ferry: if sidebar.js posted a layout.* relay, forward it to the
    // host using sidebar.js's own vscode handle (which sidebar.js owns).
    if (msg && msg.__cockpitLayoutRelay && window.__cockpitHostPost) {
      try { window.__cockpitHostPost(msg.msg); } catch { /* ignore */ }
    }
  });
})();
