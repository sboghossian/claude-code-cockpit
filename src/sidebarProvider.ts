import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  BudgetConfig,
  classifyPrompt,
  CockpitSnapshot,
  computeRecommendations,
  formatBytes,
  formatTokens,
  formatUsd,
  globalSessionSearch,
  minePrompts,
  PromptCategory,
  SessionSearchHit,
  snapshot,
} from './claudeData';
import { readAppUsage } from './appUsage';
import { detectUsageDashboard, readRTKSavings, refreshSubdomainHealth } from './integrations';
import { readMacHealth } from './macHealth';
import { logger } from './logger';
import { obsidianUriFor, readObsidianStatus } from './obsidian';
import {
  createRoutineSkill,
  CustomFeed,
  DiscoverWindow,
  FeedItem,
  fetchCustomFeed,
  fetchGithubTrending,
  fetchHackerNews,
  fetchProductHunt,
  GithubRepo,
  readRssFromObsidian,
  RssEntry,
} from './discover';
import { ChangelogStatus, readChangelog } from './changelog';
import {
  checkForUpdate,
  disabledStatus as disabledUpdateStatus,
  getCachedUpdateStatus,
  UpdateStatus,
} from './updateCheck';
import { readManageState } from './manage';
import { getTelemetrySnapshot } from './telemetry';
import { fetchRoadmap, readCachedRoadmap, RoadmapData } from './roadmap';
import {
  decideApproval,
  getQueueDbPath,
  JarvisData,
  readJarvis,
} from './jarvis';
import { scanSecurity, SecuritySnapshot, summarizeFindings } from './security';

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
    | 'updatePromptCategory'
    | 'minePrompts'
    | 'savePromptsBatch'
    | 'pinMemory'
    | 'unpinMemory'
    | 'setDailyCap'
    | 'goToSession'
    | 'startUsageDashboard'
    | 'detectUsageDashboard'
    | 'setUserPrefs'
    | 'createRoutine'
    | 'runRoutine'
    | 'fetchDiscover'
    | 'fetchHN'
    | 'fetchProductHunt'
    | 'fetchCustomFeed'
    | 'addCustomFeed'
    | 'removeCustomFeed'
    | 'runSecurityScan'
    | 'launchCsoSkill'
    | 'fetchRoadmap'
    | 'fetchJarvis'
    | 'jarvisApprove'
    | 'jarvisReject'
    | 'jarvisSendPeer'
    | 'jarvisPromoteAllow'
    | 'jarvisToggleOffline'
    | 'jarvisOpenRoot'
    | 'checkForUpdate'
    | 'openReleasePage';
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
  promptCategory?: PromptCategory;
  promptBatch?: { title: string; body: string; category?: PromptCategory }[];
  sessionFile?: string;
  patch?: UserPrefsPatch;
  routineName?: string;
  window?: DiscoverWindow;
  feedName?: string;
  feedUrl?: string;
  approvalId?: string;
  approvalReason?: string;
  peerText?: string;
  peerKind?: string;
  allowTool?: string;
  allowPattern?: string;
  allowNote?: string;
  offline?: boolean;
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
  category?: PromptCategory;
}

