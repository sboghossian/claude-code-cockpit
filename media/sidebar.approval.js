// =============================================================================
// Claude Cockpit — Approval queue webview script (Phase 1, approval-queue).
//
// Sibling script to media/sidebar.js. Loaded via `registerSidebarScript` /
// `<script>` injection in sidebarProvider.html(). Registers two widgets:
//
//   approvalQueue   — list of pending + recent approvals
//   approvalDetail  — sticky helper card explaining LeCun gate / hook setup
//
// All host messages use the `approval.*` namespace. Click handlers attach
// at the document level (event delegation) so re-renders by sidebar.js
// don't drop them.
// =============================================================================

(function () {
  'use strict';

  // The bridge is set up by sidebar.js before this script runs (script tags
  // are emitted in order). Bail loudly if the contract is broken so we
  // don't silently produce a black hole tab.
  if (typeof window === 'undefined' || !window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    if (typeof window !== 'undefined' && window.console) {
      window.console.warn('sidebar.approval.js: window.cockpit.registerComponent missing; tab will be empty.');
    }
    return;
  }

  var vscode = window.cockpit.vscode || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);

  // -------------------------------------------------------------------------
  // Local cache: the queue payload arrives via a separate `approval.queue`
  // postMessage from the host. We render whatever we have; if nothing yet,
  // show a "loading" placeholder and ask the host.
  // -------------------------------------------------------------------------
  var queueState = {
    entries: null,    // null = not fetched yet; [] = empty queue
    fetchedAt: 0,
  };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function timeAgo(ms) {
    if (!ms || !isFinite(ms)) return '—';
    var diff = Date.now() - ms;
    if (diff < 0) return 'just now';
    if (diff < 60_000) return Math.floor(diff / 1000) + 's ago';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
    return Math.floor(diff / 86_400_000) + 'd ago';
  }

  function basenamePath(p) {
    if (!p) return '';
    var parts = String(p).split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }

  function statusPill(entry) {
    var label = entry.status;
    return '<span class="cockpit-approval-pill cockpit-approval-pill-status-' + escapeHtml(label) + '">' + escapeHtml(label) + '</span>';
  }

  function sourcePill(entry) {
    return '<span class="cockpit-approval-pill cockpit-approval-pill-source-' + escapeHtml(entry.source) + '">' + escapeHtml(entry.source) + '</span>';
  }

  function renderFiles(files) {
    if (!files || files.length === 0) {
      return '<span class="cockpit-approval-meta">No declared files.</span>';
    }
    var capped = files.slice(0, 8);
    var extra = files.length > capped.length ? '<li>… and ' + (files.length - capped.length) + ' more</li>' : '';
    return '<ul class="cockpit-approval-files">' +
      capped.map(function (f) {
        return '<li title="' + escapeHtml(f) + '">' + escapeHtml(basenamePath(f)) + '</li>';
      }).join('') + extra + '</ul>';
  }

  function renderItem(entry) {
    var canRollback = entry.source === 'cockpit' && !!entry.snapshotId && (entry.status === 'approved' || entry.status === 'pending' || entry.status === 'rolled-back');
    var decided = entry.status !== 'pending' && entry.status !== 'snapshot-failed';
    var classes = ['cockpit-approval-item'];
    if (entry.status === 'snapshot-failed') classes.push('cockpit-approval-snapshot-failed');
    if (decided) classes.push('cockpit-approval-decided');
    var warn = '';
    if (entry.status === 'snapshot-failed') {
      warn = '<div class="cockpit-approval-warn">Snapshot failed: ' + escapeHtml(entry.snapshotError || 'unknown error') + '. Revert is disabled — approve only if you can manually undo.</div>';
    }
    var args = entry.action.argsRedacted
      ? '<pre class="cockpit-approval-args">' + escapeHtml(entry.action.argsRedacted) + '</pre>'
      : '';
    var rollbackInfo = '';
    if (entry.rollback) {
      var summary = entry.rollback.summary || {};
      var parts = Object.keys(summary).map(function (k) { return summary[k] + ' ' + k; }).join(', ');
      rollbackInfo = '<div class="cockpit-approval-meta">Rolled back ' + timeAgo(entry.rollback.performedAt) + ' — ' + escapeHtml(parts) + '</div>';
    }
    var disabledRollback = canRollback ? '' : 'disabled';
    var pendingButtons = entry.status === 'pending' || entry.status === 'snapshot-failed'
      ? '<button class="cockpit-approval-button cockpit-approval-button-approve" data-approval-action="approve" data-approval-id="' + escapeHtml(entry.id) + '">Approve</button>' +
        '<button class="cockpit-approval-button cockpit-approval-button-reject" data-approval-action="reject" data-approval-id="' + escapeHtml(entry.id) + '">Reject</button>'
      : '';
    var rollbackBtn = entry.source === 'cockpit'
      ? '<button class="cockpit-approval-button cockpit-approval-button-rollback" data-approval-action="rollback" data-approval-id="' + escapeHtml(entry.id) + '" ' + disabledRollback + '>Revert</button>'
      : '';
    return '' +
      '<div class="' + classes.join(' ') + '">' +
        '<div class="cockpit-approval-row">' +
          '<span class="cockpit-approval-tool">' + escapeHtml(entry.action.tool || 'unknown') + '</span>' +
          '<span class="cockpit-approval-actions">' + sourcePill(entry) + ' ' + statusPill(entry) + '</span>' +
        '</div>' +
        '<div class="cockpit-approval-meta">' +
          'requested ' + timeAgo(entry.action.requestedAt) +
          (entry.action.byAgent ? ' by ' + escapeHtml(entry.action.byAgent) : '') +
          (entry.action.worktree ? ' · ' + escapeHtml(entry.action.worktree) : '') +
        '</div>' +
        args +
        renderFiles(entry.action.filesAffected) +
        warn +
        rollbackInfo +
        '<div class="cockpit-approval-actions">' + pendingButtons + rollbackBtn + '</div>' +
      '</div>';
  }

  function renderQueue(snap) {
    var counts = (snap && snap.approvalCounts) || { pending: 0, recent: 0 };
    var entries = queueState.entries;
    if (entries == null) {
      // Trigger a fetch the first time anyone renders the tab.
      if (vscode) vscode.postMessage({ type: 'approval.fetchQueue' });
      return '' +
        '<div class="cockpit-approval-root">' +
          '<div class="cockpit-approval-header">' +
            '<h2>Approval queue</h2>' +
            '<div class="cockpit-approval-actions">' +
              '<button class="cockpit-approval-button" data-approval-action="refresh">Refresh</button>' +
            '</div>' +
          '</div>' +
          '<div class="cockpit-approval-empty">Loading queue from ~/.claude/.cockpit/queue.json…</div>' +
        '</div>';
    }
    var pending = entries.filter(function (e) { return e.status === 'pending' || e.status === 'snapshot-failed'; });
    var decided = entries.filter(function (e) { return e.status !== 'pending' && e.status !== 'snapshot-failed'; }).slice(0, 25);
    var pendingHtml = pending.length
      ? '<div class="cockpit-approval-list">' + pending.map(renderItem).join('') + '</div>'
      : '<div class="cockpit-approval-empty">No pending approvals. ' + escapeHtml(String(counts.recent)) + ' decision(s) in the last 24h.</div>';
    var decidedHtml = decided.length
      ? '<details><summary>Recent decisions (' + decided.length + ')</summary><div class="cockpit-approval-list">' + decided.map(renderItem).join('') + '</div></details>'
      : '';
    return '' +
      '<div class="cockpit-approval-root">' +
        '<div class="cockpit-approval-header">' +
          '<h2>Approval queue (' + escapeHtml(String(pending.length)) + ' pending)</h2>' +
          '<div class="cockpit-approval-actions">' +
            '<button class="cockpit-approval-button" data-approval-action="refresh">Refresh</button>' +
            '<button class="cockpit-approval-button" data-approval-action="bulkApprove">Approve all</button>' +
            '<button class="cockpit-approval-button" data-approval-action="bulkReject">Reject all</button>' +
            '<button class="cockpit-approval-button" data-approval-action="enqueueDemo">Demo entry</button>' +
          '</div>' +
        '</div>' +
        pendingHtml +
        decidedHtml +
      '</div>';
  }

  function renderDetail() {
    return '' +
      '<div class="cockpit-approval-detail">' +
        '<strong>LeCun gate.</strong> Cockpit observes Claude Code; it does not block actions. ' +
        'Wire your <code>.claude/settings.json</code> <code>hooks.PreToolUse</code> to call ' +
        '<code>claudeCockpit.approval.openQueue</code> to enqueue actions before they run. ' +
        'Snapshots cover only declared <code>filesAffected</code>; revert is byte-identical with sha256 drift detection.' +
      '</div>';
  }

  // -------------------------------------------------------------------------
  // Component registration. The shape mirrors the COMPONENTS object in
  // sidebar.js: { label, category, requiresCwd, render }.
  // -------------------------------------------------------------------------

  window.cockpit.registerComponent('approvalQueue', {
    label: 'Approval queue',
    category: 'Approval',
    requiresCwd: false,
    render: renderQueue,
  });

  window.cockpit.registerComponent('approvalDetail', {
    label: 'Approval detail / LeCun gate',
    category: 'Approval',
    requiresCwd: false,
    render: renderDetail,
  });

  // -------------------------------------------------------------------------
  // Message bus. The host posts `approval.queue` with the merged list any
  // time someone calls postApprovalQueue() (initial fetch, post-decide,
  // file-watcher tick).
  // -------------------------------------------------------------------------

  window.addEventListener('message', function (event) {
    var msg = event && event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'approval.queue' && Array.isArray(msg.entries)) {
      queueState = { entries: msg.entries, fetchedAt: Date.now() };
      if (window.cockpit && typeof window.cockpit.requestRerender === 'function') {
        window.cockpit.requestRerender();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Click delegation. Single document-level listener so re-renders in
  // sidebar.js don't strip our handlers.
  // -------------------------------------------------------------------------

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target || typeof target.getAttribute !== 'function') return;
    var btn = target.closest && target.closest('[data-approval-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-approval-action');
    var id = btn.getAttribute('data-approval-id');
    if (!action || !vscode) return;
    switch (action) {
      case 'refresh':
        vscode.postMessage({ type: 'approval.fetchQueue' });
        break;
      case 'approve':
        if (id) vscode.postMessage({ type: 'approval.approve', approvalId: id });
        break;
      case 'reject':
        if (id) vscode.postMessage({ type: 'approval.reject', approvalId: id });
        break;
      case 'rollback':
        if (id) vscode.postMessage({ type: 'approval.rollback', approvalId: id });
        break;
      case 'bulkApprove':
        vscode.postMessage({ type: 'approval.bulkApprove' });
        break;
      case 'bulkReject':
        vscode.postMessage({ type: 'approval.bulkReject' });
        break;
      case 'enqueueDemo':
        vscode.postMessage({ type: 'approval.enqueueDemo' });
        break;
      default:
        break;
    }
  });
})();
