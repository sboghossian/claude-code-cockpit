(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  function basename(p) {
    if (!p) return '';
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render(snap) {
    if (!snap) {
      root.innerHTML = '<p class="empty">Open a folder to see Claude session data.</p>';
      return;
    }
    if (!snap.projectDir) {
      root.innerHTML =
        '<p class="empty">No Claude Code history for this workspace yet. Run <code>claude</code> here to get started.</p>';
      return;
    }
    const s = snap.stats;
    const sessionShort = s.sessionId ? s.sessionId.slice(0, 8) : '—';

    const tokens = `
      <h2>Tokens</h2>
      <div class="tokens">
        <div class="token-card"><div class="label">Total</div><div class="value">${escapeHtml(s.totalTokensFormatted)}</div></div>
        <div class="token-card"><div class="label">Output</div><div class="value">${escapeHtml(s.outputTokensFormatted)}</div></div>
        <div class="token-card"><div class="label">Cache read</div><div class="value">${escapeHtml(s.cacheReadTokensFormatted)}</div></div>
        <div class="token-card"><div class="label">Cache write</div><div class="value">${escapeHtml(s.cacheCreationTokensFormatted)}</div></div>
      </div>
    `;

    const session = `
      <h2>Session</h2>
      <div class="kv">
        <span class="k">ID</span><span class="v">${escapeHtml(sessionShort)}</span>
        <span class="k">Messages</span><span class="v">${s.messageCount}</span>
        <span class="k">Tool calls</span><span class="v">${s.toolCallCount}</span>
        <span class="k">Last activity</span><span class="v">${escapeHtml(s.lastActivityAt ?? '—')}</span>
      </div>
    `;

    const fileItems = s.filesTouched.length
      ? s.filesTouched
          .slice(0, 50)
          .map(
            (f) => `
        <li>
          <div class="row">
            <a class="left link" data-file="${escapeHtml(f.filePath)}" title="${escapeHtml(f.filePath)}">${escapeHtml(basename(f.filePath))}</a>
            <span class="right"><span class="tag">${escapeHtml(f.tool)}</span>${f.count}×</span>
          </div>
        </li>`,
          )
          .join('')
      : '<li><span class="empty">No file edits yet.</span></li>';

    const memoryItems = snap.memory.length
      ? snap.memory
          .slice(0, 40)
          .map(
            (m) => `
        <li>
          <div class="row">
            <a class="left link" data-memory="${escapeHtml(m.filename)}" title="${escapeHtml(m.hook)}">${escapeHtml(m.title)}</a>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${escapeHtml(m.hook)}</div>
        </li>`,
          )
          .join('')
      : '<li><span class="empty">No persistent memory yet.</span></li>';

    root.innerHTML = `
      <div class="actions">
        <button data-action="refresh">Refresh</button>
        <button data-action="memory">Open MEMORY.md</button>
        <button data-action="session">Open session</button>
      </div>
      <h2>Workspace</h2>
      <div class="kv">
        <span class="k">cwd</span><span class="v">${escapeHtml(snap.cwd)}</span>
      </div>
      ${tokens}
      ${session}
      <h2>Files touched (${s.filesTouched.length})</h2>
      <ul class="list">${fileItems}</ul>
      <h2>Memory (${snap.memory.length})</h2>
      <ul class="list">${memoryItems}</ul>
    `;

    root.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action === 'refresh') vscode.postMessage({ type: 'refresh' });
        if (action === 'memory') vscode.postMessage({ type: 'openMemory' });
        if (action === 'session') vscode.postMessage({ type: 'openSessionFile' });
      });
    });

    root.querySelectorAll('a[data-file]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', filePath: a.getAttribute('data-file') });
      });
    });

    root.querySelectorAll('a[data-memory]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openMemoryFile', filename: a.getAttribute('data-memory') });
      });
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') {
      render(msg.snapshot);
    }
  });

  vscode.postMessage({ type: 'refresh' });
})();
