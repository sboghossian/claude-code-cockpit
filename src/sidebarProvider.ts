import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  BudgetConfig,
  CockpitSnapshot,
  computeRecommendations,
  formatBytes,
  formatTokens,
  formatUsd,
  globalSessionSearch,
  SessionSearchHit,
  snapshot,
} from './claudeData';
import { readAppUsage } from './appUsage';
import { detectUsageDashboard, readRTKSavings } from './integrations';
import { readMacHealth } from './macHealth';
import { logger } from './logger';
import { obsidianUriFor, readObsidianStatus } from './obsidian';
import {
  createRoutineSkill,
  DiscoverWindow,
  fetchGithubTrending,
  GithubRepo,
  readRssFromObsidian,
  RssEntry,
} from './discover';

interface InboundMessage {
  type:
    | 'refresh'
    | 'openMemory'
    | 'openMemoryFile'
    | 'openFile'
    | 'openSessionFile'
    | 'openProject'
    | 'openProjectSession'
    | 'copySkill'
    | 'revealInOS'
    | 'openExternal'
    | 'openTerminal'
    | 'saveToObsidian'
    | 'openVault'
    | 'openVaultNote'
    | 'openSessionInObsidian'
    | 'searchSessions'
    | 'addPrompt'
    | 'deletePrompt'
    | 'usePrompt'
    | 'pinMemory'
    | 'unpinMemory'
    | 'setDailyCap'
    | 'goToSession'
    | 'startUsageDashboard'
    | 'detectUsageDashboard'
    | 'setUserPrefs'
    | 'createRoutine'
    | 'runRoutine'
    | 'fetchDiscover';
  filename?: string;
  filePath?: string;
  decodedPath?: string;
  projectDir?: string;
  skillName?: string;
  path?: string;
  url?: string;
  command?: string;
  vaultName?: string;
  noteRelPath?: string;
  query?: string;
  promptId?: string;
  promptTitle?: string;
  promptBody?: string;
  sessionFile?: string;
  patch?: UserPrefsPatch;
  routineName?: string;
  window?: DiscoverWindow;
}

interface UserPrefs {
  customComponents: string[] | undefined;
  enabledTabs: string[] | undefined;
  theme: 'auto' | 'dark' | 'light';
  tabFilter: 'all' | 'requires' | 'standalone';
  discoverEnabled: boolean;
}

interface UserPrefsPatch {
  customComponents?: string[];
  enabledTabs?: string[];
  theme?: 'auto' | 'dark' | 'light';
  tabFilter?: 'all' | 'requires' | 'standalone';
  discoverEnabled?: boolean;
}

interface PromptEntry {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

const PROMPTS_KEY = 'claudeCockpit.prompts';
const PINS_KEY = 'claudeCockpit.pinnedMemory';
const USER_PREFS_KEY = 'claudeCockpit.userPrefs';

function readUserPrefs(state: vscode.Memento): UserPrefs {
  const stored = state.get<Partial<UserPrefs>>(USER_PREFS_KEY, {});
  const cfg = vscode.workspace.getConfiguration('claudeCockpit');
  const settingsTheme = cfg.get<'auto' | 'dark' | 'light'>('theme', 'auto');
  const settingsDiscover = cfg.get<boolean>('discover.enabled', false);
  return {
    customComponents: Array.isArray(stored.customComponents) ? stored.customComponents : undefined,
    enabledTabs: Array.isArray(stored.enabledTabs) ? stored.enabledTabs : undefined,
    theme: stored.theme === 'dark' || stored.theme === 'light' || stored.theme === 'auto'
      ? stored.theme
      : settingsTheme,
    tabFilter: stored.tabFilter === 'requires' || stored.tabFilter === 'standalone' || stored.tabFilter === 'all'
      ? stored.tabFilter
      : 'all',
    discoverEnabled: typeof stored.discoverEnabled === 'boolean' ? stored.discoverEnabled : settingsDiscover,
  };
}

export class CockpitSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeCockpit.sidebar';

