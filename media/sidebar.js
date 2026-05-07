(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let lastSnapshot = null;
  let minedPromptsState = null; // { prompts: MinedPrompt[], selected: Set<fingerprint> }

  const PROMPT_CATEGORIES = ['legal', 'build', 'review', 'plan', 'research', 'infra', 'other'];
  const PROMPT_CATEGORY_LABELS = {
    all: 'All',
    legal: 'Legal',
    build: 'Build',
    review: 'Review',
    plan: 'Plan',
    research: 'Research',
    infra: 'Infra',
    other: 'Other',
  };

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

  function fmtBytes(gb) {
    if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${(gb * 1000).toFixed(0)} MB`;
  }

  function fmtSeconds(s) {
    if (!s) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function macHealthSection(snap) {
    const m = snap.macHealth;
    if (!m || !m.available) {
      return `
        <h2>Mac Health</h2>
        <p class="empty">Mac-specific metrics only available on macOS.</p>
      `;
    }
    if (!m.disk && !m.memory && !m.battery && !m.cpu) {
      return `
        <h2>Mac Health</h2>
        <p class="empty">Probing system… refresh in a moment.</p>
      `;
    }
    const healthBadge = `<span class="health-badge health-${escapeHtml(m.overallHealth)}">${escapeHtml(m.overallHealth)}</span>`;
    const cards = [];
    if (m.disk) {
      const tone = m.disk.usedPct > 90 ? 'danger' : m.disk.usedPct > 75 ? 'warn' : 'ok';
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">Macintosh HD</div>
          <div class="mac-card-value">${fmtBytes(m.disk.availableGb)} free</div>
          <div class="bar"><div class="bar-fill bar-${tone}" style="width: ${m.disk.usedPct.toFixed(1)}%"></div></div>
          <div class="mac-card-sub">${escapeHtml(m.disk.usedPct.toFixed(0))}% used of ${fmtBytes(m.disk.totalGb)}</div>
        </div>`);
    }
    if (m.memory) {
      const tone = m.memory.pressurePct > 90 ? 'danger' : m.memory.pressurePct > 75 ? 'warn' : 'ok';
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">Memory</div>
          <div class="mac-card-value">${m.memory.pressurePct.toFixed(0)}% pressure</div>
          <div class="bar"><div class="bar-fill bar-${tone}" style="width: ${m.memory.pressurePct.toFixed(1)}%"></div></div>
          <div class="mac-card-sub">${fmtBytes(m.memory.appUsedGb)} app · ${fmtBytes(m.memory.wiredGb)} wired · ${fmtBytes(m.memory.totalGb)} total</div>
        </div>`);
    }
    if (m.battery) {
      const charge = m.battery.fullyCharged
        ? 'Fully charged'
        : m.battery.isCharging
          ? `Charging${m.battery.timeRemaining ? ' · ' + m.battery.timeRemaining : ''}`
          : m.battery.isPluggedIn
            ? 'Plugged in'
            : `On battery${m.battery.timeRemaining ? ' · ' + m.battery.timeRemaining + ' left' : ''}`;
      const tone = m.battery.pct > 50 ? 'ok' : m.battery.pct > 20 ? 'warn' : 'danger';
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">Battery ${m.battery.isCharging ? '⚡' : ''}</div>
          <div class="mac-card-value">${m.battery.pct}%</div>
          <div class="bar"><div class="bar-fill bar-${tone}" style="width: ${m.battery.pct}%"></div></div>
          <div class="mac-card-sub">${escapeHtml(charge)}</div>
        </div>`);
    }
    if (m.cpu) {
      const tone = m.cpu.loadPct1 > 200 ? 'danger' : m.cpu.loadPct1 > 100 ? 'warn' : 'ok';
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">CPU</div>
          <div class="mac-card-value">${m.cpu.loadPct1.toFixed(0)}% load</div>
          <div class="bar"><div class="bar-fill bar-${tone}" style="width: ${Math.min(100, m.cpu.loadPct1).toFixed(1)}%"></div></div>
          <div class="mac-card-sub">${m.cpu.loadAvg1.toFixed(2)} · ${m.cpu.loadAvg5.toFixed(2)} · ${m.cpu.loadAvg15.toFixed(2)} on ${m.cpu.cores} cores</div>
        </div>`);
    }
    if (m.network) {
      const wifi = m.network.ssid ? `${m.network.ssid}` : m.network.interfaceName;
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">Network · ${escapeHtml(wifi)}</div>
          <div class="mac-card-value">${m.network.rxKbps.toFixed(0)} ↓ / ${m.network.txKbps.toFixed(0)} ↑ KB/s</div>
          <div class="mac-card-sub">interface: ${escapeHtml(m.network.interfaceName)}</div>
        </div>`);
    }
    if (m.cpu && m.cpu.uptime) {
      cards.push(`
        <div class="mac-card">
          <div class="mac-card-label">Uptime</div>
          <div class="mac-card-value">${m.cpu.uptime.days}d ${m.cpu.uptime.hours}h ${m.cpu.uptime.minutes}m</div>
          <div class="mac-card-sub">${escapeHtml(m.hostname)}${m.model ? ' · ' + escapeHtml(m.model) : ''}</div>
        </div>`);
    }

    const drives = (m.externalDrives || [])
      .map(
        (d) => `
        <div class="mac-card">
          <div class="mac-card-label">${escapeHtml(d.name)}</div>
          <div class="mac-card-value">${fmtBytes(d.availableGb)} free</div>
          <div class="bar"><div class="bar-fill bar-${d.usedPct > 90 ? 'danger' : d.usedPct > 75 ? 'warn' : 'ok'}" style="width: ${d.usedPct.toFixed(1)}%"></div></div>
          <div class="mac-card-sub">${d.usedPct.toFixed(0)}% used of ${fmtBytes(d.totalGb)}</div>
        </div>`,
      )
      .join('');

    const bt = (m.bluetooth || [])
      .map((d) => {
        const pct = typeof d.battery === 'number' ? d.battery : undefined;
        const ringColor = pct === undefined
          ? 'var(--vscode-editorWidget-border)'
          : pct > 50
            ? '#6ad48f'
            : pct > 20
              ? '#ffa05a'
              : '#e36161';
        return `
          <div class="bt-device">
            <div class="bt-ring" style="--pct: ${pct ?? 0}; --ring: ${ringColor};"></div>
            <div class="bt-name">${escapeHtml(d.name)}</div>
            <div class="bt-meta">${pct !== undefined ? pct + '%' : (d.connected ? 'connected' : 'disconnected')}${d.kind ? ' · ' + escapeHtml(d.kind) : ''}</div>
          </div>`;
      })
      .join('');

    return `
      <h2>Mac Health ${healthBadge}</h2>
      <div class="mac-grid">${cards.join('')}</div>
      ${systemStatsSection(m)}
      ${drives ? `<h3 class="sub-h">External drives</h3><div class="mac-grid">${drives}</div>` : ''}
      ${bt ? `<h3 class="sub-h">Bluetooth peripherals</h3><div class="bt-grid">${bt}</div>` : ''}
      ${appUsageSection(snap)}
    `;
  }

  // === System Stats — rich detail cards (CPU/Memory/Energy/Disk/Network) ===
  // Inline icons live on the cards themselves. Tone uses the same thresholds as
  // the existing summary cards above (disk 75/90, memory 75/90, battery <15
  // unplugged = bad, CPU load 100/200) so colors stay consistent.
  const STAT_ICONS = {
    cpu:    '<svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><line x1="9" y1="2" x2="9" y2="6"/><line x1="15" y1="2" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="22"/><line x1="15" y1="18" x2="15" y2="22"/><line x1="2" y1="9" x2="6" y2="9"/><line x1="2" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="22" y2="9"/><line x1="18" y1="15" x2="22" y2="15"/></svg>',
    memory: '<svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="20" height="9" rx="1"/><line x1="6" y1="18" x2="6" y2="21"/><line x1="10" y1="18" x2="10" y2="21"/><line x1="14" y1="18" x2="14" y2="21"/><line x1="18" y1="18" x2="18" y2="21"/></svg>',
    battery:'<svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/></svg>',
    disk:   '<svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>',
    net:    '<svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
  };

  function pctBar(parts) {
    return `<div class="stat-stack">${parts
      .filter((p) => p && p.pct > 0)
      .map((p) => `<span class="${p.cls}" style="width: ${p.pct.toFixed(2)}%"></span>`)
      .join('')}</div>`;
  }

  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fmt0(n) { return Math.round(n).toString(); }

  function systemStatsSection(m) {
    if (!m || !m.available) return '';
    const cpu = m.cpu || {};
    const md = m.memoryDetail;
    const energy = m.energy;
    const volumes = m.volumes || [];
    const ifaces = m.interfaces || [];

    // CPU card
    const userPct = typeof cpu.userPct === 'number' ? cpu.userPct : 0;
    const sysPct = typeof cpu.sysPct === 'number' ? cpu.sysPct : 0;
    const idlePct = typeof cpu.idlePct === 'number' ? cpu.idlePct : 100;
    const usedPct = Math.max(0, Math.min(100, userPct + sysPct));
    const cpuTone = (cpu.loadPct1 || 0) > 200 ? 'bad' : (cpu.loadPct1 || 0) > 100 ? 'warn' : 'ok';
    const cpuModel = cpu.model ? escapeHtml(cpu.model) : '';
    const cpuSub = `user ${fmt1(userPct)}% · sys ${fmt1(sysPct)}%${
      cpu.physicalCores ? ` · cores ${cpu.physicalCores}p/${cpu.cores || ''}` : ''
    }${cpu.model ? ` · ${escapeHtml(cpu.model)}` : ''}`;
    const cpuCard = `
      <div class="stat-card" data-stat-card="cpu" ${cpuModel ? `data-cpu-model="${cpuModel}"` : ''} ${cpuModel ? 'title="Click to copy CPU model"' : ''}>
        <div class="stat-card-head">${STAT_ICONS.cpu}<span class="stat-card-label">CPU</span></div>
        <div class="stat-card-value tone-${cpuTone}">${fmt0(usedPct)}%</div>
        ${pctBar([
          { cls: 'seg-user', pct: userPct },
          { cls: 'seg-sys', pct: sysPct },
          { cls: 'seg-idle', pct: idlePct },
        ])}
        <div class="stat-card-sub">${cpuSub}</div>
      </div>`;

    // Memory card
    let memCard = '';
    if (md) {
      const total = md.totalMb || 1;
      const wiredPct = (md.wiredMb / total) * 100;
      const activePct = (md.activeMb / total) * 100;
      const compressedPct = (md.compressedMb / total) * 100;
      const freePct = Math.max(0, 100 - wiredPct - activePct - compressedPct);
      const pressurePct = (m.memory && m.memory.pressurePct) || (wiredPct + activePct + compressedPct);
      const memTone = pressurePct > 90 ? 'bad' : pressurePct > 75 ? 'warn' : 'ok';
      const swap = md.swapTotalMb > 0
        ? ` · swap ${fmt1(md.swapUsedMb / 1024)}/${fmt1(md.swapTotalMb / 1024)}gb`
        : '';
      memCard = `
        <div class="stat-card" data-stat-card="memory">
          <div class="stat-card-head">${STAT_ICONS.memory}<span class="stat-card-label">Memory</span></div>
          <div class="stat-card-value tone-${memTone}">${fmt0(pressurePct)}%</div>
          ${pctBar([
            { cls: 'seg-wired', pct: wiredPct },
            { cls: 'seg-active', pct: activePct },
            { cls: 'seg-compressed', pct: compressedPct },
            { cls: 'seg-free', pct: freePct },
          ])}
          <div class="stat-card-sub">wired ${fmt1(md.wiredMb / 1024)}gb · active ${fmt1(md.activeMb / 1024)}gb · compressed ${fmt1(md.compressedMb / 1024)}gb${swap}</div>
        </div>`;
    }

    // Energy card
    let energyCard = '';
    if (m.battery) {
      const pct = m.battery.pct;
      const onAc = (energy && energy.source === 'AC') || m.battery.isPluggedIn;
      const tone = !onAc && pct < 15 ? 'bad' : pct < 30 ? 'warn' : 'ok';
      const cycle = energy && typeof energy.cycleCount === 'number' ? `cycle ${energy.cycleCount}` : '';
      const health = energy && typeof energy.healthPct === 'number' ? `health ${energy.healthPct}%` : '';
      const remaining = (energy && energy.timeRemaining) || m.battery.timeRemaining || '';
      const watt = energy && energy.acWattage ? `${energy.acWattage}W` : '';
      const subBits = [
        cycle, health, onAc ? 'src AC' : 'src Batt',
        remaining ? `${remaining} remaining` : '',
      ].filter(Boolean).join(' · ');
      const pill = onAc
        ? `<span class="stat-pill">${watt || 'AC'}${m.battery.isCharging ? ' · charging' : ''}</span>`
        : '';
      energyCard = `
        <div class="stat-card" data-stat-card="energy">
          <div class="stat-card-head">${STAT_ICONS.battery}<span class="stat-card-label">Energy</span>${pill}</div>
          <div class="stat-card-value tone-${tone}">${pct}%</div>
          <div class="stat-stack"><span class="seg-active" style="width: ${pct}%"></span><span class="seg-free" style="width: ${100 - pct}%"></span></div>
          <div class="stat-card-sub">${escapeHtml(subBits || '—')}</div>
        </div>`;
    }

    // Disk card (uses existing m.disk for headline; volumes for the list)
    let diskCard = '';
    if (m.disk) {
      const pct = m.disk.usedPct;
      const tone = pct > 90 ? 'bad' : pct > 75 ? 'warn' : 'ok';
      const volRows = volumes.length
        ? volumes.map((v) => {
            return `<div class="stat-mini-row" title="${escapeHtml(v.mount)}">
              <span style="flex-shrink:0; max-width: 50%; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(v.mount)}</span>
              <span class="stat-mini-bar"><span style="width: ${v.pct.toFixed(1)}%"></span></span>
              <span style="flex-shrink:0;">${fmt1(v.freeGb)}gb free</span>
            </div>`;
          }).join('')
        : '';
      diskCard = `
        <div class="stat-card" data-stat-card="disk">
          <div class="stat-card-head">${STAT_ICONS.disk}<span class="stat-card-label">Disk</span></div>
          <div class="stat-card-value tone-${tone}">${fmt0(pct)}%</div>
          <div class="stat-card-sub">${fmt1(m.disk.availableGb)}gb free of ${fmt1(m.disk.totalGb)}gb</div>
          ${volRows}
        </div>`;
    }

    // Network card
    let netCard = '';
    if (m.network) {
      const total = m.network.rxKbps + m.network.txKbps;
      const tone = 'ok';
      const ifaceRows = ifaces.length
        ? ifaces.map((i) => `<div class="stat-mini-row"><span>${escapeHtml(i.name)}</span><span>${escapeHtml(i.ipv4 || '—')}</span></div>`).join('')
        : '';
      const ssid = m.network.ssid ? escapeHtml(m.network.ssid) : '—';
      const primaryIp = (ifaces.find((i) => i.name === m.network.interfaceName) || {}).ipv4 || '';
      netCard = `
        <div class="stat-card" data-stat-card="network">
          <div class="stat-card-head">${STAT_ICONS.net}<span class="stat-card-label">Network</span></div>
          <div class="stat-card-value tone-${tone}">${fmt0(total)}<span style="font-size:11px; color: var(--vscode-descriptionForeground);"> kb/s</span></div>
          <div class="stat-card-sub">${escapeHtml(m.network.interfaceName)} · ${ssid}${primaryIp ? ' · ' + escapeHtml(primaryIp) : ''}</div>
          ${ifaceRows}
        </div>`;
    }

    const all = [cpuCard, memCard, energyCard, diskCard, netCard].filter(Boolean).join('');
    if (!all) return '';
    return `<h3 class="sub-h">System stats</h3><div class="stat-grid">${all}</div>`;
  }

  function appUsageSection(snap) {
    const u = snap.appUsage;
    if (!u || !u.available) return '';
    const total = u.today.totalSeconds;
    if (total === 0) {
      return `
        <h3 class="sub-h">Application time today</h3>
        <p class="empty" style="font-size: 11px;">Tracking starts on activation. Sample once per minute. Data shows up after a few minutes.</p>
      `;
    }
    const max = Math.max(...u.hourly.map((h) => h.total), 60);
    let bars = '<div style="display: grid; grid-template-columns: repeat(24, 1fr); gap: 1px; align-items: end; height: 60px;">';
    for (const h of u.hourly) {
      const pct = (h.total / max) * 100;
      const bg = h.total > 0 ? 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))' : 'transparent';
      const title = `${h.hour.toString().padStart(2, '0')}:00 — ${fmtSeconds(h.total)}${h.topApp ? ' · ' + h.topApp : ''}`;
      bars += `<div title="${escapeHtml(title)}" style="height: ${pct.toFixed(0)}%; background: ${bg}; min-height: 1px; border-radius: 1px 1px 0 0;"></div>`;
    }
    bars += '</div>';
    bars += '<div style="display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 4px; font-size: 9px; color: var(--vscode-descriptionForeground);"><div>00</div><div>06</div><div>12</div><div>18</div></div>';
    const apps = u.topApps
      .slice(0, 8)
      .map(
        (a) => `
        <div class="cost-tool-row">
          <span class="tool-name">${escapeHtml(a.name)}</span>
          <span>${escapeHtml(fmtSeconds(a.seconds))} · ${a.pct.toFixed(0)}%</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width: ${a.pct.toFixed(1)}%"></div></div>`,
      )
      .join('');
    return `
      <h3 class="sub-h">Application time today <span class="cost-rate">${fmtSeconds(total)}</span></h3>
      ${bars}
      ${apps}
      <p class="empty" style="font-size: 10px; margin-top: 6px;">Frontmost app sampled every minute while VSCode is running. Local-only — no telemetry.</p>
    `;
  }

  function welcomeBannerSection(snap) {
    // Heuristic system status: do we see any Claude data on disk, and do we
    // have an active session for this folder?
    const hasProjects = (snap.projects || []).length > 0;
    const hasWatch = (snap.watchtower || []).length > 0;
    const hasActive = !!snap.cwd;
    const usage = snap.usage;
    const hasUsage = !!(usage && usage.allTime && usage.allTime.totalTokens > 0);
    const budget = snap.budget;
    const capsConfigured = !!(budget && (budget.dailyCapUsd > 0 || budget.sessionCapUsd > 0));
    const userPrefs = snap.userPrefs || {};
    const themeChosen = userPrefs.theme && userPrefs.theme !== 'auto';

    const ok = '<span class="tag tag-used">✓</span>';
    const warn = '<span class="tag tag-warn">!</span>';
    const off = '<span class="tag">○</span>';

    const checks = [
      {
        icon: hasProjects ? ok : warn,
        title: 'Claude Code data',
        detail: hasProjects
          ? `Found ${snap.projects.length} project folder${snap.projects.length === 1 ? '' : 's'} under <code>~/.claude/projects/</code>.`
          : 'No data found at <code>~/.claude/projects/</code>. Run <code>claude</code> in any folder to bootstrap.',
      },
      {
        icon: hasActive ? ok : (hasWatch ? warn : off),
        title: 'Active session',
        detail: hasActive
          ? `This window is attached to <code>${escapeHtml(snap.cwd)}</code>.`
          : (hasWatch
              ? `No active session for the open folder, but ${snap.watchtower.length} other session${snap.watchtower.length === 1 ? '' : 's'} ${snap.watchtower.length === 1 ? 'is' : 'are'} live elsewhere — see Watchtower.`
              : 'Open a folder in VSCode and run <code>claude</code> in its terminal to see live session data.'),
      },
      {
        icon: hasUsage ? ok : off,
        title: 'Usage rollups',
        detail: hasUsage
          ? `${usage.scannedFiles} JSONL file${usage.scannedFiles === 1 ? '' : 's'} scanned · all-time spend $${usage.allTime.totalUsd.toFixed(2)}.`
          : 'No usage history yet — Cockpit will tally token+cost rollups as your sessions accumulate.',
      },
      {
        icon: capsConfigured ? ok : off,
        title: 'Budget caps',
        detail: capsConfigured
          ? `Daily ${budget.dailyCapUsd > 0 ? '$' + budget.dailyCapUsd : '—'} · session ${budget.sessionCapUsd > 0 ? '$' + budget.sessionCapUsd : '—'}.`
          : 'Optional. Set caps to get progress bars on the Usage rollups widget.',
      },
      {
        icon: themeChosen ? ok : off,
        title: 'Theme',
        detail: themeChosen
          ? `Locked to <strong>${escapeHtml(userPrefs.theme)}</strong>.`
          : 'Auto (follows VSCode). Override in the Customize panel.',
      },
    ];

    const checksHtml = checks.map((c) => `
      <li class="welcome-row">
        <span class="welcome-row-icon">${c.icon}</span>
        <div class="welcome-row-body">
          <div class="welcome-row-title"><strong>${escapeHtml(c.title)}</strong></div>
          <div class="welcome-row-detail">${c.detail}</div>
        </div>
      </li>
    `).join('');

    const next = snap.firstRunCompleted
      ? `<button class="office-btn" data-action="reset-first-run" title="Show this welcome again on next reload">Reset welcome</button>`
      : `<button class="office-btn" data-action="dismiss-welcome">Got it — take me to the cockpit →</button>`;

    return `
      <div class="welcome-banner">
        <h2 style="margin-top: 4px;">Welcome to Claude Cockpit</h2>
        <p class="empty" style="font-size: 12px; margin-top: 0;">
          Read-only HUD for Claude Code. <strong>100% local</strong> — no telemetry,
          no network calls without an explicit opt-in. Cockpit watches
          <code>~/.claude/projects/</code> and surfaces what's already on your disk.
        </p>

        <h3 class="sub-h">System check</h3>
        <ul class="welcome-list">${checksHtml}</ul>

        <h3 class="sub-h">Next steps</h3>
        <div class="actions" style="gap: 6px; flex-wrap: wrap;">
          <button class="office-btn" data-action="open-customize" title="Pick widgets per tab, choose visible tabs, theme">Customize widgets ⚙</button>
          <button class="office-btn" data-action="open-settings" title="Edit budget caps + opt-in toggles in VSCode settings">Open settings</button>
          <button class="office-btn" data-action="goto-tab" data-tab="now" title="See live session data">Go to Now</button>
          <button class="office-btn" data-action="goto-tab" data-tab="help" title="Read the full feature reference">Read the docs</button>
        </div>

        <h3 class="sub-h">What's where</h3>
        <p class="empty" style="font-size: 11px;">
          <strong>Now</strong> = your live session ·
          <strong>Watchtower</strong> = every recent Claude session ·
          <strong>History</strong> = search every JSONL ·
          <strong>Mac</strong> = system health ·
          <strong>Settings</strong> = caps, MCP, hooks, plugins ·
          <strong>Custom</strong> = any widgets you want, anywhere.
        </p>

        <p class="empty" style="font-size: 11px; margin-top: 12px;">
          Tip: every tab is now a composition of widgets you choose. Click
          <strong>Customize ⚙</strong> on any tab to pick what shows up there.
        </p>

        <div class="actions" style="margin-top: 16px;">${next}</div>
      </div>
    `;
  }

  function helpSection() {
    const tabs = [
      ['Now', 'Your live cockpit. Greeting, alerts that need attention (Inbox), at-a-glance stats, your active Claude session details (tokens, cost, files, tools).'],
      ['Mac', 'Mac system health: disk, memory, battery, CPU, Wi-Fi, external drives, Bluetooth peripheral battery levels. Plus application time tracked today.'],
      ['Watchtower', 'Every Claude Code session touched in the last hour, color-coded green (live) → orange (idle) → grey (stale). Click any session to inspect.'],
      ['Agents', 'Your specialist council — agent definitions found in <code>~/.claude/agents/</code> (global) and <code>.claude/agents/</code> (per-workspace).'],
      ['Routines', 'Scheduled Claude Code runs. Local routines = <code>~/.claude/scheduled-tasks/&lt;name&gt;/SKILL.md</code> (read directly). Cloud routines = scheduled remote agents managed in the desktop app / claude.ai (opt-in deep-link, no API state).'],
      ['Chat', 'Conversations from claude.ai (the web Chat surface) parsed from a <code>claude-data-export</code> folder. Cockpit unifies Chat + Code in one view.'],
      ['Search', 'Grep across every Claude session JSONL on this machine. Min 2 chars. Click a hit to open the source session.'],
      ['Obsidian', 'Auto-detects your Obsidian vaults, lists recent notes, lets you save the active session as a markdown digest with one click.'],
      ['Memory', 'Persistent memory entries Claude has saved across conversations. Pin (📌) the ones you reference most. Stale entries (>30 days) are flagged.'],
      ['Prompts', 'Personal prompt library. Click any prompt to copy it to your clipboard, paste into Claude.'],
      ['Skills', 'Every <code>SKILL.md</code> Claude has access to. Click to copy <code>/skill-name</code> to your clipboard. Usage counts show how often each fires this session.'],
      ['Projects', 'Recent projects with Claude Code history. Click to open a project folder in a new VSCode window.'],
      ['Files', 'Browse <code>~/.claude/</code> (the "mother folder") and the active project folder. Reveal in Finder.'],
      ['Config', 'Budget caps, RTK token-killer stats, Cloudflare tunnels, MCP servers, hooks, plugins, disk usage, office visualizer launcher.'],
    ];
    const metrics = [
      ['Tokens', 'Sum of input + output + cache-read + cache-write tokens for this session.'],
      ['Input tokens', 'New text Claude reads (your prompts, file contents, tool results).'],
      ['Output tokens', 'Text Claude generates back (its responses).'],
      ['Cache read', 'Tokens served from prompt cache — much cheaper than fresh input.'],
      ['Cache write', 'Tokens added to the cache for future reuse.'],
      ['Cache hit rate', 'cache reads ÷ (cache reads + fresh input). Higher = cheaper sessions. Below 30% on long sessions usually means you can structure your prompts better.'],
      ['Context window', 'Maximum tokens Claude can hold in working memory. 200K (default) or 1M (extended). When fill % approaches 100, run <code>/compact</code> or start fresh.'],
      ['Cost burn ($/hr)', 'Total session cost ÷ wall-clock duration. A live "is this getting expensive?" gauge.'],
      ['Streak', 'Consecutive days with Claude Code activity (counted from yesterday backwards — today doesn\'t count yet).'],
      ['Active days · 30d', 'How many of the last 30 days had any Claude Code session activity.'],
      ['Peak hour', 'Hour of day where you ran the most events in the last 7 days.'],
      ['Favorite model', 'Whichever model family (Opus / Sonnet / Haiku) used the most tokens in the last 7 days.'],
      ['Streak vs Active days', 'Streak is consecutive. Active days is total. A 22-day streak = 22 active days in a row. 27 active days in 30 = had 3 off days but not necessarily consecutive.'],
      ['Watchtower status', 'green = live (touched <10s ago) · green = recent (<15min) · orange = idle (15-30min) · grey = stale (>30min).'],
      ['Idle sentinel', 'Sessions sitting waiting for input. Often a sub-agent finished and you forgot.'],
      ['Sub-agents', 'Specialized agents Claude spawned mid-session for sub-tasks. Each has its own JSONL log.'],
      ['Tool histogram', 'Which tools (Read, Edit, Bash, etc.) Claude has used most this session.'],
      ['Tool decisions', 'Recent tool calls with ✓ (succeeded), ✗ (errored), · (still running).'],
      ['Plans', 'Auto-detected from <code>tasks/todo.md</code>, <code>forkcast.md</code>, etc. Counts <code>[x]</code> done vs <code>[ ]</code> pending checkboxes.'],
      ['MCP servers', 'Model Context Protocol servers giving Claude extra tools (Linear, Gmail, Notion, etc.).'],
      ['Hooks', 'Shell commands the harness runs automatically on events like Stop, UserPromptSubmit, ToolUse.'],
      ['RTK', 'Rust Token Killer — Stephane\'s CLI proxy that rewrites verbose commands into compact equivalents to save context tokens. Shows cumulative savings.'],
      ['Tunnels', 'Cloudflare tunnels exposing local services to public hostnames (e.g. <code>cockpit.dashable.dev</code>).'],
      ['Mac Health: pressure', 'Memory pressure = how much of your RAM is actively being used. >75% = your Mac is starting to swap; >90% = noticeable slowdown.'],
      ['Mac Health: load avg', 'Average tasks waiting for CPU. Above your core count for 15min straight means the machine is under sustained load.'],
      ['Application time', 'How long each Mac app has been frontmost today. Sampled once per minute; only counts time while VSCode is open.'],
    ];
    return `
      <h2>Help · how to read this thing</h2>
      <p class="empty" style="font-size: 11px; margin-bottom: 12px;">Cockpit reads files Claude Code stores under <code>~/.claude/</code> plus a few system sources on macOS. Everything is local — zero telemetry, zero network calls (except optional Obsidian/Cloudflare/usage-dashboard handoffs).</p>

      <h3 class="sub-h">Tabs</h3>
      <ul class="list">
        ${tabs.map(([t, d]) => `<li><div class="row"><span class="left"><strong>${t}</strong></span></div><div class="note-excerpt">${d}</div></li>`).join('')}
      </ul>

      <h3 class="sub-h">Metrics</h3>
      <ul class="list">
        ${metrics.map(([t, d]) => `<li><div class="row"><span class="left"><strong>${escapeHtml(t)}</strong></span></div><div class="note-excerpt">${d}</div></li>`).join('')}
      </ul>

      <h3 class="sub-h">Privacy</h3>
      <p class="empty" style="font-size: 11px;">All data is read-only and stays on your machine. Cockpit never makes outbound network calls except: (1) when you click an Obsidian link (<code>obsidian://</code>), (2) when you click a Cloudflare tunnel hostname (opens external), or (3) when probing localhost ports for the optional claude-usage dashboard. The webview content security policy blocks all <code>connect-src</code>.</p>

      <h3 class="sub-h">Where data comes from</h3>
      <ul class="list">
        <li><strong>Sessions:</strong> <code>~/.claude/projects/&lt;encoded-cwd&gt;/*.jsonl</code></li>
        <li><strong>Memory:</strong> <code>~/.claude/projects/&lt;encoded-cwd&gt;/memory/MEMORY.md</code> + linked files</li>
        <li><strong>Skills:</strong> <code>~/.claude/skills/&lt;name&gt;/SKILL.md</code></li>
        <li><strong>Agents:</strong> <code>~/.claude/agents/&lt;name&gt;.md</code> + <code>.claude/agents/</code></li>
        <li><strong>Routines:</strong> <code>~/.claude/scheduled-tasks/&lt;name&gt;/SKILL.md</code></li>
        <li><strong>Hooks/MCP:</strong> <code>~/.claude/settings.json</code></li>
        <li><strong>Obsidian:</strong> <code>~/Library/Application Support/obsidian/obsidian.json</code></li>
        <li><strong>Tunnels:</strong> <code>~/.cloudflared/*.yml</code></li>
        <li><strong>Mac Health:</strong> <code>df</code>, <code>vm_stat</code>, <code>pmset</code>, <code>sysctl</code>, <code>netstat</code>, <code>system_profiler SPBluetoothDataType</code></li>
        <li><strong>App time:</strong> polling <code>lsappinfo front</code> once per minute</li>
      </ul>
    `;
  }

  function greetingSection(snap) {
    const greet = snap.greeting || 'Hi';
    const pilotName = (snap.pilot && snap.pilot.name) || 'there';
    const live = (snap.watchtower || []).filter((w) => w.status === 'live').length;
    const idle = (snap.watchtower || []).filter((w) => w.status === 'idle' || w.status === 'stale').length;
    const inbox = (snap.inbox || []).length;
    const meta = [];
    if (live) meta.push(`<strong>${live}</strong> live run${live === 1 ? '' : 's'}`);
    if (idle) meta.push(`<strong>${idle}</strong> idle`);
    if (inbox) meta.push(`<strong>${inbox}</strong> need${inbox === 1 ? 's' : ''} you`);
    return `
      <div class="greeting">
        <div class="greeting-line">${escapeHtml(greet)}, <strong>${escapeHtml(pilotName)}</strong></div>
        <div class="greeting-meta">${meta.join(' · ') || 'all clear'}</div>
      </div>
    `;
  }

  function statsGridSection(snap) {
    const cs = snap.cockpitStats;
    if (!cs) return '';
    const cards = [
      { label: 'Streak', value: cs.streakDays > 0 ? `${cs.streakDays}d` : '—', accent: cs.streakDays >= 7 ? 'ok' : '' },
      { label: 'Active days · 30d', value: String(cs.activeDays30), accent: '' },
      { label: 'Peak hour', value: cs.peakHourLabel, accent: '' },
      { label: 'Favorite model', value: cs.favoriteModel ? cs.favoriteModel : '—', accent: '' },
      { label: 'Week cost', value: cs.weekUsdFormatted || '—', accent: '' },
    ];
    return `
      <h2>At a glance</h2>
      <div class="stats-grid">
        ${cards
          .map(
            (c) => `<div class="stat-card ${c.accent ? 'stat-' + c.accent : ''}">
              <div class="stat-label">${escapeHtml(c.label)}</div>
              <div class="stat-value">${escapeHtml(c.value)}</div>
            </div>`,
          )
          .join('')}
      </div>
    `;
  }

  function inboxSection(snap) {
    const items = snap.inbox || [];
    if (!items.length) return '';
    const iconFor = (cat) =>
      ({ idle: '◌', error: '✗', memory: '🗂', plan: '☐', subagent: '⚙', budget: '$' })[cat] || '·';
    const cards = items
      .slice(0, 8)
      .map(
        (it) => `
        <div class="inbox-card inbox-${escapeHtml(it.level)}">
          <div class="inbox-icon">${iconFor(it.category)}</div>
          <div class="inbox-body">
            <div class="inbox-title">${escapeHtml(it.title)}</div>
            <div class="inbox-detail">${escapeHtml(it.detail)}</div>
          </div>
          ${it.action !== 'none' ? `<button class="inbox-action" data-inbox-action="${escapeHtml(it.action)}" data-inbox-payload="${escapeHtml(it.actionPayload || '')}">→</button>` : ''}
        </div>`,
      )
      .join('');
    return `<h2>Inbox <span class="cost-rate">${items.length} need${items.length === 1 ? 's' : ''} you</span></h2>${cards}`;
  }

  function agentsSection(snap) {
    const list = snap.agents || [];
    if (!list.length) {
      return `
        <h2>Agents</h2>
        <p class="empty">No agents found in <code>~/.claude/agents/</code> or <code>.claude/agents/</code>.</p>
      `;
    }
    const globals = list.filter((a) => a.scope === 'global');
    const workspace = list.filter((a) => a.scope === 'workspace');
    const renderOne = (a) => `
      <div class="watch-card" style="display: block;">
        <div class="row">
          <a class="left link" data-open-file="${escapeHtml(a.filePath)}" title="${escapeHtml(a.filePath)}"><strong>${escapeHtml(a.name)}</strong></a>
          <span class="right">
            ${a.scope === 'workspace' ? '<span class="tag tag-used">workspace</span>' : '<span class="tag">global</span>'}
            ${a.model ? `<span class="tag">${escapeHtml(a.model)}</span>` : ''}
          </span>
        </div>
        <div class="note-excerpt">${escapeHtml(a.description || 'No description')}</div>
        ${a.tools ? `<div style="margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 10px;">tools: ${escapeHtml(a.tools)}</div>` : ''}
      </div>
    `;
    return `
      <h2>Agents <span class="cost-rate">${list.length}</span></h2>
      <input type="search" class="search" data-search="agents" placeholder="Filter agents…" />
      <ul class="list" data-search-target="agents" style="list-style: none; padding: 0;">
        ${[
          ...workspace.map((a) => `<li data-search-text="${escapeHtml((a.name + ' ' + a.description).toLowerCase())}">${renderOne(a)}</li>`),
          ...globals.map((a) => `<li data-search-text="${escapeHtml((a.name + ' ' + a.description).toLowerCase())}">${renderOne(a)}</li>`),
        ].join('')}
      </ul>
    `;
  }

  function tunnelsSection(snap) {
    const list = snap.tunnels || [];
    if (!list.length) return '';
    const items = list
      .map(
        (t) => `<li>
          <div class="row">
            <a class="left link" data-open-file="${escapeHtml(t.configPath)}" title="${escapeHtml(t.configPath)}">${escapeHtml(t.name)}</a>
            ${t.hostname ? `<span class="right"><a class="link" data-open-url="https://${escapeHtml(t.hostname)}">${escapeHtml(t.hostname)} ↗</a></span>` : ''}
          </div>
          ${t.service ? `<div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;">→ ${escapeHtml(t.service)}</div>` : ''}
        </li>`,
      )
      .join('');
    return `<h2>Tunnels <span class="cost-rate">${list.length}</span></h2><ul class="list">${items}</ul>`;
  }

  function fmtAge(ms) {
    if (!ms) return '—';
    const seconds = Math.max(0, (Date.now() - ms) / 1000);
    if (seconds < 60) return 'just now';
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
  }

  function manageSection(snap) {
    const m = snap.manage || { globalSettings: { exists: false }, localSettings: { exists: false }, hookEvents: [], mcpServers: [], enabledPlugins: [], topLevelKeys: [], agentsDir: '', scheduledTasksDir: '', skillsDir: '' };
    const g = m.globalSettings || {};
    const l = m.localSettings || {};

    const fileCard = (label, view, openButtonLabel) => {
      const path = view.filePath || '';
      const status = !view.exists
        ? '<span class="tag">missing</span>'
        : view.parseError
        ? '<span class="tag tag-needs-cwd">parse error</span>'
        : '<span class="tag tag-used">ok</span>';
      const error = view.parseError ? `<div class="note-excerpt" style="color: var(--vscode-errorForeground);">${escapeHtml(view.parseError)}</div>` : '';
      return `<div class="manage-group">
        <div class="manage-group-head">
          <span>${escapeHtml(label)} ${status}</span>
          <span>
            <button class="rec-action" data-open-file="${escapeHtml(path)}">${escapeHtml(openButtonLabel)}</button>
          </span>
        </div>
        <div class="manage-row"><div class="left-col"><div class="v">${escapeHtml(path)}</div></div></div>
        ${error}
      </div>`;
    };

    const groupRow = (title, count, action) => `<div class="manage-row">
      <div class="left-col"><strong>${escapeHtml(title)}</strong> <span class="cost-rate">${count}</span></div>
      <span>${action}</span>
    </div>`;

    const hookList = m.hookEvents.length
      ? m.hookEvents.map((ev) => `<div class="manage-row">
          <div class="left-col">${escapeHtml(ev)}</div>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath)}">edit</button>
        </div>`).join('')
      : '<div class="manage-row"><div class="left-col"><span class="empty">No hooks configured.</span></div></div>';

    const mcpList = m.mcpServers.length
      ? m.mcpServers.map((s) => `<div class="manage-row">
          <div class="left-col">${escapeHtml(s)}</div>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath)}">edit</button>
        </div>`).join('')
      : '<div class="manage-row"><div class="left-col"><span class="empty">No MCP servers configured.</span></div></div>';

    const pluginList = m.enabledPlugins.length
      ? m.enabledPlugins.map((p) => `<div class="manage-row">
          <div class="left-col">${escapeHtml(p)}</div>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath)}">edit</button>
        </div>`).join('')
      : '<div class="manage-row"><div class="left-col"><span class="empty">No plugins enabled.</span></div></div>';

    const topKeyRows = (m.topLevelKeys || [])
      .filter((k) => !['hooks', 'mcpServers', 'enabledPlugins'].includes(k))
      .map((k) => {
        const v = (g.data && g.data[k] !== undefined) ? g.data[k] : (l.data ? l.data[k] : undefined);
        const display = v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v));
        return `<div class="manage-row">
          <div class="left-col">
            <div><strong>${escapeHtml(k)}</strong></div>
            <div class="v">${escapeHtml(display || '—')}</div>
          </div>
          <button class="rec-action" data-open-file="${escapeHtml((g.exists ? g.filePath : l.filePath) || '')}">edit</button>
        </div>`;
      })
      .join('');

    return `
      <h2>Manage Claude</h2>
      <p class="empty" style="font-size: 11px;">Surfaces every key in <code>~/.claude/settings.json</code> and <code>~/.claude/settings.local.json</code>. Click <strong>edit</strong> on any row to open the JSON file in the VSCode editor — Cockpit doesn't write settings programmatically (any change goes through the editor so you can review).</p>

      ${fileCard('Global settings', g, 'Open settings.json')}
      ${fileCard('Local overrides', l, 'Open settings.local.json')}

      <div class="manage-group">
        <div class="manage-group-head">
          <span>Hooks <span class="cost-rate">${m.hookEvents.length}</span></span>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath || '')}">+ Add</button>
        </div>
        ${hookList}
      </div>

      <div class="manage-group">
        <div class="manage-group-head">
          <span>MCP servers <span class="cost-rate">${m.mcpServers.length}</span></span>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath || '')}">+ Add</button>
        </div>
        ${mcpList}
      </div>

      <div class="manage-group">
        <div class="manage-group-head">
          <span>Enabled plugins <span class="cost-rate">${m.enabledPlugins.length}</span></span>
          <button class="rec-action" data-open-file="${escapeHtml(g.filePath || '')}">+ Add</button>
        </div>
        ${pluginList}
      </div>

      ${topKeyRows ? `<div class="manage-group">
        <div class="manage-group-head"><span>Other settings</span></div>
        ${topKeyRows}
      </div>` : ''}

      <div class="manage-group">
        <div class="manage-group-head"><span>Locations</span></div>
        <div class="manage-row">
          <div class="left-col"><strong>Agents</strong> <span class="v">${escapeHtml(m.agentsDir)}</span></div>
          <button class="rec-action" data-reveal="${escapeHtml(m.agentsDir)}">reveal</button>
        </div>
        <div class="manage-row">
          <div class="left-col"><strong>Scheduled tasks</strong> <span class="v">${escapeHtml(m.scheduledTasksDir)}</span></div>
          <button class="rec-action" data-reveal="${escapeHtml(m.scheduledTasksDir)}">reveal</button>
        </div>
        <div class="manage-row">
          <div class="left-col"><strong>Skills</strong> <span class="v">${escapeHtml(m.skillsDir)}</span></div>
          <button class="rec-action" data-reveal="${escapeHtml(m.skillsDir)}">reveal</button>
        </div>
      </div>
    `;
  }

  function changelogSection(snap) {
    const cl = snap.changelog || { exists: false, fullText: '', versions: [], currentVersion: '' };
    const upd = snap.updateStatus || { enabled: false, currentVersion: cl.currentVersion, hasUpdate: false };

    const updateBlock = !upd.enabled
      ? `<p class="empty" style="font-size: 11px;">Update checks are disabled. Enable <code>claudeCockpit.updateCheck.enabled</code> in settings to be notified about new releases.</p>`
      : upd.error
      ? `<p class="empty" style="font-size: 11px;">Last update check failed: ${escapeHtml(upd.error)}. <button class="rec-action" data-action="check-update">Retry</button></p>`
      : !upd.latestVersion
      ? `<p class="empty" style="font-size: 11px;">Checking for updates… <button class="rec-action" data-action="check-update">Check now</button></p>`
      : upd.hasUpdate
      ? `<div class="watch-card update-banner" style="display: block;">
          <div class="row">
            <span class="left"><strong>Update available — v${escapeHtml(upd.latestVersion)}</strong></span>
            <span class="right">
              <button class="office-btn" data-action="open-release">Get update ↗</button>
              <button class="rec-action" data-action="check-update">Re-check</button>
            </span>
          </div>
          ${upd.releaseTitle ? `<div class="note-excerpt">${escapeHtml(upd.releaseTitle)}</div>` : ''}
          <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;">You're running v${escapeHtml(upd.currentVersion)}${upd.publishedAt ? ' · published ' + escapeHtml(fmtAge(upd.publishedAt)) : ''}.</div>
        </div>`
      : `<p class="empty" style="font-size: 11px;">You're on the latest version (v${escapeHtml(upd.currentVersion)}). <button class="rec-action" data-action="check-update">Check again</button></p>`;

    if (!cl.exists) {
      return `
        <h2>Changelog</h2>
        ${updateBlock}
        <p class="empty">No <code>CHANGELOG.md</code> bundled with this build.</p>
      `;
    }

    const versions = cl.versions || [];
    const versionsHtml = !versions.length
      ? `<pre class="changelog-pre">${escapeHtml(cl.fullText.slice(0, 4000))}</pre>`
      : versions
          .map(
            (v) => `<div class="changelog-version ${v.isCurrent ? 'is-current' : ''}">
              <div class="row">
                <span class="left"><strong>v${escapeHtml(v.version)}</strong>${v.date ? ` <span class="cost-rate">${escapeHtml(v.date)}</span>` : ''}</span>
                <span class="right">
                  ${v.isCurrent ? '<span class="tag tag-used">installed</span>' : ''}
                  <a class="link" data-open-url="https://github.com/sboghossian/claude-code-cockpit/releases/tag/v${escapeHtml(v.version)}">release ↗</a>
                </span>
              </div>
              <div class="changelog-body">${renderMarkdown(v.body)}</div>
            </div>`,
          )
          .join('');

    return `
      <h2>Changelog <span class="cost-rate">v${escapeHtml(cl.currentVersion)}</span></h2>
      ${updateBlock}
      <p class="empty" style="font-size: 11px;">What shipped, when. Tap any version's release ↗ link to see the GitHub release page.</p>
      ${versionsHtml}
    `;
  }

  // Minimal markdown → HTML for changelog bodies. Handles headings (### / ##),
  // lists (- ), inline code (`x`), bold (**x**), and paragraph breaks.
  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.split(/\r?\n/);
    const out = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) {
        closeList();
        continue;
      }
      if (/^###\s+/.test(line)) {
        closeList();
        out.push(`<h4 class="changelog-h4">${inlineMd(line.replace(/^###\s+/, ''))}</h4>`);
        continue;
      }
      if (/^##\s+/.test(line)) {
        closeList();
        out.push(`<h3 class="sub-h">${inlineMd(line.replace(/^##\s+/, ''))}</h3>`);
        continue;
      }
      if (/^-\s+/.test(line)) {
        if (!inList) { out.push('<ul class="changelog-list">'); inList = true; }
        out.push(`<li>${inlineMd(line.replace(/^-\s+/, ''))}</li>`);
        continue;
      }
      closeList();
      out.push(`<p class="changelog-p">${inlineMd(line)}</p>`);
    }
    closeList();
    return out.join('');
  }

  function inlineMd(s) {
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
    return out;
  }

  function roadmapSection(snap) {
    const r = snap.roadmap;
    const stateNow = vscode.getState() || {};
    const filterCat = stateNow.roadmapCat || 'all';
    const filterStage = stateNow.roadmapStage || 'all';
    const search = (stateNow.roadmapSearch || '').toLowerCase();

    const head = `
      <div class="row">
        <h2 class="left">Roadmap</h2>
        <span class="right">
          <button class="office-btn" data-action="roadmap-refresh">Refresh</button>
          <button class="office-btn" data-action="roadmap-open-live" title="Open roadmap.dashable.dev">Live</button>
        </span>
      </div>
    `;

    if (!r || (!r.categories || r.categories.length === 0)) {
      const err = r && r.error ? `<p class="empty" style="font-size:11px;color:var(--vscode-errorForeground);">${escapeHtml(r.error)}</p>` : '';
      return `${head}
        ${err}
        <p class="empty" style="font-size:11px;">Loading roadmap from <code>roadmap.dashable.dev</code> (or <code>localhost:3000</code> if running locally)…</p>
      `;
    }

    const cats = r.categories;
    const allProjects = cats.flatMap((c) => c.projects);
    const stages = Array.from(new Set(allProjects.map((p) => p.stage).filter(Boolean))).sort();

    const matchesFilter = (p) => {
      if (filterCat !== 'all' && p.category !== filterCat) return false;
      if (filterStage !== 'all' && p.stage !== filterStage) return false;
      if (search) {
        const hay = `${p.name} ${p.desc || ''} ${p.longDesc || ''} ${(p.techStack || []).join(' ')}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    };

    const visibleCats = cats
      .map((c) => ({ ...c, projects: c.projects.filter(matchesFilter) }))
      .filter((c) => c.projects.length > 0);

    const visibleCount = visibleCats.reduce((s, c) => s + c.projects.length, 0);

    const ageHint = r.fetchedAt ? `<span class="cost-rate">${fmtAge(r.fetchedAt)}</span>` : '';
    const sourceHint = r.source ? `<span class="cost-rate" title="${escapeHtml(r.source)}">${r.source.includes('localhost') ? 'local' : 'live'}</span>` : '';
    const errorHint = r.error ? `<p class="empty" style="font-size:11px;color:var(--vscode-errorForeground);">${escapeHtml(r.error)}</p>` : '';

    const summary = `
      <div class="row" style="font-size:11px;">
        <span class="left">${visibleCount} / ${r.totalProjects} projects ${sourceHint} ${ageHint}</span>
      </div>
      ${errorHint}
    `;

    const catChip = (id, label, count) =>
      `<button class="filter-chip ${filterCat === id ? 'on' : ''}" data-roadmap-cat="${escapeHtml(id)}">${escapeHtml(label)}${count != null ? ` <span class="cost-rate">${count}</span>` : ''}</button>`;

    const catChips = `
      <div class="filter-chips">
        ${catChip('all', 'All', allProjects.length)}
        ${cats.map((c) => catChip(c.key, c.label, c.projects.length)).join('')}
      </div>
    `;

    const stageChip = (id, label) =>
      `<button class="filter-chip ${filterStage === id ? 'on' : ''}" data-roadmap-stage="${escapeHtml(id)}">${escapeHtml(label)}</button>`;

    const stageChips = stages.length
      ? `<div class="filter-chips">${stageChip('all', 'Any stage')}${stages.map((s) => stageChip(s, s)).join('')}</div>`
      : '';

    const searchBox = `
      <div class="row" style="margin: 6px 0;">
        <input
          type="text"
          class="search-input"
          data-roadmap-search
          placeholder="Search projects, descriptions, tech stack…"
          value="${escapeHtml(stateNow.roadmapSearch || '')}"
          style="width:100%;padding:4px 6px;font-size:11px;"
        />
      </div>
    `;

    const projectCard = (p) => {
      const sessionCount = (r.sessionStats && r.sessionStats.byProject && r.sessionStats.byProject[p.name]) || p.obsidianSessions || 0;
      const stageBadge = p.label
        ? `<span class="filter-chip on" style="background:${escapeHtml(p.color || 'var(--vscode-badge-background)')};color:#fff;border:0;cursor:default;">${escapeHtml(p.label)}</span>`
        : '';
      const links = [
        p.url ? `<button class="office-btn" data-roadmap-open-url="${escapeHtml(p.url)}">Open</button>` : '',
        p.git ? `<button class="office-btn" data-roadmap-open-url="${escapeHtml(p.git)}">GitHub</button>` : '',
        sessionCount > 0 ? `<span class="cost-rate" title="Claude Code sessions">${sessionCount} sessions</span>` : '',
      ].filter(Boolean).join(' ');
      const tech = (p.techStack || []).slice(0, 6).map((t) => `<span class="cost-rate">${escapeHtml(t)}</span>`).join(' ');
      const next = (p.nextSteps || []).slice(0, 2).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
      return `
        <div class="row" style="display:block;margin:6px 0;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:4px;">
          <div class="row">
            <strong class="left">${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</strong>
            <span class="right">${stageBadge}</span>
          </div>
          ${p.desc ? `<div class="note-excerpt">${escapeHtml(p.desc)}</div>` : ''}
          ${tech ? `<div style="margin:4px 0;">${tech}</div>` : ''}
          ${next ? `<details><summary style="font-size:10px;color:var(--vscode-descriptionForeground);cursor:pointer;">Next steps</summary><ul style="font-size:11px;margin:4px 0 0 14px;">${next}</ul></details>` : ''}
          <div class="row" style="margin-top:4px;">${links}</div>
        </div>
      `;
    };

    const catBlocks = visibleCats.map((c) => `
      <h3 class="sub-h">${escapeHtml(c.label)} <span class="cost-rate">${c.projects.length}</span></h3>
      ${c.projects.map(projectCard).join('')}
    `).join('');

    const empty = !visibleCount ? `<p class="empty" style="font-size:11px;">No projects match the current filters.</p>` : '';

    return `${head}${summary}${catChips}${stageChips}${searchBox}${empty}${catBlocks}`;
  }

  function discoverSection(snap) {
    const d = snap.discover || { enabled: false, github: undefined, rss: { entries: [] } };
    if (!d.enabled) {
      return `
        <h2>Discover</h2>
        <p class="empty" style="font-size: 11px;">Discover surfaces top GitHub projects, Hacker News, Product Hunt, and your custom RSS feeds. <strong>Off by default</strong> — local-first stance. Turning Discover on lets Cockpit make outbound HTTPS calls only when you click <strong>Refresh</strong> on each source.</p>
        <button class="office-btn" data-action="enable-discover">Enable Discover (opt-in)</button>
      `;
    }

    const state = vscode.getState() || {};
    const view = state.discoverView || 'github';
    const customFeeds = d.customFeeds || [];
    const customCount = customFeeds.length;

    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'github' ? 'sub-tab-active' : ''}" data-discover-view="github">GitHub</button>
        <button class="sub-tab ${view === 'hn' ? 'sub-tab-active' : ''}" data-discover-view="hn">HN</button>
        <button class="sub-tab ${view === 'producthunt' ? 'sub-tab-active' : ''}" data-discover-view="producthunt">Product Hunt</button>
        <button class="sub-tab ${view === 'obsidian' ? 'sub-tab-active' : ''}" data-discover-view="obsidian">Obsidian RSS</button>
        <button class="sub-tab ${view === 'custom' ? 'sub-tab-active' : ''}" data-discover-view="custom">Custom${customCount ? ' <span class="chip-count">' + customCount + '</span>' : ''}</button>
      </div>
    `;

    let body = '';
    if (view === 'github') body = discoverGithubBody(d);
    else if (view === 'hn') body = discoverHNBody(d);
    else if (view === 'producthunt') body = discoverPHBody(d);
    else if (view === 'obsidian') body = discoverObsidianBody(d);
    else if (view === 'custom') body = discoverCustomBody(d);

    return `<h2>Discover</h2>${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  function feedItemCard(item) {
    const ageStr = item.publishedAt ? fmtAge(item.publishedAt) : '';
    const score = item.score ? `<span class="tag tag-used">▲ ${item.score}</span>` : '';
    const sourceTag = `<span class="tag">${escapeHtml(item.source)}</span>`;
    return `<li>
      <div class="watch-card" style="display: block;">
        <div class="row">
          <a class="left link" data-open-url="${escapeHtml(item.url)}" title="${escapeHtml(item.title)}"><strong>${escapeHtml(item.title)}</strong></a>
          <span class="right">${score}${sourceTag}</span>
        </div>
        ${item.description ? `<div class="note-excerpt">${escapeHtml(item.description)}</div>` : ''}
        ${ageStr ? `<div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;">${escapeHtml(ageStr)}</div>` : ''}
      </div>
    </li>`;
  }

  function discoverGithubBody(d) {
    const win = (vscode.getState() || {}).discoverWindow || 'week';
    const ghCache = d.github;
    const ghError = ghCache && ghCache.error;
    const ghRepos = (ghCache && ghCache.repos) || [];
    const ghAge = ghCache ? fmtAge(ghCache.fetchedAt) : '';
    const header = `
      <div class="row">
        <h3 class="sub-h left">GitHub trending <span class="cost-rate">${ghRepos.length}</span></h3>
        <span class="right"><button class="office-btn" data-action="discover-refresh">Refresh</button></span>
      </div>
      <div class="filter-chips">
        ${['day', 'week', 'month'].map((w) => `<button class="filter-chip ${win === w ? 'on' : ''}" data-discover-window="${w}">${
          w === 'day' ? 'Today' : w === 'week' ? 'This week' : 'This month'
        }</button>`).join('')}
      </div>
      ${ghCache ? `<p class="empty" style="font-size: 10px;">Cached ${escapeHtml(ghAge)} · window: ${escapeHtml(ghCache.window)}</p>` : '<p class="empty">Click Refresh to fetch top repos.</p>'}
    `;
    const list = ghError
      ? `<p class="empty">${escapeHtml(ghError)}</p>`
      : !ghRepos.length
      ? ''
      : `<ul class="list" style="list-style: none; padding: 0;">${ghRepos.map((r) => `<li>
          <div class="watch-card" style="display: block;">
            <div class="row">
              <a class="left link" data-open-url="${escapeHtml(r.url)}" title="${escapeHtml(r.fullName)}"><strong>${escapeHtml(r.fullName)}</strong></a>
              <span class="right">${r.language ? `<span class="tag">${escapeHtml(r.language)}</span>` : ''}<span class="tag">★ ${r.stars.toLocaleString()}</span></span>
            </div>
            ${r.description ? `<div class="note-excerpt">${escapeHtml(r.description)}</div>` : ''}
          </div>
        </li>`).join('')}</ul>`;
    return `${header}${list}`;
  }

  function discoverHNBody(d) {
    const win = (vscode.getState() || {}).hnWindow || 'day';
    const hn = d.hn;
    const items = (hn && hn.items) || [];
    const err = hn && hn.error;
    const age = hn ? fmtAge(hn.fetchedAt) : '';
    const header = `
      <div class="row">
        <h3 class="sub-h left">Hacker News <span class="cost-rate">${items.length}</span></h3>
        <span class="right"><button class="office-btn" data-action="hn-refresh">Refresh</button></span>
      </div>
      <div class="filter-chips">
        ${['day', 'week', 'month'].map((w) => `<button class="filter-chip ${win === w ? 'on' : ''}" data-hn-window="${w}">${
          w === 'day' ? 'Today' : w === 'week' ? 'This week' : 'This month'
        }</button>`).join('')}
      </div>
      ${hn ? `<p class="empty" style="font-size: 10px;">Cached ${escapeHtml(age)}</p>` : '<p class="empty">Click Refresh to fetch front page stories.</p>'}
    `;
    const body = err
      ? `<p class="empty">${escapeHtml(err)}</p>`
      : !items.length
      ? ''
      : `<ul class="list" style="list-style: none; padding: 0;">${items.map(feedItemCard).join('')}</ul>`;
    return `${header}${body}`;
  }

  function discoverPHBody(d) {
    const ph = d.producthunt;
    const items = (ph && ph.items) || [];
    const err = ph && ph.error;
    const age = ph ? fmtAge(ph.fetchedAt) : '';
    const header = `
      <div class="row">
        <h3 class="sub-h left">Product Hunt <span class="cost-rate">${items.length}</span></h3>
        <span class="right"><button class="office-btn" data-action="ph-refresh">Refresh</button></span>
      </div>
      ${ph ? `<p class="empty" style="font-size: 10px;">Cached ${escapeHtml(age)}</p>` : '<p class="empty">Click Refresh to fetch today\'s products.</p>'}
    `;
    const body = err
      ? `<p class="empty">${escapeHtml(err)}</p>`
      : !items.length
      ? ''
      : `<ul class="list" style="list-style: none; padding: 0;">${items.map(feedItemCard).join('')}</ul>`;
    return `${header}${body}`;
  }

  function discoverObsidianBody(d) {
    const rss = d.rss || { entries: [] };
    const header = `<h3 class="sub-h">RSS from Obsidian ${rss.folder ? `<span class="cost-rate">${rss.entries.length}</span>` : ''}</h3>
      ${rss.folder ? `<p class="empty" style="font-size: 10px;">Reading: <code>${escapeHtml(rss.folder)}</code></p>` : ''}`;
    const body = rss.error
      ? `<p class="empty">${escapeHtml(rss.error)}</p>`
      : !rss.entries.length
      ? `<p class="empty">No RSS notes found yet. The <code>rss-feed-obsidian</code> routine should populate them.</p>`
      : `<ul class="list" style="list-style: none; padding: 0;">${rss.entries.slice(0, 30).map((e) => `<li>
          <div class="watch-card" style="display: block;">
            <div class="row">
              <a class="left link" data-open-file="${escapeHtml(e.filePath)}" title="${escapeHtml(e.filePath)}"><strong>${escapeHtml(e.title)}</strong></a>
              <span class="right"><span class="tag">${escapeHtml(e.vault)}</span></span>
            </div>
            <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;">${e.source ? escapeHtml(e.source) + ' · ' : ''}${escapeHtml(fmtAge(e.mtimeMs))}</div>
          </div>
        </li>`).join('')}</ul>`;
    return `${header}${body}`;
  }

  function discoverCustomBody(d) {
    const feeds = d.customFeeds || [];
    const cache = d.custom || {};
    const addForm = `
      <div class="custom-feed-form">
        <input data-custom-feed-name placeholder="Feed name (e.g. 'My X via Nitter')" />
        <input data-custom-feed-url placeholder="https://..." type="url" />
        <button class="office-btn" data-add-custom-feed>+ Add feed</button>
      </div>
      <p class="empty" style="font-size: 10px;">X and LinkedIn don't expose RSS directly. Use a bridge: <code>https://nitter.net/{user}/rss</code> for X, or your own RSS-Bridge instance.</p>
    `;
    if (!feeds.length) {
      return `<h3 class="sub-h">Custom feeds</h3><p class="empty">No custom feeds yet. Add any RSS/Atom URL.</p>${addForm}`;
    }
    const cards = feeds.map((f) => {
      const c = cache[f.name];
      const items = (c && c.items) || [];
      const err = c && c.error;
      const age = c ? fmtAge(c.fetchedAt) : '';
      return `<div class="custom-feed-block">
        <div class="row">
          <h4 class="sub-h left">${escapeHtml(f.name)} <span class="cost-rate">${items.length}</span></h4>
          <span class="right">
            <button class="watch-action" data-fetch-custom-feed="${escapeHtml(f.name)}" data-feed-url="${escapeHtml(f.url)}">Refresh</button>
            <button class="watch-action" data-remove-custom-feed="${escapeHtml(f.name)}" style="color: var(--vscode-errorForeground);">Remove</button>
          </span>
        </div>
        <p class="empty" style="font-size: 10px;"><code>${escapeHtml(f.url)}</code>${c ? ' · cached ' + escapeHtml(age) : ''}</p>
        ${err ? `<p class="empty">${escapeHtml(err)}</p>` : ''}
        ${items.length ? `<ul class="list" style="list-style: none; padding: 0;">${items.slice(0, 15).map(feedItemCard).join('')}</ul>` : ''}
      </div>`;
    }).join('');
    return `<h3 class="sub-h">Custom feeds <span class="cost-rate">${feeds.length}</span></h3>${cards}${addForm}`;
  }

  function routinesSection(snap) {
    const r = snap.routines || { local: [], cloudEnabled: false, cloudUrl: '', scheduledTasksDir: '', scheduledTasksDirExists: false };
    const local = r.local || [];

    const newRoutineBtn = `<button class="office-btn" data-action="new-routine" title="Create a new routine SKILL.md">+ New routine</button>`;

    const localBlock = !r.scheduledTasksDirExists
      ? `<p class="empty">No <code>~/.claude/scheduled-tasks/</code> directory yet. Click <strong>+ New routine</strong> to create one.</p>`
      : !local.length
      ? `<p class="empty">Directory exists but no routines yet. Click <strong>+ New routine</strong> or create <code>~/.claude/scheduled-tasks/&lt;name&gt;/SKILL.md</code> manually.</p>`
      : `<ul class="list" data-search-target="routines" style="list-style: none; padding: 0;">${local
          .map((rt) => {
            const cad = rt.cadenceHint ? `<span class="tag">${escapeHtml(rt.cadenceHint)}</span>` : '';
            const sizeKb = (rt.bodyBytes / 1024).toFixed(1);
            return `<li data-search-text="${escapeHtml((rt.name + ' ' + rt.description).toLowerCase())}">
              <div class="watch-card" style="display: block;">
                <div class="row">
                  <a class="left link" data-open-file="${escapeHtml(rt.filePath)}" title="${escapeHtml(rt.filePath)}"><strong>${escapeHtml(rt.name)}</strong></a>
                  <span class="right">${cad}<span class="tag">${sizeKb} KB</span></span>
                </div>
                <div class="note-excerpt">${escapeHtml(rt.description || 'No description.')}</div>
                <div style="margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 10px;">
                  edited ${fmtAge(rt.mtimeMs)} ·
                  <a class="link" data-open-file="${escapeHtml(rt.filePath)}">open SKILL.md</a> ·
                  <a class="link" data-reveal="${escapeHtml(rt.dirPath)}">reveal in OS</a> ·
                  <button class="rec-action" data-run-routine="${escapeHtml(rt.name)}" title="Open a terminal that pipes the SKILL.md into a fresh claude session">▶ Run now</button>
                </div>
              </div>
            </li>`;
          })
          .join('')}</ul>`;

    const cloudBlock = r.cloudEnabled
      ? `<div class="watch-card" style="display: block;">
          <div class="row">
            <span class="left"><strong>Cloud routines</strong></span>
            <span class="right"><span class="tag tag-used">opt-in enabled</span></span>
          </div>
          <div class="note-excerpt">Cloud routines (scheduled remote agents) are managed in the Claude desktop app and on claude.ai. Cockpit can't read their state — Anthropic doesn't expose a routines API to extensions yet. Manage them directly:</div>
          <div style="margin-top: 6px;">
            <button class="office-btn" data-open-url="${escapeHtml(r.cloudUrl)}">Open Routines in Claude.ai ↗</button>
          </div>
        </div>`
      : `<div class="watch-card" style="display: block;">
          <div class="row">
            <span class="left"><strong>Cloud routines</strong></span>
            <span class="right"><span class="tag">opt-in disabled</span></span>
          </div>
          <div class="note-excerpt">Scheduled remote agents that run on Anthropic infrastructure (managed via the Claude desktop app and claude.ai). Cockpit's privacy stance is local-only by default — enable <code>claudeCockpit.cloudRoutines.enabled</code> in settings to surface a deep-link to manage them.</div>
        </div>`;

    return `
      <div class="row">
        <h2 class="left">Routines <span class="cost-rate">${local.length} local</span></h2>
        <span class="right">${newRoutineBtn}</span>
      </div>
      <p class="empty" style="font-size: 11px; margin-bottom: 8px;">Routines = scheduled Claude Code runs. Local routines live as <code>SKILL.md</code> files under <code>~/.claude/scheduled-tasks/</code>. Cloud routines live in your Anthropic account.</p>

      <h3 class="sub-h">Local <span class="cost-rate">${local.length}</span></h3>
      ${local.length ? `<input type="search" class="search" data-search="routines" placeholder="Filter routines…" />` : ''}
      ${localBlock}

      <h3 class="sub-h">Cloud</h3>
      ${cloudBlock}
    `;
  }

  function rtkSection(snap) {
    const r = snap.rtk;
    if (!r || !r.installed) return '';
    return `
      <h2>RTK token killer <span class="cost-rate">${r.efficiencyPct ? r.efficiencyPct.toFixed(1) + '%' : '—'} efficient</span></h2>
      <div class="kv">
        <span class="k">Commands</span><span class="v">${r.totalCommands ? r.totalCommands.toLocaleString() : '—'}</span>
        <span class="k">Saved</span><span class="v">${escapeHtml(r.tokensSaved || '—')}</span>
        ${r.topCommand ? `<span class="k">Top</span><span class="v">${escapeHtml(r.topCommand.slice(0, 60))}</span>` : ''}
      </div>
    `;
  }

  function plansSection(snap) {
    const plans = snap.plans || [];
    if (!plans.length) return '';
    const cards = plans
      .map((p) => {
        const tone = p.pct >= 100 ? 'ok' : p.pct >= 50 ? 'warn' : p.pct >= 1 ? 'ok' : 'warn';
        const next = p.nextItems.slice(0, 5)
          .map((t) => `<li>${escapeHtml(t.slice(0, 100))}${t.length > 100 ? '…' : ''}</li>`)
          .join('');
        return `
          <div class="watch-card" style="display: block;">
            <div class="row">
              <a class="left link" data-open-file="${escapeHtml(p.path)}" title="${escapeHtml(p.path)}"><strong>${escapeHtml(p.name)}</strong></a>
              <span class="right">${p.doneCount}/${p.totalCount} · ${p.pct}%</span>
            </div>
            <div class="bar" style="margin-top: 4px;"><div class="bar-fill bar-${escapeHtml(tone)}" style="width: ${p.pct}%"></div></div>
            ${next ? `<ul class="list" style="margin-top: 6px;">${next}</ul>` : ''}
          </div>`;
      })
      .join('');
    return `<h2>Plans <span class="cost-rate">${plans.length}</span></h2>${cards}`;
  }

  function heatmapSection(snap) {
    const h = snap.heatmap;
    if (!h || h.max === 0) return '';
    const dayLabels = ['6d', '5d', '4d', '3d', '2d', '1d', 'today'];
    const grid = [];
    const map = new Map();
    for (const c of h.cells) map.set(c.day * 24 + c.hour, c.count);
    let html = '<div style="display: grid; grid-template-columns: 32px repeat(24, 1fr); gap: 1px; font-size: 9px; color: var(--vscode-descriptionForeground);">';
    html += '<div></div>';
    for (let hr = 0; hr < 24; hr++) {
      html += `<div style="text-align: center; font-variant-numeric: tabular-nums;">${hr % 6 === 0 ? hr : ''}</div>`;
    }
    for (let day = 0; day < 7; day++) {
      html += `<div style="text-align: right; padding-right: 4px;">${dayLabels[day]}</div>`;
      for (let hr = 0; hr < 24; hr++) {
        const count = map.get(day * 24 + hr) || 0;
        const intensity = count === 0 ? 0 : Math.max(0.15, count / h.max);
        const bg = count === 0
          ? 'var(--vscode-editorWidget-border)'
          : `rgba(106, 212, 143, ${intensity.toFixed(2)})`;
        html += `<div title="${dayLabels[day]} ${hr}:00 — ${count}" style="background: ${bg}; height: 10px; border-radius: 1px;"></div>`;
      }
    }
    html += '</div>';
    return `<h2>Activity heatmap <span class="cost-rate">last 7 days</span></h2>${html}<div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 4px;">Hour of day → ; brighter = more events</div>`;
    void grid;
  }

  function chatExportSection(snap) {
    const c = snap.chatExport;
    if (!c) {
      return `
        <h2>Chat surface (claude.ai)</h2>
        <p class="empty">Chat export not detected.</p>
      `;
    }
    if (!c.installed) {
      return `
        <h2>Chat surface (claude.ai)</h2>
        <p class="empty">No <code>claude-data-export</code> folder found.</p>
        <p class="empty" style="font-size: 11px; margin-top: 4px;">Export your claude.ai data, drop the JSON into <code>~/Documents/Code/claude-data-export/</code>, refresh.</p>
      `;
    }
    const memBlock = c.memoryPreview
      ? `
        <h3 class="sub-h">claude.ai memory <span class="cost-rate">${(c.memoryPreview.bytes / 1024).toFixed(1)} KB</span></h3>
        <div class="watch-card" style="display: block;">
          <div class="note-excerpt">${escapeHtml(c.memoryPreview.preview)}…</div>
          <div class="row" style="margin-top: 6px;">
            <a class="left link" data-open-file="${escapeHtml(c.memoryPreview.fullPath)}">open full memory →</a>
          </div>
        </div>
      `
      : '';
    const convs = c.recentConversations || [];
    const convList = convs.length
      ? convs
          .map(
            (cv) => `
        <div class="note-card">
          <div class="row">
            <span class="left note-title">${escapeHtml(cv.name)}</span>
            <span class="right">${escapeHtml(fmtRelative(cv.updatedAt || cv.createdAt))} · ${cv.messageCount} msgs</span>
          </div>
          ${cv.excerpt ? `<div class="note-excerpt">${escapeHtml(cv.excerpt)}</div>` : ''}
        </div>`,
          )
          .join('')
      : '<p class="empty">No conversations parsed.</p>';
    return `
      <h2>Chat surface (claude.ai) <span class="cost-rate">${c.conversationCount} convos · ${c.projectCount} projects</span></h2>
      <p class="empty" style="font-size: 11px; margin-bottom: 8px;">From <code>${escapeHtml(c.exportPath)}</code></p>
      ${memBlock}
      <h3 class="sub-h">Recent conversations</h3>
      ${convList}
    `;
  }

  function fmtUsdAmount(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0.00';
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 100) return '$' + n.toFixed(0);
    if (n >= 10) return '$' + n.toFixed(1);
    return '$' + n.toFixed(2);
  }

  function fmtTokensCompact(n) {
    if (typeof n !== 'number' || !isFinite(n) || n === 0) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function usageRollupsSection(snap) {
    const u = snap.usage;
    if (!u) {
      return '<h2>Usage rollups</h2><p class="empty">No usage data scanned yet.</p>';
    }
    const periods = [
      { key: 'session', label: 'Session' },
      { key: 'today',   label: 'Today' },
      { key: 'week',    label: 'This week' },
      { key: 'month',   label: 'This month' },
      { key: 'year',    label: 'This year' },
      { key: 'allTime', label: 'All time' },
    ];
    const rows = periods.map(({ key, label }) => {
      const p = u[key];
      if (!p) return '';
      const cap = p.capUsd > 0;
      const bar = cap
        ? `<div class="bar"><div class="bar-fill bar-${escapeHtml(p.tone)}" style="width: ${p.pct.toFixed(1)}%"></div></div>`
        : '';
      const capText = cap
        ? `${fmtUsdAmount(p.totalUsd)} / ${fmtUsdAmount(p.capUsd)}`
        : fmtUsdAmount(p.totalUsd);
      const subline = `${fmtTokensCompact(p.totalTokens)} tok · ${p.turns} turn${p.turns === 1 ? '' : 's'}`;
      const noCapHint = !cap && (key === 'week' || key === 'month' || key === 'year')
        ? ` <span class="tag" title="Set claudeCockpit.budget.${key === 'week' ? 'weekly' : key === 'month' ? 'monthly' : 'yearly'}CapUsd to enable progress bar">no cap</span>`
        : '';
      return `
        <div class="budget-row" style="margin-top: 6px;">
          <span>${escapeHtml(label)}${noCapHint}</span>
          <span class="b-cap">${escapeHtml(capText)}</span>
        </div>
        <div class="budget-row" style="opacity: 0.7; font-size: 11px;">
          <span>${escapeHtml(subline)}</span>
          <span></span>
        </div>
        ${bar}
      `;
    }).join('');
    const scanInfo = u.scanMs > 0
      ? `<p class="empty" style="font-size: 10px; margin-top: 6px;">Scanned ${u.scannedFiles} file${u.scannedFiles === 1 ? '' : 's'} · ${u.cacheHits} cached · ${u.scanMs}ms</p>`
      : '';
    return `
      <h2>Usage rollups</h2>
      <div class="budget-card">${rows}</div>
      ${scanInfo}
    `;
  }

  function usageDashboardSection(snap) {
    const u = snap.usageDashboard;
    if (!u) return '';
    if (u.url) {
      return `
        <h2>Usage dashboard <span class="cost-rate">running on :${u.runningOnPort}</span></h2>
        <div class="actions">
          <button class="office-btn" data-open-url="${escapeHtml(u.url)}">Open dashboard ↗</button>
          <button class="office-btn" data-qa="detect-usage">Re-check</button>
        </div>
      `;
    }
    if (u.installed) {
      return `
        <h2>Usage dashboard <span class="cost-rate">installed, not running</span></h2>
        <p class="empty">Found at <code>${escapeHtml(u.installPath)}</code>.</p>
        <div class="actions">
          <button class="office-btn" data-qa="start-usage">Start dashboard</button>
          <button class="office-btn" data-qa="detect-usage">Re-check</button>
        </div>
      `;
    }
    return `
      <h2>Usage dashboard <span class="cost-rate">not installed</span></h2>
      <p class="empty">Install <a class="link" data-open-url="https://github.com/phuryn/claude-usage">claude-usage</a> for charts of cost-by-day, model breakdown, hour heatmap.</p>
    `;
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
    const prompts = (snap.prompts || []).map((p) => ({
      ...p,
      category: p.category || 'other',
    }));
    const state = vscode.getState() || {};
    const activeFilter = state.promptFilter || 'all';
    // Count per category for chip labels.
    const counts = { all: prompts.length };
    for (const c of PROMPT_CATEGORIES) counts[c] = 0;
    for (const p of prompts) counts[p.category] = (counts[p.category] || 0) + 1;

    const chipFilters = ['all', ...PROMPT_CATEGORIES.filter((c) => counts[c] > 0)];
    const chips = chipFilters
      .map(
        (f) => `<button class="filter-chip ${activeFilter === f ? 'on' : ''}" data-prompt-filter="${f}">${
          PROMPT_CATEGORY_LABELS[f]
        }${counts[f] ? ` <span class="chip-count">${counts[f]}</span>` : ''}</button>`,
      )
      .join('');

    const filtered = activeFilter === 'all' ? prompts : prompts.filter((p) => p.category === activeFilter);

    const search = prompts.length
      ? '<input type="search" class="search" data-search="prompts" placeholder="Search prompts…" style="margin-top: 6px;" />'
      : '';

    const cards = filtered.length
      ? `<ul class="list" data-search-target="prompts" style="list-style: none; padding: 0;">${filtered
          .map(
            (p) => `<li data-search-text="${escapeHtml((p.title + ' ' + p.body).toLowerCase())}">
              <div class="prompt-card">
                <div class="row">
                  <div class="prompt-title left">${escapeHtml(p.title)}</div>
                  <span class="right">
                    <select class="prompt-cat-select" data-prompt-cat-id="${escapeHtml(p.id)}" title="Category">
                      ${PROMPT_CATEGORIES.map(
                        (c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${PROMPT_CATEGORY_LABELS[c]}</option>`,
                      ).join('')}
                    </select>
                  </span>
                </div>
                <div class="prompt-body">${escapeHtml(p.body)}</div>
                <div class="prompt-actions">
                  <button class="watch-action" data-prompt-use="${escapeHtml(p.id)}">Copy</button>
                  <button class="watch-action" data-prompt-delete="${escapeHtml(p.id)}" style="color: var(--vscode-errorForeground);">Delete</button>
                </div>
              </div>
            </li>`,
          )
          .join('')}</ul>`
      : prompts.length
      ? `<p class="empty">No prompts in <strong>${escapeHtml(PROMPT_CATEGORY_LABELS[activeFilter])}</strong>. Switch filter or add one below.</p>`
      : `<p class="empty">No saved prompts yet. Click <strong>Mine recent prompts</strong> to scan your sessions, or add one manually below.</p>`;

    const minedBlock = renderMinedPromptsBlock();

    return `
      <h2>Prompt library <span class="cost-rate">${prompts.length}</span>
        <button class="office-btn" data-prompt-mine style="float: right;">⛏ Mine recent prompts</button>
      </h2>
      ${prompts.length ? `<div class="filter-chips">${chips}</div>` : ''}
      ${search}
      ${minedBlock}
      ${cards}
      <div class="prompt-form">
        <input data-prompt-title placeholder="Prompt title (e.g. 'plan-review')" />
        <select data-prompt-cat-new>
          <option value="">Auto-classify</option>
          ${PROMPT_CATEGORIES.map((c) => `<option value="${c}">${PROMPT_CATEGORY_LABELS[c]}</option>`).join('')}
        </select>
        <textarea data-prompt-body placeholder="Prompt body — gets copied to clipboard"></textarea>
        <button class="office-btn" data-prompt-add>Save prompt</button>
      </div>
    `;
  }

  function renderMinedPromptsBlock() {
    if (!minedPromptsState) return '';
    const { prompts, selected } = minedPromptsState;
    if (!prompts.length) {
      return `
        <div class="mined-block">
          <div class="row">
            <h3 class="sub-h left">Mined prompts</h3>
            <button class="watch-action right" data-prompt-mine-close>Dismiss</button>
          </div>
          <p class="empty">No reusable prompts found in your recent sessions. Once you've reused a prompt across sessions, it'll show up here.</p>
        </div>
      `;
    }
    const rows = prompts
      .map((p, idx) => {
        const fp = p.fingerprint;
        const checked = selected.has(fp) ? 'checked' : '';
        const preview = p.body.length > 220 ? p.body.slice(0, 220) + '…' : p.body;
        const occ = p.occurrences > 1 ? `<span class="tag tag-used">×${p.occurrences}</span>` : '';
        const proj = p.projectHint ? `<span class="tag">${escapeHtml(p.projectHint)}</span>` : '';
        return `<li>
          <label class="mined-row">
            <input type="checkbox" data-mined-toggle="${escapeHtml(fp)}" ${checked} />
            <div class="mined-content">
              <div class="row">
                <span class="left"><strong>${escapeHtml(deriveTitle(p.body, idx))}</strong> <span class="tag tag-${escapeHtml(p.category)}">${escapeHtml(PROMPT_CATEGORY_LABELS[p.category])}</span></span>
                <span class="right">${occ}${proj}</span>
              </div>
              <div class="mined-preview">${escapeHtml(preview)}</div>
            </div>
          </label>
        </li>`;
      })
      .join('');
    const selCount = selected.size;
    return `
      <div class="mined-block">
        <div class="row">
          <h3 class="sub-h left">Mined prompts <span class="cost-rate">${prompts.length}</span></h3>
          <span class="right">
            <button class="watch-action" data-prompt-mine-select-all>${selCount === prompts.length ? 'Deselect all' : 'Select all'}</button>
            <button class="office-btn" data-prompt-mine-save ${selCount ? '' : 'disabled'}>Save ${selCount || ''} selected</button>
            <button class="watch-action" data-prompt-mine-close>Dismiss</button>
          </span>
        </div>
        <p class="empty" style="font-size: 11px;">Found ${prompts.length} reusable prompts across your recent sessions. Tick the ones to add to your library.</p>
        <ul class="list" style="list-style: none; padding: 0;">${rows}</ul>
      </div>
    `;
  }

  function deriveTitle(body, idx) {
    // First line, capped at 60 chars. If first line is too generic, fall back
    // to a numbered title.
    const first = body.split(/\n/)[0].trim();
    if (first.length >= 8 && first.length <= 80) return first;
    if (first.length > 80) return first.slice(0, 77) + '…';
    return `Mined prompt ${idx + 1}`;
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
    const burn = typeof b.burnUsdPerHour === 'number' ? b.burnUsdPerHour : 0;
    const projectionLine = burn > 0
      ? (() => {
          const burnText = `$${burn.toFixed(2)}/hr`;
          const next30 = `$${(b.projected30MinUsd || 0).toFixed(2)}`;
          const capWarn = b.projectedDailyHitsCap
            ? ` <span class="tag tag-warn" title="Projected to hit daily cap before midnight at current burn rate">will hit cap</span>`
            : '';
          const tte = typeof b.minutesToDailyCap === 'number'
            ? ` · ETA cap ${b.minutesToDailyCap < 60 ? b.minutesToDailyCap + 'm' : Math.round(b.minutesToDailyCap / 60) + 'h'}`
            : '';
          return `<div class="budget-row" style="margin-top: 8px; opacity: 0.85;"><span>Burn rate</span><span class="b-cap">${burnText} · next 30m ≈ ${next30}${tte}${capWarn}</span></div>`;
        })()
      : '';
    return `
      <h2>Budget caps ${b.enabled ? '<span class="tag tag-used">on</span>' : '<span class="tag">off</span>'}</h2>
      <div class="budget-card">
        ${dailyBar}
        ${sessionBar}
        ${projectionLine}
      </div>
      <div class="actions"><button data-qa="set-cap">Set daily cap</button></div>
    `;
  }

  function selfTelemetrySection(snap) {
    const t = snap.telemetry;
    if (!t || !Array.isArray(t.sections)) {
      return '<h2>Self</h2><p class="empty">No telemetry yet — refresh once.</p>';
    }
    const surfaces = snap.surfaces || {};
    const surfaceState = (k, label) =>
      `<li><span class="left">${escapeHtml(label)}</span><span class="right">${surfaces[k] === false ? '<span class="tag">off</span>' : '<span class="tag tag-used">on</span>'}</span></li>`;
    const upMs = Math.max(0, Date.now() - (t.startedAt || Date.now()));
    const upText = upMs < 60_000 ? `${Math.round(upMs / 1000)}s`
      : upMs < 3600_000 ? `${Math.round(upMs / 60_000)}m`
      : `${(upMs / 3600_000).toFixed(1)}h`;
    const sectionItems = t.sections.length
      ? t.sections
          .map((s) => `
        <li>
          <div class="row">
            <span class="left" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
            <span class="right"><span class="tag">${s.runs}×</span> avg ${s.avgDurationMs}ms · last ${s.lastDurationMs}ms · max ${s.maxDurationMs}ms${s.errorCount > 0 ? ' · <span class="tag tag-warn">' + s.errorCount + ' err</span>' : ''}</span>
          </div>
        </li>`)
          .join('')
      : '<li><span class="empty">Idle.</span></li>';
    return `
      <h2>Self · cockpit observing itself</h2>
      <div class="kv">
        <span class="k">Uptime</span><span class="v">${upText}</span>
        <span class="k">Total runs</span><span class="v">${t.totalRuns}</span>
        <span class="k">Errors</span><span class="v">${t.totalErrors}</span>
      </div>
      <h3 style="margin-top: 12px;">Surfaces enabled</h3>
      <ul class="list">
        ${surfaceState('macHealth', 'Mac Health')}
        ${surfaceState('appUsage', 'App Usage')}
        ${surfaceState('subdomainHealth', 'Subdomain HEAD probes')}
      </ul>
      <h3 style="margin-top: 12px;">Refresh cost by section</h3>
      <ul class="list">${sectionItems}</ul>
      <p class="empty" style="margin-top: 12px;">Each refresh runs the listed sections. If a section is consistently slow (>100ms) and you don't need it, disable its surface in <code>settings.json</code> under <code>claudeCockpit.surfaces.*</code>.</p>
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
    const healthByDomain = new Map(
      (snap.subdomainHealth || []).map((h) => [h.domain, h]),
    );
    const dots = (p.alwaysLive || [])
      .map((d) => {
        const h = healthByDomain.get(d);
        const status = h ? h.status : 'unknown';
        const checked = h && h.checkedAtMs
          ? new Date(h.checkedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'never';
        const httpInfo = h && h.httpStatus ? ` HTTP ${h.httpStatus}` : '';
        const tip = `${d} · ${status}${httpInfo} · checked ${checked}`;
        return `<span class="subdomain-dot subdomain-dot-${status}" title="${escapeHtml(tip)}"></span><span class="subdomain-name">${escapeHtml(d.split('.')[0])}</span>`;
      })
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
        ${pilotNowFlyingStrip(snap)}
        ${principles ? `<div class="pilot-principles-label">core principles</div><ol class="pilot-principles">${principles}</ol>` : ''}
        ${dotsBlock}
      </section>
    `;
  }

  function pilotNowFlyingStrip(snap) {
    const s = snap.stats || {};
    const cwd = snap.cwd;
    if (!cwd) return '';
    const cwdShort = cwd.split('/').filter(Boolean).pop() || cwd;
    const branch = snap.gitBranch;
    const model = s.modelFamily && s.modelFamily !== 'unknown'
      ? s.modelFamily
      : (s.lastModel || '—');
    const ago = pilotFormatAgo(pilotSecondsSince(s.lastActivityAt));
    const liveBadge = s.isActive
      ? `<span class="pilot-live-badge"><span class="live-dot"></span>live</span>`
      : `<span class="pilot-live-badge pilot-live-idle">idle · ${escapeHtml(ago)}</span>`;
    const todoCount = (snap.plans || []).reduce((n, p) => n + (p.pendingCount || 0), 0);
    const fillPct = s.contextFillPct != null ? Math.round(s.contextFillPct) : undefined;
    const tone = fillPct == null ? '' : fillPct > 90 ? ' pilot-chip-danger' : fillPct > 70 ? ' pilot-chip-warn' : '';
    const chips = [
      `<span class="pilot-chip" title="${escapeHtml(cwd)}"><span class="pilot-chip-key">cwd</span><span class="pilot-chip-val">${escapeHtml(cwdShort)}</span></span>`,
      branch ? `<span class="pilot-chip"><span class="pilot-chip-key">branch</span><span class="pilot-chip-val">${escapeHtml(branch)}</span></span>` : '',
      `<span class="pilot-chip"><span class="pilot-chip-key">model</span><span class="pilot-chip-val">${escapeHtml(model)}</span></span>`,
      fillPct != null ? `<span class="pilot-chip${tone}"><span class="pilot-chip-key">ctx</span><span class="pilot-chip-val">${fillPct}%</span></span>` : '',
      todoCount > 0 ? `<span class="pilot-chip"><span class="pilot-chip-key">todos</span><span class="pilot-chip-val">${todoCount}</span></span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="pilot-flying">
        <div class="pilot-flying-head">
          <span class="pilot-flying-label">now flying</span>
          ${liveBadge}
        </div>
        <div class="pilot-chips">${chips}</div>
      </div>
    `;
  }

  function pilotSecondsSince(iso) {
    if (!iso) return undefined;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return undefined;
    return Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  function pilotFormatAgo(seconds) {
    if (seconds == null) return 'never';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
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

  function officeFloorSection(snap) {
    const tiles = snap.officeFloor || [];
    if (!tiles.length) {
      return '<h2>Office floor</h2><p class="empty">No agents on the floor. Open Claude Code in a project — they\'ll show up here.</p>';
    }
    const live = tiles.filter((t) => t.status === 'live').length;
    const recent = tiles.filter((t) => t.status === 'recent').length;
    const idle = tiles.filter((t) => t.status === 'idle' || t.status === 'stale').length;
    const summary = `<div class="today-pill">
      <span><strong>${tiles.length}</strong> projects</span>
      <span><strong>${live}</strong> live</span>
      <span><strong>${recent}</strong> recent</span>
      <span><strong>${idle}</strong> idle</span>
    </div>`;
    const cards = tiles.map((t) => floorTile(t)).join('');
    return `
      <h2>Office floor <span class="cost-rate">${tiles.length} project${tiles.length === 1 ? '' : 's'}</span></h2>
      ${summary}
      <div class="floor-grid">${cards}</div>
    `;
  }

  function floorTile(t) {
    const ageLabel = formatFloorAge(t.ageSeconds);
    const subAgent = t.subAgentName
      ? `<div class="floor-subagent" title="${escapeHtml(t.subAgentDescription || t.subAgentName)}">
           <span class="floor-tag agent">${escapeHtml(t.subAgentName)}</span>
           ${t.subAgentDescription ? `<span class="floor-subagent-desc">${escapeHtml(t.subAgentDescription)}</span>` : ''}
         </div>`
      : '';
    const tool = t.lastTool
      ? `<div class="floor-action">
           <span class="floor-tool floor-result-${escapeHtml(t.lastToolResult || 'pending')}">${escapeHtml(t.lastTool)}</span>
           ${t.lastToolArgs ? `<span class="floor-tool-args" title="${escapeHtml(t.lastToolArgs)}">${escapeHtml(truncateFloor(t.lastToolArgs, 60))}</span>` : ''}
         </div>`
      : '<div class="floor-action floor-quiet">idle</div>';
    const file = t.currentFile
      ? `<div class="floor-file" title="${escapeHtml(t.currentFile)}">📄 ${escapeHtml(basename(t.currentFile))}</div>`
      : '';
    const modelTag = t.modelFamily && t.modelFamily !== 'unknown'
      ? `<span class="floor-tag model-${escapeHtml(t.modelFamily)}">${escapeHtml(t.modelFamily)}</span>`
      : '';
    return `
      <div class="floor-card floor-status-${escapeHtml(t.status)}" data-watch-session="${escapeHtml(t.sessionFile)}" data-watch-project="${escapeHtml(t.decodedPath)}" title="Click to open this session">
        <div class="floor-head">
          <span class="floor-status-dot ${escapeHtml(t.status)}"></span>
          <span class="floor-name">${escapeHtml(t.name)}</span>
          ${modelTag}
          <span class="floor-age">${escapeHtml(ageLabel)}</span>
        </div>
        ${subAgent}
        ${tool}
        ${file}
      </div>
    `;
  }

  function formatFloorAge(s) {
    if (s == null) return '—';
    if (s < 10) return 'now';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  }

  function truncateFloor(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
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

  // ===========================================================================
  // Talk tab — Jarvis-grade audio-reactive viz. Multi-layer renderer:
  //   1. Background nebula (depth gradient + drifting dust)
  //   2. HUD ring (segmented arcs that pulse on activity)
  //   3. Core particle sphere (Fibonacci distribution, audio-reactive expand)
  //   4. Energy streams (during 'speaking' mode — particles fly outward like
  //      Jarvis emitting light beams when responding)
  //   5. Lens flare core glow
  // States: 'idle' | 'listening' | 'thinking' | 'speaking'
  // ===========================================================================
  const Talk = (() => {
    let audioCtx = null;
    let analyser = null;
    let micStream = null;
    let level = 0;          // smoothed amplitude, 0..1
    let levelTarget = 0;
    let mode = 'idle';      // idle | listening | thinking | speaking
    let micBlocked = false; // true once getUserMedia has failed once
    let recognition = null;
    let canvas = null;
    let ctx2d = null;
    let rafHandle = null;
    let coreParticles = null;
    let dustParticles = null;
    let streams = [];        // active speaking-mode emissions
    let coreRotX = 0;
    let coreRotY = 0;
    let hudRotation = 0;
    let speakingEnvelope = null; // { until, baseline, fn } for synth speaking
    let utterance = null;        // current SpeechSynthesisUtterance
    let resizeObserver = null;   // tracked so teardown() can disconnect

    // Fibonacci sphere — N evenly-distributed unit vectors. Generated once.
    function buildCoreParticles(n) {
      const out = new Array(n);
      const phi = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const theta = phi * i;
        out[i] = {
          x: Math.cos(theta) * radius,
          y,
          z: Math.sin(theta) * radius,
          jitter: Math.random() * 0.18,
          twinkle: Math.random() * Math.PI * 2,
        };
      }
      return out;
    }

    // Outer ambient dust — slow-drifting points that give the viz "atmosphere".
    function buildDust(n, w, h) {
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = {
          x: Math.random() * w,
          y: Math.random() * h,
          z: Math.random(), // depth 0..1 (parallax)
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.1,
          baseSize: 0.4 + Math.random() * 0.9,
          phase: Math.random() * Math.PI * 2,
        };
      }
      return out;
    }

    function ensureCanvas() {
      const c = document.querySelector('canvas[data-talk-canvas]');
      if (c && c !== canvas) {
        canvas = c;
        ctx2d = c.getContext('2d');
        const resize = () => {
          if (!canvas) return;
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
          ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
          // Re-seed dust whenever canvas size changes meaningfully.
          dustParticles = buildDust(120, w, h);
        };
        resize();
        if (resizeObserver) { try { resizeObserver.disconnect(); } catch {} }
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
      }
      if (!coreParticles) coreParticles = buildCoreParticles(520);
    }

    function startAnimation() {
      if (rafHandle) return;
      let last = performance.now();
      const tick = (now) => {
        rafHandle = requestAnimationFrame(tick);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        sampleAudio(now);
        updateStreams(dt);
        draw(dt);
      };
      rafHandle = requestAnimationFrame(tick);
    }

    function stopAnimation() {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }

    function sampleAudio(now) {
      // Synthetic envelope (speaking-preview) overrides real mic.
      if (speakingEnvelope) {
        if (now > speakingEnvelope.until) {
          speakingEnvelope = null;
          if (mode === 'speaking') setMode('idle');
        } else {
          levelTarget = speakingEnvelope.fn(now);
        }
      } else if (analyser) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        levelTarget = Math.min(1, rms * 4.5);
      } else {
        // Decay when nothing's driving level.
        levelTarget *= 0.92;
        // In idle, breathe a tiny baseline so viz isn't dead-still.
        if (mode === 'idle') {
          levelTarget = Math.max(levelTarget, 0.04 + 0.02 * Math.sin(now / 1400));
        }
      }
      level += (levelTarget - level) * 0.18;
    }

    function updateStreams(dt) {
      // Speaking mode emits particle streams outward continuously.
      if (mode === 'speaking' && level > 0.05) {
        const emissions = Math.min(8, Math.floor(level * 12));
        for (let i = 0; i < emissions; i++) emitStream();
      }
      for (let i = streams.length - 1; i >= 0; i--) {
        const s = streams[i];
        s.life -= dt;
        if (s.life <= 0) { streams.splice(i, 1); continue; }
        s.r += s.speed * dt;
        s.alpha = Math.max(0, s.life / s.maxLife);
      }
    }

    function emitStream() {
      // Emit from a random point on the core sphere outward.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.cos(phi);
      const dirZ = Math.sin(phi) * Math.sin(theta);
      streams.push({
        x: dirX, y: dirY, z: dirZ,    // unit-vector direction
        r: 1.0,                        // start at sphere surface
        speed: 1.6 + Math.random() * 1.4,
        life: 0.7 + Math.random() * 0.6,
        maxLife: 1.3,
        alpha: 1,
        hue: 195 + Math.random() * 50, // cyan→teal
        size: 0.8 + Math.random() * 1.2,
      });
    }

    function draw(dt) {
      if (!ctx2d || !canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;

      // === Layer 1: background — radial gradient + slow trail
      const bg = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h));
      bg.addColorStop(0, 'rgba(8, 14, 32, 0.22)');
      bg.addColorStop(0.6, 'rgba(4, 7, 18, 0.32)');
      bg.addColorStop(1, 'rgba(0, 0, 4, 0.55)');
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, w, h);

      // === Layer 2: drifting dust (parallax)
      if (dustParticles) {
        for (const d of dustParticles) {
          d.x += d.vx * (0.5 + d.z);
          d.y += d.vy * (0.5 + d.z);
          d.phase += dt * 1.8;
          if (d.x < -10) d.x = w + 10; else if (d.x > w + 10) d.x = -10;
          if (d.y < -10) d.y = h + 10; else if (d.y > h + 10) d.y = -10;
          const a = (0.18 + 0.22 * Math.sin(d.phase)) * (0.4 + 0.6 * d.z);
          ctx2d.fillStyle = `rgba(150, 200, 255, ${a.toFixed(3)})`;
          ctx2d.beginPath();
          ctx2d.arc(d.x, d.y, d.baseSize * (0.5 + 0.5 * d.z), 0, Math.PI * 2);
          ctx2d.fill();
        }
      }

      const baseR = Math.min(w, h) * 0.30;
      const expand = baseR * (1 + level * 0.55);

      // === Layer 3: HUD ring (segmented arcs)
      hudRotation += 0.003 + level * 0.01;
      drawHudRing(cx, cy, baseR * 1.42, hudRotation, level);
      drawHudRing(cx, cy, baseR * 1.62, -hudRotation * 0.7, level * 0.8);

      // === Layer 4: speaking streams (drawn behind core)
      drawStreams(cx, cy, expand);

      // === Layer 5: core particle sphere
      coreRotX += 0.0028 + level * 0.014;
      coreRotY += 0.0019 + level * 0.008;
      const cosR = Math.cos(coreRotX);
      const sinR = Math.sin(coreRotX);
      const cosT = Math.cos(coreRotY);
      const sinT = Math.sin(coreRotY);

      // Color tinting per mode.
      const palette = paletteFor(mode, level);

      for (let i = 0; i < coreParticles.length; i++) {
        const p = coreParticles[i];
        const x1 = p.x * cosR + p.z * sinR;
        const z1 = -p.x * sinR + p.z * cosR;
        const y1 = p.y * cosT - z1 * sinT;
        const z2 = p.y * sinT + z1 * cosT;
        const persp = 1 / (1.45 - z2 * 0.45);
        const breathe = 1 + p.jitter * level + 0.04 * Math.sin(p.twinkle + hudRotation * 4 + level * 6);
        const r = expand * breathe;
        const px = cx + x1 * r * persp;
        const py = cy + y1 * r * persp;
        const depth = (z2 + 1) / 2;
        const size = (0.6 + depth * 1.7) * (1 + level * 0.65);
        const alpha = (0.25 + depth * 0.7) * palette.coreAlpha;
        ctx2d.fillStyle = `hsla(${palette.hue + level * 30}, 85%, ${50 + depth * 30}%, ${alpha.toFixed(3)})`;
        ctx2d.beginPath();
        ctx2d.arc(px, py, size, 0, Math.PI * 2);
        ctx2d.fill();
      }

      // === Layer 6: core glow + lens flare
      const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, expand * 1.4);
      glow.addColorStop(0, `hsla(${palette.hue}, 90%, 70%, ${(0.06 + level * 0.22) * palette.coreAlpha})`);
      glow.addColorStop(0.5, `hsla(${palette.hue}, 85%, 55%, ${(0.02 + level * 0.08) * palette.coreAlpha})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx2d.fillStyle = glow;
      ctx2d.fillRect(0, 0, w, h);

      // Subtle scanline highlight that crosses the sphere.
      const scanY = cy + Math.sin(hudRotation * 1.2) * baseR * 0.6;
      const scanGrad = ctx2d.createLinearGradient(0, scanY - 1, 0, scanY + 1);
      scanGrad.addColorStop(0, 'rgba(180, 230, 255, 0)');
      scanGrad.addColorStop(0.5, `rgba(180, 230, 255, ${0.12 + level * 0.18})`);
      scanGrad.addColorStop(1, 'rgba(180, 230, 255, 0)');
      ctx2d.fillStyle = scanGrad;
      ctx2d.fillRect(cx - expand, scanY - 1, expand * 2, 2);
    }

    function drawHudRing(cx, cy, radius, rot, intensity) {
      const segments = 24;
      const gap = 0.06;
      for (let i = 0; i < segments; i++) {
        // Skip random segments to feel mechanical.
        if ((i + Math.floor(rot * 3)) % 5 === 0) continue;
        const seg = (Math.PI * 2) / segments;
        const a0 = i * seg + rot + gap;
        const a1 = (i + 1) * seg + rot - gap;
        const alpha = (0.18 + intensity * 0.45) * (0.5 + 0.5 * Math.sin(rot * 5 + i));
        ctx2d.strokeStyle = `hsla(195, 90%, ${60 + intensity * 25}%, ${alpha.toFixed(3)})`;
        ctx2d.lineWidth = 1 + intensity * 1.5;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, radius, a0, a1);
        ctx2d.stroke();
      }
      // Tick marks every 8 segments.
      for (let i = 0; i < 8; i++) {
        const a = i * (Math.PI * 2 / 8) + rot * 0.5;
        const tx = cx + Math.cos(a) * radius;
        const ty = cy + Math.sin(a) * radius;
        ctx2d.fillStyle = `hsla(195, 90%, 75%, ${(0.4 + intensity * 0.5).toFixed(3)})`;
        ctx2d.beginPath();
        ctx2d.arc(tx, ty, 1.4, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }

    function drawStreams(cx, cy, sphereR) {
      if (!streams.length) return;
      // Use the same rotation as the core so streams appear to come FROM
      // the sphere surface into camera space.
      const cosR = Math.cos(coreRotX);
      const sinR = Math.sin(coreRotX);
      const cosT = Math.cos(coreRotY);
      const sinT = Math.sin(coreRotY);
      for (const s of streams) {
        const x1 = s.x * cosR + s.z * sinR;
        const z1 = -s.x * sinR + s.z * cosR;
        const y1 = s.y * cosT - z1 * sinT;
        const z2 = s.y * sinT + z1 * cosT;
        const persp = 1 / (1.4 - z2 * 0.4);
        const px = cx + x1 * sphereR * s.r * persp;
        const py = cy + y1 * sphereR * s.r * persp;
        // Trail: line from (s.r - 0.15) → (s.r) along same direction
        const r0 = Math.max(1.0, s.r - 0.18);
        const px0 = cx + x1 * sphereR * r0 * persp;
        const py0 = cy + y1 * sphereR * r0 * persp;
        const grad = ctx2d.createLinearGradient(px0, py0, px, py);
        grad.addColorStop(0, `hsla(${s.hue}, 95%, 70%, 0)`);
        grad.addColorStop(1, `hsla(${s.hue}, 95%, 75%, ${(s.alpha * 0.9).toFixed(3)})`);
        ctx2d.strokeStyle = grad;
        ctx2d.lineWidth = s.size * (0.5 + s.alpha);
        ctx2d.beginPath();
        ctx2d.moveTo(px0, py0);
        ctx2d.lineTo(px, py);
        ctx2d.stroke();
        // Bright head.
        ctx2d.fillStyle = `hsla(${s.hue}, 100%, 88%, ${s.alpha.toFixed(3)})`;
        ctx2d.beginPath();
        ctx2d.arc(px, py, s.size * 1.4, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }

    function paletteFor(m, lvl) {
      if (m === 'listening') return { hue: 195, coreAlpha: 1.0 };           // cyan
      if (m === 'thinking')  return { hue: 270 - lvl * 20, coreAlpha: 0.9 }; // violet
      if (m === 'speaking')  return { hue: 30 + lvl * 20, coreAlpha: 1.05 }; // amber/gold (Jarvis)
      return { hue: 210, coreAlpha: 0.85 }; // idle: muted blue
    }

    function setMode(next) {
      mode = next;
      const indicator = document.querySelector('[data-talk-mode]');
      if (indicator) {
        indicator.textContent = MODE_LABELS[next] || next;
        indicator.dataset.mode = next;
      }
      updateButtons();
    }

    const MODE_LABELS = {
      idle: 'IDLE',
      listening: 'LISTENING',
      thinking: 'THINKING',
      speaking: 'SPEAKING',
    };

    async function startListening() {
      if (mode === 'listening') return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showBanner(
          'Microphone API not exposed in this VSCode webview build. ' +
          'Use <strong>Wispr Flow</strong> or system dictation (fn-fn) and click in the textarea.',
          'warn'
        );
        micBlocked = true;
        return;
      }
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        setMode('listening');
        clearBanner();
        startRecognition();
      } catch (err) {
        micBlocked = true;
        const reason = err && err.message ? err.message : String(err);
        showBanner(
          `Mic blocked: ${escapeHtml(reason)}. VSCode webviews deny mic by default — use <strong>Wispr Flow</strong> or system dictation, then click <strong>▶ Speak preview</strong> below to see the AI-speaking visualization.`,
          'error'
        );
      }
    }

    function stopListening() {
      if (mode !== 'listening') return;
      if (micStream) {
        for (const t of micStream.getTracks()) t.stop();
        micStream = null;
      }
      analyser = null;
      stopRecognition();
      setMode('idle');
      levelTarget = 0;
    }

    function startRecognition() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      try {
        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (e) => {
          let finalText = '';
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          const ta = document.querySelector('textarea[data-talk-text]');
          if (finalText && ta) {
            ta.value = (ta.value ? ta.value + ' ' : '') + finalText.trim();
          }
        };
        recognition.onerror = () => { /* silent — banner already shown if blocked */ };
        recognition.onend = () => {
          if (mode === 'listening' && recognition) {
            try { recognition.start(); } catch (_) { /* ignore */ }
          }
        };
        recognition.start();
      } catch (_) {
        recognition = null;
      }
    }

    function stopRecognition() {
      if (recognition) {
        try { recognition.stop(); } catch (_) { /* ignore */ }
        recognition = null;
      }
    }

    // === Speaking preview — drives the speaking-mode viz from a synthetic
    //     envelope so the user can SEE the effect without live AI audio.
    //     Also routes the text through speechSynthesis so they hear it.
    function speakPreview(text) {
      const sample = (text && text.trim()) ||
        'Cockpit online. All systems nominal. Awaiting your direction.';
      // Cancel any in-flight utterance.
      try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
      setMode('speaking');
      const startedAt = performance.now();
      const wordCount = sample.split(/\s+/).filter(Boolean).length;
      // ~150wpm average speech — give the envelope ~that long.
      const durationMs = Math.max(1500, (wordCount / 150) * 60_000);
      speakingEnvelope = {
        until: startedAt + durationMs,
        baseline: 0.35,
        fn: (now) => {
          const t = (now - startedAt) / 1000;
          // Combine multiple sines for a speech-like envelope.
          const e1 = 0.45 + 0.35 * Math.sin(t * 6.2);
          const e2 = 0.2 * Math.sin(t * 13.7 + 1.1);
          const e3 = 0.15 * Math.sin(t * 2.1 + 0.4);
          const env = Math.max(0.05, e1 + e2 + e3);
          return Math.min(1, env * 0.85);
        },
      };
      // Best-effort actual speech (works in webview even when mic doesn't).
      try {
        if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
          utterance = new SpeechSynthesisUtterance(sample);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.onend = () => {
            if (mode === 'speaking') setMode('idle');
            speakingEnvelope = null;
          };
          window.speechSynthesis.speak(utterance);
        }
      } catch (_) { /* ignore */ }
    }

    function stopSpeaking() {
      try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
      speakingEnvelope = null;
      if (mode === 'speaking') setMode('idle');
    }

    function showBanner(html, kind) {
      const b = document.querySelector('[data-talk-banner]');
      if (!b) return;
      b.innerHTML = html;
      b.className = `talk-banner talk-banner-${kind || 'info'}`;
      b.style.display = '';
    }

    function clearBanner() {
      const b = document.querySelector('[data-talk-banner]');
      if (!b) return;
      b.style.display = 'none';
    }

    function updateButtons() {
      const startBtn = document.querySelector('button[data-talk-start]');
      const stopBtn = document.querySelector('button[data-talk-stop]');
      const speakBtn = document.querySelector('button[data-talk-speak]');
      const speakStopBtn = document.querySelector('button[data-talk-speak-stop]');
      if (startBtn) startBtn.style.display = mode === 'listening' ? 'none' : '';
      if (stopBtn) stopBtn.style.display = mode === 'listening' ? '' : 'none';
      if (speakBtn) speakBtn.style.display = mode === 'speaking' ? 'none' : '';
      if (speakStopBtn) speakStopBtn.style.display = mode === 'speaking' ? '' : 'none';
    }

    function send(sendMode) {
      const ta = document.querySelector('textarea[data-talk-text]');
      if (!ta) return;
      const text = ta.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'talkToClaude', talkText: text, talkMode: sendMode });
      ta.value = '';
      // Brief "thinking" pulse while terminal is opening.
      setMode('thinking');
      setTimeout(() => { if (mode === 'thinking') setMode('idle'); }, 1800);
    }

    function init() {
      ensureCanvas();
      startAnimation();
      setMode(mode);
      // Surface the known-blocked state proactively so user isn't confused.
      if (micBlocked) {
        showBanner(
          'Microphone unavailable in this VSCode webview build. Use <strong>Wispr Flow</strong> / system dictation to fill the textarea, or click <strong>▶ Speak preview</strong> to demo the AI-speaking visualization.',
          'warn'
        );
      }
    }

    function teardown() {
      stopListening();
      stopSpeaking();
      stopAnimation();
      if (resizeObserver) { try { resizeObserver.disconnect(); } catch {} resizeObserver = null; }
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
      analyser = null;
    }

    return { init, teardown, startListening, stopListening, send, speakPreview, stopSpeaking };
  })();

  function talkSection(snap) {
    return `
      <div class="talk-shell">
        <div class="talk-banner" data-talk-banner style="display: none;"></div>
        <div class="talk-canvas-wrap">
          <canvas data-talk-canvas></canvas>
          <div class="talk-mode-indicator"><span class="talk-mode-dot"></span><span data-talk-mode>IDLE</span></div>
        </div>
        <div class="talk-controls">
          <button class="office-btn" data-talk-start>🎙 Listen</button>
          <button class="office-btn" data-talk-stop style="display: none;">■ Stop</button>
          <button class="office-btn talk-btn-speak" data-talk-speak title="Synthesize speech and drive the speaking-mode viz">▶ Speak preview</button>
          <button class="office-btn" data-talk-speak-stop style="display: none;">■ Stop speaking</button>
          <button class="watch-action" data-talk-wispr title="Trigger Wispr Flow shortcut (configure in settings)">Wispr</button>
        </div>
        <textarea class="talk-text" data-talk-text rows="4" placeholder="Type or dictate. Click ▶ Speak preview to hear it back and watch the viz erupt."></textarea>
        <div class="talk-send-row">
          <button class="office-btn" data-talk-send="new-session">Send → new session</button>
          <button class="watch-action" data-talk-send="resume">Resume last</button>
          <button class="watch-action" data-talk-send="background">Background (--print)</button>
        </div>
        <p class="empty" style="font-size: 11px;">
          Cyan = idle/listening · Violet = thinking · <strong>Amber = speaking</strong> (Jarvis core). Energy streams emit when speaking. Mic uses the browser Web Speech API; if VSCode blocks it (common), use Wispr/system dictation. Voice never leaves your machine.
        </p>
      </div>
    `;
  }

  function securitySection(snap) {
    const sec = snap.security;
    const summary = sec && sec.summary;
    const state = vscode.getState() || {};
    const view = state.securityView || 'overview';

    const headerBtns = `
      <span class="right">
        <button class="office-btn" data-action="security-scan">${sec ? 'Re-scan' : 'Scan now'}</button>
        <button class="office-btn" data-action="launch-cso" title="Run the gstack /cso skill — deeper audit, dependency CVEs, etc.">/cso</button>
      </span>
    `;

    if (!sec) {
      return `
        <div class="row"><h2 class="left">Security</h2>${headerBtns}</div>
        <p class="empty">No scan run yet. Click <strong>Scan now</strong> to audit this workspace for: tracked .env files, hardcoded API keys/tokens in source, MCP servers with inline secrets, git remote exposure. <strong>Local-only — nothing leaves your machine.</strong></p>
        <p class="empty" style="font-size: 11px;">For deeper audits (dependency CVEs, GitHub repo settings, edge-function exposure, OWASP Top 10), use the <code>/cso</code> skill — runs in a terminal here.</p>
      `;
    }

    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'overview' ? 'sub-tab-active' : ''}" data-security-view="overview">Overview</button>
        <button class="sub-tab ${view === 'secrets' ? 'sub-tab-active' : ''}" data-security-view="secrets">Secrets <span class="chip-count">${(sec.secrets || []).length}</span></button>
        <button class="sub-tab ${view === 'env' ? 'sub-tab-active' : ''}" data-security-view="env">.env <span class="chip-count">${(sec.envFiles || []).length}</span></button>
        <button class="sub-tab ${view === 'git' ? 'sub-tab-active' : ''}" data-security-view="git">Git <span class="chip-count">${(sec.gitRemotes || []).length}</span></button>
        <button class="sub-tab ${view === 'mcp' ? 'sub-tab-active' : ''}" data-security-view="mcp">MCP <span class="chip-count">${(sec.mcpServers || []).length}</span></button>
      </div>
    `;

    let body = '';
    if (view === 'overview') body = securityOverviewBody(sec, summary);
    else if (view === 'secrets') body = securitySecretsBody(sec);
    else if (view === 'env') body = securityEnvBody(sec);
    else if (view === 'git') body = securityGitBody(sec);
    else if (view === 'mcp') body = securityMcpBody(sec);

    const truncatedNote = sec.truncated
      ? `<p class="empty" style="font-size: 10px;">⚠ Scan capped — repo is large. Findings shown are partial.</p>`
      : '';

    return `
      <div class="row"><h2 class="left">Security</h2>${headerBtns}</div>
      <p class="empty" style="font-size: 10px;">Last scan: ${escapeHtml(fmtAge(sec.scannedAt))} · root: <code>${escapeHtml(sec.scanRoot || '—')}</code></p>
      ${truncatedNote}
      ${subBar}
      <div class="sub-tab-panel">${body}</div>
    `;
  }

  function severityChip(sev) {
    if (sev === 'high') return '<span class="tag tag-warn">high</span>';
    return '<span class="tag">medium</span>';
  }

  function securityOverviewBody(sec, summary) {
    if (!summary) return '<p class="empty">No findings.</p>';
    const tiles = `
      <div class="sec-tiles">
        <div class="sec-tile ${summary.high ? 'sec-tile-high' : 'sec-tile-clean'}">
          <div class="sec-tile-num">${summary.high}</div>
          <div class="sec-tile-label">high-severity secrets</div>
        </div>
        <div class="sec-tile ${summary.medium ? 'sec-tile-warn' : 'sec-tile-clean'}">
          <div class="sec-tile-num">${summary.medium}</div>
          <div class="sec-tile-label">medium-severity secrets</div>
        </div>
        <div class="sec-tile ${summary.envTracked ? 'sec-tile-high' : 'sec-tile-clean'}">
          <div class="sec-tile-num">${summary.envTracked}</div>
          <div class="sec-tile-label">.env files tracked in git</div>
        </div>
        <div class="sec-tile ${summary.mcpInline ? 'sec-tile-warn' : 'sec-tile-clean'}">
          <div class="sec-tile-num">${summary.mcpInline}</div>
          <div class="sec-tile-label">MCP servers with inline secrets</div>
        </div>
      </div>
    `;
    const verdict = summary.total === 0
      ? '<p class="empty"><strong>✓ Clean scan.</strong> No obvious leaks. Run /cso for deeper audit.</p>'
      : `<p class="empty">${summary.total} finding${summary.total === 1 ? '' : 's'} below. <strong>${summary.high} need urgent action.</strong></p>`;
    return `${tiles}${verdict}`;
  }

  function securitySecretsBody(sec) {
    const list = sec.secrets || [];
    if (!list.length) return '<p class="empty">✓ No hardcoded secrets matched.</p>';
    return `<ul class="list" style="list-style: none; padding: 0;">${list.map((s) => `<li>
      <div class="watch-card" style="display: block;">
        <div class="row">
          <a class="left link" data-open-file="${escapeHtml(s.absoluteFile)}" title="${escapeHtml(s.absoluteFile)}"><strong>${escapeHtml(s.file)}</strong>:${s.line}</a>
          <span class="right">${severityChip(s.severity)}<span class="tag">${escapeHtml(s.rule)}</span></span>
        </div>
        <div class="note-excerpt"><code>${escapeHtml(s.excerpt)}</code></div>
      </div>
    </li>`).join('')}</ul>`;
  }

  function securityEnvBody(sec) {
    const list = sec.envFiles || [];
    if (!list.length) return '<p class="empty">No .env files in this workspace.</p>';
    return `<ul class="list" style="list-style: none; padding: 0;">${list.map((e) => {
      const danger = e.trackedInGit && !e.ignored;
      const status = danger
        ? '<span class="tag tag-warn">tracked in git</span>'
        : e.ignored
        ? '<span class="tag tag-used">gitignored ✓</span>'
        : '<span class="tag">untracked</span>';
      return `<li>
        <div class="watch-card" style="display: block;">
          <div class="row">
            <a class="left link" data-open-file="${escapeHtml(e.absoluteFile)}"><strong>${escapeHtml(e.file)}</strong></a>
            <span class="right">${status}<span class="tag">${(e.sizeBytes / 1024).toFixed(1)} KB</span></span>
          </div>
          ${danger ? '<div class="note-excerpt" style="color: var(--vscode-errorForeground);">⚠ This .env file is being tracked. Add it to .gitignore and rotate any secrets it contains.</div>' : ''}
        </div>
      </li>`;
    }).join('')}</ul>`;
  }

  function securityGitBody(sec) {
    const list = sec.gitRemotes || [];
    if (!list.length) return '<p class="empty">Not a git repo (or no remotes configured).</p>';
    return `<ul class="list" style="list-style: none; padding: 0;">${list.map((r) => `<li>
      <div class="watch-card" style="display: block;">
        <div class="row">
          <span class="left"><strong>${escapeHtml(r.name)}</strong></span>
          <span class="right">${r.isGithub ? '<span class="tag">GitHub</span>' : ''}</span>
        </div>
        <div class="note-excerpt"><code>${escapeHtml(r.url)}</code></div>
      </div>
    </li>`).join('')}</ul>
    <p class="empty" style="font-size: 11px; margin-top: 8px;">For repo visibility / branch protection / secret scanning audit, run <code>/cso</code>.</p>`;
  }

  function securityMcpBody(sec) {
    const list = sec.mcpServers || [];
    if (!list.length) return '<p class="empty">No MCP servers configured in <code>~/.claude/settings.json</code>.</p>';
    return `<ul class="list" style="list-style: none; padding: 0;">${list.map((m) => {
      const inlineWarn = m.hasInlineSecret
        ? '<span class="tag tag-warn">inline secret</span>'
        : '<span class="tag tag-used">env-var only ✓</span>';
      return `<li>
        <div class="watch-card" style="display: block;">
          <div class="row">
            <span class="left"><strong>${escapeHtml(m.serverName)}</strong></span>
            <span class="right">${inlineWarn}</span>
          </div>
          ${m.envKeys.length ? `<div class="note-excerpt">env keys: ${m.envKeys.map((k) => '<code>' + escapeHtml(k) + '</code>').join(', ')}</div>` : '<div class="note-excerpt" style="font-size: 10px;">No env config.</div>'}
          ${m.hasInlineSecret ? '<div class="note-excerpt" style="color: var(--vscode-errorForeground);">⚠ A literal secret value appears to be set inline. Move it to <code>${</code> env var reference and rotate.</div>' : ''}
        </div>
      </li>`;
    }).join('')}</ul>`;
  }

  function browseSection(snap) {
    const state = vscode.getState() || {};
    const view = state.browseView === 'files' ? 'files' : 'projects';
    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'projects' ? 'sub-tab-active' : ''}" data-browse-view="projects">Projects</button>
        <button class="sub-tab ${view === 'files' ? 'sub-tab-active' : ''}" data-browse-view="files">Files (~/.claude)</button>
      </div>
    `;
    const body = view === 'files' ? filesSection(snap) : projectsSection(snap);
    return `${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  function historySection(snap) {
    const state = vscode.getState() || {};
    const view = state.historyView === 'chat' ? 'chat' : 'search';
    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'search' ? 'sub-tab-active' : ''}" data-history-view="search">Session search</button>
        <button class="sub-tab ${view === 'chat' ? 'sub-tab-active' : ''}" data-history-view="chat">claude.ai exports</button>
      </div>
    `;
    const body = view === 'chat' ? chatExportSection(snap) : searchSection(snap);
    return `${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  function timelineSection(snap) {
    const state = vscode.getState() || {};
    const view = state.timelineView === 'changelog' ? 'changelog' : 'roadmap';
    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'roadmap' ? 'sub-tab-active' : ''}" data-timeline-view="roadmap">Roadmap (planned)</button>
        <button class="sub-tab ${view === 'changelog' ? 'sub-tab-active' : ''}" data-timeline-view="changelog">Changelog (shipped)</button>
      </div>
    `;
    let body = '';
    if (view === 'roadmap') {
      body = roadmapSection(snap);
      maybeAutoFetchRoadmap();
    } else {
      body = changelogSection(snap);
    }
    return `${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  function unifiedSettingsSection(snap) {
    const state = vscode.getState() || {};
    const view = state.settingsView || 'budget';
    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'budget' ? 'sub-tab-active' : ''}" data-settings-view="budget">Budget</button>
        <button class="sub-tab ${view === 'rtk' ? 'sub-tab-active' : ''}" data-settings-view="rtk">RTK</button>
        <button class="sub-tab ${view === 'tunnels' ? 'sub-tab-active' : ''}" data-settings-view="tunnels">Tunnels</button>
        <button class="sub-tab ${view === 'office' ? 'sub-tab-active' : ''}" data-settings-view="office">Office</button>
        <button class="sub-tab ${view === 'manage' ? 'sub-tab-active' : ''}" data-settings-view="manage">Manage</button>
        <button class="sub-tab ${view === 'usage' ? 'sub-tab-active' : ''}" data-settings-view="usage">Usage</button>
        <button class="sub-tab ${view === 'disk' ? 'sub-tab-active' : ''}" data-settings-view="disk">Disk</button>
        <button class="sub-tab ${view === 'hooks' ? 'sub-tab-active' : ''}" data-settings-view="hooks">Hooks</button>
      </div>
    `;
    let body = '';
    if (view === 'budget') body = budgetSection(snap);
    else if (view === 'rtk') body = rtkSection(snap);
    else if (view === 'tunnels') body = tunnelsSection(snap);
    else if (view === 'office') body = officeSection(snap);
    else if (view === 'manage') body = manageSection(snap);
    else if (view === 'usage') body = usageDashboardSection(snap);
    else if (view === 'disk') body = diskUsageSection(snap);
    else if (view === 'hooks') body = settingsSection(snap);
    return `${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  function librarySection(snap) {
    const state = vscode.getState() || {};
    const view = state.libraryView === 'memory' ? 'memory' : 'prompts';
    const memCount = (snap.memory || []).length;
    const promptCount = (snap.prompts || []).length;
    if (view === 'prompts') maybeAutoMinePrompts(promptCount);
    const subBar = `
      <div class="sub-tab-bar">
        <button class="sub-tab ${view === 'prompts' ? 'sub-tab-active' : ''}" data-library-view="prompts">Prompts <span class="chip-count">${promptCount}</span></button>
        <button class="sub-tab ${view === 'memory' ? 'sub-tab-active' : ''}" data-library-view="memory">Memory <span class="chip-count">${memCount}</span></button>
      </div>
    `;
    const body = view === 'memory' ? memorySection(snap) : promptsSection(snap);
    return `${subBar}<div class="sub-tab-panel">${body}</div>`;
  }

  let autoMineAttempted = false;

  // First time the user lands on the Prompts view with an empty library,
  // kick off mining automatically. Avoids the "always 0" footgun where the
  // user has to discover the Mine button.
  function maybeAutoMinePrompts(promptCount) {
    if (autoMineAttempted) return;
    if (promptCount > 0) return;
    if (minedPromptsState) return;
    autoMineAttempted = true;
    // Defer slightly so the empty-state UI paints first; user sees the
    // "mining…" feedback rather than a flash of empty.
    setTimeout(() => vscode.postMessage({ type: 'minePrompts' }), 100);
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

  function recommendationsSection(snap) {
    const recs = snap.recommendations || [];
    if (!recs.length) {
      return `
        <h2>Recommendations</h2>
        <p class="empty">Nothing to recommend — your cockpit looks clean. Recommendations surface when memory drifts, skills go unused, budgets aren't set, or session context fills up.</p>
      `;
    }
    const groups = new Map();
    for (const r of recs) {
      if (!groups.has(r.category)) groups.set(r.category, []);
      groups.get(r.category).push(r);
    }
    const catLabel = {
      memory: 'Memory',
      skills: 'Skills',
      prompts: 'Prompts',
      agents: 'Agents',
      session: 'Session',
      budget: 'Budget',
      health: 'Health',
      workflow: 'Workflow',
    };
    const order = ['session', 'memory', 'skills', 'agents', 'prompts', 'budget', 'workflow', 'health'];
    const high = recs.filter((r) => r.impact === 'high').length;
    const med = recs.filter((r) => r.impact === 'med').length;
    const low = recs.filter((r) => r.impact === 'low').length;
    const summary = `
      ${high ? `<span class="rec-pill rec-high">${high} high</span>` : ''}
      ${med ? `<span class="rec-pill rec-med">${med} medium</span>` : ''}
      ${low ? `<span class="rec-pill rec-low">${low} low</span>` : ''}
    `;
    let body = '';
    for (const cat of order) {
      const list = groups.get(cat);
      if (!list || !list.length) continue;
      body += `
        <h3 class="sub-h">${escapeHtml(catLabel[cat] || cat)}</h3>
        <ul class="rec-list">
          ${list.map((r) => recCard(r)).join('')}
        </ul>
      `;
    }
    return `
      <h2>Recommendations <span class="rec-summary">${summary}</span></h2>
      <p class="rec-intro">Actionable suggestions surfaced from across your cockpit — memory, skills, agents, prompts, budgets, and session health.</p>
      ${body}
    `;
  }

  function recCard(r) {
    const actionBtn = r.action && r.action !== 'none'
      ? `<button class="rec-action"
            data-rec-action="${escapeHtml(r.action)}"
            data-rec-payload="${escapeHtml(r.actionPayload || '')}">
            ${escapeHtml(r.actionLabel || 'Open')}
          </button>`
      : '';
    return `
      <li class="rec-card rec-impact-${escapeHtml(r.impact)}">
        <div class="rec-head">
          <span class="rec-impact-dot rec-dot-${escapeHtml(r.impact)}"></span>
          <span class="rec-title">${escapeHtml(r.title)}</span>
        </div>
        <div class="rec-why">${escapeHtml(r.why)}</div>
        ${actionBtn ? `<div class="rec-foot">${actionBtn}</div>` : ''}
      </li>
    `;
  }

  function recsLabel(snap) {
    const recs = snap.recommendations || [];
    if (!recs.length) return 'Recs';
    const high = recs.filter((r) => r.impact === 'high').length;
    if (high > 0) return `Recs (${high}!)`;
    return `Recs (${recs.length})`;
  }

  function secLabel(snap) {
    const s = snap.security && snap.security.summary;
    if (!s) return 'Security';
    if (s.high > 0) return `Security (${s.high}!)`;
    if (s.total > 0) return `Security (${s.total})`;
    return 'Security ✓';
  }

// ===========================================================================
  // Component registry — every reusable widget is addressable by id so the
  // Custom tab can compose any combination of them. category groups them in
  // the picker UI; requiresCwd hides components that need an active session.
  // ===========================================================================
  const COMPONENTS = {
    greeting:        { label: 'Greeting',           category: 'Now',      requiresCwd: false, render: (s) => greetingSection(s) },
    notifications:   { label: 'Notifications',      category: 'Now',      requiresCwd: false, render: (s) => notificationsSection(s) },
    inbox:           { label: 'Inbox',              category: 'Now',      requiresCwd: false, render: (s) => inboxSection(s) },
    statsGrid:       { label: 'Stats grid',         category: 'Now',      requiresCwd: false, render: (s) => statsGridSection(s) },
    pilot:           { label: 'PILOT card',         category: 'Now',      requiresCwd: true,  render: (s) => pilotSection(s) },
    quickActions:    { label: 'Quick actions',      category: 'Now',      requiresCwd: false, render: (s) => quickActionsSection(s) },
    plans:           { label: 'Plans',              category: 'Now',      requiresCwd: true,  render: (s) => plansSection(s) },
    tokens:          { label: 'Tokens',             category: 'Session',  requiresCwd: true,  render: (s) => sessionTokensFragment(s) },
    heatmap:         { label: 'Activity heatmap',   category: 'Session',  requiresCwd: false, render: (s) => heatmapSection(s) },
    contextFill:     { label: 'Context fill',       category: 'Session',  requiresCwd: true,  render: (s) => contextFillSection(s.stats) },
    cost:            { label: 'Cost',               category: 'Session',  requiresCwd: true,  render: (s) => costSection(s.stats) },
    costByTool:      { label: 'Cost by tool',       category: 'Session',  requiresCwd: true,  render: (s) => costByToolSection(s) },
    budget:          { label: 'Budget caps',        category: 'Session',  requiresCwd: false, render: (s) => budgetSection(s) },
    usageRollups:    { label: 'Usage rollups',      category: 'Session',  requiresCwd: false, render: (s) => usageRollupsSection(s) },
    sessionMeta:     { label: 'Session metadata',   category: 'Session',  requiresCwd: true,  render: (s) => sessionMetaFragment(s) },
    claudeMd:        { label: 'CLAUDE.md stack',    category: 'Session',  requiresCwd: true,  render: (s) => claudeMdSection(s) },
    toolHistogram:   { label: 'Tool histogram',     category: 'Session',  requiresCwd: true,  render: (s) => toolHistogramSection(s.stats) },
    subAgents:       { label: 'Sub-agents',         category: 'Session',  requiresCwd: true,  render: (s) => subAgentsSection(s.stats) },
    toolHistory:     { label: 'Tool decisions',     category: 'Session',  requiresCwd: true,  render: (s) => toolHistorySection(s.stats) },
    activityFeed:    { label: 'Activity feed',      category: 'Session',  requiresCwd: true,  render: (s) => activityFeedSection(s.stats) },
    filesTouched:    { label: 'Files touched',      category: 'Session',  requiresCwd: true,  render: (s) => filesTouchedFragment(s) },
    today:           { label: 'Today',              category: 'Now',      requiresCwd: false, render: (s) => todaySection(s) },
    recommendations: { label: 'Recommendations',    category: 'Now',      requiresCwd: false, render: (s) => recommendationsSection(s) },
    watchtower:      { label: 'Watchtower',         category: 'Cross',    requiresCwd: false, render: (s) => watchtowerSection(s) },
    macHealth:       { label: 'Mac health',         category: 'System',   requiresCwd: false, render: (s) => macHealthSection(s) },
    appUsage:        { label: 'App usage',          category: 'System',   requiresCwd: false, render: (s) => appUsageSection(s) },
    agents:          { label: 'Agents',             category: 'Cross',    requiresCwd: false, render: (s) => agentsSection(s) },
    routines:        { label: 'Routines',           category: 'Cross',    requiresCwd: false, render: (s) => routinesSection(s) },
    discover:        { label: 'Discover (GH+RSS)',  category: 'Cross',    requiresCwd: false, render: (s) => discoverSection(s) },
    roadmap:         { label: 'Roadmap',             category: 'Cross',    requiresCwd: false, render: (s) => roadmapSection(s) },
    changelog:       { label: 'Changelog',           category: 'Cross',    requiresCwd: false, render: (s) => changelogSection(s) },
    manage:          { label: 'Manage Claude',       category: 'Config',   requiresCwd: false, render: (s) => manageSection(s) },
    chatExport:      { label: 'Chat export',        category: 'Cross',    requiresCwd: false, render: (s) => chatExportSection(s) },
    obsidian:        { label: 'Obsidian',           category: 'Cross',    requiresCwd: false, render: (s) => obsidianSection(s) },
    memory:          { label: 'Memory',             category: 'Memory',   requiresCwd: true,  render: (s) => memorySection(s) },
    prompts:         { label: 'Prompts',            category: 'Memory',   requiresCwd: false, render: (s) => promptsSection(s) },
    skills:          { label: 'Skills',             category: 'Memory',   requiresCwd: false, render: (s) => skillsSection(s) },
    projects:        { label: 'Projects',           category: 'Cross',    requiresCwd: false, render: (s) => projectsSection(s) },
    files:           { label: 'Files',              category: 'Memory',   requiresCwd: true,  render: (s) => filesSection(s) },
    rtk:             { label: 'RTK token killer',   category: 'Config',   requiresCwd: false, render: (s) => rtkSection(s) },
    tunnels:         { label: 'Tunnels',            category: 'Config',   requiresCwd: false, render: (s) => tunnelsSection(s) },
    usageDashboard:  { label: 'Usage dashboard',    category: 'Config',   requiresCwd: false, render: (s) => usageDashboardSection(s) },
    office:          { label: 'Office visualizer',  category: 'Config',   requiresCwd: false, render: (s) => officeSection(s) },
    officeFloor:     { label: 'Office floor',       category: 'Cross',    requiresCwd: false, render: (s) => officeFloorSection(s) },
    settings:        { label: 'Global settings',    category: 'Config',   requiresCwd: false, render: (s) => settingsSection(s) },
    diskUsage:       { label: 'Disk usage',         category: 'Config',   requiresCwd: false, render: (s) => diskUsageSection(s) },
    sessionActive:   { label: 'Active session block', category: 'Session', requiresCwd: true,  render: (s) => activeSessionFragment(s) },
    watchtowerIdle:  { label: 'Idle sentinel',      category: 'Cross',    requiresCwd: false, render: (s) => watchtowerSection(s, { idleOnly: true }) },
    timeline:        { label: 'Timeline (full)',    category: 'Cross',    requiresCwd: false, render: (s) => timelineSection(s) },
    unifiedSettings: { label: 'Settings (full)',    category: 'Config',   requiresCwd: false, render: (s) => unifiedSettingsSection(s) },
    history:         { label: 'History (full)',     category: 'Cross',    requiresCwd: false, render: (s) => historySection(s) },
    library:         { label: 'Library (full)',     category: 'Memory',   requiresCwd: false, render: (s) => librarySection(s) },
    browse:          { label: 'Browse (full)',      category: 'Cross',    requiresCwd: false, render: (s) => browseSection(s) },
    talk:            { label: 'Talk',               category: 'Cross',    requiresCwd: false, render: (s) => talkSection(s) },
    securityFull:    { label: 'Security (full)',    category: 'System',   requiresCwd: false, render: (s) => securitySection(s) },
    helpDoc:         { label: 'Help',               category: 'Config',   requiresCwd: false, render: () => helpSection() },
    selfTelemetry:   { label: 'Self · telemetry',   category: 'System',   requiresCwd: false, render: (s) => selfTelemetrySection(s) },
    welcomeBanner:   { label: 'Welcome / setup',    category: 'Config',   requiresCwd: false, render: (s) => welcomeBannerSection(s) },
  };

  // ===========================================================================
  // Plugin API (Phase 0): EXTERNAL_COMPONENTS is populated by sibling scripts
  // injected via sidebarProvider.html() — Phase-1 worktrees own their own JS
  // file (e.g. media/sidebar.approval.js) and register their widgets here so
  // they never touch the COMPONENTS literal above. Same shape as a COMPONENTS
  // entry: { label, category, requiresCwd, render: (snap) => htmlString }.
  // ===========================================================================
  const EXTERNAL_COMPONENTS = {};
  function registerExternalComponent(id, def) { EXTERNAL_COMPONENTS[id] = def; }
  // Public bridge for sibling scripts. Defined once; subsequent sidebar.js
  // reloads (e.g. webview restore) just re-bind the same handle.
  if (typeof window !== 'undefined') {
    window.cockpit = window.cockpit || {};
    window.cockpit.registerComponent = registerExternalComponent;
  }

  // Fragments used as components but not standalone sections — they get
  // rendered as HTML snippets stitched into the active session view.
  function sessionTokensFragment(snap) {
    const s = snap.stats;
    return `
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
  }

  function sessionMetaFragment(snap) {
    const s = snap.stats;
    const sessionShort = s.sessionId ? s.sessionId.slice(0, 8) : '—';
    const modeRow = s.permissionMode
      ? `\n        <span class="k">Mode</span><span class="v"><span class="tag tag-mode-${escapeHtml(s.permissionMode)}" title="Latest permissionMode seen in the session JSONL — Cockpit displays only; toggle in Claude Code itself.">${escapeHtml(s.permissionMode)}</span></span>`
      : '';
    return `
      <h2>Session</h2>
      <div class="kv">
        <span class="k">ID</span><span class="v">${escapeHtml(sessionShort)}</span>
        <span class="k">Model</span><span class="v">${escapeHtml(s.lastModel || '—')}</span>${modeRow}
        <span class="k">Messages</span><span class="v">${s.messageCount}</span>
        <span class="k">Tool calls</span><span class="v">${s.toolCallCount}</span>
        <span class="k">Last activity</span><span class="v">${escapeHtml(s.lastActivityAt ?? '—')}</span>
      </div>
    `;
  }

  function activeSessionFragment(snap) {
    if (!snap.cwd) return '';
    const s = snap.stats || {};
    const liveDot = s.isActive ? '<span class="live-dot" title="written in last 10s"></span>' : '';
    return `
      <h2>Active session ${liveDot}</h2>
      <div class="kv">
        <span class="k">project</span><span class="v">${escapeHtml(snap.cwd)}</span>
      </div>
    `;
  }

  function filesTouchedFragment(snap) {
    const s = snap.stats;
    const items = s.filesTouched.length
      ? s.filesTouched
          .slice(0, 50)
          .map(
            (f) => `<li>
              <div class="row">
                <a class="left link" data-file="${escapeHtml(f.filePath)}" title="${escapeHtml(f.filePath)}">${escapeHtml(basename(f.filePath))}</a>
                <span class="right"><span class="tag">${escapeHtml(f.tool)}</span>${f.count}×</span>
              </div>
            </li>`,
          )
          .join('')
      : '<li><span class="empty">No file edits yet.</span></li>';
    return `
      <h2>Files touched (${s.filesTouched.length})</h2>
      <ul class="list">${items}</ul>
    `;
  }

  // ===========================================================================
  // Tab catalogue — maps tab id to label-fn + body composer. The user can
  // hide any non-pinned tab via the customize panel.
  // ===========================================================================
  const PINNED_TABS = ['custom', 'now', 'help'];
  const DEFAULT_CUSTOM_COMPONENTS = ['greeting', 'inbox', 'statsGrid', 'quickActions', 'tokens', 'cost', 'routines'];

  // Per-tab default compositions. Each tab's body is now a list of widget IDs;
  // the user can override any tab via the Customize panel. Empty array =
  // "user wants this tab empty" — never falls back to defaults silently.
  const DEFAULT_TAB_COMPOSITIONS = {
    welcome:    ['welcomeBanner'],
    custom:     DEFAULT_CUSTOM_COMPONENTS,
    now: [
      'greeting', 'notifications', 'inbox', 'statsGrid', 'pilot',
      'quickActions', 'plans', 'sessionActive', 'tokens', 'heatmap',
      'contextFill', 'cost', 'costByTool', 'budget', 'usageRollups',
      'sessionMeta', 'claudeMd', 'toolHistogram', 'subAgents', 'toolHistory',
      'activityFeed', 'filesTouched', 'today',
    ],
    recs:       ['recommendations'],
    mac:        ['macHealth'],
    watchtower: ['watchtower', 'watchtowerIdle'],
    office:     ['officeFloor', 'office'],
    agents:     ['agents'],
    routines:   ['routines'],
    discover:   ['discover'],
    timeline:   ['timeline'],
    settings:   ['unifiedSettings'],
    history:    ['history'],
    obsidian:   ['obsidian'],
    library:    ['library'],
    skills:     ['skills'],
    browse:     ['browse'],
    talk:       ['talk'],
    security:   ['securityFull'],
    help:       ['helpDoc'],
    self:       ['selfTelemetry'],
  };

  // Inline SVG icons for the primary tab bar. Stroke-only, 14×14, currentColor
  // so they inherit the tab text color (active/hover handled by parent). VSCode
  // webviews don't auto-load codicons, so we ship the geometry inline.
  const TAB_ICONS = {
    now:        '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 12 7 12 10 5 14 19 17 12 21 12"/></svg>',
    library:    '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    skills:     '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>',
    browse:     '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
    history:    '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/><polyline points="12 7 12 12 15 14"/></svg>',
    timeline:   '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    settings:   '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    watchtower: '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    search:     '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    prompts:    '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><polyline points="7 22 12 18 17 22"/></svg>',
    talk:       '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
    security:   '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>',
    mac:        '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><line x1="9" y1="2" x2="9" y2="6"/><line x1="15" y1="2" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="22"/><line x1="15" y1="18" x2="15" y2="22"/><line x1="2" y1="9" x2="6" y2="9"/><line x1="2" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="22" y2="9"/><line x1="18" y1="15" x2="22" y2="15"/></svg>',
    inbox:      '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    agents:     '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chat:       '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    discover:   '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
    welcome:    '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/></svg>',
    custom:     '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 7.6c.4-.4.4-1 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0L14 7v3h3l2.4-2.4z"/><path d="M14 10l-9 9v3h3l9-9"/><path d="M9 4H5a2 2 0 0 0-2 2v4"/></svg>',
    help:       '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  function tabCatalogue(snap) {
    const chatLabel = snap.chatExport && snap.chatExport.installed
      ? `Chat (${snap.chatExport.conversationCount})`
      : 'Chat ◌';
    const macLabel = snap.macHealth && snap.macHealth.available ? 'Mac' : 'Mac ◌';
    // requiresCwd: tab is most useful (or only useful) when an active Claude
    // Code session exists for the open folder. Surface this so users can
    // filter / understand at a glance.
    return [
      { id: 'welcome',    label: 'Welcome',                                                           pinned: false, requiresCwd: false, hint: 'First-run setup + system check' },
      { id: 'custom',     label: 'Custom',                                                            pinned: true,  requiresCwd: false, hint: 'User-composed dashboard' },
      { id: 'now',        label: 'Now',                                                               pinned: true,  requiresCwd: true,  hint: 'Active session — tokens, cost, files, tools' },
      { id: 'recs',       label: recsLabel(snap),                                                     pinned: false, requiresCwd: false, hint: 'Recommendations across your setup' },
      { id: 'mac',        label: macLabel,                                                            pinned: false, requiresCwd: false, hint: 'macOS system health' },
      { id: 'watchtower', label: `Watchtower (${snap.watchtower.length})`,                            pinned: false, requiresCwd: false, hint: 'Every Claude session in the last hour' },
      { id: 'office',     label: `Office (${(snap.officeFloor || []).length})`,                       pinned: false, requiresCwd: false, hint: 'Live floor: every project agent and what each is doing right now' },
      { id: 'agents',     label: `Agents (${(snap.agents || []).length})`,                            pinned: false, requiresCwd: false, hint: 'Agent definitions (global + workspace)' },
      { id: 'routines',   label: `Routines (${((snap.routines || {}).local || []).length})`,          pinned: false, requiresCwd: false, hint: 'Scheduled Claude Code runs' },
      { id: 'discover',   label: 'Discover',                                                          pinned: false, requiresCwd: false, hint: 'Top GitHub projects + RSS from Obsidian (opt-in)' },
      { id: 'timeline',   label: `Timeline${snap.roadmap && snap.roadmap.totalProjects ? ' (' + snap.roadmap.totalProjects + ')' : ''}`, pinned: false, requiresCwd: false, hint: 'Roadmap (planned) + Changelog (shipped) — what happened and what is next' },
      { id: 'settings',   label: 'Settings',                                                          pinned: false, requiresCwd: false, hint: 'Budget, RTK, tunnels, MCP, hooks, plugins, dashboards' },
      { id: 'history',    label: chatLabel.replace('Chat', 'History'),                                pinned: false, requiresCwd: false, hint: 'Search every Claude session + browse claude.ai chat exports' },
      { id: 'obsidian',   label: snap.obsidian && snap.obsidian.installed ? 'Obsidian' : 'Obsidian ◌', pinned: false, requiresCwd: false, hint: 'Obsidian vaults + recent notes' },
      { id: 'library',    label: `Library (${(snap.memory || []).length + ((snap.prompts || []).length)})`, pinned: false, requiresCwd: false, hint: 'Memory + Prompts — reusable text Claude can pull from' },
      { id: 'skills',     label: `Skills (${snap.skills.length})`,                                    pinned: false, requiresCwd: false, hint: 'Available skills + usage' },
      { id: 'browse',     label: `Browse (${snap.projects.length})`,                                  pinned: false, requiresCwd: false, hint: 'Recent projects + ~/.claude/ filesystem' },
      { id: 'talk',       label: 'Talk',                                                              pinned: false, requiresCwd: false, hint: 'Voice + text → Claude. Particle visualization reacts to your voice.' },
      { id: 'security',   label: secLabel(snap),                                                      pinned: false, requiresCwd: false, hint: 'Local secret scan, .env audit, MCP credential check, /cso launcher' },
      { id: 'self',       label: 'Self',                                                              pinned: false, requiresCwd: false, hint: 'Cockpit observing itself — refresh cost, runs, errors' },
      { id: 'help',       label: '? Help',                                                            pinned: true,  requiresCwd: false, hint: 'How to read this thing' },
    ];
  }

  // Tab merges remap old IDs onto new ones so persisted enabledTabs still
  // surface the right tab. Update this when consolidating tabs.
  const TAB_MIGRATIONS = {
    memory: 'library',
    prompts: 'library',
    manage: 'settings',
    config: 'settings',
    roadmap: 'timeline',
    changelog: 'timeline',
    chat: 'history',
    search: 'history',
    projects: 'browse',
    files: 'browse',
  };

  function migrateEnabledTabIds(ids) {
    const out = new Set();
    for (const id of ids) {
      out.add(TAB_MIGRATIONS[id] || id);
    }
    return out;
  }

  function getEnabledTabIds(snap) {
    const prefs = (snap && snap.userPrefs) || {};
    const cat = tabCatalogue(snap);
    const surfaces = (snap && snap.surfaces) || {};
    const enabledExplicit = Array.isArray(prefs.enabledTabs) && prefs.enabledTabs.length;
    const explicitSet = enabledExplicit ? migrateEnabledTabIds(prefs.enabledTabs) : null;
    // Hide tabs whose underlying surface has been disabled in settings,
    // regardless of user prefs — the data isn't being collected anyway.
    const filtered = cat.filter((t) => {
      if (t.id === 'mac' && surfaces.macHealth === false) return false;
      // Welcome tab: visible by default ONLY until first-run is dismissed.
      // After dismissal it's hidden unless the user explicitly added it back.
      if (t.id === 'welcome') {
        if (snap.firstRunCompleted) {
          return enabledExplicit && explicitSet.has('welcome');
        }
        return true;
      }
      return true;
    });
    if (enabledExplicit) {
      return filtered.filter((t) => t.pinned || explicitSet.has(t.id) || t.id === 'welcome');
    }
    // First-launch default: every tab visible (preserves prior UX).
    return filtered;
  }

  function visibleTabBar(snap) {
    const hasCwd = !!snap.cwd;
    return getEnabledTabIds(snap).map(({ id, label, requiresCwd, hint }) => ({
      id,
      label,
      requiresCwd: !!requiresCwd,
      dim: !!requiresCwd && !hasCwd,
      hint,
    }));
  }

  // Returns the widget IDs for a tab, honoring user prefs FIRST. An empty
  // array in prefs.tabComponents[tabId] means "user wants this empty" and
  // we DO NOT fall back to defaults (option a + bug-fix).
  function getTabComponentIds(snap, tabId) {
    const prefs = (snap && snap.userPrefs) || {};
    const tabPrefs = prefs.tabComponents;
    if (tabPrefs && Object.prototype.hasOwnProperty.call(tabPrefs, tabId)) {
      const list = tabPrefs[tabId];
      if (Array.isArray(list)) return list.filter((id) => COMPONENTS[id]);
    }
    // Legacy migration: prior versions stored a single `customComponents`
    // list that drove the Custom tab. Honor it for backward compat until the
    // user touches the new per-tab picker, but only for the Custom tab.
    if (tabId === 'custom') {
      const legacy = prefs.customComponents;
      if (Array.isArray(legacy) && legacy.length) {
        return legacy.filter((id) => COMPONENTS[id]);
      }
    }
    const def = DEFAULT_TAB_COMPOSITIONS[tabId];
    if (Array.isArray(def)) return def.filter((id) => COMPONENTS[id]);
    return [];
  }

  // Back-compat shim — global search overlay still calls this name.
  function getCustomComponentIds(snap) {
    return getTabComponentIds(snap, 'custom');
  }

  function tabBodyComposed(snap, tabId) {
    const ids = getTabComponentIds(snap, tabId);
    const hasCwd = !!snap.cwd;
    const blocked = [];
    const rendered = ids
      .map((id) => {
        const c = COMPONENTS[id] || EXTERNAL_COMPONENTS[id];
        if (!c) return '';
        if (c.requiresCwd && !hasCwd) {
          blocked.push(c.label);
          return '';
        }
        try {
          return c.render(snap) || '';
        } catch (err) {
          return `<p class="empty">Failed to render <code>${escapeHtml(id)}</code>: ${escapeHtml(String(err))}</p>`;
        }
      })
      .join('\n');
    const blockedNote = blocked.length
      ? `<p class="empty" style="font-size: 11px;">Hidden until a Claude Code session is active in this folder: ${blocked.map((b) => escapeHtml(b)).join(', ')}.</p>`
      : '';
    const empty = !rendered.trim() && !blocked.length
      ? `<p class="empty">No widgets on this tab. Click <strong>⚙</strong> in the header to add some.</p>`
      : '';
    return `${customizeHint(snap, tabId)}${empty}${rendered}${blockedNote}`;
  }

  // Back-compat alias; some call sites may still reference customTabBody.
  function customTabBody(snap) {
    return tabBodyComposed(snap, 'custom');
  }

  function customizeHint(snap, tabId) {
    const ids = getTabComponentIds(snap, tabId);
    const cat = tabCatalogue(snap);
    const tab = cat.find((t) => t.id === tabId);
    const tabLabel = tab ? stripCount(tab.label) : tabId;
    return `
      <div class="customize-hint">
        <span><strong>${escapeHtml(tabLabel)}</strong> · ${ids.length} widget${ids.length === 1 ? '' : 's'}</span>
        <button class="office-btn" data-action="open-customize" data-customize-tab="${escapeHtml(tabId)}">Customize ⚙</button>
      </div>
    `;
  }

  function getCustomizeTab(snap) {
    const state = vscode.getState() || {};
    if (typeof state.customizeTab === 'string') {
      const cat = tabCatalogue(snap);
      if (cat.some((t) => t.id === state.customizeTab)) return state.customizeTab;
    }
    return 'custom';
  }

  function customizePanel(snap) {
    const tabSet = new Set(getEnabledTabIds(snap).map((t) => t.id));
    const cat = tabCatalogue(snap);
    const themePref = ((snap.userPrefs || {}).theme) || 'auto';
    const editingTabId = getCustomizeTab(snap);
    const editingTab = cat.find((t) => t.id === editingTabId);
    const editingLabel = editingTab ? stripCount(editingTab.label) : editingTabId;
    const activeSet = new Set(getTabComponentIds(snap, editingTabId));

    const compsByCat = {};
    for (const [id, c] of Object.entries(COMPONENTS)) {
      if (!compsByCat[c.category]) compsByCat[c.category] = [];
      compsByCat[c.category].push({ id, ...c });
    }
    const compHtml = Object.entries(compsByCat)
      .map(
        ([catName, items]) => `
        <h3 class="sub-h">${escapeHtml(catName)}</h3>
        <div class="comp-grid">
          ${items
            .map(
              (c) => `<label class="comp-toggle ${activeSet.has(c.id) ? 'on' : ''}">
                <input type="checkbox" data-component-toggle="${escapeHtml(c.id)}" ${activeSet.has(c.id) ? 'checked' : ''} />
                <span class="comp-label">${escapeHtml(c.label)}</span>
                ${c.requiresCwd ? '<span class="tag" title="Requires active session">cwd</span>' : ''}
              </label>`,
            )
            .join('')}
        </div>
      `,
      )
      .join('');

    const sessionFilter = ((snap.userPrefs || {}).tabFilter) || 'all';
    const filteredCat = cat.filter((t) => {
      if (sessionFilter === 'requires') return t.requiresCwd;
      if (sessionFilter === 'standalone') return !t.requiresCwd;
      return true;
    });
    const filterChips = `
      <div class="filter-chips">
        ${['all', 'requires', 'standalone']
          .map(
            (f) => `<button class="filter-chip ${sessionFilter === f ? 'on' : ''}" data-tab-filter="${f}">${
              f === 'all' ? 'All tabs' : f === 'requires' ? 'Needs session' : 'Standalone'
            }</button>`,
          )
          .join('')}
      </div>
    `;
    const tabHtml = filteredCat
      .map(
        (t) => `<label class="comp-toggle ${tabSet.has(t.id) ? 'on' : ''} ${t.pinned ? 'pinned' : ''}" title="${escapeHtml(t.hint || '')}">
          <input type="checkbox" data-tab-toggle="${escapeHtml(t.id)}" ${tabSet.has(t.id) ? 'checked' : ''} ${t.pinned ? 'disabled' : ''} />
          <span class="comp-label">${escapeHtml(stripCount(t.label))}</span>
          ${t.requiresCwd ? '<span class="tag tag-needs-cwd" title="Most useful with an active session">●</span>' : ''}
          ${t.pinned ? '<span class="tag tag-used">pinned</span>' : ''}
        </label>`,
      )
      .join('');

    // Tab selector for per-tab widget editing.
    const editTabSelector = `
      <div class="filter-chips" data-tab-edit-row>
        ${cat
          .map(
            (t) => `<button class="filter-chip ${t.id === editingTabId ? 'on' : ''}" data-customize-edit-tab="${escapeHtml(t.id)}" title="${escapeHtml(t.hint || '')}">${escapeHtml(stripCount(t.label))}</button>`,
          )
          .join('')}
      </div>
    `;

    const widgetCount = activeSet.size;
    const resetBtn = `<button class="office-btn" data-action="reset-tab-widgets" data-customize-edit-tab="${escapeHtml(editingTabId)}" title="Restore the default widget set for this tab">Reset to default</button>`;
    const clearBtn = `<button class="office-btn" data-action="clear-tab-widgets" data-customize-edit-tab="${escapeHtml(editingTabId)}" title="Remove every widget on this tab">Clear all</button>`;

    return `
      <div class="customize-panel">
        <div class="row">
          <h2 class="left">Customize Cockpit</h2>
          <button class="office-btn right" data-action="close-customize">Done</button>
        </div>
        <p class="empty" style="font-size: 11px;">Pick widgets for any tab. Empty = empty (no fallback). Pinned tabs (Custom, Now, Help) can't be hidden.</p>

        <h3 class="sub-h">Theme</h3>
        <div class="theme-toggle">
          ${['auto', 'dark', 'light']
            .map(
              (t) => `<label class="comp-toggle ${themePref === t ? 'on' : ''}">
                <input type="radio" name="theme" data-theme-set="${t}" ${themePref === t ? 'checked' : ''} />
                <span class="comp-label">${t === 'auto' ? 'Auto (follow VSCode)' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
              </label>`,
            )
            .join('')}
        </div>

        <h3 class="sub-h">Visible tabs</h3>
        ${filterChips}
        <div class="comp-grid">${tabHtml}</div>

        <h3 class="sub-h">Widgets on tab: <em>${escapeHtml(editingLabel)}</em> <span class="cost-rate">${widgetCount} active</span></h3>
        <p class="empty" style="font-size: 11px;">Pick a tab to edit, then toggle widgets on/off. Each tab keeps its own widget set.</p>
        ${editTabSelector}
        <div class="actions" style="margin-top: 6px; gap: 6px;">${resetBtn}${clearBtn}</div>
        ${compHtml}
      </div>
    `;
  }

  function stripCount(label) {
    return String(label).replace(/\s*\(\d+\)\s*$/, '').replace(/\s*◌\s*$/, '');
  }

  // ===========================================================================
  // Global search — builds a flat index from the current snapshot so the user
  // can find anything without knowing which tab it lives in.
  // ===========================================================================
  const SEARCH_TYPES = [
    { id: 'all',      label: 'All' },
    { id: 'tab',      label: 'Tabs' },
    { id: 'widget',   label: 'Widgets' },
    { id: 'memory',   label: 'Memory' },
    { id: 'skill',    label: 'Skills' },
    { id: 'prompt',   label: 'Prompts' },
    { id: 'agent',    label: 'Agents' },
    { id: 'routine',  label: 'Routines' },
    { id: 'project',  label: 'Projects' },
    { id: 'plan',     label: 'Plans' },
    { id: 'tunnel',   label: 'Tunnels' },
    { id: 'setting',  label: 'Settings' },
  ];

  // Each entry: { type, title, subtitle, tab, action, payload, keywords }
  function buildSearchIndex(snap) {
    const out = [];
    if (!snap) return out;

    for (const t of tabCatalogue(snap)) {
      out.push({
        type: 'tab',
        title: stripCount(t.label),
        subtitle: t.hint || '',
        tab: t.id,
        action: 'goto-tab',
        payload: t.id,
        keywords: `${t.id} ${t.label} ${t.hint || ''}`.toLowerCase(),
        requiresCwd: t.requiresCwd,
      });
    }

    for (const [id, c] of Object.entries(COMPONENTS)) {
      out.push({
        type: 'widget',
        title: c.label,
        subtitle: `Category: ${c.category}${c.requiresCwd ? ' · needs session' : ''}`,
        tab: 'custom',
        action: 'goto-customize',
        payload: id,
        keywords: `${id} ${c.label} ${c.category}`.toLowerCase(),
        requiresCwd: c.requiresCwd,
      });
    }

    for (const m of (snap.memory || [])) {
      out.push({
        type: 'memory',
        title: m.title || m.filename,
        subtitle: `${m.filename}${m.isStale ? ' · stale' : ''}`,
        tab: 'library',
        librarySubview: 'memory',
        action: 'open-memory-file',
        payload: m.filename,
        keywords: `${m.title || ''} ${m.filename} ${(m.preview || '').slice(0, 200)}`.toLowerCase(),
      });
    }

    for (const s of (snap.skills || [])) {
      out.push({
        type: 'skill',
        title: `/${s.name}`,
        subtitle: s.description || '',
        tab: 'skills',
        action: 'copy-skill',
        payload: s.name,
        keywords: `${s.name} ${s.description || ''}`.toLowerCase(),
      });
    }

    for (const p of (snap.prompts || [])) {
      out.push({
        type: 'prompt',
        title: p.title,
        subtitle: (p.body || '').slice(0, 120),
        tab: 'library',
        librarySubview: 'prompts',
        action: 'use-prompt',
        payload: p.id,
        promptBody: p.body,
        keywords: `${p.title} ${(p.body || '').slice(0, 200)}`.toLowerCase(),
      });
    }

    for (const a of (snap.agents || [])) {
      out.push({
        type: 'agent',
        title: a.name,
        subtitle: `${a.scope}${a.model ? ' · ' + a.model : ''} — ${a.description || ''}`,
        tab: 'agents',
        action: 'open-file',
        payload: a.filePath,
        keywords: `${a.name} ${a.description || ''} ${a.scope} ${a.model || ''}`.toLowerCase(),
      });
    }

    for (const rt of ((snap.routines || {}).local || [])) {
      out.push({
        type: 'routine',
        title: rt.name,
        subtitle: `${rt.cadenceHint ? rt.cadenceHint + ' · ' : ''}${rt.description || ''}`,
        tab: 'routines',
        action: 'open-file',
        payload: rt.filePath,
        keywords: `${rt.name} ${rt.description || ''} ${rt.cadenceHint || ''}`.toLowerCase(),
      });
    }

    for (const p of (snap.projects || [])) {
      out.push({
        type: 'project',
        title: p.decodedPath ? p.decodedPath.split('/').slice(-1)[0] : p.dirName,
        subtitle: p.decodedPath || p.dirName,
        tab: 'browse',
        action: 'open-project',
        payload: p.decodedPath,
        keywords: `${p.decodedPath || ''} ${p.dirName || ''}`.toLowerCase(),
      });
    }

    for (const pl of (snap.plans || [])) {
      out.push({
        type: 'plan',
        title: pl.name,
        subtitle: `${pl.path}${typeof pl.checkedCount === 'number' ? ` · ${pl.checkedCount}/${pl.totalCount} done` : ''}`,
        tab: 'now',
        action: 'open-file',
        payload: pl.path,
        keywords: `${pl.name} ${pl.path}`.toLowerCase(),
      });
    }

    for (const t of (snap.tunnels || [])) {
      out.push({
        type: 'tunnel',
        title: t.name,
        subtitle: `${t.hostname || '—'} → ${t.service || '—'}`,
        tab: 'settings',
        settingsSubview: 'tunnels',
        action: 'open-file',
        payload: t.configPath,
        keywords: `${t.name} ${t.hostname || ''} ${t.service || ''}`.toLowerCase(),
      });
    }

    const settings = snap.settings || {};
    if (settings.hooksCount) {
      out.push({ type: 'setting', title: `${settings.hooksCount} hooks configured`, subtitle: '~/.claude/settings.json', tab: 'settings', settingsSubview: 'hooks', action: 'goto-tab', payload: 'settings', keywords: 'hooks settings.json' });
    }
    if (settings.mcpServerCount) {
      out.push({ type: 'setting', title: `${settings.mcpServerCount} MCP servers configured`, subtitle: '~/.claude/settings.json', tab: 'settings', settingsSubview: 'hooks', action: 'goto-tab', payload: 'settings', keywords: 'mcp servers settings' });
    }
    if (settings.pluginCount) {
      out.push({ type: 'setting', title: `${settings.pluginCount} plugins enabled`, subtitle: '~/.claude/settings.json', tab: 'settings', settingsSubview: 'hooks', action: 'goto-tab', payload: 'settings', keywords: 'plugins settings' });
    }

    return out;
  }

  function searchSnapshot(snap, query, typeFilter) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const idx = buildSearchIndex(snap);
    const filtered = idx.filter((entry) => {
      if (typeFilter && typeFilter !== 'all' && entry.type !== typeFilter) return false;
      return entry.keywords.includes(q);
    });
    // Stable rank: title-prefix match first, then anywhere.
    filtered.sort((a, b) => {
      const ap = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title);
    });
    return filtered.slice(0, 100);
  }

  function getSearchState() {
    const s = vscode.getState() || {};
    return {
      query: s.searchQuery || '',
      typeFilter: s.searchTypeFilter || 'all',
      open: !!s.searchOpen,
    };
  }

  function setSearchState(patch) {
    const cur = vscode.getState() || {};
    vscode.setState({ ...cur, ...patch });
  }

  function searchOverlay(snap) {
    const { query, typeFilter } = getSearchState();
    const results = searchSnapshot(snap, query, typeFilter);
    const counts = {};
    for (const r of results) counts[r.type] = (counts[r.type] || 0) + 1;

    const chips = SEARCH_TYPES.map((t) => {
      const n = t.id === 'all' ? results.length : counts[t.id] || 0;
      return `<button class="filter-chip ${typeFilter === t.id ? 'on' : ''}" data-search-type="${t.id}">${escapeHtml(t.label)}${
        t.id === 'all' || n ? ` <span class="chip-count">${n}</span>` : ''
      }</button>`;
    }).join('');

    const renderHit = (r) => {
      const typeBadge = `<span class="tag">${escapeHtml(r.type)}</span>`;
      const cwdBadge = r.requiresCwd ? '<span class="tag tag-needs-cwd" title="Most useful with active session">●</span>' : '';
      return `<li>
        <button class="search-hit"
          data-search-action="${escapeHtml(r.action)}"
          data-search-payload="${escapeHtml(r.payload || '')}"
          data-search-tab="${escapeHtml(r.tab || '')}"
          data-search-subview="${escapeHtml(r.librarySubview || r.settingsSubview || '')}"
          data-search-subview-key="${escapeHtml(r.librarySubview ? 'libraryView' : r.settingsSubview ? 'settingsView' : '')}"
          data-search-prompt-body="${escapeHtml(r.promptBody || '')}"
          title="${escapeHtml((r.subtitle || '') + ' — opens ' + (r.tab || ''))}">
          <div class="row">
            <span class="left"><strong>${highlight(r.title, query)}</strong></span>
            <span class="right">${cwdBadge}${typeBadge}</span>
          </div>
          ${r.subtitle ? `<div class="note-excerpt">${highlight(r.subtitle, query)}</div>` : ''}
          ${r.tab ? `<div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;">→ ${escapeHtml(stripCount((tabCatalogue(snap).find((t) => t.id === r.tab) || {}).label || r.tab))}</div>` : ''}
        </button>
      </li>`;
    };

    const body = !query.trim()
      ? `<p class="empty">Type to search across tabs, widgets, memory, skills, prompts, agents, routines, projects, plans, tunnels, and settings.</p>`
      : !results.length
      ? `<p class="empty">No matches for <strong>${escapeHtml(query)}</strong>.</p>`
      : `<ul class="list search-results">${results.map(renderHit).join('')}</ul>`;

    return `
      <div class="search-overlay">
        <div class="row">
          <h2 class="left">Search</h2>
          <button class="office-btn right" data-action="close-search">Close</button>
        </div>
        <p class="empty" style="font-size: 11px;">${results.length ? results.length + ' result' + (results.length === 1 ? '' : 's') : ''}${query.trim() ? ' for "' + escapeHtml(query) + '"' : ''}</p>
        <div class="filter-chips">${chips}</div>
        ${body}
      </div>
    `;
  }

  function headerStrip(snap) {
    const themePref = ((snap.userPrefs || {}).theme) || 'auto';
    const { query } = getSearchState();
    const upd = snap.updateStatus || {};
    const updatePill = upd.hasUpdate
      ? `<button class="update-pill" data-action="goto-changelog" title="v${escapeHtml(upd.latestVersion || '')} available — open Changelog">
          <span class="update-dot"></span>Update v${escapeHtml(upd.latestVersion || '')}
        </button>`
      : '';
    return `
      <header class="cockpit-header" data-theme-pref="${escapeHtml(themePref)}">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">◐</span>
          <div class="brand-text">
            <strong class="brand-title">Claude Cockpit</strong>
            <span class="brand-tagline">Personal-OS HUD for Claude Code · 100% local</span>
          </div>
        </div>
        <div class="header-search">
          <input type="search" class="global-search-input" placeholder="Search anything…" value="${escapeHtml(query)}" data-global-search />
          ${query ? '<button class="header-btn header-btn-x" data-action="clear-search" title="Clear search">✕</button>' : ''}
        </div>
        <div class="header-actions">
          ${updatePill}
          <button class="header-btn" data-action="open-customize" title="Customize widgets, tabs, theme">⚙</button>
          <button class="header-btn" data-action="goto-help" title="Help">?</button>
        </div>
      </header>
    `;
  }

  function renderTabBar(tabs, activeTab) {
    return `
      <nav class="tabs" role="tablist">
        ${tabs
          .map((t) => {
            const cls = ['tab'];
            if (t.id === activeTab) cls.push('tab-active');
            if (t.dim) cls.push('tab-dim');
            if (t.requiresCwd) cls.push('tab-needs-cwd');
            const cwdMark = t.requiresCwd
              ? '<span class="tab-cwd-mark" title="Most useful with an active Claude Code session">●</span>'
              : '';
            const title = t.hint
              ? `title="${escapeHtml(t.hint + (t.requiresCwd ? ' — needs an active session' : ''))}"`
              : '';
            const icon = TAB_ICONS[t.id] || '';
            return `<button class="${cls.join(' ')}" data-tab="${t.id}" role="tab" aria-selected="${t.id === activeTab}" ${title}>${cwdMark}${icon}${escapeHtml(t.label)}</button>`;
          })
          .join('')}
      </nav>
    `;
  }

  function applyTheme(snap) {
    const themePref = ((snap && snap.userPrefs && snap.userPrefs.theme) || 'auto');
    document.body.setAttribute('data-theme', themePref);
  }

  function render(snap) {
    if (!snap) {
      root.innerHTML = '<p class="empty">Loading…</p>';
      return;
    }
    applyTheme(snap);
    const header = headerStrip(snap);
    const state = vscode.getState() || {};
    if (state.searchOpen || (state.searchQuery || '').trim()) {
      root.innerHTML = `${header}<div class="tab-panel">${searchOverlay(snap)}</div>`;
      bindEvents();
      const inp = root.querySelector('input[data-global-search]');
      if (inp) {
        inp.focus();
        const v = inp.value;
        inp.setSelectionRange(v.length, v.length);
      }
      return;
    }
    const customizeOpen = !!state.customizeOpen;
    if (customizeOpen) {
      root.innerHTML = `${header}<div class="tab-panel">${customizePanel(snap)}</div>`;
      bindEvents();
      return;
    }
    const tabs = visibleTabBar(snap);
    const activeTab = ensureValidActiveTab(getActiveTab(snap), tabs);
    const tabBar = renderTabBar(tabs, activeTab);
    // Map any legacy tab id (e.g. 'memory' → 'library') to the modern one
    // before composing, so prefs and defaults line up.
    const composeTabId = TAB_MIGRATIONS[activeTab] || activeTab;
    const body = tabBodyComposed(snap, composeTabId);

    root.innerHTML = `${header}${tabBar}<div class="tab-panel">${body}</div>`;
    bindEvents();
    // Talk lifecycle now follows the rendered composition, not the active
    // tab id — user can drop the Talk widget on any tab.
    const composition = getTabComponentIds(snap, composeTabId);
    if (composition.includes('talk')) Talk.init();
    else Talk.teardown();
  }

  function ensureValidActiveTab(active, tabs) {
    if (tabs.some((t) => t.id === active)) return active;
    return (tabs[0] && tabs[0].id) || 'custom';
  }

  function getActiveTab(snap) {
    const state = vscode.getState() || {};
    if (state.activeTab) return state.activeTab;
    // First run: land on Welcome until the user dismisses it.
    if (snap && !snap.firstRunCompleted) return 'welcome';
    return 'custom';
  }

  function setActiveTab(id) {
    const next = { ...(vscode.getState() || {}), activeTab: id };
    delete next.customizeOpen;
    vscode.setState(next);
  }

  // Fetch roadmap on first view, or refresh if cache is older than 10 min.
  function maybeAutoFetchRoadmap() {
    const r = lastSnapshot && lastSnapshot.roadmap;
    const stale = !r || !r.fetchedAt || (Date.now() - r.fetchedAt > 10 * 60 * 1000);
    if (stale) vscode.postMessage({ type: 'fetchRoadmap' });
  }

  function openCustomize() {
    vscode.setState({ ...(vscode.getState() || {}), customizeOpen: true });
  }

  function closeCustomize() {
    const next = { ...(vscode.getState() || {}), customizeOpen: false };
    vscode.setState(next);
  }

  function persistUserPrefs(patch) {
    vscode.postMessage({ type: 'setUserPrefs', patch });
  }

  function bindEvents() {
    root.querySelectorAll('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab');
        if (!id) return;
        setActiveTab(id);
        if (id === 'timeline' || id === 'roadmap') maybeAutoFetchRoadmap();
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action === 'refresh') vscode.postMessage({ type: 'refresh' });
        if (action === 'memory') vscode.postMessage({ type: 'openMemory' });
        if (action === 'session') vscode.postMessage({ type: 'openSessionFile' });
        if (action === 'open-customize') {
          // If the click came from a per-tab customize hint, scope the panel
          // to that tab. The header ⚙ button has no data-customize-tab.
          const targetTab = btn.getAttribute('data-customize-tab');
          if (targetTab) {
            const cur = vscode.getState() || {};
            vscode.setState({ ...cur, customizeTab: targetTab });
          }
          openCustomize();
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'close-customize') {
          closeCustomize();
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'goto-help') {
          setActiveTab('help');
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'goto-tab') {
          const target = btn.getAttribute('data-tab');
          if (target) {
            setActiveTab(target);
            if (lastSnapshot) render(lastSnapshot);
          }
        }
        if (action === 'dismiss-welcome') {
          // Mark first-run done, jump to Now (if a session exists) or Custom.
          const targetTab = (lastSnapshot && lastSnapshot.cwd) ? 'now' : 'custom';
          setActiveTab(targetTab);
          vscode.postMessage({ type: 'markFirstRunComplete' });
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'reset-first-run') {
          vscode.postMessage({ type: 'resetFirstRun' });
          setActiveTab('welcome');
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'open-settings') {
          vscode.postMessage({ type: 'openSettings' });
        }
        if (action === 'goto-changelog') {
          const cur = vscode.getState() || {};
          vscode.setState({ ...cur, timelineView: 'changelog' });
          setActiveTab('timeline');
          if (lastSnapshot) render(lastSnapshot);
        }
        if (action === 'check-update') {
          vscode.postMessage({ type: 'checkForUpdate' });
        }
        if (action === 'open-release') {
          vscode.postMessage({ type: 'openReleasePage' });
        }
      });
    });

    // Customize panel — tab selector chips ("which tab am I editing?")
    root.querySelectorAll('button[data-customize-edit-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-customize-edit-tab');
        if (!id) return;
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, customizeTab: id });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    // Customize panel — component picker checkboxes (per-tab)
    root.querySelectorAll('input[data-component-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-component-toggle');
        if (!id || !lastSnapshot) return;
        const editingTabId = getCustomizeTab(lastSnapshot);
        const current = getTabComponentIds(lastSnapshot, editingTabId);
        let next;
        if (input.checked) {
          next = current.includes(id) ? current : [...current, id];
        } else {
          next = current.filter((x) => x !== id);
        }
        const prefs = (lastSnapshot.userPrefs || {});
        const allTabComponents = (prefs.tabComponents && typeof prefs.tabComponents === 'object')
          ? { ...prefs.tabComponents }
          : {};
        // Seed with current legacy customComponents on first edit of Custom,
        // so we don't lose the user's previous picks during migration.
        if (editingTabId === 'custom' && !allTabComponents.custom && Array.isArray(prefs.customComponents)) {
          allTabComponents.custom = prefs.customComponents.slice();
        }
        allTabComponents[editingTabId] = next;
        persistUserPrefs({ tabComponents: allTabComponents });
      });
    });

    // Customize panel — Reset / Clear shortcut buttons (per-tab)
    root.querySelectorAll('button[data-action="reset-tab-widgets"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!lastSnapshot) return;
        const id = btn.getAttribute('data-customize-edit-tab') || getCustomizeTab(lastSnapshot);
        const prefs = (lastSnapshot.userPrefs || {});
        const allTabComponents = (prefs.tabComponents && typeof prefs.tabComponents === 'object')
          ? { ...prefs.tabComponents }
          : {};
        delete allTabComponents[id]; // remove the override → fall back to defaults
        persistUserPrefs({ tabComponents: allTabComponents });
      });
    });
    root.querySelectorAll('button[data-action="clear-tab-widgets"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!lastSnapshot) return;
        const id = btn.getAttribute('data-customize-edit-tab') || getCustomizeTab(lastSnapshot);
        const prefs = (lastSnapshot.userPrefs || {});
        const allTabComponents = (prefs.tabComponents && typeof prefs.tabComponents === 'object')
          ? { ...prefs.tabComponents }
          : {};
        allTabComponents[id] = []; // empty array = "user wants empty" (no fallback)
        persistUserPrefs({ tabComponents: allTabComponents });
      });
    });

    // Customize panel — tab visibility checkboxes
    root.querySelectorAll('input[data-tab-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-tab-toggle');
        if (!id || !lastSnapshot) return;
        const allTabIds = tabCatalogue(lastSnapshot).map((t) => t.id);
        const enabledNow = getEnabledTabIds(lastSnapshot).map((t) => t.id);
        let next;
        if (input.checked) {
          next = enabledNow.includes(id) ? enabledNow : [...enabledNow, id];
        } else {
          next = enabledNow.filter((x) => x !== id);
        }
        // Always ensure pinned ids remain present.
        for (const t of tabCatalogue(lastSnapshot)) {
          if (t.pinned && !next.includes(t.id)) next.push(t.id);
        }
        // Preserve catalogue order.
        const ordered = allTabIds.filter((x) => next.includes(x));
        persistUserPrefs({ enabledTabs: ordered });
      });
    });

    // Customize panel — theme radios
    root.querySelectorAll('input[data-theme-set]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const v = input.getAttribute('data-theme-set');
        if (v !== 'auto' && v !== 'dark' && v !== 'light') return;
        document.body.setAttribute('data-theme', v);
        persistUserPrefs({ theme: v });
      });
    });

    // Customize panel — tab filter chips ("All / Needs session / Standalone")
    root.querySelectorAll('button[data-tab-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-tab-filter');
        if (!v) return;
        persistUserPrefs({ tabFilter: v });
      });
    });

    // Global search input — type-to-search with debounce
    const globalSearchInput = root.querySelector('input[data-global-search]');
    if (globalSearchInput) {
      let globalSearchTimer;
      globalSearchInput.addEventListener('input', () => {
        clearTimeout(globalSearchTimer);
        const q = globalSearchInput.value;
        globalSearchTimer = setTimeout(() => {
          setSearchState({ searchQuery: q, searchOpen: !!q });
          if (lastSnapshot) render(lastSnapshot);
        }, 150);
      });
      globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          setSearchState({ searchQuery: '', searchOpen: false });
          if (lastSnapshot) render(lastSnapshot);
        }
      });
    }

    // Search-overlay type-filter chips
    root.querySelectorAll('button[data-search-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-search-type');
        if (!t) return;
        setSearchState({ searchTypeFilter: t });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    // Search-result hit handlers
    root.querySelectorAll('button[data-search-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-search-action');
        const payload = btn.getAttribute('data-search-payload') || '';
        const targetTab = btn.getAttribute('data-search-tab') || '';
        const subview = btn.getAttribute('data-search-subview') || '';
        const subviewKey = btn.getAttribute('data-search-subview-key') || '';
        const promptBody = btn.getAttribute('data-search-prompt-body') || '';
        // Always close the overlay first.
        setSearchState({ searchOpen: false, searchQuery: '' });
        // Sub-view: set before navigation so render picks it up.
        if (subviewKey && subview) {
          const cur = vscode.getState() || {};
          vscode.setState({ ...cur, [subviewKey]: subview });
        }
        if (action === 'goto-tab') {
          setActiveTab(payload || targetTab);
        } else if (action === 'goto-customize') {
          setActiveTab('custom');
          openCustomize();
        } else if (action === 'open-memory-file' && payload) {
          vscode.postMessage({ type: 'openMemoryFile', filename: payload });
        } else if (action === 'copy-skill' && payload) {
          vscode.postMessage({ type: 'copySkill', skillName: payload });
        } else if (action === 'use-prompt' && promptBody) {
          vscode.postMessage({ type: 'usePrompt', promptBody });
        } else if (action === 'open-file' && payload) {
          vscode.postMessage({ type: 'openFile', filePath: payload });
        } else if (action === 'open-project' && payload) {
          vscode.postMessage({ type: 'openProject', decodedPath: payload });
        } else if (targetTab) {
          setActiveTab(targetTab);
        }
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    // close-search action (also handled in data-action loop)
    root.querySelectorAll('button[data-action="clear-search"], button[data-action="close-search"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setSearchState({ searchQuery: '', searchOpen: false });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    // Routines: new + run
    root.querySelectorAll('button[data-action="new-routine"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'createRoutine' });
      });
    });
    root.querySelectorAll('button[data-run-routine]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-run-routine');
        if (name) vscode.postMessage({ type: 'runRoutine', routineName: name });
      });
    });

    // Discover: refresh + filter
    root.querySelectorAll('button[data-discover-window]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.getAttribute('data-discover-window');
        if (!w) return;
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, discoverWindow: w });
        if (lastSnapshot) render(lastSnapshot);
      });
    });
    root.querySelectorAll('button[data-action="discover-refresh"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = vscode.getState() || {};
        const w = cur.discoverWindow || 'week';
        vscode.postMessage({ type: 'fetchDiscover', window: w });
      });
    });
    root.querySelectorAll('button[data-action="enable-discover"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistUserPrefs({ discoverEnabled: true });
      });
    });

    root.querySelectorAll('button[data-discover-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-discover-view');
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, discoverView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-hn-window]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = btn.getAttribute('data-hn-window');
        if (!w) return;
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, hnWindow: w });
        if (lastSnapshot) render(lastSnapshot);
      });
    });
    root.querySelectorAll('button[data-action="hn-refresh"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = vscode.getState() || {};
        const w = cur.hnWindow || 'day';
        vscode.postMessage({ type: 'fetchHN', window: w });
      });
    });
    root.querySelectorAll('button[data-action="ph-refresh"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'fetchProductHunt' });
      });
    });
    root.querySelectorAll('button[data-fetch-custom-feed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-fetch-custom-feed');
        const url = btn.getAttribute('data-feed-url');
        if (!name || !url) return;
        vscode.postMessage({ type: 'fetchCustomFeed', feedName: name, feedUrl: url });
      });
    });
    root.querySelectorAll('button[data-remove-custom-feed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-remove-custom-feed');
        if (!name) return;
        vscode.postMessage({ type: 'removeCustomFeed', feedName: name });
      });
    });
    root.querySelectorAll('button[data-add-custom-feed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nameEl = root.querySelector('input[data-custom-feed-name]');
        const urlEl = root.querySelector('input[data-custom-feed-url]');
        if (!nameEl || !urlEl) return;
        const name = nameEl.value.trim();
        const url = urlEl.value.trim();
        if (!name || !url) return;
        vscode.postMessage({ type: 'addCustomFeed', feedName: name, feedUrl: url });
        nameEl.value = '';
        urlEl.value = '';
      });
    });

    root.querySelectorAll('button[data-action="roadmap-refresh"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'fetchRoadmap' });
      });
    });
    root.querySelectorAll('button[data-action="roadmap-open-live"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openExternal', url: 'https://roadmap.dashable.dev' });
      });
    });
    root.querySelectorAll('button[data-roadmap-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-roadmap-cat');
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, roadmapCat: id });
        if (lastSnapshot) render(lastSnapshot);
      });
    });
    root.querySelectorAll('button[data-roadmap-stage]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-roadmap-stage');
        const cur = vscode.getState() || {};
        vscode.setState({ ...cur, roadmapStage: id });
        if (lastSnapshot) render(lastSnapshot);
      });
    });
    root.querySelectorAll('input[data-roadmap-search]').forEach((el) => {
      let t;
      el.addEventListener('input', (e) => {
        clearTimeout(t);
        const v = e.target.value;
        t = setTimeout(() => {
          const cur = vscode.getState() || {};
          vscode.setState({ ...cur, roadmapSearch: v });
          if (lastSnapshot) render(lastSnapshot);
        }, 200);
      });
    });
    root.querySelectorAll('button[data-roadmap-open-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-roadmap-open-url');
        if (url) vscode.postMessage({ type: 'openExternal', url });
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
        } else if (qa === 'start-usage') {
          vscode.postMessage({ type: 'startUsageDashboard' });
        } else if (qa === 'detect-usage') {
          vscode.postMessage({ type: 'detectUsageDashboard' });
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

    root.querySelectorAll('button[data-rec-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.getAttribute('data-rec-action');
        const payload = btn.getAttribute('data-rec-payload') || '';
        if (a === 'gotoTab' && payload) {
          setActiveTab(TAB_MIGRATIONS[payload] || payload);
          if (lastSnapshot) render(lastSnapshot);
        } else if (a === 'openMemory') {
          vscode.postMessage({ type: 'openMemory' });
        } else if (a === 'openSession') {
          vscode.postMessage({ type: 'openSessionFile' });
        } else if (a === 'openFile' && payload) {
          vscode.postMessage({ type: 'openFile', filePath: payload });
        } else if (a === 'copySkill' && payload) {
          vscode.postMessage({ type: 'copySkill', skillName: payload });
        } else if (a === 'openExternal' && payload) {
          vscode.postMessage({ type: 'openExternal', url: payload });
        } else if (a === 'setDailyCap') {
          vscode.postMessage({ type: 'setDailyCap' });
        }
      });
    });

    root.querySelectorAll('button[data-inbox-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-inbox-action');
        const payload = btn.getAttribute('data-inbox-payload');
        if (action === 'openMemory') {
          vscode.postMessage({ type: 'openMemory' });
        } else if (action === 'openSession' && payload) {
          vscode.postMessage({ type: 'openFile', filePath: payload });
        } else if (action === 'openFile' && payload) {
          vscode.postMessage({ type: 'openFile', filePath: payload });
        }
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

    root.querySelectorAll('a[data-reveal], button[data-reveal]').forEach((a) => {
      a.addEventListener('click', () => {
        vscode.postMessage({ type: 'revealInOS', path: a.getAttribute('data-reveal') });
      });
    });

    root.querySelectorAll('a[data-open-file], button[data-open-file]').forEach((a) => {
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

    root.querySelectorAll('[data-watch-session]').forEach((btn) => {
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
        const catEl = root.querySelector('select[data-prompt-cat-new]');
        if (!titleEl || !bodyEl) return;
        const title = titleEl.value.trim();
        const body = bodyEl.value.trim();
        if (!title || !body) return;
        const category = catEl && catEl.value ? catEl.value : undefined;
        vscode.postMessage({ type: 'addPrompt', promptTitle: title, promptBody: body, promptCategory: category });
        titleEl.value = '';
        bodyEl.value = '';
        if (catEl) catEl.value = '';
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

    root.querySelectorAll('button[data-prompt-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = btn.getAttribute('data-prompt-filter');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, promptFilter: f });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-library-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-library-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, libraryView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-settings-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-settings-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, settingsView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-timeline-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-timeline-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, timelineView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-history-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-history-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, historyView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-browse-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-browse-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, browseView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    root.querySelectorAll('button[data-security-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-security-view');
        const state = vscode.getState() || {};
        vscode.setState({ ...state, securityView: v });
        if (lastSnapshot) render(lastSnapshot);
      });
    });
    // CPU stat card click → copy model string.
    root.querySelectorAll('.stat-card[data-stat-card="cpu"][data-cpu-model]').forEach((card) => {
      card.addEventListener('click', () => {
        const model = card.getAttribute('data-cpu-model') || '';
        if (model) vscode.postMessage({ type: 'copyText', text: model, label: 'CPU model' });
      });
    });

    root.querySelectorAll('button[data-action="security-scan"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Scanning…';
        vscode.postMessage({ type: 'runSecurityScan' });
      });
    });
    root.querySelectorAll('button[data-action="launch-cso"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'launchCsoSkill' });
      });
    });

    // Talk tab — wire mic / send / wispr / speak buttons. Lifecycle is
    // managed separately in the post-render hook so the canvas keeps painting.
    const startBtn = root.querySelector('button[data-talk-start]');
    if (startBtn) startBtn.addEventListener('click', () => Talk.startListening());
    const stopBtn = root.querySelector('button[data-talk-stop]');
    if (stopBtn) stopBtn.addEventListener('click', () => Talk.stopListening());
    const speakBtn = root.querySelector('button[data-talk-speak]');
    if (speakBtn) speakBtn.addEventListener('click', () => {
      const ta = root.querySelector('textarea[data-talk-text]');
      Talk.speakPreview(ta && ta.value);
    });
    const speakStopBtn = root.querySelector('button[data-talk-speak-stop]');
    if (speakStopBtn) speakStopBtn.addEventListener('click', () => Talk.stopSpeaking());
    root.querySelectorAll('button[data-talk-send]').forEach((btn) => {
      btn.addEventListener('click', () => Talk.send(btn.getAttribute('data-talk-send')));
    });
    const wisprBtn = root.querySelector('button[data-talk-wispr]');
    if (wisprBtn) wisprBtn.addEventListener('click', () => vscode.postMessage({ type: 'triggerWisprFlow' }));

    root.querySelectorAll('select[data-prompt-cat-id]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-prompt-cat-id');
        vscode.postMessage({ type: 'updatePromptCategory', promptId: id, promptCategory: sel.value });
      });
    });

    const mineBtn = root.querySelector('button[data-prompt-mine]');
    if (mineBtn) {
      mineBtn.addEventListener('click', () => {
        mineBtn.disabled = true;
        mineBtn.textContent = '⛏ Mining…';
        vscode.postMessage({ type: 'minePrompts' });
      });
    }

    root.querySelectorAll('input[data-mined-toggle]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!minedPromptsState) return;
        const fp = cb.getAttribute('data-mined-toggle');
        if (cb.checked) minedPromptsState.selected.add(fp);
        else minedPromptsState.selected.delete(fp);
        if (lastSnapshot) render(lastSnapshot);
      });
    });

    const selectAllBtn = root.querySelector('button[data-prompt-mine-select-all]');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        if (!minedPromptsState) return;
        if (minedPromptsState.selected.size === minedPromptsState.prompts.length) {
          minedPromptsState.selected.clear();
        } else {
          minedPromptsState.selected = new Set(minedPromptsState.prompts.map((p) => p.fingerprint));
        }
        if (lastSnapshot) render(lastSnapshot);
      });
    }

    const saveSelBtn = root.querySelector('button[data-prompt-mine-save]');
    if (saveSelBtn) {
      saveSelBtn.addEventListener('click', () => {
        if (!minedPromptsState || !minedPromptsState.selected.size) return;
        const batch = minedPromptsState.prompts
          .filter((p) => minedPromptsState.selected.has(p.fingerprint))
          .map((p, idx) => ({
            title: deriveTitle(p.body, idx),
            body: p.body,
            category: p.category,
          }));
        vscode.postMessage({ type: 'savePromptsBatch', promptBatch: batch });
        minedPromptsState = null;
        // Re-render will happen on next snapshot from backend.
      });
    }

    const closeBtn = root.querySelector('button[data-prompt-mine-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        minedPromptsState = null;
        if (lastSnapshot) render(lastSnapshot);
      });
    }

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
    } else if (msg && msg.type === 'minedPrompts') {
      minedPromptsState = {
        prompts: msg.prompts || [],
        selected: new Set((msg.prompts || []).filter((p) => p.occurrences >= 2).map((p) => p.fingerprint)),
      };
      if (lastSnapshot) render(lastSnapshot);
    } else if (msg && msg.type === 'setHistorySubview') {
      const cur = vscode.getState() || {};
      vscode.setState({ ...cur, historyView: msg.subview });
    }
  });

  vscode.postMessage({ type: 'refresh' });
})();
