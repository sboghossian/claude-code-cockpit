// =============================================================================
// Claude Cockpit — sidebar.agentReload.js (jcode-inspired feature 3).
//
// Surfaces agent-definition changes detected by src/agentReload.ts. Each
// pending change shows scope, agent name, file path, hash diff, and two
// buttons: "Reviewed" (mark as acknowledged) and "Open file" (jump to
// the agent definition).
//
// This is the human-in-the-loop gate the LeCun world-model stance
// requires before any agent is hot-swapped mid-session. Cockpit doesn't
// reload the agent itself — Claude Code rereads the file on each
// invocation — but the audit record proves the change was seen.
// =============================================================================

(function registerAgentReloadWidget() {
  'use strict';

  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    return;
  }

  let eventsCache; // { events: AgentChangeEvent[], pendingCount, fetchedAt }

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

  function formatRelative(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago';
    return Math.round(diff / 86_400_000) + 'd ago';
  }

  function render(_snap, root) {
    if (!eventsCache) {
      root.innerHTML = '<div class="cockpit-agent-card">Loading agent watcher…</div>';
      postToHost({ type: 'agentReload.fetch' });
      return;
    }
    const events = eventsCache.events || [];
    if (!events.length) {
      root.innerHTML =
        '<div class="cockpit-agent-card">' +
        '<div class="cockpit-agent-title">Agent hot-reload</div>' +
        '<div class="cockpit-agent-empty">No agent changes detected this session.</div>' +
        '<button data-act="refresh">Refresh</button>' +
        '</div>';
      bindActions(root);
      return;
    }
    const rows = events
      .map((e) => {
        const prev = e.prevHash ? e.prevHash.slice(0, 8) : 'new';
        const next = (e.newHash || '').slice(0, 8);
        const stateClass = e.reviewed ? 'reviewed' : 'pending';
        return (
          '<div class="cockpit-agent-row cockpit-agent-' + stateClass + '">' +
          '<div class="cockpit-agent-row-head">' +
          '<span class="cockpit-agent-scope">' + escapeHtml(e.scope) + '</span>' +
          '<span class="cockpit-agent-name">' + escapeHtml(e.name) + '</span>' +
          '<span class="cockpit-agent-when">' + formatRelative(e.changedAt) + '</span>' +
          '</div>' +
          '<div class="cockpit-agent-hash">' + escapeHtml(prev) + ' → ' + escapeHtml(next) + '</div>' +
          '<div class="cockpit-agent-actions">' +
          (e.reviewed
            ? '<span class="cockpit-agent-tag">reviewed</span>'
            : '<button data-act="review" data-id="' + escapeHtml(e.id) + '">Mark reviewed</button>') +
          ' <button data-act="open" data-path="' + escapeHtml(e.filePath) + '">Open file</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    root.innerHTML =
      '<div class="cockpit-agent-card">' +
      '<div class="cockpit-agent-title">Agent hot-reload · ' + (eventsCache.pendingCount || 0) + ' pending</div>' +
      '<div class="cockpit-agent-sub"><a href="#" data-act="refresh">refresh</a></div>' +
      '<div class="cockpit-agent-rows">' + rows + '</div>' +
      '</div>';
    bindActions(root);
  }

  function bindActions(root) {
    root.querySelectorAll('[data-act="refresh"]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        eventsCache = undefined;
        postToHost({ type: 'agentReload.fetch' });
        render(null, root);
      });
    });
    root.querySelectorAll('[data-act="review"]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id) postToHost({ type: 'agentReload.markReviewed', id });
      });
    });
    root.querySelectorAll('[data-act="open"]').forEach((el) => {
      el.addEventListener('click', () => {
        const p = el.getAttribute('data-path');
        if (p) postToHost({ type: 'openFile', filePath: p });
      });
    });
  }

  window.addEventListener('message', (ev) => {
    const msg = ev && ev.data;
    if (!msg || msg.type !== 'agentReload.events' || !msg.payload) return;
    eventsCache = Object.assign({ fetchedAt: Date.now() }, msg.payload);
    document.querySelectorAll('[data-component="agentReloadFeed"]').forEach((el) => render(null, el));
  });

  window.cockpit.registerComponent('agentReloadFeed', {
    label: 'Agents · hot-reload feed',
    category: 'Approval',
    requiresCwd: false,
    render,
  });
})();