  private view: vscode.WebviewView | undefined;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private lastSearch: { query: string; hits: SessionSearchHit[] } | undefined;
  private discoverGithub: { window: DiscoverWindow; fetchedAt: number; repos: GithubRepo[]; error: string | undefined } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly readBudgetConfig: () => BudgetConfig,
    private readonly onSnapshot: (snap: CockpitSnapshot) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: InboundMessage) => this.handle(msg));
    view.onDidDispose(() => {
      this.watcher?.close();
      this.watcher = undefined;
    });
    this.refresh();
    this.watchActive();
    // Kick off RTK probe (may take 0-4s); refresh when done so cache is populated.
    void readRTKSavings().then(() => this.refresh());
    // Async Mac Health probe; system_profiler is slow (~1s). Refresh every
    // 30s to keep CPU/memory pressure / network throughput live.
    const refreshMac = () => void readMacHealth().then(() => this.refresh());
    refreshMac();
    const macTimer = setInterval(refreshMac, 30_000);
    view.onDidDispose(() => clearInterval(macTimer));
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cloudRoutinesEnabled = vscode.workspace
      .getConfiguration('claudeCockpit')
      .get<boolean>('cloudRoutines.enabled', false);
    const snap = snapshot(cwd, this.readBudgetConfig(), cloudRoutinesEnabled);
    this.onSnapshot(snap);
    const prompts = this.globalState.get<PromptEntry[]>(PROMPTS_KEY, []);
    const pinnedMemory = this.globalState.get<string[]>(PINS_KEY, []);
    const userPrefs = readUserPrefs(this.globalState);
    // Recompute recommendations with prompts populated — snapshot() doesn't
    // see globalState, so its baseline list misses prompt-driven recs.
    const recommendations = computeRecommendations({
      stats: snap.stats,
      memory: snap.memory,
      skills: snap.skills,
      prompts: prompts.map((p) => ({ id: p.id, title: p.title, body: p.body })),
      agents: snap.agents,
      watchtower: snap.watchtower,
      budget: snap.budget,
      settings: snap.settings,
      rtk: snap.rtk,
      obsidian: snap.obsidian,
      diskUsageBytes: snap.diskUsageBytes,
      cwd: snap.cwd,
    });
    const payload = {
      ...snap,
      recommendations,
      prompts,
      pinnedMemory,
      userPrefs,
      discover: {
        enabled: userPrefs.discoverEnabled,
        github: this.discoverGithub,
        rss: userPrefs.discoverEnabled ? readRssFromObsidian() : { folder: undefined, entries: [] as RssEntry[], error: undefined },
      },
      lastSearch: this.lastSearch,
      stats: {
        ...snap.stats,
        totalTokensFormatted: formatTokens(snap.stats.totalTokens),
        inputTokensFormatted: formatTokens(snap.stats.inputTokens),
        outputTokensFormatted: formatTokens(snap.stats.outputTokens),
        cacheReadTokensFormatted: formatTokens(snap.stats.cacheReadTokens),
        cacheCreationTokensFormatted: formatTokens(snap.stats.cacheCreationTokens),
        costPerHourFormatted: formatUsd(snap.stats.costPerHourUsd),
        contextWindowMaxFormatted: formatTokens(snap.stats.contextWindowMax),
        contextFillPctFormatted: `${snap.stats.contextFillPct.toFixed(1)}%`,
        cacheHitRatePctFormatted: `${(snap.stats.cacheHitRate * 100).toFixed(1)}%`,
        cost: {
          ...snap.stats.cost,
          totalUsdFormatted: formatUsd(snap.stats.cost.totalUsd),
          inputUsdFormatted: formatUsd(snap.stats.cost.inputUsd),
          outputUsdFormatted: formatUsd(snap.stats.cost.outputUsd),
          cacheReadUsdFormatted: formatUsd(snap.stats.cost.cacheReadUsd),
          cacheCreationUsdFormatted: formatUsd(snap.stats.cost.cacheCreationUsd),
        },
        subAgents: snap.stats.subAgents.map((a) => ({
          ...a,
          totalTokensFormatted: formatTokens(a.totalTokens),
        })),
      },
      claudeMdStack: snap.claudeMdStack.map((c) => ({
        ...c,
        sizeFormatted: formatBytes(c.sizeBytes),
      })),
      projects: snap.projects.map((p) => ({
        ...p,
        totalTokensFormatted: formatTokens(p.totalTokens),
      })),
      today: {
        ...snap.today,
        totalTokensFormatted: formatTokens(snap.today.totalTokens),
        totalUsdFormatted: formatUsd(snap.today.totalUsd),
        perProject: snap.today.perProject.map((p) => ({
          ...p,
          tokensFormatted: formatTokens(p.tokens),
          usdFormatted: formatUsd(p.usd),
        })),
      },
      diskUsageBytesFormatted: formatBytes(snap.diskUsageBytes),
      localLayout: {
        ...snap.localLayout,
        motherEntries: snap.localLayout.motherEntries.map((e) => ({
          ...e,
          sizeFormatted: e.isDirectory ? `${e.itemCount ?? 0} items` : formatBytes(e.sizeBytes),
        })),
        sessionEntries: snap.localLayout.sessionEntries.map((e) => ({
          ...e,
          sizeFormatted: e.isDirectory ? `${e.itemCount ?? 0} items` : formatBytes(e.sizeBytes),
        })),
      },
      watchtower: snap.watchtower.map((w) => ({
        ...w,
        totalTokensFormatted: formatTokens(w.totalTokens),
        totalUsdFormatted: formatUsd(w.totalUsd),
        ageLabel: ageLabel(w.ageSeconds),
      })),
      costByTool: snap.costByTool.map((c) => ({
        ...c,
        approxUsdFormatted: formatUsd(c.approxUsd),
        approxTokensFormatted: formatTokens(c.approxTokens),
      })),
      budget: {
        ...snap.budget,
        spentTodayFormatted: formatUsd(snap.budget.spentTodayUsd),
        spentSessionFormatted: formatUsd(snap.budget.spentSessionUsd),
        dailyCapFormatted: formatUsd(snap.budget.dailyCapUsd),
        sessionCapFormatted: formatUsd(snap.budget.sessionCapUsd),
      },
      cockpitStats: {
        ...snap.cockpitStats,
        weekUsdFormatted: formatUsd(snap.cockpitStats.weekUsdRaw),
      },
      appUsage: readAppUsage(this.globalState),
    };
    this.view.webview.postMessage({ type: 'snapshot', snapshot: payload });
  }

  setActiveTabFromHost(tab: string): void {
    this.view?.webview.postMessage({ type: 'setTab', tab });
  }

  runSearch(query: string): void {
    const hits = globalSessionSearch(query, 30);
    this.lastSearch = { query, hits };
    this.refresh();
    this.setActiveTabFromHost('search');
  }

  private watchActive(): void {
    this.watcher?.close();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const snap = snapshot(cwd, this.readBudgetConfig(), false);
    const target = snap.projectDir ?? path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(target)) {
      return;
    }
    try {
      this.watcher = fs.watch(target, { recursive: true }, () => {
        if (this.debounce) {
          clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => this.refresh(), 400);
      });
    } catch (err) {
      logger.warn(`watch failed for ${target}: ${String(err)}`);
    }
  }

  private async handle(msg: InboundMessage): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    switch (msg.type) {
      case 'refresh':
        this.refresh();
        return;
      case 'openMemory':
        void vscode.commands.executeCommand('claudeCockpit.openMemory');
        return;
      case 'openSessionFile':
        void vscode.commands.executeCommand('claudeCockpit.openSessionFile');
        return;
      case 'openMemoryFile':
        if (cwd && msg.filename) {
          this.openMemoryFileSafely(cwd, msg.filename);
        }
        return;
      case 'openFile':
        if (msg.filePath) {
          void vscode.window.showTextDocument(vscode.Uri.file(msg.filePath));
        }
        return;
      case 'openProject':
        if (msg.decodedPath) {
          void vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(msg.decodedPath),
            { forceNewWindow: true },
          );
        }
        return;
      case 'openProjectSession':
        if (msg.projectDir) {
          this.openLatestJsonlInDir(msg.projectDir);
        }
        return;
      case 'copySkill':
        if (msg.skillName) {
          const text = `/${msg.skillName}`;
          void vscode.env.clipboard.writeText(text).then(() => {
            void vscode.window.setStatusBarMessage(`Copied ${text}`, 1500);
          });
        }
        return;
      case 'revealInOS':
        if (msg.path) {
          void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        }
        return;
      case 'openExternal':
        if (msg.url) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        return;
      case 'openTerminal':
        if (msg.command) {
          const term = vscode.window.createTerminal({ name: 'Claude Cockpit' });
          term.show();
          term.sendText(msg.command);
        }
        return;
      case 'saveToObsidian':
        void vscode.commands.executeCommand('claudeCockpit.saveToObsidian');
        return;
      case 'openVault':
        void vscode.commands.executeCommand('claudeCockpit.openVault');
        return;
      case 'openVaultNote':
        if (msg.vaultName && msg.noteRelPath) {
          const obs = readObsidianStatus();
          const v = obs.vaults.find((x) => x.name === msg.vaultName);
          if (v) {
            void vscode.env.openExternal(vscode.Uri.parse(obsidianUriFor(v, msg.noteRelPath)));
          }
        }
        return;
      case 'searchSessions':
        if (msg.query) {
          this.runSearch(msg.query);
        }
        return;
      case 'addPrompt':
        if (msg.promptTitle && msg.promptBody) {
          const prompts = this.globalState.get<PromptEntry[]>(PROMPTS_KEY, []);
          prompts.push({
            id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            title: msg.promptTitle.slice(0, 80),
            body: msg.promptBody,
            createdAt: Date.now(),
          });
          await this.globalState.update(PROMPTS_KEY, prompts);
          this.refresh();
        }
        return;
      case 'deletePrompt':
        if (msg.promptId) {
          const prompts = this.globalState
            .get<PromptEntry[]>(PROMPTS_KEY, [])
            .filter((p) => p.id !== msg.promptId);
          await this.globalState.update(PROMPTS_KEY, prompts);
          this.refresh();
        }
        return;
      case 'usePrompt':
        if (msg.promptBody) {
          await vscode.env.clipboard.writeText(msg.promptBody);
          void vscode.window.setStatusBarMessage('Prompt copied — paste into Claude', 1800);
        }
        return;
      case 'pinMemory':
        if (msg.filename) {
          const pins = this.globalState.get<string[]>(PINS_KEY, []);
          if (!pins.includes(msg.filename)) {
            pins.push(msg.filename);
            await this.globalState.update(PINS_KEY, pins);
            this.refresh();
          }
        }
        return;
      case 'unpinMemory':
        if (msg.filename) {
          const pins = this.globalState
            .get<string[]>(PINS_KEY, [])
            .filter((f) => f !== msg.filename);
          await this.globalState.update(PINS_KEY, pins);
          this.refresh();
        }
        return;
      case 'setDailyCap':
        void vscode.commands.executeCommand('claudeCockpit.setDailyCap');
        return;
      case 'goToSession':
        if (msg.sessionFile) {
          void vscode.window.showTextDocument(vscode.Uri.file(msg.sessionFile));
        }
        return;
      case 'detectUsageDashboard':
        await detectUsageDashboard();
        this.refresh();
        return;
      case 'createRoutine': {
        const name = await vscode.window.showInputBox({
          prompt: 'Routine name (lowercase, hyphen-separated)',
          placeHolder: 'e.g. weekly-haqq-summary',
          validateInput: (v) => (!v || !v.trim() ? 'Name is required' : undefined),
        });
        if (!name) return;
        const description = await vscode.window.showInputBox({
          prompt: 'One-line description (shown in the cockpit and used by Claude when picking the routine)',
          placeHolder: 'e.g. Weekly summary of HAQQ Stripe activity',
        });
        const result = createRoutineSkill(name, description ?? '', '');
        if (!result.ok) {
          void vscode.window.showErrorMessage(`Cockpit: ${result.error}`);
          return;
        }
        if (result.filePath) {
          const doc = await vscode.workspace.openTextDocument(result.filePath);
          void vscode.window.showTextDocument(doc);
        }
        this.refresh();
        return;
      }
      case 'runRoutine': {
        const name = msg.routineName;
        if (!name) return;
        const skill = path.join(os.homedir(), '.claude', 'scheduled-tasks', name, 'SKILL.md');
        if (!fs.existsSync(skill)) {
          void vscode.window.showErrorMessage(`Cockpit: routine SKILL.md not found at ${skill}`);
          return;
        }
        const term = vscode.window.createTerminal({ name: `routine: ${name}` });
        term.show();
        // Pipe the SKILL body into a fresh claude session so the routine
        // executes on demand. The user reviews the trailing prompt before
        // hitting enter (the terminal remains interactive).
        term.sendText(`cat ${shellQuote(skill)} | claude`);
        return;
      }
      case 'fetchDiscover': {
        const win = msg.window ?? 'week';
        try {
          const repos = await fetchGithubTrending(win);
          this.discoverGithub = { window: win, fetchedAt: Date.now(), repos, error: undefined };
        } catch (err) {
          this.discoverGithub = {
            window: win,
            fetchedAt: Date.now(),
            repos: [],
            error: String(err instanceof Error ? err.message : err),
          };
        }
        this.refresh();
        return;
      }
      case 'setUserPrefs': {
        const patch = msg.patch ?? {};
        const current = readUserPrefs(this.globalState);
        const next: UserPrefs = {
          customComponents: Array.isArray(patch.customComponents)
            ? patch.customComponents
            : current.customComponents,
          enabledTabs: Array.isArray(patch.enabledTabs)
            ? patch.enabledTabs
            : current.enabledTabs,
          theme:
            patch.theme === 'auto' || patch.theme === 'dark' || patch.theme === 'light'
              ? patch.theme
              : current.theme,
          tabFilter:
            patch.tabFilter === 'all' || patch.tabFilter === 'requires' || patch.tabFilter === 'standalone'
              ? patch.tabFilter
              : current.tabFilter,
          discoverEnabled:
            typeof patch.discoverEnabled === 'boolean' ? patch.discoverEnabled : current.discoverEnabled,
        };
        await this.globalState.update(USER_PREFS_KEY, next);
        this.refresh();
        return;
      }
      case 'startUsageDashboard': {
        const installed = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        void installed;
        const status = await detectUsageDashboard();
        if (status.url) {
          void vscode.env.openExternal(vscode.Uri.parse(status.url));
          return;
        }
        if (status.installPath) {
          const term = vscode.window.createTerminal({ name: 'claude-usage' });
          term.show();
          term.sendText(`cd "${status.installPath}" && python3 server.py`);
        } else {
          void vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/phuryn/claude-usage'),
          );
        }
        return;
      }
    }
  }

  private openLatestJsonlInDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }
    let best: { file: string; mtime: number } | undefined;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.jsonl')) {
          continue;
        }
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (!best || stat.mtimeMs > best.mtime) {
          best = { file: full, mtime: stat.mtimeMs };
        }
      }
    } catch (err) {
      logger.warn(`openLatestJsonlInDir failed for ${dir}: ${String(err)}`);
      return;
    }
    if (best) {
      void vscode.window.showTextDocument(vscode.Uri.file(best.file));
    }
  }

  private openMemoryFileSafely(cwd: string, filename: string): void {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      logger.warn(`openMemoryFile rejected suspicious filename: ${filename}`);
      return;
    }
    const snap = snapshot(cwd, this.readBudgetConfig(), false);
    if (!snap.projectDir) {
      return;
    }
    const memoryDir = path.resolve(snap.projectDir, 'memory');
    const target = path.resolve(memoryDir, filename);
    if (target !== memoryDir && !target.startsWith(memoryDir + path.sep)) {
      logger.warn(`openMemoryFile rejected escape attempt: ${filename}`);
      return;
    }
    void vscode.window.showTextDocument(vscode.Uri.file(target));
  }

  private html(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'),
    );
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; connect-src 'none'; form-action 'none';" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Claude Cockpit</title>
</head>
<body>
  <main id="root">
    <p class="empty">Loading…</p>
  </main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function ageLabel(seconds: number): string {
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
