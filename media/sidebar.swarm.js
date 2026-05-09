// =============================================================================
// Claude Cockpit — sidebar.swarm.js (jcode-inspired feature 2).
//
// Renders the swarm topology computed by src/swarm.ts as a compact list:
// each active session shows its cwd, last touch, and any other sessions
// it shares files with. Severity badges flag conflicts:
//   high    — both sessions are active right now
//   medium  — one is active, one idle
//   low     — both idle, just historical overlap
//
// A future iteration could render an actual force-directed graph; the
// list view is good enough to unblock the "are two of my sessions about
// to step on each other?" question, which is the core jcode pitch.
// =============================================================================

(function registerSwarmWidget() {
  'use strict';

  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    return;
  }

  let topoCache; // { generatedAt, nodes, edges, activeCount, fetchedAt }

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

  function renderTopology(_snap, root) {
    if (!topoCache) {
      root.innerHTML = '<div class="cockpit-swarm-card">Loading swarm topology…</div>';
      postToHost({ type: 'swarm.fetch' });
      return;
    }
    const nodes = topoCache.nodes || [];
    const edges = topoCache.edges || [];
    if (!nodes.length) {
      root.innerHTML =
        '<div class="cockpit-swarm-card">' +
        '<div class="cockpit-swarm-title">Swarm topology</div>' +
        '<div class="cockpit-swarm-empty">No Claude sessions touched in the last hour.</div>' +
        '<button data-act="refresh">Refresh</button>' +
        '</div>';
      bindRefresh(root);
      return;
    }
    const edgesByNode = new Map();
    for (const e of edges) {
      if (!edgesByNode.has(e.source)) edgesByNode.set(e.source, []);
      if (!edgesByNode.has(e.target)) edgesByNode.set(e.target, []);
      edgesByNode.get(e.source).push({ peer: e.target, overlap: e.overlap, severity: e.severity });
      edgesByNode.get(e.target).push({ peer: e.source, overlap: e.overlap, severity: e.severity });
    }
    const nodeRows = nodes
      .map((n) => {
        const peers = edgesByNode.get(n.id) || [];
        const peerHtml = peers.length
          ? '<ul class="cockpit-swarm-peers">' +
            peers
              .map(
                (p) =>
                  '<li class="cockpit-swarm-peer cockpit-swarm-sev-' + escapeHtml(p.severity) + '">' +
                  '<span class="cockpit-swarm-peer-id">↔ ' + escapeHtml(p.peer.slice(0, 12)) + '</span>' +
                  '<span class="cockpit-swarm-peer-files">' + p.overlap.length + ' file' + (p.overlap.length === 1 ? '' : 's') + '</span>' +
                  '</li>',
              )
              .join('') +
            '</ul>'
          : '';
        const dot = n.active ? '🟢' : '⚪';
        return (
          '<div class="cockpit-swarm-node">' +
          '<div class="cockpit-swarm-node-head">' +
          '<span class="cockpit-swarm-dot">' + dot + '</span>' +
          '<span class="cockpit-swarm-cwd">' + escapeHtml(n.cwd || n.projectDir) + '</span>' +
          '<span class="cockpit-swarm-meta">' + formatRelative(n.lastTouchedMs) + ' · ' + n.filesTouched.length + ' files</span>' +
          '</div>' +
          peerHtml +
          '</div>'
        );
      })
      .join('');
    root.innerHTML =
      '<div class="cockpit-swarm-card">' +
      '<div class="cockpit-swarm-title">Swarm · ' + nodes.length + ' sessions, ' + topoCache.activeCount + ' active, ' + edges.length + ' overlap edges</div>' +
      '<div class="cockpit-swarm-sub"><a href="#" data-act="refresh">refresh</a></div>' +
      '<div class="cockpit-swarm-nodes">' + nodeRows + '</div>' +
      '</div>';
    bindRefresh(root);
  }

  function bindRefresh(root) {
    root.querySelectorAll('[data-act="refresh"]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        topoCache = undefined;
        postToHost({ type: 'swarm.fetch' });
        renderTopology(null, root);
      });
    });
  }

  window.addEventListener('message', (ev) => {
    const msg = ev && ev.data;
    if (!msg || msg.type !== 'swarm.topology' || !msg.payload) return;
    topoCache = Object.assign({ fetchedAt: Date.now() }, msg.payload);
    document.querySelectorAll('[data-component="swarmTopology"]').forEach((el) => renderTopology(null, el));
  });

  window.cockpit.registerComponent('swarmTopology', {
    label: 'Swarm · topology',
    category: 'Cross',
    requiresCwd: false,
    render: renderTopology,
  });
})();
