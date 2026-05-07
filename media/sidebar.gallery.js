// =============================================================================
// Claude Cockpit — Gallery widgets (Phase 1, sibling script).
// Loaded via plugin.registerSidebarScript('media/sidebar.gallery.js') and
// registered through the Phase-0 bridge (window.cockpit.registerComponent).
//
// Two widgets:
//   - galleryGrid:      list of every local skill + agent with a Share button.
//   - galleryShareCard: HTTPS install + clipboard publish.
//
// State (search query, kind filter, items, install preview) lives on a single
// closure; we call `window.cockpit.requestRender()` after mutations so the
// host re-renders the whole panel using `lastSnapshot`. No coupling with the
// COMPONENTS literal — siblings are append-only via EXTERNAL_COMPONENTS.
// =============================================================================
(function () {
  if (!window.cockpit || typeof window.cockpit.registerComponent !== 'function') {
    return;
  }

  // -------- Local state (per webview lifetime). --------
  const state = {
    items: null,                 // GalleryItem[] | null — loaded on demand.
    loading: false,
    error: null,
    query: '',
    kind: 'all',                 // 'all' | 'skill' | 'agent'
    install: {
      url: '',
      preview: null,             // InstallPreview | null
      busy: false,
      error: null,
      success: null,             // { filePath, sha256 } after a confirmed install
    },
    lastShareLabel: null,
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function matchesFilter(item) {
    if (state.kind === 'skill' && item.kind !== 'skill-user' && item.kind !== 'skill-plugin') return false;
    if (state.kind === 'agent' && item.kind !== 'agent') return false;
    if (state.query) {
      const q = state.query.toLowerCase();
      const hay = `${item.name} ${item.description} ${item.origin}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function kindLabel(kind) {
    if (kind === 'skill-user') return 'user';
    if (kind === 'skill-plugin') return 'plugin';
    if (kind === 'agent') return 'agent';
    return kind;
  }

  // -------- galleryGrid render --------
  function galleryGridSection() {
    const counts = (window.cockpit.getSnapshot && window.cockpit.getSnapshot()) || {};
    const summary = counts.gallery || { skillCount: 0, agentCount: 0, totalCount: 0 };
    const header = `
      <div class="cockpit-gallery-header">
        <h2>Skills + agents</h2>
        <span class="cockpit-gallery-summary">${summary.skillCount} skills · ${summary.agentCount} agents</span>
      </div>
    `;

    if (state.items === null) {
      // Lazy load on first render.
      if (!state.loading) {
        state.loading = true;
        window.cockpit.postMessage({ type: 'gallery.openLocal' });
      }
      return `${header}<p class="empty">Loading gallery…</p>`;
    }
    if (state.error) {
      return `${header}<p class="empty">Gallery error: ${escapeHtml(state.error)}</p>`;
    }
    const filtered = state.items.filter(matchesFilter);
    const filterRow = `
      <div class="cockpit-gallery-filters">
        <input
          type="search"
          class="cockpit-gallery-search"
          placeholder="Filter by name, description, or origin"
          value="${escapeHtml(state.query)}"
          data-gallery-action="search"
        />
        <div class="cockpit-gallery-chips">
          ${['all', 'skill', 'agent'].map((k) => `
            <button
              class="cockpit-gallery-chip${state.kind === k ? ' is-active' : ''}"
              data-gallery-action="filter"
              data-gallery-kind="${k}"
            >${k === 'all' ? 'All' : k === 'skill' ? 'Skills' : 'Agents'}</button>
          `).join('')}
        </div>
      </div>
    `;
    if (filtered.length === 0) {
      return `${header}${filterRow}<p class="empty">No gallery items match this filter.</p>`;
    }
    const rows = filtered
      .slice(0, 200)
      .map((item) => `
        <li class="cockpit-gallery-row">
          <div class="cockpit-gallery-row-main">
            <div class="cockpit-gallery-row-name">${escapeHtml(item.name)}</div>
            <div class="cockpit-gallery-row-meta">
              <span class="cockpit-gallery-tag cockpit-gallery-tag--${escapeHtml(item.kind)}">${escapeHtml(kindLabel(item.kind))}</span>
              <span class="cockpit-gallery-origin">${escapeHtml(item.origin)}</span>
              ${item.useCount > 0 ? `<span class="cockpit-gallery-usecount">${item.useCount}× used</span>` : ''}
            </div>
            ${item.description ? `<div class="cockpit-gallery-row-desc">${escapeHtml(item.description)}</div>` : ''}
          </div>
          <div class="cockpit-gallery-row-actions">
            <button class="cockpit-gallery-btn" data-gallery-action="share" data-gallery-id="${escapeHtml(item.id)}">Share</button>
            <button class="cockpit-gallery-btn" data-gallery-action="open" data-gallery-id="${escapeHtml(item.id)}">Open</button>
          </div>
        </li>
      `).join('');
    return `
      ${header}
      ${filterRow}
      <ul class="cockpit-gallery-list">${rows}</ul>
    `;
  }

  // -------- galleryShareCard render --------
  function galleryShareCardSection() {
    const ins = state.install;
    let previewBlock = '';
    if (ins.preview) {
      previewBlock = `
        <div class="cockpit-gallery-preview">
          <div class="cockpit-gallery-preview-row"><span class="cockpit-gallery-preview-key">URL</span><span class="cockpit-gallery-preview-val">${escapeHtml(ins.preview.url)}</span></div>
          <div class="cockpit-gallery-preview-row"><span class="cockpit-gallery-preview-key">SHA256</span><span class="cockpit-gallery-preview-val cockpit-gallery-mono">${escapeHtml(ins.preview.sha256)}</span></div>
          <div class="cockpit-gallery-preview-row"><span class="cockpit-gallery-preview-key">Bytes</span><span class="cockpit-gallery-preview-val">${ins.preview.bytes}</span></div>
          <div class="cockpit-gallery-preview-row"><span class="cockpit-gallery-preview-key">Will install as</span><span class="cockpit-gallery-preview-val cockpit-gallery-mono">~/.claude/skills/${escapeHtml(ins.preview.inferredName)}/SKILL.md</span></div>
          <details class="cockpit-gallery-excerpt">
            <summary>First 1KB</summary>
            <pre>${escapeHtml(ins.preview.excerpt)}</pre>
          </details>
          <div class="cockpit-gallery-actions">
            <button class="cockpit-gallery-btn cockpit-gallery-btn--primary" data-gallery-action="install-confirm" ${ins.busy ? 'disabled' : ''}>Confirm install</button>
            <button class="cockpit-gallery-btn" data-gallery-action="install-cancel">Cancel</button>
          </div>
        </div>
      `;
    }
    const errorBlock = ins.error
      ? `<p class="cockpit-gallery-error">${escapeHtml(ins.error)}</p>`
      : '';
    const successBlock = ins.success
      ? `<p class="cockpit-gallery-success">Installed: ${escapeHtml(ins.success.filePath)}</p>`
      : '';
    return `
      <div class="cockpit-gallery-share-card">
        <h2>Install / publish</h2>
        <p class="cockpit-gallery-hint">Install a skill from any HTTPS URL (GitHub raw or a registry mirror). Cockpit shows the SHA256 + a 1KB preview before writing anything to <code>~/.claude/skills/</code>.</p>
        <div class="cockpit-gallery-install-row">
          <input
            type="url"
            class="cockpit-gallery-install-input"
            placeholder="https://raw.githubusercontent.com/.../SKILL.md"
            value="${escapeHtml(ins.url)}"
            data-gallery-action="install-url"
          />
          <button class="cockpit-gallery-btn" data-gallery-action="install-preview" ${ins.busy ? 'disabled' : ''}>Preview</button>
        </div>
        ${errorBlock}
        ${successBlock}
        ${previewBlock}
        <hr class="cockpit-gallery-sep" />
        <p class="cockpit-gallery-hint">Want to publish your own skill? The Share button on each row copies a portable manifest to your clipboard. Open the cockpit-skills issue template and paste — that's the v1.0 publish path.</p>
        <button class="cockpit-gallery-btn" data-gallery-action="open-publish">Open publish issue template</button>
      </div>
    `;
  }

  // -------- Register both widgets via the Phase-0 bridge. --------
  window.cockpit.registerComponent('galleryGrid', {
    label: 'Skill / agent gallery',
    category: 'Gallery',
    requiresCwd: false,
    render: () => galleryGridSection(),
  });
  window.cockpit.registerComponent('galleryShareCard', {
    label: 'Gallery · share / install',
    category: 'Gallery',
    requiresCwd: false,
    render: () => galleryShareCardSection(),
  });

  // -------- Single document-level click handler (event delegation). --------
  // We bind once; sidebar.js's render() blows away DOM but our listener stays
  // on `document`. Each render emits data-gallery-action attributes that we
  // dispatch from here — no coupling with sidebar.js's bindEvents.
  document.addEventListener('click', (evt) => {
    const target = evt.target instanceof Element ? evt.target.closest('[data-gallery-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-gallery-action');
    if (!action) return;
    if (action === 'filter') {
      const k = target.getAttribute('data-gallery-kind') || 'all';
      state.kind = k;
      window.cockpit.requestRender();
      return;
    }
    if (action === 'share') {
      const id = target.getAttribute('data-gallery-id');
      if (!id) return;
      window.cockpit.postMessage({ type: 'gallery.share', galleryId: id });
      state.lastShareLabel = id;
      return;
    }
    if (action === 'open') {
      const id = target.getAttribute('data-gallery-id');
      if (!id) return;
      window.cockpit.postMessage({ type: 'gallery.openItem', galleryId: id });
      return;
    }
    if (action === 'install-preview') {
      const value = (state.install.url || '').trim();
      if (!value) {
        state.install.error = 'Paste an HTTPS URL first';
        window.cockpit.requestRender();
        return;
      }
      state.install.busy = true;
      state.install.error = null;
      state.install.success = null;
      state.install.preview = null;
      window.cockpit.requestRender();
      window.cockpit.postMessage({ type: 'gallery.installPreview', galleryUrl: value });
      return;
    }
    if (action === 'install-confirm') {
      if (!state.install.preview) return;
      state.install.busy = true;
      state.install.error = null;
      window.cockpit.requestRender();
      window.cockpit.postMessage({
        type: 'gallery.installConfirm',
        galleryUrl: state.install.preview.url,
        gallerySha256: state.install.preview.sha256,
      });
      return;
    }
    if (action === 'install-cancel') {
      state.install.preview = null;
      state.install.error = null;
      state.install.success = null;
      state.install.busy = false;
      window.cockpit.requestRender();
      return;
    }
    if (action === 'open-publish') {
      window.cockpit.postMessage({ type: 'gallery.openPublishIssue' });
      return;
    }
  });

  // Search input: debounced via input event.
  let searchDebounce;
  document.addEventListener('input', (evt) => {
    const target = evt.target instanceof Element ? evt.target.closest('[data-gallery-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-gallery-action');
    if (action === 'search') {
      const value = target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.query = value;
        window.cockpit.requestRender();
      }, 120);
    } else if (action === 'install-url') {
      state.install.url = target.value;
      // No re-render — input keeps focus.
    }
  });

  // -------- Receive responses from the host. --------
  window.addEventListener('message', (evt) => {
    const msg = evt && evt.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'gallery.localItems') {
      state.items = Array.isArray(msg.items) ? msg.items : [];
      state.loading = false;
      state.error = null;
      window.cockpit.requestRender();
    } else if (msg.type === 'gallery.localError') {
      state.error = String(msg.error || 'unknown error');
      state.loading = false;
      window.cockpit.requestRender();
    } else if (msg.type === 'gallery.installPreview') {
      state.install.busy = false;
      state.install.preview = msg.preview || null;
      state.install.error = msg.error ? String(msg.error) : null;
      window.cockpit.requestRender();
    } else if (msg.type === 'gallery.installResult') {
      state.install.busy = false;
      if (msg.error) {
        state.install.error = String(msg.error);
        state.install.success = null;
      } else {
        state.install.error = null;
        state.install.success = { filePath: msg.filePath, sha256: msg.sha256 };
        state.install.preview = null;
        // Refresh local items so the freshly installed skill shows up.
        state.items = null;
      }
      window.cockpit.requestRender();
    }
  });
})();
