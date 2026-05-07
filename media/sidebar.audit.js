// =============================================================================
// Claude Cockpit — sidebar.audit.js (Phase 1, feat/launch-permissions-audit).
//
// Sibling script loaded after media/sidebar.js. Registers four widgets via
// the Phase-0 bridge (window.cockpit.registerComponent):
//
//   auditKeys     — encrypted API keys stored via VS Code SecretStorage.
//                   Surface count + last-added timestamp ONLY; values never
//                   leave the host.
//   auditLeaks    — passthrough of the existing scanSecurity findings (the
//                   built-in `securityFull` widget already renders them; this
//                   widget is a focused sub-view that omits Overview / Git /
//                   .env clutter when the user wants only the secret hits).
//   auditOutbound — unique domains the extension hit in the last 24h, plus a
//                   per-domain count + last-seen pill. Driven by
//                   outboundDomainTail() over ~/.claude/.cockpit/audit.log.
//   auditLog      — newest-first table of audit events with a search box.
//                   Lazy-loaded — the snapshot only carries the 24h count;
//                   the events themselves arrive via the audit.payload
//                   message round-trip.
//
// Namespace prefix `audit.*` for all message types (see launch brief).
// CSS prefix `.cockpit-audit-...`. Selectors live in media/sidebar.css for
// reviewability; this file only emits the markup.
//
// IIFE so we don't pollute the webview's global scope. The Phase-0 bridge
// (window.cockpit.registerComponent) is the ONE shared symbol we touch.
// =============================================================================

