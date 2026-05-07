/* Claude Cockpit — Mobile companion (read-only, v1.0).
 *
 * Fetches a SANITIZED snapshot of the approval queue from a user-configured
 * URL (typically a Cloudflare Tunnel + Cloudflare Access protected endpoint
 * the desktop extension publishes to ~/.claude/.cockpit/queue.public.json).
 *
 * v1.0 contract:
 *   - Read-only. No POST. No PUT. The page never tries to approve.
 *   - URL stored in localStorage on this device only.
 *   - Polls every 5s when visible; pauses when the tab is backgrounded.
 *   - Surface stale-data warning if last successful fetch was >15s ago.
 *
 * v1.1 (planned, NOT implemented here): a Decisions endpoint the user
 * publishes via the same tunnel. The desktop extension polls it; the mobile
 * page POSTs decisions to it (Cloudflare-Access-protected). Cockpit still
 * makes ZERO direct outbound calls.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var STORAGE_KEY = 'cockpit.mobile.queueUrl.v1';
  var POLL_INTERVAL_MS = 5000;
  var STALE_THRESHOLD_MS = 15000;
  // Cap displayed entries — defence-in-depth even though the publisher caps too.
  var MAX_RENDER = 50;

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  var els = {
    statusLine: document.getElementById('statusLine'),
    refreshBtn: document.getElementById('refreshBtn'),
    setupSection: document.getElementById('setupSection'),
    urlInput: document.getElementById('urlInput'),
    saveUrlBtn: document.getElementById('saveUrlBtn'),
    clearUrlBtn: document.getElementById('clearUrlBtn'),
    queueSection: document.getElementById('queueSection'),
    queueList: document.getElementById('queueList'),
    pendingCount: document.getElementById('pendingCount'),
    emptyMessage: document.getElementById('emptyMessage'),
    errorSection: document.getElementById('errorSection'),
    errorMessage: document.getElementById('errorMessage'),
    resetBtn: document.getElementById('resetBtn'),
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  var state = {
    url: null,
    pollTimer: null,
    lastSuccessAt: 0,
    inflight: false,
  };

  // ---------------------------------------------------------------------------
  // URL persistence
  // ---------------------------------------------------------------------------

  function loadUrl() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveUrl(url) {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch (err) {
      // Private mode / disabled storage — surface but don't crash.
      showError('Could not save URL: ' + describeError(err));
    }
  }

  function clearUrl() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // ignore
    }
  }

  function isHttpsUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
      var parsed = new URL(value);
      // Require https for anything that isn't localhost (dev convenience).
      if (parsed.protocol === 'https:') return true;
      if (parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) return true;
      return false;
    } catch (err) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Section visibility
  // ---------------------------------------------------------------------------

  function show(section) {
    els.setupSection.hidden = section !== 'setup';
    els.queueSection.hidden = section !== 'queue';
    els.errorSection.hidden = section !== 'error';
  }

  function showError(message) {
    els.errorMessage.textContent = message;
    show('error');
    setStatus(message, 'error');
  }

  function setStatus(text, kind) {
    els.statusLine.textContent = text;
    els.statusLine.classList.toggle('is-stale', kind === 'stale');
    els.statusLine.classList.toggle('is-error', kind === 'error');
  }

  function describeError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    return 'unknown error';
  }

  // ---------------------------------------------------------------------------
  // Fetch + render
  // ---------------------------------------------------------------------------

  function refreshNow() {
    if (!state.url || state.inflight) return;
    state.inflight = true;
    els.refreshBtn.classList.add('is-spinning');
    fetch(state.url, {
      method: 'GET',
      credentials: 'include', // ride Cloudflare Access SSO cookies
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        }
        return res.json();
      })
      .then(function (payload) {
        state.lastSuccessAt = Date.now();
        renderPayload(payload);
      })
      .catch(function (err) {
        // Stay on the queue view if we have prior data; only flip to error if
        // we never loaded successfully.
        if (state.lastSuccessAt === 0) {
          showError(describeError(err));
        } else {
          setStatus('Couldn’t refresh — ' + describeError(err), 'error');
        }
      })
      .then(function () {
        state.inflight = false;
        els.refreshBtn.classList.remove('is-spinning');
      });
  }

  function renderPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      showError('Malformed payload from queue endpoint.');
      return;
    }
    if (payload.enabled === false) {
      show('queue');
      els.pendingCount.textContent = '0';
      els.pendingCount.classList.add('is-zero');
      els.queueList.innerHTML = '';
      els.emptyMessage.hidden = false;
      els.emptyMessage.textContent = 'Desktop has mobile.enabled = false. Queue paused.';
      setStatus('Queue paused on desktop.', 'stale');
      return;
    }

    var entries = Array.isArray(payload.entries) ? payload.entries.slice(0, MAX_RENDER) : [];
    var pending = typeof payload.pendingCount === 'number' ? payload.pendingCount : 0;

    show('queue');
    els.pendingCount.textContent = String(pending);
    els.pendingCount.classList.toggle('is-zero', pending === 0);
    els.emptyMessage.hidden = entries.length > 0;

    // Build list with createElement (no innerHTML for entry data — defence
    // against any future field that lands as HTML by accident).
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) {
      frag.appendChild(buildItem(entries[i]));
    }
    els.queueList.innerHTML = '';
    els.queueList.appendChild(frag);

    // Status line: how fresh is the snapshot?
    var publishedAt = typeof payload.publishedAt === 'number' ? payload.publishedAt : 0;
    var ageMs = publishedAt > 0 ? Date.now() - publishedAt : 0;
    if (ageMs > STALE_THRESHOLD_MS) {
      setStatus('Snapshot ' + formatAgeMs(ageMs) + ' old. Desktop may be paused.', 'stale');
    } else {
      setStatus('Live · polled every ' + (POLL_INTERVAL_MS / 1000) + 's', 'ok');
    }
  }

  function buildItem(entry) {
    var li = document.createElement('li');
    li.className = 'cockpit-mobile-item';
    var status = typeof entry.status === 'string' ? entry.status : 'pending';
    li.classList.add('is-' + status);

    var rowTop = document.createElement('div');
    rowTop.className = 'cockpit-mobile-row';

    var tool = document.createElement('span');
    tool.className = 'cockpit-mobile-tool';
    tool.textContent = String(entry.tool || 'unknown');
    rowTop.appendChild(tool);

    var age = document.createElement('span');
    age.className = 'cockpit-mobile-age';
    var seconds = typeof entry.ageSeconds === 'number' ? entry.ageSeconds : 0;
    age.textContent = formatAgeSeconds(seconds);
    rowTop.appendChild(age);

    li.appendChild(rowTop);

    var meta = document.createElement('div');
    meta.className = 'cockpit-mobile-meta';

    var badge = document.createElement('span');
    badge.className = 'cockpit-mobile-status-badge is-' + status;
    badge.textContent = status;
    meta.appendChild(badge);

    if (entry.agentName) {
      var agent = document.createElement('span');
      agent.textContent = 'by ' + String(entry.agentName);
      meta.appendChild(agent);
    }

    var fileCount = typeof entry.fileCount === 'number' ? entry.fileCount : 0;
    if (fileCount > 0) {
      var files = document.createElement('span');
      files.textContent = fileCount + ' file' + (fileCount === 1 ? '' : 's');
      meta.appendChild(files);
    }

    var diff = typeof entry.expectedDiffBytes === 'number' ? entry.expectedDiffBytes : 0;
    if (diff > 0) {
      var diffEl = document.createElement('span');
      diffEl.textContent = formatBytes(diff);
      meta.appendChild(diffEl);
    }

    li.appendChild(meta);
    return li;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function formatAgeSeconds(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function formatAgeMs(ms) {
    return formatAgeSeconds(Math.floor(ms / 1000));
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---------------------------------------------------------------------------
  // Polling lifecycle
  // ---------------------------------------------------------------------------

  function startPolling() {
    stopPolling();
    if (!state.url) return;
    state.pollTimer = window.setInterval(refreshNow, POLL_INTERVAL_MS);
    refreshNow();
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  els.saveUrlBtn.addEventListener('click', function () {
    var value = (els.urlInput.value || '').trim();
    if (!isHttpsUrl(value)) {
      setStatus('URL must be https:// (or http://localhost for dev).', 'error');
      return;
    }
    state.url = value;
    saveUrl(value);
    startPolling();
  });

  els.clearUrlBtn.addEventListener('click', function () {
    state.url = null;
    clearUrl();
    stopPolling();
    els.urlInput.value = '';
    setStatus('Configure your published queue URL to begin.', null);
    show('setup');
  });

  els.resetBtn.addEventListener('click', function () {
    state.url = null;
    clearUrl();
    stopPolling();
    els.urlInput.value = '';
    setStatus('Configure your published queue URL to begin.', null);
    show('setup');
  });

  els.refreshBtn.addEventListener('click', function () {
    if (!state.url) return;
    refreshNow();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
    } else if (state.url) {
      startPolling();
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function boot() {
    var saved = loadUrl();
    if (saved && isHttpsUrl(saved)) {
      state.url = saved;
      els.urlInput.value = saved;
      startPolling();
    } else {
      setStatus('Configure your published queue URL to begin.', null);
      show('setup');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
