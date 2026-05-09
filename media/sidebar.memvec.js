// =============================================================================
// Claude Cockpit — sidebar.memvec.js (jcode-inspired feature 1).
//
// Sibling script loaded after media/sidebar.js. Registers two widgets:
//   memvecStats   — DB summary (chunks, source-type breakdown, recency).
//   memvecSearch  — search box; renders top-K hits with similarity bars.
//
// All round-trips use `memvec.*` message types handled in
// sidebarProvider.ts. Read-only — no destructive ops exposed.
// =============================================================================

(function registerMemvecWidgets() {
  'use strict';

  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    return;
  }

  let statsCache; // { available, totalChunks, bySourceType, bySourcePath, newestIndexedAt, reason, fetchedAt }
  let lastQuery = { text: '', results: [], backend: '', error: '', fetchedAt: 0 };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function postToHost(msg) {
    if (window.cockpit && window.cockpit.vscode && typeof window.cockpit.vscode.postMessage === 'function') {
      window.cockpit.vscode.postMessage(msg);
    }
  }

  function formatRelative(iso) {
    if (!iso) return 'never';
    const ts = typeof iso === 'number' ? iso : new Date(iso).getTime();
    if (!Number.isFinite(ts)) return 'never';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago';
    return Math.round(diff / 86_400_000) + 'd ago';
  }

  // -------------------------------------------------------------------------
  // memvecStats widget
  // -------------------------------------------------------------------------

  function renderStats(_snap, root) {
    if (!statsCache) {
      root.innerHTML = '<div class="cockpit-memvec-card">Loading vector memory…</div>';
      postToHost({ type: 'memvec.fetchStats' });
      return;
    }
    if (!statsCache.available) {
      root.innerHTML =
        '<div class="cockpit-memvec-card cockpit-memvec-empty">' +
        '<div class="cockpit-memvec-title">Vector memory</div>' +
        '<div class="cockpit-memvec-reason">' + escapeHtml(statsCache.reason || 'unavailable') + '</div>' +
        '<button class="cockpit-memvec-refresh" data-act="refresh">Retry</button>' +
        '</div>';
      bindRefresh(root);
      return;
    }
    const types = Object.entries(statsCache.bySourceType || {});
    const totalForBars = types.reduce((s, [, v]) => s + (v || 0), 0) || 1;
    const typeRows = types
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => {
        const pct = Math.round((n / totalForBars) * 100);
        return (
          '<div class="cockpit-memvec-row">' +
          '<span class="cockpit-memvec-row-label">' + escapeHtml(t) + '</span>' +
          '<span class="cockpit-memvec-row-bar"><span style="width:' + pct + '%"></span></span>' +
          '<span class="cockpit-memvec-row-n">' + n + '</span>' +
          '</div>'
        );
      })
      .join('');
    root.innerHTML =
      '<div class="cockpit-memvec-card">' +
      '<div class="cockpit-memvec-title">Vector memory · ' + statsCache.totalChunks + ' chunks</div>' +
      '<div class="cockpit-memvec-sub">' +
      'newest: ' + escapeHtml(formatRelative(statsCache.newestIndexedAt)) +
      ' · <a href="#" data-act="refresh">refresh</a>' +
      '</div>' +
      (typeRows ? '<div class="cockpit-memvec-rows">' + typeRows + '</div>' : '') +
      '</div>';
    bindRefresh(root);
  }

  function bindRefresh(root) {
    root.querySelectorAll('[data-act="refresh"]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        statsCache = undefined;
        postToHost({ type: 'memvec.fetchStats' });
        renderStats(null, root);
      });
    });
  }

  // -------------------------------------------------------------------------
  // memvecSearch widget
  // -------------------------------------------------------------------------

  function renderSearch(_snap, root) {
    const inputVal = lastQuery.text || '';
    root.innerHTML =
      '<div class="cockpit-memvec-card">' +
      '<div class="cockpit-memvec-title">Memory search</div>' +
      '<div class="cockpit-memvec-search">' +
      '<input type="text" placeholder="semantic query…" value="' + escapeHtml(inputVal) + '" data-memvec-input />' +
      '<button data-memvec-go>Search</button>' +
      '</div>' +
      '<div class="cockpit-memvec-search-meta">' +
      (lastQuery.backend ? 'backend: ' + escapeHtml(lastQuery.backend) + ' · ' : '') +
      (lastQuery.error ? '<span class="cockpit-memvec-error">' + escapeHtml(lastQuery.error) + '</span>' : (lastQuery.results.length + ' hits')) +
      '</div>' +
      '<div class="cockpit-memvec-results">' + renderHits(lastQuery.results) + '</div>' +
      '</div>';
    const input = root.querySelector('[data-memvec-input]');
    const go = root.querySelector('[data-memvec-go]');
    function submit() {
      const q = input && input.value ? input.value.trim() : '';
      if (!q) return;
      lastQuery = { text: q, results: [], backend: '', error: '', fetchedAt: Date.now() };
      postToHost({ type: 'memvec.query', query: q });
      renderSearch(null, root);
    }
    if (go) go.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
    root.querySelectorAll('[data-memvec-open]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const p = el.getAttribute('data-memvec-open');
        if (p) postToHost({ type: 'openFile', filePath: p });
      });
    });
  }

  function renderHits(hits) {
    if (!hits || !hits.length) return '<div class="cockpit-memvec-empty">no hits yet</div>';
    return hits
      .map((h) => {
        const sim = Math.max(0, Math.min(1, 1 - (h.distance || 0)));
        const pct = Math.round(sim * 100);
        return (
          '<div class="cockpit-memvec-hit">' +
          '<div class="cockpit-memvec-hit-head">' +
          '<a href="#" data-memvec-open="' + escapeHtml(h.sourcePath) + '">' + escapeHtml(h.sourcePath) + '</a>' +
          ' <span class="cockpit-memvec-hit-type">[' + escapeHtml(h.sourceType || '?') + ']</span>' +
          '</div>' +
          '<div class="cockpit-memvec-hit-bar"><span style="width:' + pct + '%"></span><b>' + pct + '%</b></div>' +
          '<div class="cockpit-memvec-hit-snippet">' + escapeHtml(h.snippet || '') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  // -------------------------------------------------------------------------
  // host -> webview message bridge
  // -------------------------------------------------------------------------

  window.addEventListener('message', (ev) => {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'memvec.stats' && msg.payload) {
      statsCache = Object.assign({ fetchedAt: Date.now() }, msg.payload);
      const els = document.querySelectorAll('[data-component="memvecStats"]');
      els.forEach((el) => renderStats(null, el));
    } else if (msg.type === 'memvec.queryResult' && msg.payload) {
      const p = msg.payload;
      lastQuery = {
        text: String(p.query || ''),
        results: Array.isArray(p.results) ? p.results : [],
        backend: String(p.backend || ''),
        error: String(p.error || ''),
        fetchedAt: Date.now(),
      };
      const els = document.querySelectorAll('[data-component="memvecSearch"]');
      els.forEach((el) => renderSearch(null, el));
    }
  });

  // -------------------------------------------------------------------------
  // registration
  // -------------------------------------------------------------------------

  window.cockpit.registerComponent('memvecStats', {
    label: 'Memory · vector store',
    category: 'Memory',
    requiresCwd: false,
    render: renderStats,
  });

  window.cockpit.registerComponent('memvecSearch', {
    label: 'Memory · semantic search',
    category: 'Memory',
    requiresCwd: false,
    render: renderSearch,
  });
})();
