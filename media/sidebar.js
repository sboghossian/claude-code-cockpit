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

  function fmtRelative(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function projectsSection(snap) {
    if (!snap.projects || snap.projects.length === 0) {
      return '<h2>Recent projects</h2><p class="empty">No Claude Code history yet on this machine.</p>';
    }
    const items = snap.projects
      .slice(0, 12)
      .map((p) => {
        const isActive = snap.cwd && p.decodedPath === snap.cwd;
        return `
        <li>
          <div class="row">
            <a class="left link" data-project-session="${escapeHtml(p.projectDir)}" data-project-path="${escapeHtml(p.decodedPath)}" title="${escapeHtml(p.decodedPath)}">
              ${isActive ? '★ ' : ''}${escapeHtml(p.name)}
            </a>
            <span class="right">${escapeHtml(p.totalTokensFormatted)} · ${escapeHtml(fmtRelative(p.lastActivityAt))}</span>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'} · <a class="link" data-project-folder="${escapeHtml(p.decodedPath)}">open folder</a></div>
        </li>`;
      })
      .join('');
    return `<h2>Recent projects (${snap.projects.length})</h2><ul class="list">${items}</ul>`;
  }

  function settingsSection(snap) {
    const s = snap.settings || {};
    if (!s.settingsExists) {
      return '';
    }
    const mcpItems = (s.mcpServerNames || []).length
      ? s.mcpServerNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('')
      : '<li><span class="empty">No MCP servers configured.</span></li>';
    const hookItems = (s.hooks || []).length
      ? s.hooks
          .map(
            (h) => `<li>
              <div class="row">
                <span class="left">${escapeHtml(h.event)}</span>
                <span class="right">${h.count}×</span>
              </div>
              <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${(h.commands || []).map((c) => escapeHtml(c)).join(', ')}</div>
            </li>`,
          )
          .join('')
      : '<li><span class="empty">No hooks configured.</span></li>';
    const pluginItems = (s.enabledPlugins || []).length
      ? `<h2>Enabled plugins (${s.enabledPlugins.length})</h2><ul class="list">${s.enabledPlugins.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
      : '';
    return `
      <h2>MCP servers (${(s.mcpServerNames || []).length})</h2>
      <ul class="list">${mcpItems}</ul>
      <h2>Hooks (${(s.hooks || []).length})</h2>
      <ul class="list">${hookItems}</ul>
      ${pluginItems}
    `;
  }

  function pilotSection(snap) {
    const p = snap.pilot;
    if (!p) return '';
    const dots = (p.alwaysLive || [])
      .map((d) => `<span class="subdomain-dot" title="${escapeHtml(d)}"></span><span class="subdomain-name">${escapeHtml(d.split('.')[0])}</span>`)
      .join('');
    const principles = (p.principles || [])
      .slice(0, 12)
      .map((pr) => `<li class="principle">${escapeHtml(pr)}</li>`)
      .join('');
    const oneLiner = p.oneLiner
      ? `<p class="pilot-quote">"${escapeHtml(p.oneLiner)}"</p>`
      : '';
    const role = p.role ? `<p class="pilot-role">${escapeHtml(p.role.slice(0, 140))}${p.role.length > 140 ? '…' : ''}</p>` : '';
    const dotsBlock = dots
      ? `<div class="pilot-dots-label">always live</div><div class="pilot-dots">${dots}</div>`
      : '';
    return `
      <section class="pilot">
        <div class="pilot-header">
          <span class="pilot-badge">PILOT</span>
          <span class="pilot-name">${escapeHtml(p.name)}</span>
        </div>
        ${role}
        ${oneLiner}
        ${principles ? `<div class="pilot-principles-label">core principles</div><ol class="pilot-principles">${principles}</ol>` : ''}
        ${dotsBlock}
      </section>
    `;
  }

  function sparklineSvg(points) {
    if (!points || points.length === 0) return '';
    const max = Math.max(...points.map((p) => p.tokens), 1);
    const w = 120;
    const h = 28;
    // points are ordered minute=59 (oldest) → 0 (newest)
    const path = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = h - (p.tokens / max) * (h - 2) - 1;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const lastY = h - (points[points.length - 1].tokens / max) * (h - 2) - 1;
    const lastX = w;
    return `
      <svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="tokens per minute, last 60 minutes">
        <path d="${path}" fill="none" stroke="var(--vscode-charts-blue, var(--vscode-textLink-foreground))" stroke-width="1.5" />
        <circle cx="${lastX}" cy="${lastY.toFixed(1)}" r="2" fill="var(--vscode-charts-blue, var(--vscode-textLink-foreground))" />
      </svg>
    `;
  }

  function costSection(s) {
    const c = s.cost || {};
    return `
      <h2>Cost <span class="model-tag">${escapeHtml(s.modelFamily || 'unknown')}</span></h2>
      <div class="kv">
        <span class="k">Total</span><span class="v cost-total">${escapeHtml(s.cost.totalUsdFormatted)}</span>
        <span class="k">Input</span><span class="v">${escapeHtml(s.cost.inputUsdFormatted)}</span>
        <span class="k">Output</span><span class="v">${escapeHtml(s.cost.outputUsdFormatted)}</span>
        <span class="k">Cache read</span><span class="v">${escapeHtml(s.cost.cacheReadUsdFormatted)}</span>
        <span class="k">Cache write</span><span class="v">${escapeHtml(s.cost.cacheCreationUsdFormatted)}</span>
      </div>
    `;
  }

  function subAgentsSection(s) {
    const list = s.subAgents || [];
    if (!list.length) return '';
    const items = list
      .slice(0, 10)
      .map(
        (a) => `
        <li>
          <div class="row">
            <a class="left link" data-subagent="${escapeHtml(a.jsonlFile)}" title="${escapeHtml(a.jsonlFile)}">${escapeHtml(a.agentId)}</a>
            <span class="right">${escapeHtml(a.totalTokensFormatted)} · ${escapeHtml(fmtRelative(a.lastActivityAt))}</span>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${a.toolCallCount} tools · ${a.messageCount} msgs</div>
        </li>`,
      )
      .join('');
    return `<h2>Sub-agents (${list.length})</h2><ul class="list">${items}</ul>`;
  }

  function skillsSection(snap) {
    const list = snap.skills || [];
    if (!list.length) return '';
    return `
      <h2>Skills (${list.length})</h2>
      <input type="search" class="search" data-search="skills" placeholder="Filter skills…" />
      <ul class="list" data-search-target="skills">
        ${list
          .map(
            (sk) => `
        <li data-search-text="${escapeHtml((sk.name + ' ' + sk.description).toLowerCase())}">
          <div class="row">
            <a class="left link" data-copy-skill="${escapeHtml(sk.name)}" title="Copy /${escapeHtml(sk.name)} to clipboard">/${escapeHtml(sk.name)}</a>
            <span class="right"><span class="tag">${escapeHtml(sk.source)}</span></span>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${escapeHtml(sk.description.slice(0, 200))}${sk.description.length > 200 ? '…' : ''}</div>
        </li>`,
          )
          .join('')}
      </ul>
    `;
  }

  function memorySection(snap) {
    const list = snap.memory || [];
    return `
      <h2>Memory (${list.length})</h2>
      ${list.length ? '<input type="search" class="search" data-search="memory" placeholder="Search memory…" />' : ''}
      <ul class="list" data-search-target="memory">
        ${list.length
          ? list
              .map(
                (m) => `
        <li data-search-text="${escapeHtml((m.title + ' ' + m.hook).toLowerCase())}">
          <div class="row">
            <a class="left link" data-memory="${escapeHtml(m.filename)}" title="${escapeHtml(m.hook)}">${escapeHtml(m.title)}</a>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${escapeHtml(m.hook)}</div>
        </li>`,
              )
              .join('')
          : '<li><span class="empty">No persistent memory yet.</span></li>'}
      </ul>
    `;
  }

  function render(snap) {
    if (!snap) {
      root.innerHTML = '<p class="empty">Loading…</p>';
      return;
    }
    if (!snap.cwd) {
      root.innerHTML = `
        <div class="actions">
          <button data-action="refresh">Refresh</button>
        </div>
        <p class="empty">No Claude Code sessions on this machine yet. Run <code>claude</code> anywhere to get started.</p>
        ${skillsSection(snap)}
        ${settingsSection(snap)}
      `;
      bindEvents();
      return;
    }
    const s = snap.stats;
    const sessionShort = s.sessionId ? s.sessionId.slice(0, 8) : '—';
    const liveDot = s.isActive ? '<span class="live-dot" title="written in last 10s"></span>' : '';

    const tokens = `
      <div class="tokens-header">
        <h2>Tokens</h2>
        ${sparklineSvg(s.sparkline)}
      </div>
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
        <span class="k">Model</span><span class="v">${escapeHtml(s.lastModel || '—')}</span>
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

    root.innerHTML = `
      ${pilotSection(snap)}
      <div class="actions">
        <button data-action="refresh">Refresh</button>
        <button data-action="memory">Open MEMORY.md</button>
        <button data-action="session">Open session</button>
      </div>
      <h2>Active session ${liveDot}</h2>
      <div class="kv">
        <span class="k">project</span><span class="v">${escapeHtml(snap.cwd)}</span>
      </div>
      ${tokens}
      ${costSection(s)}
      ${session}
      ${subAgentsSection(s)}
      <h2>Files touched (${s.filesTouched.length})</h2>
      <ul class="list">${fileItems}</ul>
      ${memorySection(snap)}
      ${skillsSection(snap)}
      ${projectsSection(snap)}
      ${settingsSection(snap)}
    `;
    bindEvents();
  }

  function bindEvents() {
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

    root.querySelectorAll('a[data-project-session]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openProjectSession',
          projectDir: a.getAttribute('data-project-session'),
        });
      });
    });

    root.querySelectorAll('a[data-project-folder]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          type: 'openProject',
          decodedPath: a.getAttribute('data-project-folder'),
        });
      });
    });

    root.querySelectorAll('a[data-subagent]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', filePath: a.getAttribute('data-subagent') });
      });
    });

    root.querySelectorAll('a[data-copy-skill]').forEach((a) => {
      a.addEventListener('click', () => {
        const name = a.getAttribute('data-copy-skill');
        vscode.postMessage({ type: 'copySkill', skillName: name });
        a.textContent = '/' + name + ' ✓';
        setTimeout(() => { a.textContent = '/' + name; }, 1200);
      });
    });

    root.querySelectorAll('input.search[data-search]').forEach((input) => {
      const target = input.getAttribute('data-search');
      const list = root.querySelector(`ul[data-search-target="${target}"]`);
      if (!list) return;
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        list.querySelectorAll('li[data-search-text]').forEach((li) => {
          const t = li.getAttribute('data-search-text') || '';
          li.style.display = !q || t.includes(q) ? '' : 'none';
        });
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
