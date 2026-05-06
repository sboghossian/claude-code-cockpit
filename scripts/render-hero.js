// Generates a hero screenshot of the cockpit sidebar with mock v0.8.0 data.
// Output: /tmp/cockpit-hero.html (open in any browser, or screenshot headlessly).
// Usage: node scripts/render-hero.js
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.js'), 'utf8');

// Mock snapshot covering everything new in v0.8.0. Numbers tuned to look
// believable on a busy weekday.
const snap = {
  cwd: '/Users/stephane/Documents/Code/haqq-legal-ai',
  projectDir: '/Users/stephane/.claude/projects/-Users-stephane-Documents-Code-haqq-legal-ai',
  greeting: 'Evening',
  pilot: {
    name: 'Stephane',
    role: 'Serial founder · OSS model · primary venture HAQQ Legal AI',
    principles: [
      'Latency collapse is the product',
      'Self-narration is primary UX',
      'Capability discovery > declaration',
      'Heartbeat is the phase change',
      'Platform risk is real',
    ],
    oneLiner: 'Chatbots give up. Agents improvise.',
    alwaysLive: ['roadmap', 'crm', 'brain', 'cortex', 'nomos', 'stark', 'napoleon'],
    sourceFile: '/Users/stephane/.claude/.../stephane_claude.md',
  },
  cockpitStats: {
    streakDays: 22,
    activeDays30: 27,
    peakHour: 9,
    peakHourLabel: '9 AM',
    favoriteModel: 'opus',
    weekUsdRaw: 184.32,
    weekUsdFormatted: '$184',
    totalSessions: 142,
  },
  notifications: [
    {
      id: 'context-high',
      level: 'warn',
      title: 'Context window above 75%',
      detail: '78.2% used — consider /compact soon.',
      action: 'openSession',
      actionPayload: undefined,
    },
  ],
  inbox: [
    {
      id: 'idle-haqq-legal-ai',
      level: 'info',
      category: 'idle',
      title: 'haqq-legal-ai idle',
      detail: 'Waiting 14min',
      action: 'openSession',
      actionPayload: '/x.jsonl',
    },
    {
      id: 'mem-stale',
      level: 'info',
      category: 'memory',
      title: '6 stale memories',
      detail: 'project_old_pricing, haqq_q1_okrs, archived_team_doc',
      action: 'openMemory',
      actionPayload: undefined,
    },
    {
      id: 'plan-todo.md',
      level: 'info',
      category: 'plan',
      title: 'todo.md: 4 open',
      detail: 'Wire Sentry alerts into HAQQ dashboard',
      action: 'openFile',
      actionPayload: '/x',
    },
  ],
  watchtower: [
    {
      decodedPath: '/Users/stephane/Documents/Code/haqq-legal-ai',
      projectDir: '/x',
      sessionFile: '/x.jsonl',
      sessionId: 'abc12345',
      name: 'haqq-legal-ai',
      lastActivityAt: new Date().toISOString(),
      lastActivityMs: Date.now() - 5_000,
      ageSeconds: 5,
      status: 'live',
      totalTokens: 1_240_000,
      totalUsd: 18.42,
      model: 'claude-opus-4-7[1m]',
      modelFamily: 'opus',
      totalTokensFormatted: '1.24M',
      totalUsdFormatted: '$18',
      ageLabel: 'just now',
    },
    {
      decodedPath: '/Users/stephane/Documents/Code/claude-cockpit',
      projectDir: '/x',
      sessionFile: '/x.jsonl',
      sessionId: 'def67890',
      name: 'claude-cockpit',
      lastActivityAt: new Date().toISOString(),
      lastActivityMs: Date.now() - 480_000,
      ageSeconds: 480,
      status: 'recent',
      totalTokens: 320_000,
      totalUsd: 4.81,
      model: 'sonnet',
      modelFamily: 'sonnet',
      totalTokensFormatted: '320k',
      totalUsdFormatted: '$5',
      ageLabel: '8m ago',
    },
    {
      decodedPath: '/Users/stephane/Documents/Code/forkcast',
      projectDir: '/x',
      sessionFile: '/x.jsonl',
      sessionId: 'ghi11111',
      name: 'forkcast',
      lastActivityAt: new Date().toISOString(),
      lastActivityMs: Date.now() - 1_400_000,
      ageSeconds: 1400,
      status: 'idle',
      totalTokens: 88_000,
      totalUsd: 1.32,
      model: 'sonnet',
      modelFamily: 'sonnet',
      totalTokensFormatted: '88k',
      totalUsdFormatted: '$1',
      ageLabel: '23m ago',
    },
  ],
  stats: {
    sessionFile: '/x.jsonl',
    sessionId: 'abc12345',
    inputTokens: 84_120,
    outputTokens: 32_410,
    cacheReadTokens: 920_300,
    cacheCreationTokens: 198_400,
    totalTokens: 1_235_230,
    filesTouched: [
      { filePath: '/Users/stephane/Documents/Code/haqq-legal-ai/src/pages/Matters.tsx', tool: 'Edit', count: 6, lastTouchedAt: new Date().toISOString() },
      { filePath: '/Users/stephane/Documents/Code/haqq-legal-ai/src/components/ClauseLibrary.tsx', tool: 'Edit', count: 3, lastTouchedAt: new Date().toISOString() },
      { filePath: '/Users/stephane/Documents/Code/haqq-legal-ai/server/routes/billing.ts', tool: 'Write', count: 1, lastTouchedAt: new Date().toISOString() },
      { filePath: '/Users/stephane/Documents/Code/haqq-legal-ai/CHANGELOG.md', tool: 'Edit', count: 2, lastTouchedAt: new Date().toISOString() },
    ],
    toolCallCount: 187,
    messageCount: 64,
    startedAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
    lastModel: 'claude-opus-4-7[1m]',
    modelFamily: 'opus',
    isActive: true,
    cost: {
      inputUsd: 1.26, outputUsd: 2.43, cacheReadUsd: 1.38, cacheCreationUsd: 3.72,
      totalUsd: 8.79,
      inputUsdFormatted: '$1.26', outputUsdFormatted: '$2.43',
      cacheReadUsdFormatted: '$1.38', cacheCreationUsdFormatted: '$3.72',
      totalUsdFormatted: '$8.79',
    },
    sparkline: Array.from({ length: 60 }, (_, i) => ({
      minute: 59 - i,
      tokens: Math.max(0, Math.round(15000 * Math.sin(i / 6) + 18000 + Math.random() * 8000 - i * 80)),
    })),
    subAgents: [
      { agentId: 'code-reviewer-7af3', jsonlFile: '/x', totalTokens: 84_300, toolCallCount: 12, messageCount: 8, lastActivityAt: new Date().toISOString(), lastActivityMs: Date.now() - 60_000, totalTokensFormatted: '84k' },
      { agentId: 'plan-eng-review-2de1', jsonlFile: '/x', totalTokens: 41_200, toolCallCount: 6, messageCount: 4, lastActivityAt: new Date().toISOString(), lastActivityMs: Date.now() - 600_000, totalTokensFormatted: '41k' },
    ],
    toolHistogram: [
      { tool: 'Read', count: 64 },
      { tool: 'Edit', count: 31 },
      { tool: 'Bash', count: 28 },
      { tool: 'Grep', count: 22 },
      { tool: 'Glob', count: 18 },
      { tool: 'Write', count: 12 },
      { tool: 'Task', count: 7 },
      { tool: 'WebFetch', count: 3 },
    ],
    costPerHourUsd: 2.41,
    costPerHourFormatted: '$2.41',
    activityFeed: [
      { timestamp: new Date(Date.now() - 5_000).toISOString(), kind: 'tool_use', summary: 'Edit: src/pages/Matters.tsx' },
      { timestamp: new Date(Date.now() - 30_000).toISOString(), kind: 'tool_use', summary: 'Read: src/pages/Matters.tsx' },
      { timestamp: new Date(Date.now() - 60_000).toISOString(), kind: 'message', summary: 'assistant message' },
      { timestamp: new Date(Date.now() - 120_000).toISOString(), kind: 'tool_use', summary: 'Bash: npm test' },
    ],
    contextWindowMax: 1_000_000,
    contextFillPct: 78.2,
    cacheHitRate: 0.84,
    contextWindowMaxFormatted: '1.00M',
    contextFillPctFormatted: '78.2%',
    cacheHitRatePctFormatted: '84.0%',
    toolHistory: [
      { timestamp: new Date(Date.now() - 10_000).toISOString(), tool: 'Edit', argsSummary: 'src/pages/Matters.tsx', result: 'ok' },
      { timestamp: new Date(Date.now() - 30_000).toISOString(), tool: 'Read', argsSummary: 'src/pages/Matters.tsx', result: 'ok' },
      { timestamp: new Date(Date.now() - 60_000).toISOString(), tool: 'Bash', argsSummary: 'npm run build', result: 'error', errorMessage: 'Type error in Matters.tsx:42' },
      { timestamp: new Date(Date.now() - 90_000).toISOString(), tool: 'Bash', argsSummary: 'npm test', result: 'ok' },
    ],
    totalTokensFormatted: '1.24M',
    inputTokensFormatted: '84k',
    outputTokensFormatted: '32k',
    cacheReadTokensFormatted: '920k',
    cacheCreationTokensFormatted: '198k',
  },
  memory: [
    { title: 'HAQQ plan names', filename: 'project_haqq_plan_names.md', hook: 'eFirm = Boutique + Purple; AI = Starter/Pro/Business', isStale: false, lastModifiedAt: new Date(Date.now() - 86400_000).toISOString(), lastModifiedMs: Date.now() - 86400_000 },
    { title: 'Claude Cockpit', filename: 'project_claude_cockpit.md', hook: 'VSCode extension at ~/Documents/Code/claude-cockpit/', isStale: false, lastModifiedAt: new Date(Date.now() - 7200_000).toISOString(), lastModifiedMs: Date.now() - 7200_000 },
    { title: 'Always-live subdomains', filename: 'project_always_live_subdomains.md', hook: 'roadmap, crm, brain, cortex must stay reachable', isStale: false, lastModifiedAt: new Date(Date.now() - 3600_000).toISOString(), lastModifiedMs: Date.now() - 3600_000 },
  ],
  projects: [
    { name: 'haqq-legal-ai', encodedPath: 'x', decodedPath: '/Users/stephane/Documents/Code/haqq-legal-ai', projectDir: '/x', sessionCount: 42, lastActivityAt: new Date().toISOString(), lastActivityMs: Date.now() - 5_000, totalTokens: 38_500_000, totalTokensFormatted: '38.5M' },
    { name: 'claude-cockpit', encodedPath: 'x', decodedPath: '/Users/stephane/Documents/Code/claude-cockpit', projectDir: '/x', sessionCount: 18, lastActivityAt: new Date().toISOString(), lastActivityMs: Date.now() - 600_000, totalTokens: 12_400_000, totalTokensFormatted: '12.4M' },
    { name: 'forkcast', encodedPath: 'x', decodedPath: '/Users/stephane/Documents/Code/forkcast', projectDir: '/x', sessionCount: 11, lastActivityAt: new Date().toISOString(), lastActivityMs: Date.now() - 1_400_000, totalTokens: 4_800_000, totalTokensFormatted: '4.8M' },
  ],
  settings: {
    settingsExists: true,
    mcpServerNames: ['Linear', 'Gmail', 'Notion', 'PostHog', 'Figma', 'HubSpot', 'Cloudflare', 'Stripe'],
    hooks: [
      { event: 'Stop', count: 3, commands: ['rtk', 'pncl-sync'] },
      { event: 'PreToolUse', count: 2, commands: ['rtk-rewrite'] },
      { event: 'UserPromptSubmit', count: 1, commands: ['ai-defence'] },
    ],
    enabledPlugins: ['gstack', 'forkcast', 'caveman'],
  },
  skills: [
    { name: 'plan-ceo-review', description: 'CEO/founder-mode plan review.', source: 'user', pluginName: undefined, useCount: 4 },
    { name: 'forkcast', description: 'Decision tree planner with confidence cascade.', source: 'plugin', pluginName: 'forkcast', useCount: 2 },
    { name: 'caveman', description: 'Ultra-compressed communication mode.', source: 'plugin', pluginName: 'caveman', useCount: 0 },
  ],
  agents: [
    { name: 'code-reviewer', description: 'Meticulous, constructive reviewer for correctness, clarity, security, and maintainability.', scope: 'global', filePath: '/x', model: 'opus', color: 'yellow', tools: undefined },
    { name: 'plan-eng-review', description: 'Eng manager-mode plan review. Lock in execution plan.', scope: 'global', filePath: '/x', model: 'opus', color: undefined, tools: undefined },
    { name: 'haqq-pricing-reviewer', description: 'Reviews HAQQ pricing decisions against legal-AI market.', scope: 'workspace', filePath: '/x', model: 'opus', color: 'purple', tools: undefined },
  ],
  tunnels: [
    { name: 'cockpit', hostname: 'cockpit.dashable.dev', service: 'http://127.0.0.1:8788', configPath: '/x' },
    { name: 'haqq-app', hostname: 'haqq.dashable.dev', service: 'http://127.0.0.1:5173', configPath: '/x' },
    { name: 'roadmap', hostname: 'roadmap.dashable.dev', service: 'http://127.0.0.1:3000', configPath: '/x' },
  ],
  rtk: {
    installed: true,
    totalCommands: 1282,
    tokensSaved: '8.9M',
    efficiencyPct: 64.9,
    topCommand: 'rtk read',
    raw: undefined,
  },
  plans: [
    { path: '/x/tasks/todo.md', name: 'todo.md', totalCount: 12, doneCount: 8, pendingCount: 4, pct: 67, nextItems: ['Wire Sentry alerts into HAQQ dashboard', 'Ship pricing v3 page', 'Migrate billing webhook to Stripe v2'], lastModifiedAt: new Date().toISOString(), lastModifiedMs: Date.now() },
    { path: '/x/tasks/forkcast.md', name: 'forkcast.md', totalCount: 8, doneCount: 5, pendingCount: 3, pct: 63, nextItems: ['Run depth-3 forkcast on Q3 launch'], lastModifiedAt: new Date(Date.now() - 3600_000).toISOString(), lastModifiedMs: Date.now() - 3600_000 },
  ],
  chatExport: {
    installed: true,
    exportPath: '/Users/stephane/Documents/Code/claude-data-export',
    conversationCount: 312,
    projectCount: 18,
    recentConversations: [
      { uuid: 'x', name: 'EU AI Act compliance gaps for HAQQ', createdAt: new Date(Date.now() - 86400_000).toISOString(), updatedAt: new Date().toISOString(), messageCount: 24, excerpt: 'You asked me to review HAQQ\'s data handling for EU AI Act conformity. Three gaps stood out…' },
      { uuid: 'x', name: 'Investor email draft — Q2 board prep', createdAt: new Date(Date.now() - 172800_000).toISOString(), updatedAt: new Date(Date.now() - 60000_000).toISOString(), messageCount: 11, excerpt: 'Drafted Q2 board update covering ARR trend, sales velocity, and risks/mitigations…' },
    ],
    memoryPreview: { preview: 'Stephane is a serial founder operating under an "Open Startup Studio" (OSS) model, building and launching products on an accelerated cadence. Primary active venture: HAQQ Legal AI…', fullPath: '/x', bytes: 5230 },
  },
  heatmap: {
    cells: (() => {
      const cells = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          // Heaviest mid-morning + early afternoon, lighter evenings, almost nothing 0-6.
          const base = hour >= 7 && hour <= 11 ? 12 : hour >= 12 && hour <= 18 ? 8 : hour >= 19 && hour <= 22 ? 4 : 0;
          if (base > 0) cells.push({ day, hour, count: base + Math.floor(Math.random() * 6) });
        }
      }
      return cells;
    })(),
    max: 18,
    byHour: new Array(24).fill(0).map((_, h) => h >= 7 && h <= 18 ? 50 : 10),
    byDay: new Array(7).fill(0).map(() => 70),
  },
  costByTool: [
    { tool: 'Read', count: 64, approxUsd: 2.81, approxTokens: 421_000, approxUsdFormatted: '$2.81', approxTokensFormatted: '421k' },
    { tool: 'Edit', count: 31, approxUsd: 2.32, approxTokens: 348_000, approxUsdFormatted: '$2.32', approxTokensFormatted: '348k' },
    { tool: 'Bash', count: 28, approxUsd: 1.61, approxTokens: 242_000, approxUsdFormatted: '$1.61', approxTokensFormatted: '242k' },
    { tool: 'Task', count: 7, approxUsd: 1.04, approxTokens: 156_000, approxUsdFormatted: '$1.04', approxTokensFormatted: '156k' },
  ],
  budget: {
    enabled: true, dailyCapUsd: 50, sessionCapUsd: 15, spentTodayUsd: 32.18, spentSessionUsd: 8.79,
    dailyPct: 64.4, sessionPct: 58.6, dailyTone: 'warn', sessionTone: 'ok',
    spentTodayFormatted: '$32', dailyCapFormatted: '$50',
    spentSessionFormatted: '$8.79', sessionCapFormatted: '$15',
  },
  obsidian: {
    installed: true,
    registryPath: '/x',
    primaryVault: { id: 'a', name: 'stephane_claude', path: '/Users/stephane/Documents/Code/stephane_claude', isOpen: true, lastOpenedMs: Date.now() - 60000, exists: true },
    vaults: [
      { id: 'a', name: 'stephane_claude', path: '/Users/stephane/Documents/Code/stephane_claude', isOpen: true, lastOpenedMs: Date.now() - 60000, exists: true },
    ],
    recentNotes: [
      { vaultPath: '/x', vaultName: 'stephane_claude', relPath: '20-Projects/haqq/q2-board-prep.md', filename: 'q2-board-prep.md', lastModifiedAt: new Date(Date.now() - 60_000).toISOString(), lastModifiedMs: Date.now() - 60_000, sizeBytes: 2400, excerpt: 'Q2 board update — ARR trend, sales velocity, mitigations…' },
      { vaultPath: '/x', vaultName: 'stephane_claude', relPath: '10-Sessions/2026-05-06-cockpit-shipping.md', filename: '2026-05-06-cockpit-shipping.md', lastModifiedAt: new Date(Date.now() - 1800_000).toISOString(), lastModifiedMs: Date.now() - 1800_000, sizeBytes: 1800, excerpt: 'Shipping v0.7.0 then v0.8.0 of claude-cockpit…' },
    ],
  },
  prompts: [
    { id: 'p1', title: 'plan-review', body: 'Review this plan as if you were the eng manager. Flag missing edge cases, perf risks, and rollback paths. Be terse.', createdAt: Date.now() - 7200000 },
    { id: 'p2', title: 'commit-msg', body: 'Write a conventional commit subject for this diff. Lead with feat:, fix:, or chore:. Under 60 chars.', createdAt: Date.now() - 86400000 },
  ],
  pinnedMemory: ['project_claude_cockpit.md'],
  today: {
    sessions: 14, totalTokens: 4_320_000, totalUsd: 32.18,
    totalTokensFormatted: '4.32M', totalUsdFormatted: '$32',
    perProject: [
      { name: 'haqq-legal-ai', sessions: 6, tokens: 2_100_000, usd: 18.42, tokensFormatted: '2.10M', usdFormatted: '$18' },
      { name: 'claude-cockpit', sessions: 5, tokens: 1_400_000, usd: 9.75, tokensFormatted: '1.40M', usdFormatted: '$10' },
      { name: 'forkcast', sessions: 3, tokens: 820_000, usd: 4.01, tokensFormatted: '820k', usdFormatted: '$4' },
    ],
    topFiles: [
      { path: '/Users/stephane/Documents/Code/haqq-legal-ai/src/pages/Matters.tsx', touches: 18 },
      { path: '/Users/stephane/Documents/Code/claude-cockpit/src/claudeData.ts', touches: 14 },
    ],
    topTools: [
      { tool: 'Read', count: 184 },
      { tool: 'Edit', count: 96 },
    ],
  },
  diskUsageBytes: 8_400_000_000,
  diskUsageBytesFormatted: '8.4 GB',
  localLayout: {
    motherFolder: '/Users/stephane/.claude',
    motherEntries: [],
    sessionFolder: undefined,
    sessionEntries: [],
    globalSettingsFile: undefined,
    activeSessionFile: undefined,
  },
  claudeMdStack: [
    { path: '/Users/stephane/.claude/CLAUDE.md', scope: 'global', sizeBytes: 1840, sizeFormatted: '1.8 KB' },
    { path: '/Users/stephane/Documents/Code/haqq-legal-ai/CLAUDE.md', scope: 'project', sizeBytes: 3120, sizeFormatted: '3.0 KB' },
  ],
  office: { installPath: undefined, hookConfigured: false, port: 3000 },
  usageDashboard: { installed: true, installPath: '/x', runningOnPort: 5000, url: 'http://localhost:5000' },
  macHealth: {
    available: true,
    hostname: 'stephane-mbp',
    model: 'MacBookPro18,3',
    overallHealth: 'excellent',
    disk: { totalGb: 1000, usedGb: 264, availableGb: 736, usedPct: 26.4, filesystem: '/dev/disk3s5' },
    memory: { totalGb: 32, pressurePct: 53, appUsedGb: 12.4, wiredGb: 4.8, compressedGb: 2.1 },
    battery: { pct: 100, isCharging: false, isPluggedIn: true, fullyCharged: true, timeRemaining: undefined },
    cpu: { loadAvg1: 1.84, loadAvg5: 2.12, loadAvg15: 1.94, cores: 10, loadPct1: 18.4, uptime: { days: 4, hours: 12, minutes: 31 } },
    network: { interfaceName: 'en0', ssid: 'Livebox-3E10', rxKbps: 177, txKbps: 31 },
    externalDrives: [],
    bluetooth: [
      { name: 'AirPods Pro', battery: 84, connected: true, kind: 'Headset' },
      { name: 'Magic Keyboard', battery: 62, connected: true, kind: 'Keyboard' },
      { name: 'Magic Trackpad', battery: 91, connected: true, kind: 'Pointing' },
    ],
  },
  appUsage: {
    available: true,
    enabled: true,
    today: {
      date: '2026-05-06',
      totalSeconds: 13560,
      perApp: { 'Visual Studio Code': 3840, 'Google Chrome': 3240, 'Microsoft Teams': 540, 'X (anciennement Twitter)': 660, 'Notes': 480, 'CleanMyMac': 300, 'Terminal': 1200, 'Obsidian': 3300 },
      perHour: {},
    },
    yesterday: undefined,
    topApps: [
      { name: 'Visual Studio Code', seconds: 3840, pct: 28.3 },
      { name: 'Obsidian', seconds: 3300, pct: 24.3 },
      { name: 'Google Chrome', seconds: 3240, pct: 23.9 },
      { name: 'Terminal', seconds: 1200, pct: 8.8 },
      { name: 'X (anciennement Twitter)', seconds: 660, pct: 4.9 },
      { name: 'Microsoft Teams', seconds: 540, pct: 4.0 },
    ],
    hourly: (() => {
      const arr = [];
      for (let h = 0; h < 24; h++) {
        const base = h >= 7 && h <= 12 ? 600 : h >= 13 && h <= 19 ? 800 : h >= 20 && h <= 22 ? 200 : 0;
        arr.push({ hour: h, total: base + Math.floor(Math.random() * 200), topApp: 'Visual Studio Code' });
      }
      return arr;
    })(),
    lastSampledAt: new Date().toISOString(),
  },
};

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
:root {
  --vscode-foreground: #cccccc;
  --vscode-font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  --vscode-font-size: 13px;
  --vscode-descriptionForeground: #8a8a8a;
  --vscode-editor-background: #1e1e1e;
  --vscode-editorWidget-background: #252526;
  --vscode-editorWidget-border: #3a3a3a;
  --vscode-textLink-foreground: #4ea3e0;
  --vscode-charts-blue: #4ea3e0;
  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryForeground: #ffffff;
  --vscode-button-secondaryHoverBackground: #45494e;
  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3a3a3a;
  --vscode-focusBorder: #4ea3e0;
  --vscode-errorForeground: #f48771;
}
html, body { background: #1e1e1e; margin: 0; padding: 0; }
.frame { width: 460px; padding: 12px; box-sizing: border-box; }
${css}
</style></head><body><div class="frame"><main id="root"><p class="empty">Loading…</p></main></div>
<script>
window.__SNAPSHOT__ = ${JSON.stringify(snap)};
let __state = { activeTab: 'now' };
window.acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => __state,
  setState: (s) => { __state = s; },
});
${js}
window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshot', snapshot: window.__SNAPSHOT__ } }));
</script></body></html>`;

const out = '/tmp/cockpit-hero.html';
fs.writeFileSync(out, html);
console.log('wrote', out, '(' + html.length + ' bytes)');
