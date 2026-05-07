// =============================================================================
// Cockpit replay-timeline — webview-side widgets.
//
// Registered via the Phase-0 plugin bridge: window.cockpit.registerComponent.
// Renders three widgets:
//
//   - replayScrubber       — slider over the event list, click to scrub
//   - replayDiff           — unified-diff viewer for the current scrub range
//   - replayCostProjection — Now-tab card; spent / projected / budget warning
//
// All host messages are namespaced `replay.*` and `cost.*` per the launch
// plan's anti-collision rule. CSS selectors are prefixed `.cockpit-replay-`.
// No `any` — but this file is plain JS (sibling to media/sidebar.js).
// =============================================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (!window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    // sidebar.js hasn't loaded yet (or registry is unavailable). Defer.
    document.addEventListener('DOMContentLoaded', register, { once: true });
    return;
  }
  register();

  function register() {
    if (!window.cockpit || !window.cockpit.registerComponent) return;
    window.cockpit.registerComponent('replayScrubber', {
      label: 'Replay · scrubber',
      category: 'Replay',
      requiresCwd: true,
      render: renderScrubber,
    });
    window.cockpit.registerComponent('replayDiff', {
      label: 'Replay · diff',
      category: 'Replay',
      requiresCwd: true,
      render: renderDiff,
    });
    window.cockpit.registerComponent('replayCostProjection', {
      label: 'Cost projection',
      category: 'Replay',
      requiresCwd: true,
      render: renderCostProjection,
    });
    bootstrap();
  }

  // ---------------------------------------------------------------------------
  // Per-session replay state, kept in module scope. The webview is single-view,
  // single-active-session, so a flat object is fine. Keys:
  //   sessionFile, events, digest, indexA, indexB, diffs, lastLoadedAt
  // ---------------------------------------------------------------------------
  const state = {
    sessionFile: undefined,
    events: [],
    digest: undefined,
    cost: undefined,
    indexA: 0,
    indexB: 0,
    diffs: [],
    requested: false,
    lastError: undefined,
  };

  function bootstrap() {
    if (typeof window.addEventListener !== 'function') return;
    window.addEventListener('message', (ev) => {
      const data = ev && ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'snapshot') {
        // snapshot.replayIndex is the always-on tail. Trigger a load on first
        // sight of a session file we haven't seen yet.
        const idx = data.snapshot && data.snapshot.replayIndex;
        const sessionFile =
          data.snapshot && data.snapshot.localLayout && data.snapshot.localLayout.activeSessionFile;
        if (sessionFile && idx && idx.available && state.sessionFile !== sessionFile) {
          state.sessionFile = sessionFile;
          state.requested = false;
        }
        // Re-render anything that depends on snapshot (cost projection card).
        rerenderHosts();
      } else if (data.type === 'replay.session' && data.payload) {
        state.events = Array.isArray(data.payload.events) ? data.payload.events : [];
        state.digest = data.payload.digest;
        state.cost = data.payload.cost;
        state.sessionFile = data.payload.sessionFile;
        if (state.events.length > 0) {
          state.indexA = 0;
          state.indexB = state.events[state.events.length - 1].index;
        }
        state.lastError = undefined;
        rerenderHosts();
      } else if (data.type === 'replay.diff') {
        state.diffs = Array.isArray(data.diffs) ? data.diffs : [];
        rerenderHosts();
      } else if (data.type === 'replay.forkResult') {
        // Forking a session does not change scrub state — host already
        // surfaces a toast; we don't re-render here.
      }
    });
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
  }

  function postMessage(msg) {
    try {
      const vscode = acquireOrCachedApi();
      if (vscode && typeof vscode.postMessage === 'function') {
        vscode.postMessage(msg);
      }
    } catch (err) {
      // The host's vscode handle may be unavailable in dev; fall through.
    }
  }

  let cachedApi;
  function acquireOrCachedApi() {
    if (cachedApi !== undefined) return cachedApi;
    if (typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function') {
      try {
        cachedApi = window.acquireVsCodeApi();
        return cachedApi;
      } catch (err) {
        // Already acquired by sidebar.js — peek at the cached singleton.
        cachedApi = window.__cockpitVscode || undefined;
        return cachedApi;
      }
    }
    return undefined;
  }

  function rerenderHosts() {
    // We can't rebuild the whole sidebar — sidebar.js owns that. But we can
    // patch our own placeholders in place. Each render fn writes a wrapper
    // div with a known data-cockpit-replay attribute; we look those up.
    document
      .querySelectorAll('[data-cockpit-replay="scrubber"]')
      .forEach((el) => (el.innerHTML = scrubberInner()));
    document
      .querySelectorAll('[data-cockpit-replay="diff"]')
      .forEach((el) => (el.innerHTML = diffInner()));
    document
      .querySelectorAll('[data-cockpit-replay="cost"]')
      .forEach((el) => (el.innerHTML = costInner()));
  }

  // ---------------------------------------------------------------------------
  // Top-level render functions registered with the bridge.
  // ---------------------------------------------------------------------------

  function renderScrubber(snap) {
    primeFromSnapshot(snap);
    return (
      '<div class="cockpit-replay-scrubber" data-cockpit-replay="scrubber">' +
      scrubberInner() +
      '</div>'
    );
  }

  function renderDiff(snap) {
    primeFromSnapshot(snap);
    return (
      '<div class="cockpit-replay-diff" data-cockpit-replay="diff">' +
      diffInner() +
      '</div>'
    );
  }

  function renderCostProjection(snap) {
    primeFromSnapshot(snap);
    return (
      '<div class="cockpit-cost-projection" data-cockpit-replay="cost">' +
      costInner() +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------------
  // Lazy-load the full event list the first time a Replay widget renders for
  // a given session.
  // ---------------------------------------------------------------------------

  function primeFromSnapshot(snap) {
    if (!snap || !snap.localLayout) return;
    const file = snap.localLayout.activeSessionFile;
    if (!file) return;
    if (file !== state.sessionFile) {
      state.sessionFile = file;
      state.events = [];
      state.digest = undefined;
      state.cost = undefined;
      state.requested = false;
    }
    if (!state.requested && snap.replayIndex && snap.replayIndex.available && snap.replayIndex.totalEvents > 0) {
      state.requested = true;
      postMessage({ type: 'replay.loadSession', replaySessionFile: file });
    }
  }

  // ---------------------------------------------------------------------------
  // Scrubber UI
  // ---------------------------------------------------------------------------

  function scrubberInner() {
    if (!state.sessionFile) {
      return '<p class="empty">No active session — open a folder Claude Code is working in.</p>';
    }
    if (state.events.length === 0) {
      return '<p class="empty">Loading session timeline…</p>';
    }
    const minIdx = state.events[0].index;
    const maxIdx = state.events[state.events.length - 1].index;
    const a = clamp(state.indexA, minIdx, maxIdx);
    const b = clamp(state.indexB, minIdx, maxIdx);
    const evA = findEvent(a) || state.events[0];
    const evB = findEvent(b) || state.events[state.events.length - 1];
    const minLabel = '#' + minIdx;
    const maxLabel = '#' + maxIdx;
    return (
      '<h2>Replay · scrubber</h2>' +
      '<div class="cockpit-replay-meta">' +
      '<span>events ' + state.events.length + '</span>' +
      '<span>files touched ' + (state.digest ? state.digest.touchedFiles.length : 0) + '</span>' +
      '</div>' +
      '<div class="cockpit-replay-range">' +
      '<label>From <span>#' + a + '</span></label>' +
      '<input type="range" data-cockpit-replay-input="A" min="' + minIdx + '" max="' + maxIdx + '" value="' + a + '" step="1" />' +
      '<label>To <span>#' + b + '</span></label>' +
      '<input type="range" data-cockpit-replay-input="B" min="' + minIdx + '" max="' + maxIdx + '" value="' + b + '" step="1" />' +
      '</div>' +
      '<div class="cockpit-replay-event">' +
      '<div><strong>A:</strong> ' + escapeHtml(formatEventLabel(evA, minLabel)) + '</div>' +
      '<div><strong>B:</strong> ' + escapeHtml(formatEventLabel(evB, maxLabel)) + '</div>' +
      '</div>' +
      '<div class="cockpit-replay-actions">' +
      '<button data-cockpit-replay-action="diff">Compute diff</button>' +
      '<button data-cockpit-replay-action="fork">Fork at #' + b + '</button>' +
      '<button data-cockpit-replay-action="reset">Reset</button>' +
      '</div>'
    );
  }

  function findEvent(index) {
    if (!Array.isArray(state.events)) return undefined;
    // Events may be sampled — find the closest entry.
    let lo = 0;
    let hi = state.events.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const ev = state.events[mid];
      if (ev.index === index) return ev;
      if (ev.index < index) lo = mid + 1;
      else hi = mid - 1;
    }
    // Closest below.
    if (hi >= 0) return state.events[hi];
    if (lo < state.events.length) return state.events[lo];
    return undefined;
  }

  function formatEventLabel(ev, fallback) {
    if (!ev) return fallback;
    const ts = ev.timestamp ? ev.timestamp.replace('T', ' ').slice(0, 19) : '';
    const tail = ev.toolName ? '[' + ev.toolName + '] ' : '';
    return '#' + ev.index + ' ' + ts + ' ' + tail + (ev.summary || ev.kind);
  }

  // ---------------------------------------------------------------------------
  // Diff viewer
  // ---------------------------------------------------------------------------

  function diffInner() {
    if (!state.sessionFile) {
      return '<p class="empty">No active session.</p>';
    }
    if (state.events.length === 0) {
      return '<p class="empty">Waiting for session timeline…</p>';
    }
    if (!Array.isArray(state.diffs) || state.diffs.length === 0) {
      return '<h2>Replay · diff</h2><p class="empty">Drag the scrubbers and click <em>Compute diff</em>.</p>';
    }
    const items = state.diffs
      .map((d) => {
        const sign =
          (d.addedLines > 0 ? '+' + d.addedLines : '') +
          (d.removedLines > 0 ? ' −' + d.removedLines : '');
        return (
          '<details class="cockpit-replay-file">' +
          '<summary>' +
          escapeHtml(d.filePath) +
          ' <span class="cockpit-replay-stat">' +
          escapeHtml(sign || 'unchanged') +
          '</span></summary>' +
          '<pre class="cockpit-replay-unified">' +
          escapeHtml(d.unified || '(no textual change)') +
          '</pre>' +
          '</details>'
        );
      })
      .join('');
    return '<h2>Replay · diff</h2>' + items;
  }

  // ---------------------------------------------------------------------------
  // Cost projection card (Now tab)
  // ---------------------------------------------------------------------------

  function costInner() {
    if (!state.sessionFile) {
      return '<p class="empty">No active session.</p>';
    }
    if (!state.cost) {
      return '<h2>Cost projection</h2><p class="empty">Open the Replay tab once to populate.</p>';
    }
    const fmt = (n) =>
      typeof n === 'number'
        ? n < 0.01
          ? '<$0.01'
          : '$' + n.toFixed(2)
        : '—';
    const banner = state.cost.willHitDailyCap
      ? '<div class="cockpit-cost-warn">Projected next-50 events would push you past your daily cap. Consider pausing or running on a cheaper model.</div>'
      : '';
    return (
      '<h2>Cost projection</h2>' +
      banner +
      '<div class="cockpit-cost-grid">' +
      '<div><div class="label">Spent</div><div class="value">' + fmt(state.cost.spentUsd) + '</div></div>' +
      '<div><div class="label">Per event</div><div class="value">' + fmt(state.cost.perEventUsd) + '</div></div>' +
      '<div><div class="label">Projected</div><div class="value">' + fmt(state.cost.projectedUsd) + '</div></div>' +
      '<div><div class="label">Family</div><div class="value">' + escapeHtml(state.cost.family || 'unknown') + '</div></div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function onClick(ev) {
    const target = ev.target;
    if (!target || !(target instanceof Element)) return;
    const action = target.getAttribute('data-cockpit-replay-action');
    if (!action) return;
    if (action === 'diff') {
      postMessage({
        type: 'replay.exportDiff',
        replaySessionFile: state.sessionFile,
        replayIndex: state.indexA,
        replayIndexB: state.indexB,
      });
    } else if (action === 'fork') {
      postMessage({
        type: 'replay.fork',
        replaySessionFile: state.sessionFile,
        replayForkAtIndex: state.indexB,
      });
    } else if (action === 'reset') {
      if (state.events.length > 0) {
        state.indexA = state.events[0].index;
        state.indexB = state.events[state.events.length - 1].index;
        state.diffs = [];
        rerenderHosts();
      }
    }
  }

  function onInput(ev) {
    const t = ev.target;
    if (!t || !(t instanceof Element)) return;
    const which = t.getAttribute('data-cockpit-replay-input');
    if (!which) return;
    const val = parseInt(t.value, 10);
    if (!Number.isFinite(val)) return;
    if (which === 'A') state.indexA = val;
    else if (which === 'B') state.indexB = val;
    rerenderHosts();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
