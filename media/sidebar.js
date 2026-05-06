(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let lastSnapshot = null;

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

  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escQ, 'gi'), (m) => `<mark>${m}</mark>`);
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

  function notificationsSection(snap) {
    const list = snap.notifications || [];
    if (!list.length) return '';
    const items = list
      .map((n) => {
        const action = n.action && n.action !== 'none'
          ? `<button class="notif-action" data-notif-action="${escapeHtml(n.action)}">Open</button>`
          : '';
        return `
          <div class="notif ${escapeHtml(n.level)}">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-detail">${escapeHtml(n.detail)}</div>
            ${action}
          </div>`;
      })
      .join('');
    return `<section class="notif-strip">${items}</section>`;
  }

  function quickActionsSection(snap) {
    const buttons = [
      `<button data-qa="search">Search sessions ⌕</button>`,
      `<button data-qa="watchtower">Watchtower</button>`,
    ];
    if (snap.obsidian && snap.obsidian.installed) {
      buttons.push(`<button data-qa="save-obsidian">Save → Obsidian</button>`);
      if (snap.obsidian.primaryVault) {
        buttons.push(`<button data-qa="open-vault">Open vault</button>`);
      }
    }
    if (snap.cwd) {
      buttons.push(`<button data-qa="open-session">Open session JSONL</button>`);
    }
    return `<div class="quick-actions">${buttons.join('')}</div>`;
  }

  function watchtowerSection(snap, opts) {
    opts = opts || {};
    const list = snap.watchtower || [];
    if (!list.length) {
      return '<h2>Watchtower</h2><p class="empty">No sessions touched in the last hour.</p>';
    }
    const filter = opts.idleOnly ? (s) => s.status === 'idle' || s.status === 'stale' : () => true;
    const filtered = list.filter(filter);
    if (!filtered.length) {
      return opts.idleOnly
        ? '<h2>Idle sentinel</h2><p class="empty">Nothing idle. All recent sessions are active.</p>'
        : '<h2>Watchtower</h2><p class="empty">No sessions match.</p>';
    }
    const cards = filtered
      .map(
        (w) => `
        <div class="watch-card">
          <span class="watch-status ${escapeHtml(w.status)}" title="${escapeHtml(w.status)}"></span>
          <div class="watch-body">
            <div class="watch-name">${escapeHtml(w.name)} ${w.modelFamily ? `<span class="tag">${escapeHtml(w.modelFamily)}</span>` : ''}</div>
            <div class="watch-meta">${escapeHtml(w.totalTokensFormatted)} · ${escapeHtml(w.totalUsdFormatted)} · ${escapeHtml(w.ageLabel)}</div>
          </div>
          <button class="watch-action" data-watch-session="${escapeHtml(w.sessionFile)}" data-watch-project="${escapeHtml(w.decodedPath)}">open</button>
        </div>`,
      )
      .join('');
    const liveCount = list.filter((w) => w.status === 'live').length;
    const idleCount = list.filter((w) => w.status === 'idle' || w.status === 'stale').length;
    const summary = `<div class="today-pill">
      <span><strong>${list.length}</strong> recent</span>
      <span><strong>${liveCount}</strong> live</span>
      <span><strong>${idleCount}</strong> idle</span>
    </div>`;
    return `<h2>${opts.idleOnly ? 'Idle sentinel' : 'Watchtower'} <span class="cost-rate">${filtered.length} session${filtered.length === 1 ? '' : 's'}</span></h2>${opts.idleOnly ? '' : summary}${cards}`;
  }

  function obsidianSection(snap) {
    const obs = snap.obsidian || { installed: false, vaults: [], recentNotes: [] };
    if (!obs.installed) {
      return `
        <h2>Obsidian</h2>
        <p class="empty">Obsidian not detected at <code>~/Library/Application Support/obsidian/obsidian.json</code>. Install Obsidian and open it once to register a vault.</p>
      `;
    }
    if (!obs.vaults.length) {
      return `
        <h2>Obsidian</h2>
        <p class="empty">Registry found but no existing vaults. Open Obsidian and create or attach a vault.</p>
      `;
    }
    const vault = obs.primaryVault;
    const vaultBadge = vault
      ? `<span class="obsidian-pill">vault: ${escapeHtml(vault.name)}</span>`
      : '';
    const actions = `
      <div class="obsidian-actions">
        <button class="office-btn" data-qa="save-obsidian">Save active session →</button>
        <button class="office-btn" data-qa="open-vault">Open vault in Obsidian</button>
      </div>
    `;
    const vaultsList = obs.vaults
      .map(
        (v) => `<li>
          <div class="row">
            <a class="left link" data-open-vault-byname="${escapeHtml(v.name)}">${escapeHtml(v.name)}</a>
            <span class="right">${escapeHtml(v.path)}</span>
          </div>
        </li>`,
      )
      .join('');
    const notes = (obs.recentNotes || []).slice(0, 12);
    const notesHtml = notes.length
      ? notes
          .map(
            (n) => `
        <div class="note-card">
          <div class="row">
            <a class="left link note-title" data-open-note-vault="${escapeHtml(n.vaultName)}" data-open-note-rel="${escapeHtml(n.relPath)}" title="${escapeHtml(n.relPath)}">${escapeHtml(n.filename.replace(/\.md$/i, ''))}</a>
            <span class="right">${escapeHtml(fmtRelative(n.lastModifiedAt))}</span>
          </div>
          ${n.excerpt ? `<div class="note-excerpt">${escapeHtml(n.excerpt)}</div>` : ''}
          <div class="row" style="margin-top: 2px;">
            <span class="left" style="color: var(--vscode-descriptionForeground); font-size: 10px;">${escapeHtml(n.relPath)}</span>
          </div>
        </div>`,
          )
          .join('')
      : '<p class="empty">No notes yet.</p>';
    return `
      <h2>Obsidian ${vaultBadge}</h2>
      ${actions}
      ${obs.vaults.length > 1 ? `<h3 class="sub-h">Vaults (${obs.vaults.length})</h3><ul class="list">${vaultsList}</ul>` : ''}
      <h3 class="sub-h">Recent notes</h3>
      ${notesHtml}
    `;
  }

  function promptsSection(snap) {
    const prompts = snap.prompts || [];
    const cards = prompts.length
      ? prompts
          .map(
            (p) => `
            <div class="prompt-card">
              <div class="prompt-title">${escapeHtml(p.title)}</div>
              <div class="prompt-body">${escapeHtml(p.body)}</div>
              <div class="prompt-actions">
                <button class="watch-action" data-prompt-use="${escapeHtml(p.id)}">Copy</button>
                <button class="watch-action" data-prompt-delete="${escapeHtml(p.id)}" style="color: var(--vscode-errorForeground);">Delete</button>
              </div>
            </div>`,
          )
          .join('')
      : '<p class="empty">No saved prompts yet. Add one below.</p>';
    return `
      <h2>Prompt library <span class="cost-rate">${prompts.length}</span></h2>
      ${cards}
      <div class="prompt-form">
        <input data-prompt-title placeholder="Prompt title (e.g. 'plan-review')" />
        <textarea data-prompt-body placeholder="Prompt body — gets copied to clipboard"></textarea>
        <button class="office-btn" data-prompt-add>Save prompt</button>
      </div>
    `;
  }

  function budgetSection(snap) {
    const b = snap.budget;
    if (!b) return '';
    if (!b.enabled && b.dailyCapUsd === 0 && b.sessionCapUsd === 0) {
      return `
        <h2>Budget caps</h2>
        <p class="empty">No budget set. Use <code>Claude Cockpit: Set Daily Budget Cap</code> or settings.</p>
        <div class="actions"><button data-qa="set-cap">Set daily cap</button></div>
      `;
    }
    const dailyBar = b.dailyCapUsd > 0
      ? `<div class="budget-row"><span>Today</span><span class="b-cap">${escapeHtml(b.spentTodayFormatted)} / ${escapeHtml(b.dailyCapFormatted)}</span></div>
         <div class="bar"><div class="bar-fill bar-${escapeHtml(b.dailyTone)}" style="width: ${b.dailyPct.toFixed(1)}%"></div></div>`
      : '';
    const sessionBar = b.sessionCapUsd > 0
      ? `<div class="budget-row" style="margin-top: 8px;"><span>This session</span><span class="b-cap">${escapeHtml(b.spentSessionFormatted)} / ${escapeHtml(b.sessionCapFormatted)}</span></div>
         <div class="bar"><div class="bar-fill bar-${escapeHtml(b.sessionTone)}" style="width: ${b.sessionPct.toFixed(1)}%"></div></div>`
      : '';
    return `
      <h2>Budget caps ${b.enabled ? '<span class="tag tag-used">on</span>' : '<span class="tag">off</span>'}</h2>
      <div class="budget-card">
        ${dailyBar}
        ${sessionBar}
      </div>
      <div class="actions"><button data-qa="set-cap">Set daily cap</button></div>
    `;
  }

  function searchSection(snap) {
    const last = snap.lastSearch;
    const value = last ? last.query : '';
    const results = last && last.hits ? last.hits : [];
    const items = results.length
      ? results
          .map(
            (h) => `
        <div class="search-hit">
          <div class="search-hit-meta">
            <a class="link" data-go-session="${escapeHtml(h.sessionFile)}">${escapeHtml(h.projectName)}</a>
            · <span class="tag">${escapeHtml(h.matchType)}</span>
            · ${escapeHtml(fmtRelative(h.matchTimestamp))}
          </div>
          <div class="search-hit-snippet">${highlight(h.matchSnippet, last.query)}</div>
        </div>`,
          )
          .join('')
      : last
        ? '<p class="empty">No matches.</p>'
        : '<p class="empty">Search across every Claude session JSONL on this machine. Min 2 chars.</p>';
    return `
      <h2>Search all sessions</h2>
      <input type="search" class="search" data-search-input placeholder="Search session content…" value="${escapeHtml(value)}" />
      <div class="actions">
        <button data-qa="run-search">Run search</button>
        ${last ? `<span class="cost-rate">${results.length} hits for "${escapeHtml(last.query)}"</span>` : ''}
      </div>
      <div class="search-results">${items}</div>
    `;
  }

  function costByToolSection(snap) {
    const list = snap.costByTool || [];
    if (!list.length) return '';
    const max = Math.max(...list.map((t) => t.approxUsd), 0.0001);
    const items = list
      .slice(0, 10)
      .map(
        (t) => `
        <div class="cost-tool-row">
          <span class="tool-name">${escapeHtml(t.tool)} <span class="cost-rate">${t.count}×</span></span>
          <span>${escapeHtml(t.approxUsdFormatted)} · ${escapeHtml(t.approxTokensFormatted)}</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width: ${((t.approxUsd / max) * 100).toFixed(1)}%"></div></div>`,
      )
      .join('');
    return `<h2>Cost by tool <span class="cost-rate">approx</span></h2>${items}`;
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
    const rate = s.costPerHourFormatted ? `<span class="cost-rate">${escapeHtml(s.costPerHourFormatted)}/hr</span>` : '';
    const cacheHit = s.cacheHitRatePctFormatted
      ? `<span class="cost-rate" title="cache reads / (cache reads + input)">cache ${escapeHtml(s.cacheHitRatePctFormatted)}</span>`
      : '';
    return `
      <h2>Cost <span class="model-tag">${escapeHtml(s.modelFamily || 'unknown')}</span> ${rate} ${cacheHit}</h2>
      <div class="kv">
        <span class="k">Total</span><span class="v cost-total">${escapeHtml(s.cost.totalUsdFormatted)}</span>
        <span class="k">Input</span><span class="v">${escapeHtml(s.cost.inputUsdFormatted)}</span>
        <span class="k">Output</span><span class="v">${escapeHtml(s.cost.outputUsdFormatted)}</span>
        <span class="k">Cache read</span><span class="v">${escapeHtml(s.cost.cacheReadUsdFormatted)}</span>
        <span class="k">Cache write</span><span class="v">${escapeHtml(s.cost.cacheCreationUsdFormatted)}</span>
      </div>
    `;
  }

  function contextFillSection(s) {
    if (!s.contextWindowMax) return '';
    const pct = Math.max(0, Math.min(100, s.contextFillPct));
    const tone = pct > 90 ? 'danger' : pct > 70 ? 'warn' : 'ok';
    return `
      <h2>Context window <span class="cost-rate">${escapeHtml(s.contextFillPctFormatted)} of ${escapeHtml(s.contextWindowMaxFormatted)}</span></h2>
      <div class="bar context-bar"><div class="bar-fill bar-${tone}" style="width: ${pct.toFixed(1)}%"></div></div>
    `;
  }

  function toolHistorySection(s) {
    const list = s.toolHistory || [];
    if (!list.length) return '';
    const items = list
      .slice(0, 20)
      .map((h) => {
        const t = h.timestamp ? new Date(h.timestamp) : null;
        const time = t && !isNaN(t.getTime())
          ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—';
        const dot = h.result === 'ok' ? '✓' : h.result === 'error' ? '✗' : '·';
        const cls = h.result === 'error' ? 'tool-error' : h.result === 'ok' ? 'tool-ok' : 'tool-pending';
        return `<li>
          <div class="row">
            <span class="left activity-summary"><span class="${cls}">${dot}</span> <strong>${escapeHtml(h.tool)}</strong> ${escapeHtml(h.argsSummary)}</span>
            <span class="right activity-time">${escapeHtml(time)}</span>
          </div>
          ${h.errorMessage ? `<div style="color: var(--vscode-errorForeground); font-size: 11px; margin-top: 2px;">${escapeHtml(h.errorMessage)}</div>` : ''}
        </li>`;
      })
      .join('');
    return `<h2>Tool decisions</h2><ul class="list">${items}</ul>`;
  }

  function claudeMdSection(snap) {
    const list = snap.claudeMdStack || [];
    if (!list.length) return '';
    const items = list
      .map((c) => `
        <li>
          <div class="row">
            <a class="left link" data-open-file="${escapeHtml(c.path)}" title="${escapeHtml(c.path)}"><span class="tag">${escapeHtml(c.scope)}</span> ${escapeHtml(c.path)}</a>
            <span class="right">${escapeHtml(c.sizeFormatted)}</span>
          </div>
        </li>`)
      .join('');
    return `<h2>CLAUDE.md stack (${list.length})</h2><ul class="list">${items}</ul>`;
  }

  function officeSection(snap) {
    const o = snap.office;
    if (!o) return '';
    const status = o.installPath ? `installed @ <code>${escapeHtml(o.installPath)}</code>` : 'not installed';
    const hookBadge = o.hookConfigured ? '<span class="tag">hook configured</span>' : '';
    const launchBtn = o.installPath
      ? `<button class="office-btn" data-launch-office="${escapeHtml(o.installPath)}">Launch (make dev-tmux)</button>
         <button class="office-btn" data-open-url="http://localhost:${o.port}">Open browser → :${o.port}</button>`
      : `<button class="office-btn" data-open-url="https://github.com/paulrobello/claude-office">Install instructions ↗</button>`;
    return `
      <h2>Office visualizer ${hookBadge}</h2>
      <p class="empty" style="margin: 0 0 6px;">${status}</p>
      <div class="actions">${launchBtn}</div>
    `;
  }

  function toolHistogramSection(s) {
    const list = s.toolHistogram || [];
    if (!list.length) return '';
    const max = Math.max(...list.map((t) => t.count), 1);
    const items = list
      .slice(0, 12)
      .map(
        (t) => `
        <li>
          <div class="row">
            <span class="left">${escapeHtml(t.tool)}</span>
            <span class="right">${t.count}</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width: ${((t.count / max) * 100).toFixed(1)}%"></div></div>
        </li>`,
      )
      .join('');
    return `<h2>Tool usage</h2><ul class="list bars">${items}</ul>`;
  }

  function activityFeedSection(s) {
    const list = s.activityFeed || [];
    if (!list.length) return '';
    const items = list
      .slice(0, 20)
      .map((a) => {
        const t = a.timestamp ? new Date(a.timestamp) : null;
        const time = t && !isNaN(t.getTime())
          ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '—';
        return `<li>
          <div class="row">
            <span class="left activity-summary" title="${escapeHtml(a.summary)}">${escapeHtml(a.summary)}</span>
            <span class="right activity-time">${escapeHtml(time)}</span>
          </div>
        </li>`;
      })
      .join('');
    return `<h2>Recent activity</h2><ul class="list">${items}</ul>`;
  }

  function todaySection(snap) {
    const t = snap.today;
    if (!t || t.sessions === 0) return '';
    const perProj = (t.perProject || [])
      .slice(0, 8)
      .map(
        (p) => `<li>
          <div class="row">
            <span class="left">${escapeHtml(p.name)}</span>
            <span class="right">${escapeHtml(p.tokensFormatted)} · ${escapeHtml(p.usdFormatted)}</span>
          </div>
        </li>`,
      )
      .join('');
    const topFiles = (t.topFiles || [])
      .slice(0, 5)
      .map(
        (f) => `<li>
          <div class="row">
            <a class="left link" data-open-file="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">${escapeHtml(basename(f.path))}</a>
            <span class="right">${f.touches}×</span>
          </div>
        </li>`,
      )
      .join('');
    const topTools = (t.topTools || [])
      .slice(0, 5)
      .map(
        (tt) => `<li>
          <div class="row">
            <span class="left">${escapeHtml(tt.tool)}</span>
            <span class="right">${tt.count}×</span>
          </div>
        </li>`,
      )
      .join('');
    return `
      <h2>Today across all projects</h2>
      <div class="today-pill">
        <span><strong>${t.sessions}</strong> session${t.sessions === 1 ? '' : 's'}</span>
        <span><strong>${escapeHtml(t.totalTokensFormatted)}</strong> tokens</span>
        <span><strong>${escapeHtml(t.totalUsdFormatted)}</strong></span>
      </div>
      ${perProj ? `<h3 class="sub-h">By project</h3><ul class="list">${perProj}</ul>` : ''}
      ${topFiles ? `<h3 class="sub-h">Top files</h3><ul class="list">${topFiles}</ul>` : ''}
      ${topTools ? `<h3 class="sub-h">Top tools</h3><ul class="list">${topTools}</ul>` : ''}
    `;
  }

  function diskUsageSection(snap) {
    return `
      <h2>Disk usage</h2>
      <div class="kv">
        <span class="k">~/.claude/projects/</span><span class="v">${escapeHtml(snap.diskUsageBytesFormatted)}</span>
      </div>
    `;
  }

  function entryRow(e) {
    const icon = e.isDirectory ? '▸' : '·';
    const meta = `${escapeHtml(e.sizeFormatted)} · ${escapeHtml(fmtRelative(e.lastModifiedAt))}`;
    return `
      <li>
        <div class="row">
          <a class="left link entry-name" data-reveal="${escapeHtml(e.path)}" title="${escapeHtml(e.path)}">${icon} ${escapeHtml(e.name)}</a>
          <span class="right">${meta}</span>
        </div>
      </li>
    `;
  }

  function filesSection(snap) {
    const layout = snap.localLayout;
    if (!layout) return '<p class="empty">No layout data available.</p>';
    const motherList = layout.motherEntries.map(entryRow).join('');
    const sessionBlock = layout.sessionFolder
      ? `
        <h2>Active session folder</h2>
        <div class="kv">
          <span class="k">path</span><span class="v"><a class="link" data-reveal="${escapeHtml(layout.sessionFolder)}" title="reveal in OS">${escapeHtml(layout.sessionFolder)}</a></span>
        </div>
        <ul class="list">${layout.sessionEntries.map(entryRow).join('')}</ul>
      `
      : '<h2>Active session folder</h2><p class="empty">No active session.</p>';
    const quickLinks = [];
    if (layout.activeSessionFile) {
      quickLinks.push(`<li><a class="link" data-open-file="${escapeHtml(layout.activeSessionFile)}" title="open in editor">▸ active session JSONL</a></li>`);
    }
    if (layout.globalSettingsFile) {
      quickLinks.push(`<li><a class="link" data-reveal="${escapeHtml(layout.globalSettingsFile)}" title="reveal in OS">▸ ~/.claude/settings.json</a></li>`);
    }
    const quickBlock = quickLinks.length
      ? `<h2>Quick open</h2><ul class="list">${quickLinks.join('')}</ul>`
      : '';
    return `
      ${quickBlock}
      <h2>Mother folder</h2>
      <div class="kv">
        <span class="k">path</span><span class="v"><a class="link" data-reveal="${escapeHtml(layout.motherFolder)}" title="reveal in OS">${escapeHtml(layout.motherFolder)}</a></span>
      </div>
      <ul class="list">${motherList}</ul>
      ${sessionBlock}
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
    const usedCount = list.filter((sk) => sk.useCount > 0).length;
    return `
      <h2>Skills (${list.length}) <span class="cost-rate">${usedCount} used this session</span></h2>
      <input type="search" class="search" data-search="skills" placeholder="Filter skills…" />
      <ul class="list" data-search-target="skills">
        ${list
          .map(
            (sk) => `
        <li data-search-text="${escapeHtml((sk.name + ' ' + sk.description).toLowerCase())}" class="${sk.useCount === 0 ? 'skill-unused' : ''}">
          <div class="row">
            <a class="left link" data-copy-skill="${escapeHtml(sk.name)}" title="Copy /${escapeHtml(sk.name)} to clipboard">/${escapeHtml(sk.name)}</a>
            <span class="right">${sk.useCount > 0 ? `<span class="tag tag-used">${sk.useCount}×</span>` : ''}<span class="tag">${escapeHtml(sk.source)}</span></span>
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
    const pinned = new Set(snap.pinnedMemory || []);
    const staleCount = list.filter((m) => m.isStale).length;
    const pinnedCount = list.filter((m) => pinned.has(m.filename)).length;
    const sorted = [...list].sort((a, b) => {
      const ap = pinned.has(a.filename) ? 1 : 0;
      const bp = pinned.has(b.filename) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.lastModifiedMs || 0) - (a.lastModifiedMs || 0);
    });
    return `
      <h2>Memory (${list.length})${staleCount ? ` <span class="cost-rate">${staleCount} stale</span>` : ''}${pinnedCount ? ` <span class="cost-rate">${pinnedCount} pinned</span>` : ''}</h2>
      ${list.length ? '<input type="search" class="search" data-search="memory" placeholder="Search memory…" />' : ''}
      <ul class="list" data-search-target="memory">
        ${list.length
          ? sorted
              .map((m) => {
                const isPinned = pinned.has(m.filename);
                return `
        <li data-search-text="${escapeHtml((m.title + ' ' + m.hook).toLowerCase())}" class="${isPinned ? 'pinned-row' : ''}">
          <div class="row">
            <a class="left link" data-memory="${escapeHtml(m.filename)}" title="${escapeHtml(m.hook)}">${isPinned ? '📌 ' : ''}${escapeHtml(m.title)}${m.isStale ? ' <span class="tag tag-stale">stale</span>' : ''}</a>
            <span class="right">
              <button class="watch-action" data-${isPinned ? 'unpin' : 'pin'}-mem="${escapeHtml(m.filename)}">${isPinned ? 'unpin' : 'pin'}</button>
              ${escapeHtml(fmtRelative(m.lastModifiedAt))}
            </span>
          </div>
          <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">${escapeHtml(m.hook)}</div>
        </li>`;
              })
              .join('')
          : '<li><span class="empty">No persistent memory yet.</span></li>'}
      </ul>
    `;
  }

  function emptyTabBar(snap) {
    const tabs = [
      { id: 'now', label: 'Now' },
      { id: 'watchtower', label: `Watchtower (${snap.watchtower.length})` },
      { id: 'search', label: 'Search' },
      { id: 'obsidian', label: snap.obsidian && snap.obsidian.installed ? 'Obsidian' : 'Obsidian ◌' },
      { id: 'skills', label: `Skills (${snap.skills.length})` },
      { id: 'projects', label: `Projects (${snap.projects.length})` },
      { id: 'config', label: 'Config' },
    ];
    return tabs;
  }

  function fullTabBar(snap) {
    return [
      { id: 'now', label: 'Now' },
      { id: 'watchtower', label: `Watchtower (${snap.watchtower.length})` },
      { id: 'search', label: 'Search' },
      { id: 'obsidian', label: snap.obsidian && snap.obsidian.installed ? 'Obsidian' : 'Obsidian ◌' },
      { id: 'memory', label: `Memory (${snap.memory.length})` },
      { id: 'prompts', label: `Prompts (${(snap.prompts || []).length})` },
      { id: 'skills', label: `Skills (${snap.skills.length})` },
      { id: 'projects', label: `Projects (${snap.projects.length})` },
      { id: 'files', label: 'Files' },
      { id: 'config', label: 'Config' },
    ];
  }

  function renderTabBar(tabs, activeTab) {
    return `
      <nav class="tabs" role="tablist">
        ${tabs
          .map(
            (t) => `<button class="tab ${t.id === activeTab ? 'tab-active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${t.id === activeTab}">${escapeHtml(t.label)}</button>`,
          )
          .join('')}
      </nav>
    `;
  }

  function render(snap) {
    if (!snap) {
      root.innerHTML = '<p class="empty">Loading…</p>';
      return;
    }
    if (!snap.cwd) {
      const tabs = emptyTabBar(snap);
      const activeTab = getActiveTab();
      const tabBar = renderTabBar(tabs, activeTab);
      let body = '';
      if (activeTab === 'watchtower') body = watchtowerSection(snap);
      else if (activeTab === 'search') body = searchSection(snap);
      else if (activeTab === 'obsidian') body = obsidianSection(snap);
      else if (activeTab === 'skills') body = skillsSection(snap);
      else if (activeTab === 'projects') body = projectsSection(snap);
      else if (activeTab === 'config') body = `${budgetSection(snap)}${settingsSection(snap)}${diskUsageSection(snap)}`;
      else body = `
        ${notificationsSection(snap)}
        ${quickActionsSection(snap)}
        <p class="empty">No Claude Code session for the open folder. Use Watchtower to see other projects, or run <code>claude</code> here to start.</p>
        ${snap.watchtower.length ? watchtowerSection(snap) : ''}
        ${snap.today.sessions ? todaySection(snap) : ''}
      `;
      root.innerHTML = `${tabBar}<div class="tab-panel">${body}</div>`;
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

    const filesTouchedHtml = `
      <h2>Files touched (${s.filesTouched.length})</h2>
      <ul class="list">${fileItems}</ul>
    `;

    const tabs = fullTabBar(snap);
    const activeTab = getActiveTab();
    const tabBar = renderTabBar(tabs, activeTab);

    let body = '';
    if (activeTab === 'now') {
      body = `
        ${notificationsSection(snap)}
        ${pilotSection(snap)}
        ${quickActionsSection(snap)}
        <h2>Active session ${liveDot}</h2>
        <div class="kv">
          <span class="k">project</span><span class="v">${escapeHtml(snap.cwd)}</span>
        </div>
        ${tokens}
        ${contextFillSection(s)}
        ${costSection(s)}
        ${costByToolSection(snap)}
        ${budgetSection(snap)}
        ${session}
        ${claudeMdSection(snap)}
        ${toolHistogramSection(s)}
        ${subAgentsSection(s)}
        ${toolHistorySection(s)}
        ${activityFeedSection(s)}
        ${filesTouchedHtml}
        ${todaySection(snap)}
      `;
    } else if (activeTab === 'watchtower') {
      body = `${watchtowerSection(snap)}${watchtowerSection(snap, { idleOnly: true })}`;
    } else if (activeTab === 'search') {
      body = searchSection(snap);
    } else if (activeTab === 'obsidian') {
      body = obsidianSection(snap);
    } else if (activeTab === 'memory') {
      body = memorySection(snap);
    } else if (activeTab === 'prompts') {
      body = promptsSection(snap);
    } else if (activeTab === 'skills') {
      body = skillsSection(snap);
    } else if (activeTab === 'projects') {
      body = projectsSection(snap);
    } else if (activeTab === 'files') {
      body = filesSection(snap);
    } else if (activeTab === 'config') {
      body = `
        ${budgetSection(snap)}
        ${officeSection(snap)}
        ${settingsSection(snap)}
        ${diskUsageSection(snap)}
      `;
    }

    root.innerHTML = `${tabBar}<div class="tab-panel">${body}</div>`;
    bindEvents();
  }

  function getActiveTab() {
    const state = vscode.getState() || {};
    return state.activeTab || 'now';
  }

  function setActiveTab(id) {
    vscode.setState({ ...(vscode.getState() || {}), activeTab: id });
  }

  function bindEvents() {
    root.querySelectorAll('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab');
        if (!id) return;
        setActiveTab(id);
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action === 'refresh') vscode.postMessage({ type: 'refresh' });
        if (action === 'memory') vscode.postMessage({ type: 'openMemory' });
        if (action === 'session') vscode.postMessage({ type: 'openSessionFile' });
      });
    });

    root.querySelectorAll('button[data-qa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qa = btn.getAttribute('data-qa');
        if (qa === 'search') {
          setActiveTab('search');
          if (lastSnapshot) render(lastSnapshot);
        } else if (qa === 'watchtower') {
          setActiveTab('watchtower');
          if (lastSnapshot) render(lastSnapshot);
        } else if (qa === 'save-obsidian') {
          vscode.postMessage({ type: 'saveToObsidian' });
        } else if (qa === 'open-vault') {
          vscode.postMessage({ type: 'openVault' });
        } else if (qa === 'open-session') {
          vscode.postMessage({ type: 'openSessionFile' });
        } else if (qa === 'set-cap') {
          vscode.postMessage({ type: 'setDailyCap' });
        } else if (qa === 'run-search') {
          const input = root.querySelector('input[data-search-input]');
          if (input && input.value.trim()) {
            vscode.postMessage({ type: 'searchSessions', query: input.value.trim() });
          }
        }
      });
    });

    root.querySelectorAll('button[data-notif-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.getAttribute('data-notif-action');
        if (a === 'openMemory') vscode.postMessage({ type: 'openMemory' });
        else if (a === 'openSession') vscode.postMessage({ type: 'openSessionFile' });
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

    root.querySelectorAll('button[data-pin-mem]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'pinMemory', filename: btn.getAttribute('data-pin-mem') });
      });
    });

    root.querySelectorAll('button[data-unpin-mem]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'unpinMemory', filename: btn.getAttribute('data-unpin-mem') });
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

    root.querySelectorAll('a[data-reveal]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'revealInOS', path: a.getAttribute('data-reveal') });
      });
    });

    root.querySelectorAll('a[data-open-file]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openFile', filePath: a.getAttribute('data-open-file') });
      });
    });

    root.querySelectorAll('button[data-open-url], a[data-open-url]').forEach((el) => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'openExternal', url: el.getAttribute('data-open-url') });
      });
    });

    root.querySelectorAll('button[data-launch-office]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.getAttribute('data-launch-office');
        vscode.postMessage({ type: 'openTerminal', command: `cd "${dir}" && make dev-tmux` });
      });
    });

    root.querySelectorAll('a[data-open-note-vault]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openVaultNote',
          vaultName: a.getAttribute('data-open-note-vault'),
          noteRelPath: a.getAttribute('data-open-note-rel'),
        });
      });
    });

    root.querySelectorAll('a[data-open-vault-byname]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'openVault' });
      });
    });

    root.querySelectorAll('button[data-watch-session]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openFile',
          filePath: btn.getAttribute('data-watch-session'),
        });
      });
    });

    root.querySelectorAll('a[data-go-session]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'goToSession', sessionFile: a.getAttribute('data-go-session') });
      });
    });

    root.querySelectorAll('button[data-prompt-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const titleEl = root.querySelector('input[data-prompt-title]');
        const bodyEl = root.querySelector('textarea[data-prompt-body]');
        if (!titleEl || !bodyEl) return;
        const title = titleEl.value.trim();
        const body = bodyEl.value.trim();
        if (!title || !body) return;
        vscode.postMessage({ type: 'addPrompt', promptTitle: title, promptBody: body });
        titleEl.value = '';
        bodyEl.value = '';
      });
    });

    root.querySelectorAll('button[data-prompt-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-prompt-use');
        const prompt = (lastSnapshot && lastSnapshot.prompts || []).find((p) => p.id === id);
        if (prompt) {
          vscode.postMessage({ type: 'usePrompt', promptBody: prompt.body });
          btn.textContent = 'Copied ✓';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        }
      });
    });

    root.querySelectorAll('button[data-prompt-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'deletePrompt', promptId: btn.getAttribute('data-prompt-delete') });
      });
    });

    const searchInput = root.querySelector('input[data-search-input]');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = searchInput.value.trim();
          if (q) vscode.postMessage({ type: 'searchSessions', query: q });
        }
      });
    }

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

  function onSnapshot(snap) {
    lastSnapshot = snap;
    render(snap);
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'snapshot') {
      onSnapshot(msg.snapshot);
    } else if (msg && msg.type === 'setTab') {
      setActiveTab(msg.tab);
      if (lastSnapshot) render(lastSnapshot);
    }
  });

  vscode.postMessage({ type: 'refresh' });
})();