const PROMPTS_KEY = 'claudeCockpit.prompts';
const PINS_KEY = 'claudeCockpit.pinnedMemory';
const USER_PREFS_KEY = 'claudeCockpit.userPrefs';
const CUSTOM_FEEDS_KEY = 'claudeCockpit.customFeeds';

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
  private discoverHN: { window: DiscoverWindow; fetchedAt: number; items: FeedItem[]; error: string | undefined } | undefined;
  private discoverPH: { fetchedAt: number; items: FeedItem[]; error: string | undefined } | undefined;
  private discoverCustom: Record<string, { fetchedAt: number; items: FeedItem[]; error: string | undefined }> = {};
  private security: SecuritySnapshot | undefined;
  private securityInflight: Promise<void> | undefined;
  private updateStatus: UpdateStatus | undefined;
  private updateCheckTimer: NodeJS.Timeout | undefined;
  private roadmap: RoadmapData | undefined = readCachedRoadmap();
  private roadmapInflight: Promise<void> | undefined;
  private jarvis: JarvisData | undefined;
  private jarvisInflight: Promise<void> | undefined;
  private jarvisWatcher: fs.FSWatcher | undefined;
  private jarvisLastPendingIds = new Set<string>();

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
    const surfaces = vscode.workspace.getConfiguration('claudeCockpit.surfaces');
    const macHealthEnabled = surfaces.get<boolean>('macHealth', true);
    const subdomainHealthEnabled = surfaces.get<boolean>('subdomainHealth', true);

    // Async Mac Health probe; system_profiler is slow (~1s). Refresh every
    // 30s to keep CPU/memory pressure / network throughput live.
    if (macHealthEnabled) {
      const refreshMac = () => void readMacHealth().then(() => this.refresh());
      refreshMac();
      const macTimer = setInterval(refreshMac, 30_000);
      view.onDidDispose(() => clearInterval(macTimer));
    }

    // Subdomain health: HEAD-probe pilot's always-live domains so the dots
    // reflect reality. Cheap (<3s with timeout per host), cached server-side.
    if (subdomainHealthEnabled) {
      const refreshHealth = () => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const snap = snapshot(cwd, this.readBudgetConfig(), false);
        const domains = snap.pilot ? snap.pilot.alwaysLive : [];
        if (domains.length === 0) return;
        void refreshSubdomainHealth(domains).then(() => this.refresh());
      };
      refreshHealth();
      const healthTimer = setInterval(refreshHealth, 60_000);
      view.onDidDispose(() => clearInterval(healthTimer));
    }

    // Self-update check — opt-out, runs once on activation and every 6 hours
    // while the view is mounted. Network call goes out only when enabled.
    this.scheduleUpdateCheck();

    void this.refreshJarvis();
    this.startJarvisWatcher();
    view.onDidDispose(() => {
      this.jarvisWatcher?.close();
      this.jarvisWatcher = undefined;
    });
  }

  private startJarvisWatcher(): void {
    try {
      const queuePath = getQueueDbPath();
      if (!fs.existsSync(queuePath)) return;
      let debounce: NodeJS.Timeout | undefined;
      this.jarvisWatcher = fs.watch(queuePath, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void this.refreshJarvis(true), 250);
      });
    } catch (err) {
      logger.info(`jarvis: watcher attach failed: ${String(err)}`);
    }
  }

  private async refreshJarvis(notifyOnNewPending = false): Promise<void> {
    if (this.jarvisInflight) return this.jarvisInflight;
    this.jarvisInflight = (async () => {
      try {
        const next = await readJarvis();
        if (notifyOnNewPending && this.jarvis) {
          const prevIds = this.jarvisLastPendingIds;
          const newPending = next.pendingApprovals.filter((a) => !prevIds.has(a.id));
          for (const a of newPending) {
            const tool = a.tool.replace(/^action\./, '');
            const preview = a.payload.length > 80 ? a.payload.slice(0, 80) + '…' : a.payload;
            const choice = await vscode.window.showInformationMessage(
              `Jarvis: ${a.requestedBy} wants to run ${tool} — ${preview}`,
              'Approve',
              'Reject',
              'Open Cockpit',
            );
            if (choice === 'Approve') {
              try { decideApproval(a.id, 'approved', 'cockpit-notification'); } catch { /* ignore */ }
            } else if (choice === 'Reject') {
              try { decideApproval(a.id, 'rejected', 'cockpit-notification', 'rejected from notification'); } catch { /* ignore */ }
            } else if (choice === 'Open Cockpit') {
              void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
            }
          }
        }
        this.jarvis = next;
        this.jarvisLastPendingIds = new Set(next.pendingApprovals.map((a) => a.id));
      } finally {
        this.jarvisInflight = undefined;
        this.refresh();
      }
    })();
    return this.jarvisInflight;
  }

  private scheduleUpdateCheck(): void {
    const enabled = vscode.workspace
      .getConfiguration('claudeCockpit')
      .get<boolean>('updateCheck.enabled', true);
    if (!enabled) {
      this.updateStatus = disabledUpdateStatus(this.currentVersion());
      return;
    }
    void this.runUpdateCheck();
    if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
    this.updateCheckTimer = setInterval(() => void this.runUpdateCheck(), 6 * 60 * 60 * 1000);
    this.view?.onDidDispose(() => {
      if (this.updateCheckTimer) clearInterval(this.updateCheckTimer);
      this.updateCheckTimer = undefined;
    });
  }

  private async runUpdateCheck(): Promise<void> {
    try {
      this.updateStatus = await checkForUpdate(this.currentVersion());
    } catch (err) {
      logger.warn(`update check failed: ${String(err)}`);
    }
    this.refresh();
  }

  private currentVersion(): string {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(this.extensionUri.fsPath, 'package.json'), 'utf8'),
      ) as { version?: string };
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private readChangelogPayload(): ChangelogStatus {
    return readChangelog(this.extensionUri.fsPath, this.currentVersion());
  }

  private readUpdateStatusPayload(): UpdateStatus {
    if (this.updateStatus) return this.updateStatus;
    const cached = getCachedUpdateStatus();
    if (cached) return cached;
    const enabled = vscode.workspace
      .getConfiguration('claudeCockpit')
      .get<boolean>('updateCheck.enabled', true);
    if (!enabled) return disabledUpdateStatus(this.currentVersion());
    // First snapshot before the async check returns — show "checking" via empty state.
    return {
      enabled: true,
      currentVersion: this.currentVersion(),
      latestVersion: undefined,
      hasUpdate: false,
      releaseUrl: 'https://github.com/sboghossian/claude-cockpit/releases',
      releaseTitle: undefined,
      publishedAt: undefined,
      fetchedAt: undefined,
      error: undefined,
    };
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
        hn: this.discoverHN,
        producthunt: this.discoverPH,
        custom: this.discoverCustom,
        customFeeds: this.globalState.get<CustomFeed[]>(CUSTOM_FEEDS_KEY, []),
        rss: userPrefs.discoverEnabled ? readRssFromObsidian() : { folder: undefined, entries: [] as RssEntry[], error: undefined },
      },
      roadmap: this.roadmap,
      jarvis: this.jarvis,
      changelog: this.readChangelogPayload(),
      updateStatus: this.readUpdateStatusPayload(),
      manage: readManageState(),
      security: this.security ? { ...this.security, summary: summarizeFindings(this.security) } : undefined,
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
      telemetry: getTelemetrySnapshot(),
      surfaces: {
        macHealth: vscode.workspace
          .getConfiguration('claudeCockpit.surfaces')
          .get<boolean>('macHealth', true),
        appUsage: vscode.workspace
          .getConfiguration('claudeCockpit.surfaces')
          .get<boolean>('appUsage', true),
        subdomainHealth: vscode.workspace
          .getConfiguration('claudeCockpit.surfaces')
          .get<boolean>('subdomainHealth', true),
      },
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
    // 'search' is a sub-view of the new 'history' tab; the webview migrates
    // legacy 'search' to 'history' but we set history+sub-view explicitly so
    // the user lands on Session search, not Chat exports.
    this.view?.webview.postMessage({ type: 'setHistorySubview', subview: 'search' });
    this.setActiveTabFromHost('history');
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
          const category = msg.promptCategory || classifyPrompt(msg.promptBody);
          prompts.push({
            id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            title: msg.promptTitle.slice(0, 80),
            body: msg.promptBody,
            createdAt: Date.now(),
            category,
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
      case 'updatePromptCategory':
        if (msg.promptId && msg.promptCategory) {
          const prompts = this.globalState.get<PromptEntry[]>(PROMPTS_KEY, []);
          const idx = prompts.findIndex((p) => p.id === msg.promptId);
          if (idx >= 0) {
            prompts[idx] = { ...prompts[idx], category: msg.promptCategory };
            await this.globalState.update(PROMPTS_KEY, prompts);
            this.refresh();
          }
        }
        return;
      case 'minePrompts': {
        const existing = this.globalState.get<PromptEntry[]>(PROMPTS_KEY, []);
        const seen = new Set(
          existing.map((p) => p.body.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)),
        );
        const mined = minePrompts(60).filter((m) => !seen.has(m.fingerprint));
        this.view?.webview.postMessage({ type: 'minedPrompts', prompts: mined });
        return;
      }
      case 'savePromptsBatch': {
        if (!Array.isArray(msg.promptBatch) || msg.promptBatch.length === 0) return;
        const prompts = this.globalState.get<PromptEntry[]>(PROMPTS_KEY, []);
        for (const entry of msg.promptBatch) {
          if (!entry.title || !entry.body) continue;
          const category = entry.category || classifyPrompt(entry.body);
          prompts.push({
            id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            title: entry.title.slice(0, 80),
            body: entry.body,
            createdAt: Date.now(),
            category,
          });
        }
        await this.globalState.update(PROMPTS_KEY, prompts);
        this.refresh();
        return;
      }
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
      case 'checkForUpdate': {
        await this.runUpdateCheck();
        return;
      }
      case 'openReleasePage': {
        const url = (this.updateStatus && this.updateStatus.releaseUrl)
          || 'https://github.com/sboghossian/claude-cockpit/releases';
        void vscode.env.openExternal(vscode.Uri.parse(url));
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
      case 'fetchHN': {
        const win = msg.window ?? 'day';
        try {
          const items = await fetchHackerNews(win);
          this.discoverHN = { window: win, fetchedAt: Date.now(), items, error: undefined };
        } catch (err) {
          this.discoverHN = { window: win, fetchedAt: Date.now(), items: [], error: String(err instanceof Error ? err.message : err) };
        }
        this.refresh();
        return;
      }
      case 'fetchProductHunt': {
        try {
          const items = await fetchProductHunt();
          this.discoverPH = { fetchedAt: Date.now(), items, error: undefined };
        } catch (err) {
          this.discoverPH = { fetchedAt: Date.now(), items: [], error: String(err instanceof Error ? err.message : err) };
        }
        this.refresh();
        return;
      }
      case 'fetchCustomFeed': {
        if (!msg.feedName || !msg.feedUrl) return;
        const feed: CustomFeed = { name: msg.feedName, url: msg.feedUrl };
        try {
          const items = await fetchCustomFeed(feed);
          this.discoverCustom[feed.name] = { fetchedAt: Date.now(), items, error: undefined };
        } catch (err) {
          this.discoverCustom[feed.name] = { fetchedAt: Date.now(), items: [], error: String(err instanceof Error ? err.message : err) };
        }
        this.refresh();
        return;
      }
      case 'addCustomFeed': {
        if (!msg.feedName || !msg.feedUrl) return;
        if (!/^https?:\/\//i.test(msg.feedUrl)) {
          void vscode.window.showErrorMessage('Custom feed URL must start with http:// or https://');
          return;
        }
        const feeds = this.globalState.get<CustomFeed[]>(CUSTOM_FEEDS_KEY, []);
        if (feeds.some((f) => f.name === msg.feedName)) {
          void vscode.window.showErrorMessage(`A custom feed named "${msg.feedName}" already exists.`);
          return;
        }
        feeds.push({ name: msg.feedName.slice(0, 60), url: msg.feedUrl });
        await this.globalState.update(CUSTOM_FEEDS_KEY, feeds);
        this.refresh();
        return;
      }
      case 'removeCustomFeed': {
        if (!msg.feedName) return;
        const feeds = this.globalState
          .get<CustomFeed[]>(CUSTOM_FEEDS_KEY, [])
          .filter((f) => f.name !== msg.feedName);
        await this.globalState.update(CUSTOM_FEEDS_KEY, feeds);
        delete this.discoverCustom[msg.feedName];
        this.refresh();
        return;
      }
      case 'fetchRoadmap': {
        const enabled = vscode.workspace
          .getConfiguration('claudeCockpit')
          .get<boolean>('roadmap.enabled', true);
        if (!enabled) {
          // Setting is off — don't issue any network call. The disk cache
          // (if any) already populated `this.roadmap` on construction.
          return;
        }
        if (this.roadmapInflight) return;
        this.roadmapInflight = (async () => {
          try {
            this.roadmap = await fetchRoadmap();
          } finally {
            this.roadmapInflight = undefined;
            this.refresh();
          }
        })();
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
      case 'runSecurityScan': {
        if (this.securityInflight) return;
        this.securityInflight = (async () => {
          try {
            // Run scan off the event loop; readFile calls are sync but cheap.
            this.security = await new Promise((resolve) => {
              setImmediate(() => resolve(scanSecurity(cwd)));
            });
          } catch (err) {
            logger.warn(`security scan failed: ${String(err)}`);
          } finally {
            this.securityInflight = undefined;
            this.refresh();
          }
        })();
        return;
      }
      case 'launchCsoSkill': {
        const term = vscode.window.createTerminal({ name: 'cso security audit' });
        term.show();
        // /cso is a gstack skill — runs from the user's claude session in this folder.
        term.sendText('claude /cso');
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
