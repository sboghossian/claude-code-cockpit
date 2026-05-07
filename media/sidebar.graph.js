// =============================================================================
// Claude Cockpit — Obsidian graph renderer (sibling of media/sidebar.js).
//
// Mounted via the Phase-0 plugin bridge: src/extension.ts calls
// registerSidebarScript('media/sidebar.graph.js') which the sidebar provider
// emits as a nonce-tagged <script> after media/sidebar.js. The vendor file
// (media/vendor/d3.min.js) loads first so window.d3 is in scope here.
//
// What this script does, in order:
//   1. Listens for 'snapshot' messages on window. When the obsidian tab is
//      active and a vault is selected, asks the host for the full graph via
//      postMessage({ type: 'graph.refresh' }).
//   2. When 'graph.payload' arrives, mounts a d3-force layout into
//      #cockpit-graph-container.
//   3. Click on a node → postMessage({ type: 'graph.openInObsidian', ... }).
//      vscode.env.openExternal(obsidian://...) handles the rest in the host.
//
// Stephane's stance: "I only care about the graph, not the actual content of
// the notes themselves." So we never render note bodies, never build a list,
// never embed Obsidian. Just the topology + click-through.
// =============================================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (!window.d3) {
    // Vendor missed; surface a useful error instead of failing silently.
    console.warn('[cockpit-graph] window.d3 missing — vendor script failed to load.');
    return;
  }
  if (!window.cockpit || typeof window.cockpit.postMessage !== 'function') {
    console.warn('[cockpit-graph] window.cockpit bridge missing — sidebar.js must load first.');
    return;
  }

  const d3 = window.d3;
  const post = window.cockpit.postMessage;

  // -------------------------------------------------------------------------
  // State.
  // -------------------------------------------------------------------------

  /** Latest graph payload from the host. */
  let lastGraph = null;
  /** Vault id we last asked the host to refresh — guards against duplicate
   *  refreshes when the snapshot stream fires repeatedly with the same vault. */
  let lastRequestedVaultId = null;
  /** Currently mounted simulation (if any). */
  let simulation = null;
  /** Set of file paths Claude touched today; updated from each snapshot. */
  let touchedSet = new Set();

  // -------------------------------------------------------------------------
  // Public bridge (so sidebar.js's "Refresh graph" button can poke us
  // directly without round-tripping through the host).
  // -------------------------------------------------------------------------

  window.cockpit.requestGraphRefresh = function () {
    const container = document.getElementById('cockpit-graph-container');
    const vaultId = container ? container.getAttribute('data-vault-id') : '';
    requestRefresh(vaultId || undefined, true);
  };

  // -------------------------------------------------------------------------
  // Snapshot listener — kicks off a graph.refresh round-trip when the tab is
  // visible and we don't already have a graph for this vault.
  // -------------------------------------------------------------------------

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'snapshot') {
      onSnapshot(msg.snapshot);
    } else if (msg.type === 'graph.payload') {
      onPayload(msg.payload);
    }
  });

  function onSnapshot(snap) {
    if (!snap) return;
    // Pull "files Claude touched today" from the snapshot so we can color
    // matching nodes in the accent color.
    touchedSet = collectTouchedToday(snap);
    // Defer mount work until the container exists in the DOM. sidebar.js
    // re-renders synchronously on every snapshot, so the element WILL be
    // there by the time this fires (sidebar.js runs first).
    const container = document.getElementById('cockpit-graph-container');
    if (!container) return;
    const vaultId = container.getAttribute('data-vault-id') || '';
    if (!vaultId) return;
    if (lastGraph && lastGraph.vaultId === vaultId) {
      // We already have a graph for this vault — re-mount in case the DOM
      // was replaced by a snapshot re-render (sidebar.js innerHTML='s the
      // whole tab body each time).
      mount(lastGraph, container);
      return;
    }
    requestRefresh(vaultId, false);
  }

  function requestRefresh(vaultId, force) {
    if (!force && vaultId && vaultId === lastRequestedVaultId) return;
    lastRequestedVaultId = vaultId || null;
    post({ type: 'graph.refresh', graphVaultId: vaultId });
  }

  function onPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.error) {
      const container = document.getElementById('cockpit-graph-container');
      if (container) {
        const errMsg = payload.error === 'no-vault'
          ? 'No Obsidian vault detected.'
          : ('Failed to build graph: ' + (payload.message || payload.error));
        container.innerHTML = '<p class="cockpit-graph-empty">' + escapeText(errMsg) + '</p>';
      }
      return;
    }
    lastGraph = {
      vaultId: payload.vaultId,
      vaultName: payload.vaultName,
      nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      edges: Array.isArray(payload.edges) ? payload.edges : [],
    };
    const container = document.getElementById('cockpit-graph-container');
    if (container) mount(lastGraph, container);
  }

  // -------------------------------------------------------------------------
  // Files-touched-today extraction. claudeData.stats.filesTouched is an array
  // of { filePath, tool, count }; we keep only paths whose mtime falls within
  // the current local day so the overlay matches Stephane's intent ("today").
  // The snapshot doesn't carry a per-touch timestamp, so we treat every entry
  // in stats.filesTouched as "today's touches" (the stats are session-scoped
  // and the session lives in today's window when the user is actively coding).
  // -------------------------------------------------------------------------

  function collectTouchedToday(snap) {
    const out = new Set();
    const stats = snap && snap.stats;
    if (!stats || !Array.isArray(stats.filesTouched)) return out;
    for (const f of stats.filesTouched) {
      if (f && typeof f.filePath === 'string' && f.filePath) {
        out.add(f.filePath);
        // Also store a basename-keyed match so notes inside a vault that
        // share filenames with a touched file still highlight.
        const base = f.filePath.split('/').pop();
        if (base) out.add(base);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Render — d3-force layout with pan/zoom and click-to-open.
  // -------------------------------------------------------------------------

  // Visual constants. Kept inside the closure so they don't leak.
  const NODE_RADIUS = 3;
  const NODE_RADIUS_TOUCHED = 5;
  const LINK_DISTANCE = 30;
  const CHARGE_STRENGTH = -45;
  const COLLIDE_RADIUS = 6;

  function mount(graph, container) {
    // Tear down any previous simulation; a stale one keeps ticking and burns
    // CPU even when its SVG has been thrown away.
    if (simulation) {
      simulation.stop();
      simulation = null;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 360);

    // Wipe and rebuild. Avoids a stale SVG sitting under the empty state.
    container.innerHTML = '';

    if (!graph.nodes.length) {
      const empty = document.createElement('p');
      empty.className = 'cockpit-graph-empty';
      empty.textContent = 'No notes found in this vault yet.';
      container.appendChild(empty);
      return;
    }

    const svg = d3.select(container)
      .append('svg')
      .attr('class', 'cockpit-graph-svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    // The zoom layer — every visual element lives inside it so pan/zoom
    // applies uniformly.
    const zoomG = svg.append('g').attr('class', 'cockpit-graph-zoom');

    svg.call(
      d3.zoom()
        .scaleExtent([0.2, 6])
        .on('zoom', (event) => {
          zoomG.attr('transform', event.transform);
        })
    );

    // d3-force mutates the input objects (sets x/y/vx/vy on each node and
    // resolves edge endpoints to node refs). We clone shallowly so the
    // payload we cached stays addressable by id.
    const nodes = graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      relPath: n.relPath,
      mtimeMs: n.mtimeMs,
      isolated: n.isolated,
    }));
    const edges = graph.edges
      .filter((e) => e.source !== e.target) // drop self-loops the host couldn't filter
      .map((e) => ({ source: e.source, target: e.target }));

    const linkSel = zoomG.append('g')
      .attr('class', 'cockpit-graph-links')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('class', 'cockpit-graph-link');

    const nodeSel = zoomG.append('g')
      .attr('class', 'cockpit-graph-nodes')
      .selectAll('circle')
      .data(nodes, (d) => d.id)
      .join('circle')
      .attr('class', (d) => {
        const classes = ['cockpit-graph-node'];
        if (d.isolated) classes.push('cockpit-graph-node-isolated');
        if (isTouchedToday(d)) classes.push('cockpit-graph-node-touched');
        return classes.join(' ');
      })
      .attr('r', (d) => (isTouchedToday(d) ? NODE_RADIUS_TOUCHED : NODE_RADIUS))
      .attr('data-rel', (d) => d.relPath || '')
      .on('click', (_, d) => openInObsidian(graph.vaultId, d.relPath))
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    nodeSel.append('title').text((d) => d.relPath || d.label);

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d) => d.id).distance(LINK_DISTANCE))
      .force('charge', d3.forceManyBody().strength(CHARGE_STRENGTH))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(COLLIDE_RADIUS))
      .alphaDecay(0.05) // faster cool-down for responsiveness on large vaults
      .on('tick', () => {
        linkSel
          .attr('x1', (d) => safeNum(d.source.x))
          .attr('y1', (d) => safeNum(d.source.y))
          .attr('x2', (d) => safeNum(d.target.x))
          .attr('y2', (d) => safeNum(d.target.y));
        nodeSel
          .attr('cx', (d) => safeNum(d.x))
          .attr('cy', (d) => safeNum(d.y));
      });

    // Cap the simulation runtime — for a 5k-node vault, the layout is
    // visually settled long before alpha hits the default minimum, and
    // tick spam keeps a fan loud for no reason.
    setTimeout(() => {
      if (simulation) simulation.alphaTarget(0).stop();
    }, 8000);
  }

  function isTouchedToday(node) {
    if (!touchedSet.size) return false;
    if (touchedSet.has(node.relPath)) return true;
    const base = (node.relPath || '').split('/').pop();
    return base ? touchedSet.has(base) : false;
  }

  function openInObsidian(vaultId, relPath) {
    if (!vaultId || !relPath) return;
    post({
      type: 'graph.openInObsidian',
      graphVaultId: vaultId,
      graphRelPath: relPath,
    });
  }

  function safeNum(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  function escapeText(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