(function registerAuditWidgets() {
  'use strict';

  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    // Sidebar.js hasn't loaded the bridge yet (or this script ran in a non-
    // webview context). Bail silently — the script tag order in
    // sidebarProvider.html() guarantees sidebar.js loads first, but defensive
    // bail keeps the webview from going white if that ever changes.
    return;
  }

  // Lazy state. The snapshot only carries `audit.last24h` + `audit.lastDomain`.
  // The full event list and per-domain rollup arrive via audit.payload, kicked
  // off when the user opens any of these widgets.
  /** @type {{ events: Array<object>, domains: Array<object>, fetchedAtMs: number } | undefined} */
  let auditCache;
  /** @type {Array<{name: string, addedAtMs: number}> | undefined} */
  let keysCache;

  // -----------------------------------------------------------------------
  // Helpers — small, intentionally duplicated from sidebar.js so this script
  // has zero coupling to that file's internals beyond the bridge.
  // -----------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtAge(ms) {
    if (!ms) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 10) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  function fmtKind(kind) {
    if (typeof kind !== 'string') return '—';
    return kind;
  }

  function host(detail) {
    if (!detail || typeof detail !== 'object') return '';
    if (typeof detail.host === 'string') return detail.host;
    return '';
  }

  // -----------------------------------------------------------------------
  // auditKeys — Keys sub-view.
  // -----------------------------------------------------------------------

  function renderKeys() {
    const list = keysCache || [];
    const empty = `
      <p class="empty">No API keys stored yet. Use <strong>Add key</strong> below or run <code>Claude Cockpit: Add API Key</code> from the command palette. Keys are stored via VS Code SecretStorage — never written to disk in plaintext, never shown to this webview.</p>
    `;
    const rows = list.length ? `<ul class="cockpit-audit-keys list" style="list-style: none; padding: 0;">${list.map((k) => `
      <li>
        <div class="watch-card cockpit-audit-key-card" style="display: block;">
          <div class="row">
            <strong class="left">${escapeHtml(k.name)}</strong>
            <span class="right">
              <span class="tag">added ${escapeHtml(fmtAge(k.addedAtMs))}</span>
              <button class="office-btn cockpit-audit-key-delete" data-audit-key-delete="${escapeHtml(k.name)}">Delete</button>
            </span>
          </div>
        </div>
      </li>
    `).join('')}</ul>` : empty;
    return `
      <div class="row"><h2 class="left">Keys</h2><span class="right" style="font-size: 11px;">stored: ${list.length}</span></div>
      ${rows}
      <div class="cockpit-audit-keys-form" style="margin-top: 8px;">
        <input class="cockpit-audit-key-name" placeholder="KEY_NAME (A-Z, 0-9, _)" maxlength="64" />
        <input class="cockpit-audit-key-value" type="password" placeholder="value" />
        <button class="office-btn cockpit-audit-key-add">Add key</button>
        <p class="empty" style="font-size: 10px; margin-top: 4px;">Values are encrypted by VS Code (Keychain on macOS, libsecret on Linux, DPAPI on Windows) and are never sent to this webview.</p>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // auditLeaks — passthrough of scanSecurity findings, secrets-only view.
  // -----------------------------------------------------------------------

  function renderLeaks(snap) {
    const sec = snap && snap.security;
    if (!sec) {
      return `
        <div class="row"><h2 class="left">Leaks</h2></div>
        <p class="empty">No scan run. Open the Security widget and click <strong>Scan now</strong>; this view mirrors the secrets findings.</p>
      `;
    }
    const list = Array.isArray(sec.secrets) ? sec.secrets : [];
    if (!list.length) {
      return `
        <div class="row"><h2 class="left">Leaks</h2></div>
        <p class="empty">No hardcoded secrets matched in the last scan.</p>
      `;
    }
    return `
      <div class="row"><h2 class="left">Leaks</h2><span class="right" style="font-size: 11px;">${list.length} finding${list.length === 1 ? '' : 's'}</span></div>
      <ul class="list cockpit-audit-leaks-list" style="list-style: none; padding: 0;">${list.map((s) => `
        <li>
          <div class="watch-card" style="display: block;">
            <div class="row">
              <a class="left link" data-open-file="${escapeHtml(s.absoluteFile)}" title="${escapeHtml(s.absoluteFile)}"><strong>${escapeHtml(s.file)}</strong>:${Number(s.line) || 0}</a>
              <span class="right"><span class="tag">${escapeHtml(s.severity || '')}</span><span class="tag">${escapeHtml(s.rule || '')}</span></span>
            </div>
            <div class="note-excerpt"><code>${escapeHtml(s.excerpt || '')}</code></div>
          </div>
        </li>
      `).join('')}</ul>
    `;
  }

  // -----------------------------------------------------------------------
  // auditOutbound — every unique domain the extension hit in the last 24h.
  // -----------------------------------------------------------------------

  function renderOutbound(snap) {
    const summary = snap && snap.audit;
    const last24h = summary ? Number(summary.last24h) || 0 : 0;
    const domains = (auditCache && auditCache.domains) || [];
    const headerCount = `
      <span class="right" style="font-size: 11px;">${last24h} event${last24h === 1 ? '' : 's'} / 24h</span>
    `;
    if (!domains.length) {
      return `
        <div class="row"><h2 class="left">Outbound</h2>${headerCount}</div>
        <p class="empty">No outbound calls recorded yet${last24h ? ' — domain rollup loading…' : ''}. Use the extension (refresh, check for updates, Discover, etc.) to populate the log.</p>
        <button class="office-btn cockpit-audit-refresh" data-audit-action="refresh">Refresh</button>
      `;
    }
    return `
      <div class="row"><h2 class="left">Outbound</h2>${headerCount}</div>
      <ul class="list cockpit-audit-outbound-list" style="list-style: none; padding: 0;">${domains.map((d) => `
        <li>
          <div class="watch-card" style="display: block;">
            <div class="row">
              <strong class="left">${escapeHtml(d.host)}</strong>
              <span class="right">
                <span class="tag">${Number(d.count) || 0}×</span>
                <span class="tag">last ${escapeHtml(fmtAge(d.lastSeenMs))}</span>
              </span>
            </div>
          </div>
        </li>
      `).join('')}</ul>
      <button class="office-btn cockpit-audit-refresh" data-audit-action="refresh" style="margin-top: 6px;">Refresh</button>
    `;
  }

  // -----------------------------------------------------------------------
  // auditLog — full table of events with search.
  // -----------------------------------------------------------------------

  function renderLog(snap) {
    const summary = snap && snap.audit;
    const last24h = summary ? Number(summary.last24h) || 0 : 0;
    const events = (auditCache && auditCache.events) || [];
    const rows = events.length ? `
      <table class="cockpit-audit-log-table" style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 4px 6px;">When</th>
            <th style="text-align: left; padding: 4px 6px;">Kind</th>
            <th style="text-align: left; padding: 4px 6px;">Host / detail</th>
          </tr>
        </thead>
        <tbody>${events.map((e) => `
          <tr>
            <td style="padding: 4px 6px;">${escapeHtml(fmtAge(Number(e.ts) || 0))}</td>
            <td style="padding: 4px 6px;"><code>${escapeHtml(fmtKind(e.kind))}</code></td>
            <td style="padding: 4px 6px;">${escapeHtml(host(e.detail) || JSON.stringify(e.detail || {}).slice(0, 80))}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    ` : `<p class="empty">No events loaded. Click <strong>Refresh</strong> or use the search box.</p>`;
    return `
      <div class="row"><h2 class="left">Audit log</h2><span class="right" style="font-size: 11px;">${last24h} / 24h</span></div>
      <div class="cockpit-audit-controls" style="margin-bottom: 6px;">
        <input class="cockpit-audit-search" placeholder="search audit log…" />
        <button class="office-btn" data-audit-action="refresh">Refresh</button>
        <button class="office-btn" data-audit-action="export">Export</button>
        <button class="office-btn" data-audit-action="open">Open file</button>
        <button class="office-btn" data-audit-action="clear">Clear</button>
      </div>
      ${rows}
    `;
  }

  // -----------------------------------------------------------------------
  // Register all four widgets.
  // -----------------------------------------------------------------------

  window.cockpit.registerComponent('auditKeys', {
    label: 'Audit · Keys',
    category: 'Audit',
    requiresCwd: false,
    render: renderKeys,
  });

  window.cockpit.registerComponent('auditLeaks', {
    label: 'Audit · Leaks',
    category: 'Audit',
    requiresCwd: false,
    render: renderLeaks,
  });

  window.cockpit.registerComponent('auditOutbound', {
    label: 'Audit · Outbound',
    category: 'Audit',
    requiresCwd: false,
    render: renderOutbound,
  });

  window.cockpit.registerComponent('auditLog', {
    label: 'Audit · Log',
    category: 'Audit',
    requiresCwd: false,
    render: renderLog,
  });

  // -----------------------------------------------------------------------
  // Event delegation. We wire ONE document-level click + change handler
  // that catches any of our `data-audit-action` / `cockpit-audit-key-*`
  // controls. The host's render() rebuilds DOM on every snapshot, so we
  // avoid re-binding per render and use delegation instead.
  // -----------------------------------------------------------------------

  // sidebar.js exposes the VS Code API on window.cockpit.vscode. We never
  // try to re-acquire it (acquireVsCodeApi is single-shot per webview).
  function postToHost(msg) {
    if (window.cockpit && window.cockpit.vscode && typeof window.cockpit.vscode.postMessage === 'function') {
      window.cockpit.vscode.postMessage(msg);
    }
  }

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute && target.getAttribute('data-audit-action');
    if (action === 'refresh') {
      postToHost({ type: 'audit.refresh', auditTailN: 200 });
      return;
    }
    if (action === 'export') {
      postToHost({ type: 'audit.export' });
      return;
    }
    if (action === 'open') {
      postToHost({ type: 'audit.openLog' });
      return;
    }
    if (action === 'clear') {
      postToHost({ type: 'audit.clearLog' });
      return;
    }
    if (target.classList.contains('cockpit-audit-key-add')) {
      const root = target.closest('.cockpit-audit-keys-form');
      if (!root) return;
      const nameEl = root.querySelector('.cockpit-audit-key-name');
      const valueEl = root.querySelector('.cockpit-audit-key-value');
      const name = (nameEl && 'value' in nameEl) ? String(nameEl.value || '').trim() : '';
      const value = (valueEl && 'value' in valueEl) ? String(valueEl.value || '') : '';
      if (!name || !value) return;
      postToHost({ type: 'keys.add', keyName: name, keyValue: value });
      if (valueEl && 'value' in valueEl) valueEl.value = '';
      return;
    }
    const delName = target.getAttribute && target.getAttribute('data-audit-key-delete');
    if (delName) {
      postToHost({ type: 'keys.delete', keyName: delName });
      return;
    }
  });

  document.addEventListener('change', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains('cockpit-audit-search')) {
      const v = ('value' in target) ? String(target.value || '').trim() : '';
      postToHost({ type: 'audit.search', auditQuery: v });
    }
  });

  // Listen for host-side payloads. sidebar.js routes inbound messages with
  // unknown `type` fields through a generic dispatcher; we register our own
  // window listener as a fallback so we don't depend on that hook.
  window.addEventListener('message', (event) => {
    const msg = event && event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'audit.payload') {
      auditCache = {
        events: Array.isArray(msg.events) ? msg.events : [],
        domains: Array.isArray(msg.domains) ? msg.domains : [],
        fetchedAtMs: Date.now(),
      };
      // Ask the host to re-render. We post a no-op refresh; the host snapshot
      // re-trigger will repaint our widgets with the fresh cache.
      postToHost({ type: 'refresh' });
      return;
    }
    if (msg.type === 'audit.searchResult') {
      auditCache = {
        events: Array.isArray(msg.events) ? msg.events : [],
        domains: (auditCache && auditCache.domains) || [],
        fetchedAtMs: Date.now(),
      };
      postToHost({ type: 'refresh' });
      return;
    }
    if (msg.type === 'audit.cleared') {
      auditCache = { events: [], domains: [], fetchedAtMs: Date.now() };
      postToHost({ type: 'refresh' });
      return;
    }
    if (msg.type === 'keys.payload') {
      keysCache = Array.isArray(msg.keys) ? msg.keys.map((k) => ({
        name: typeof k.name === 'string' ? k.name : '',
        addedAtMs: typeof k.addedAtMs === 'number' ? k.addedAtMs : 0,
      })) : [];
      postToHost({ type: 'refresh' });
      return;
    }
  });

  // Kick off an initial keys + audit fetch shortly after registration so the
  // sub-views are populated by the time the user opens the Security tab.
  setTimeout(() => {
    postToHost({ type: 'keys.list' });
    postToHost({ type: 'audit.refresh', auditTailN: 200 });
  }, 250);
})();
