// =============================================================================
// Claude Cockpit — sidebar.tutorial.js (Phase 2, feat/launch-onboarding-sandbox).
//
// Sibling script loaded after media/sidebar.js. Registers two widgets via the
// Phase-0 bridge:
//
//   tutorialRecs    — re-renders the snapshot's `recommendations` list as
//                     "try this command" cards. Click → copies the command
//                     to clipboard (or jumps to the relevant tab if the rec
//                     carries a `gotoTab` action).
//   tutorialNudges  — usage-pattern nudges synthesized in the host
//                     (tutorial.recommendations message) from the existing
//                     `minePrompts` output. Reads from a local cache the host
//                     fills via tutorial.fetchRecs.
//
// Namespace prefix `tutorial.*` for all postMessage types. CSS classes
// prefixed `.cockpit-tutorial-...`.
// =============================================================================

(function registerTutorialWidgets() {
  'use strict';

  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    return;
  }

  /** @type {{ nudges: Array<{ id: string, title: string, why: string, command: string|undefined, action: string|undefined }>, fetchedAtMs: number } | undefined} */
  let nudgeCache;
  /** @type {{ active: boolean, sessionFile: string|undefined, projectRoot: string|undefined, sessionId: string|undefined } | undefined} */
  let sandboxCache;

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

  // -----------------------------------------------------------------------
  // Sandbox banner — rendered as a thin wrapper around the active tab so the
  // user never forgets they're in tour mode. Lives at the top of every tab
  // body via a render hook the bridge exposes.
  // -----------------------------------------------------------------------

  function sandboxBanner(snap) {
    const sb = (snap && snap.sandbox) || sandboxCache;
    if (!sb || !sb.active) return '';
    const label = sb.sessionId ? sb.sessionId.slice(0, 8) : 'demo';
    return `
      <div class="cockpit-tutorial-banner">
        <span class="cockpit-tutorial-banner-pill">SANDBOX</span>
        <span>Tour mode is on. Synthetic project at <code>${escapeHtml(sb.projectRoot || '~/.claude/.cockpit/sandbox/demo-project')}</code> · session <code>${escapeHtml(label)}</code>.</span>
        <button class="office-btn cockpit-tutorial-banner-btn" data-tutorial-action="exit-sandbox">Exit demo</button>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // tutorialRecs — wraps snap.recommendations into copy-to-clipboard cards.
  // -----------------------------------------------------------------------

  function renderTutorialRecs(snap) {
    const recs = (snap && Array.isArray(snap.recommendations)) ? snap.recommendations : [];
    if (recs.length === 0) {
      return `${sandboxBanner(snap)}
        <h2>Try this</h2>
        <p class="empty">No recommendations yet — your session history is too small. Run Claude in a project, come back in a day.</p>
      `;
    }
    const top = recs.slice(0, 8);
    const items = top.map((r) => {
      const impactClass = r.impact === 'high' ? 'cockpit-tutorial-rec-high'
        : r.impact === 'med' ? 'cockpit-tutorial-rec-med'
        : 'cockpit-tutorial-rec-low';
      const action = (r.action && typeof r.action === 'string') ? r.action : 'none';
      const payload = r.actionPayload ? ` data-tutorial-payload="${escapeHtml(String(r.actionPayload))}"` : '';
      const buttonLabel = r.actionLabel || (action === 'gotoTab' ? 'Open tab' : 'Try it');
      return `
        <li class="cockpit-tutorial-rec ${impactClass}">
          <div class="cockpit-tutorial-rec-head">
            <strong>${escapeHtml(r.title || '')}</strong>
            <span class="tag">${escapeHtml(r.category || 'workflow')}</span>
          </div>
          <p class="cockpit-tutorial-rec-why">${escapeHtml(r.why || '')}</p>
          <div class="cockpit-tutorial-rec-actions">
            <button class="office-btn" data-tutorial-action="${escapeHtml(action)}"${payload}>${escapeHtml(buttonLabel)}</button>
            <button class="office-btn" data-tutorial-action="dismiss-rec" data-tutorial-rec-id="${escapeHtml(r.id || '')}">Dismiss</button>
          </div>
        </li>
      `;
    }).join('');
    return `${sandboxBanner(snap)}
      <h2>Try this · ${recs.length} suggestions</h2>
      <p class="empty cockpit-tutorial-hint">Curated from your real session history (computeRecommendations + minePrompts). Click "Try it" to act on a card; "Dismiss" to hide for the rest of the session.</p>
      <ul class="cockpit-tutorial-recs list" style="list-style: none; padding: 0;">${items}</ul>
    `;
  }

  // -----------------------------------------------------------------------
  // tutorialNudges — host-side usage-pattern hints (e.g. "you ran /qa 4
  // times this week — try /qa --report-only"). Lazy: rendered from
  // `nudgeCache` populated by tutorial.recommendations.
  // -----------------------------------------------------------------------

  function renderTutorialNudges(snap) {
    const cache = nudgeCache;
    if (!cache) {
      // Trigger a fetch on first render. Host responds with
      // `tutorial.recommendations` and the next snapshot push re-renders us.
      postToHost({ type: 'tutorial.fetchRecs' });
      return `${sandboxBanner(snap)}
        <h2>Patterns</h2>
        <p class="empty">Looking at your prompt history…</p>
      `;
    }
    const items = cache.nudges.length === 0
      ? '<li><span class="empty">No repeating prompt patterns detected — your prompts are diverse, no nudges needed.</span></li>'
      : cache.nudges.map((n) => `
          <li class="cockpit-tutorial-nudge">
            <strong>${escapeHtml(n.title)}</strong>
            <p class="cockpit-tutorial-nudge-why">${escapeHtml(n.why)}</p>
            ${n.command
              ? `<button class="office-btn" data-tutorial-action="copy-command" data-tutorial-payload="${escapeHtml(n.command)}">Copy: <code>${escapeHtml(n.command)}</code></button>`
              : ''}
            <button class="office-btn" data-tutorial-action="dismiss-rec" data-tutorial-rec-id="${escapeHtml(n.id)}">Dismiss</button>
          </li>
        `).join('');
    return `
      <h2>Patterns ${cache.nudges.length > 0 ? '(' + cache.nudges.length + ')' : ''}</h2>
      <ul class="cockpit-tutorial-nudges list" style="list-style: none; padding: 0;">${items}</ul>
      <button class="office-btn" data-tutorial-action="refresh-nudges">Re-scan history</button>
    `;
  }

  // -----------------------------------------------------------------------
  // Bridge registration.
  // -----------------------------------------------------------------------

  window.cockpit.registerComponent('tutorialRecs', {
    label: 'Tutorial · Try this',
    category: 'Now',
    requiresCwd: false,
    render: renderTutorialRecs,
  });

  window.cockpit.registerComponent('tutorialNudges', {
    label: 'Tutorial · Patterns',
    category: 'Now',
    requiresCwd: false,
    render: renderTutorialNudges,
  });

  // -----------------------------------------------------------------------
  // Event delegation. One document-level click listener catches every
  // tutorial action; we never re-bind per render.
  // -----------------------------------------------------------------------

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.getAttribute('data-tutorial-action');
    if (!action) return;
    const payload = target.getAttribute('data-tutorial-payload') || '';
    if (action === 'copy-command' && payload) {
      postToHost({ type: 'copyText', text: payload, label: 'command' });
      return;
    }
    if (action === 'gotoTab' && payload) {
      postToHost({ type: 'tutorial.gotoTab', tabId: payload });
      return;
    }
    if (action === 'openMemory') {
      postToHost({ type: 'openMemory' });
      return;
    }
    if (action === 'openSession') {
      postToHost({ type: 'openSessionFile' });
      return;
    }
    if (action === 'setDailyCap') {
      postToHost({ type: 'setDailyCap' });
      return;
    }
    if (action === 'openExternal' && payload) {
      postToHost({ type: 'openExternal', url: payload });
      return;
    }
    if (action === 'copySkill' && payload) {
      postToHost({ type: 'copySkill', skillName: payload });
      return;
    }
    if (action === 'dismiss-rec') {
      const id = target.getAttribute('data-tutorial-rec-id') || '';
      postToHost({ type: 'tutorial.dismiss', recId: id });
      return;
    }
    if (action === 'refresh-nudges') {
      nudgeCache = undefined;
      postToHost({ type: 'tutorial.fetchRecs' });
      return;
    }
    if (action === 'exit-sandbox') {
      postToHost({ type: 'sandbox.exit' });
      return;
    }
    if (action === 'start-sandbox') {
      postToHost({ type: 'sandbox.start' });
      return;
    }
  });

  // Listen for host-side payloads.
  window.addEventListener('message', (event) => {
    const msg = event && event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'tutorial.recommendations') {
      nudgeCache = {
        nudges: Array.isArray(msg.nudges) ? msg.nudges : [],
        fetchedAtMs: Date.now(),
      };
      // Trigger a re-render so the user sees the freshly-loaded nudges.
      if (window.cockpit && typeof window.cockpit.requestRerender === 'function') {
        window.cockpit.requestRerender();
      }
      return;
    }
    if (msg.type === 'sandbox.state') {
      sandboxCache = msg.state || undefined;
      if (window.cockpit && typeof window.cockpit.requestRerender === 'function') {
        window.cockpit.requestRerender();
      }
      return;
    }
  });

})();
