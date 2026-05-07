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
import { listSidebarScripts } from './plugin';
import { obsidianUriFor, readObsidianStatus } from './obsidian';
import { getOrBuildGraph, VaultGraph } from './graph';
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
import { outboundDomainTail, scanSecurity, SecuritySnapshot, summarizeFindings } from './security';
import {
  appendAuditEvent,
  clearAuditLog,
  getAuditLogPath,
  readAuditTail,
  searchAudit,
} from './auditLog';
import {
  formatShareManifest,
  installFromUrl,
  listGalleryItems,
  previewInstall,
  validateInstallUrl,
} from './gallery';

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
    | 'talkToClaude'
    | 'triggerWisprFlow'
    | 'fetchRoadmap'
    | 'checkForUpdate'
    | 'openReleasePage'
    | 'markFirstRunComplete'
    | 'resetFirstRun'
    | 'openSettings'
    | 'copyText'
    // === obsidian-graph ===
    | 'graph.refresh'
    | 'graph.openInObsidian'
    | 'graph.pickVault'
    // === permissions-audit ===
    | 'audit.refresh'
    | 'audit.search'
    | 'audit.export'
    | 'audit.clearLog'
    | 'audit.openLog'
    | 'keys.add'
    | 'keys.delete'
    | 'keys.list'
    // === skill-gallery (Phase 1) ===
    | 'gallery.openLocal'
    | 'gallery.share'
    | 'gallery.openItem'
    | 'gallery.installPreview'
    | 'gallery.installConfirm'
    | 'gallery.openPublishIssue'
    // === tab-system-v2 ===
    | 'layout.save'
    | 'layout.load'
    | 'layout.delete'
    | 'layout.popOut'
    | 'layout.reorderTabs'
    | 'layout.pin'
    | 'layout.unpin'
    | 'layout.hide'
    | 'layout.show'
    | 'layout.activateTab';
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
  talkText?: string;
  talkMode?: 'new-session' | 'resume' | 'background';
  text?: string;
  label?: string;
  // === obsidian-graph ===
  graphVaultId?: string;
  graphRelPath?: string;
  // permissions-audit fields. Key VALUES are NEVER serialized to disk in
  // plaintext — they go into VS Code's SecretStorage on the host side and the
  // webview only sees count + last-added timestamp.
  auditQuery?: string;
  auditTailN?: number;
  keyName?: string;
  keyValue?: string;
  // === skill-gallery payloads ===
  galleryId?: string;
  galleryUrl?: string;
  gallerySha256?: string;
  // === tab-system-v2 ===
  layoutName?: string;
  tabId?: string;
  tabOrder?: string[];
  pinnedTabs?: string[];
  hiddenTabs?: string[];
}

/**
 * tab-system-v2: a named layout overlays four orthogonal axes on top of the
 * existing tabComponents/enabledTabs prefs. tabOrder is the ordered list of
 * tab IDs the user wants to see, left-to-right. pinnedTabs is a stable
 * front-cluster (always rendered first, in their declared order).
 * hiddenTabs is the explicit hide-list — tabs NOT in pinnedTabs OR tabOrder
 * but present in this list are hidden. tabComponents is per-tab widget order
 * (mirrors the Custom-tab pref), letting a "Reviewing PRs" preset rearrange
 * the inside of a tab without overwriting the user's "Coding" preset.
 */
interface TabLayout {
  tabOrder: string[];
  pinnedTabs: string[];
  hiddenTabs: string[];
  tabComponents: Record<string, string[]>;
}

type CockpitTheme = 'auto' | 'dark' | 'light' | 'high-contrast';

interface UserPrefs {
  customComponents: string[] | undefined;
  tabComponents: Record<string, string[]> | undefined;
  enabledTabs: string[] | undefined;
  theme: CockpitTheme;
  tabFilter: 'all' | 'requires' | 'standalone';
  discoverEnabled: boolean;
  // === tab-system-v2 ===
  tabLayouts: Record<string, TabLayout> | undefined;
  currentLayoutName: string | undefined;
  pinnedTabs: string[] | undefined;
  hiddenTabs: string[] | undefined;
  tabOrder: string[] | undefined;
}

interface UserPrefsPatch {
  customComponents?: string[];
  tabComponents?: Record<string, string[]>;
  enabledTabs?: string[];
  theme?: CockpitTheme;
  tabFilter?: 'all' | 'requires' | 'standalone';
  discoverEnabled?: boolean;
  // === tab-system-v2 ===
  tabLayouts?: Record<string, TabLayout>;
  currentLayoutName?: string | null;
  pinnedTabs?: string[];
  hiddenTabs?: string[];
  tabOrder?: string[];
}

function isCockpitTheme(v: unknown): v is CockpitTheme {
  return v === 'auto' || v === 'dark' || v === 'light' || v === 'high-contrast';
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
const FIRST_RUN_KEY = 'claudeCockpit.firstRunCompleted';
// permissions-audit: index of secret-storage key NAMES (never values).
const KEYS_INDEX_KEY = 'claudeCockpit.audit.keysIndex';
function secretKeyFor(name: string): string {
  return `claudeCockpit.audit.secret.${name}`;
}
function keyAddedAtMsKey(name: string): string {
  return `claudeCockpit.audit.keyAddedAt.${name}`;
}

function isStringArrayMap(v: unknown): v is Record<string, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (!Array.isArray(val)) return false;
    for (const s of val) {
      if (typeof s !== 'string') return false;
    }
  }
  return true;
}

// === tab-system-v2 ===
// Coerce stored layout map → typed TabLayout shape. Anything malformed gets
// silently dropped so a corrupted globalState entry never crashes the view.
function isTabLayoutMap(v: unknown): v is Record<string, TabLayout> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const layout of Object.values(v as Record<string, unknown>)) {
    if (!layout || typeof layout !== 'object') return false;
    const l = layout as Record<string, unknown>;
    if (!Array.isArray(l.tabOrder) || !l.tabOrder.every((s) => typeof s === 'string')) return false;
    if (!Array.isArray(l.pinnedTabs) || !l.pinnedTabs.every((s) => typeof s === 'string')) return false;
    if (!Array.isArray(l.hiddenTabs) || !l.hiddenTabs.every((s) => typeof s === 'string')) return false;
    if (!isStringArrayMap(l.tabComponents)) return false;
  }
  return true;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function readUserPrefs(state: vscode.Memento): UserPrefs {
  const stored = state.get<Partial<UserPrefs>>(USER_PREFS_KEY, {});
  const cfg = vscode.workspace.getConfiguration('claudeCockpit');
  const settingsTheme = cfg.get<CockpitTheme>('theme', 'auto');
  const settingsDiscover = cfg.get<boolean>('discover.enabled', false);
  return {
    customComponents: Array.isArray(stored.customComponents) ? stored.customComponents : undefined,
    tabComponents: isStringArrayMap(stored.tabComponents) ? stored.tabComponents : undefined,
    enabledTabs: Array.isArray(stored.enabledTabs) ? stored.enabledTabs : undefined,
    theme: isCockpitTheme(stored.theme)
      ? stored.theme
      : (isCockpitTheme(settingsTheme) ? settingsTheme : 'auto'),
    tabFilter: stored.tabFilter === 'requires' || stored.tabFilter === 'standalone' || stored.tabFilter === 'all'
      ? stored.tabFilter
      : 'all',
    discoverEnabled: typeof stored.discoverEnabled === 'boolean' ? stored.discoverEnabled : settingsDiscover,
    // === tab-system-v2 ===
    tabLayouts: isTabLayoutMap(stored.tabLayouts) ? stored.tabLayouts : undefined,
    currentLayoutName: typeof stored.currentLayoutName === 'string' && stored.currentLayoutName
      ? stored.currentLayoutName
      : undefined,
    pinnedTabs: isStringArray(stored.pinnedTabs) ? stored.pinnedTabs : undefined,
    hiddenTabs: isStringArray(stored.hiddenTabs) ? stored.hiddenTabs : undefined,
    tabOrder: isStringArray(stored.tabOrder) ? stored.tabOrder : undefined,
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
  private lastAlwaysLive: string[] = [];
  // permissions-audit: SecretStorage handle so the Keys sub-view can persist
  // API keys without ever serializing values to disk in plaintext. Plumbed in
  // via setSecretStorage() from extension.ts on activation; never serialised to
  // the webview.
  private secrets: vscode.SecretStorage | undefined;
  // === tab-system-v2 ===
  // Pop-out panel created by `layout.popOut`. Same html() output as the
  // sidebar webview, so both consume the same snapshot payload + post the
  // same messages back here. We re-broadcast every refresh() to both views
  // to keep layout state coherent.
  private popoutPanel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly readBudgetConfig: () => BudgetConfig,
    private readonly onSnapshot: (snap: CockpitSnapshot) => void,
  ) {}

  setSecretStorage(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

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
        const domains = this.lastAlwaysLive;
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
      this.jarvisWatcher?.close();
      this.jarvisWatcher = undefined;
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
      releaseUrl: 'https://github.com/sboghossian/claude-code-cockpit/releases',
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
    this.lastAlwaysLive = snap.pilot ? snap.pilot.alwaysLive : [];
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
      firstRunCompleted: this.globalState.get<boolean>(FIRST_RUN_KEY, false),
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
    // === tab-system-v2 ===
    // The pop-out panel renders the SAME html() as the sidebar view. Both
    // post messages back to this same provider, so we broadcast every
    // snapshot to both surfaces to keep layout state in lockstep — the
    // primary risk called out in PLAN.md (#7 layout state desync).
    if (this.popoutPanel) {
      this.popoutPanel.webview.postMessage({ type: 'snapshot', snapshot: payload });
      // Tag the pop-out so its render() can branch into the full-screen grid.
      this.popoutPanel.webview.postMessage({ type: 'layout.popoutMode', enabled: true });
    }
  }

  setActiveTabFromHost(tab: string): void {
    this.view?.webview.postMessage({ type: 'setTab', tab });
    this.popoutPanel?.webview.postMessage({ type: 'setTab', tab });
  }

  /**
   * tab-system-v2: jump to tab by index in the user's CURRENT visible order.
   * Index is 0-based; out-of-range is a no-op so cmd+9 doesn't crash on a
   * 5-tab layout. The webview computes the actual order on its side; we just
   * forward an index and the layout-aware webview-side handler resolves it.
   */
  jumpToTabIndex(index: number): void {
    this.view?.webview.postMessage({ type: 'layout.jumpToIndex', index });
    this.popoutPanel?.webview.postMessage({ type: 'layout.jumpToIndex', index });
  }

  /** tab-system-v2: cycle to next/prev tab in the visible order. */
  cycleTab(direction: 'next' | 'prev'): void {
    this.view?.webview.postMessage({ type: 'layout.cycleTab', direction });
    this.popoutPanel?.webview.postMessage({ type: 'layout.cycleTab', direction });
  }

  /** tab-system-v2: open the pop-out fullscreen panel from a host command. */
  popOutFullscreen(): void {
    this.openPopoutPanel();
  }

  /** tab-system-v2: prompt + save current layout via host command. */
  async saveLayoutViaPrompt(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Save current tab layout as',
      placeHolder: 'e.g. Coding, Research, Reviewing PRs',
      validateInput: (v) => (v && v.trim() ? null : 'Name required'),
    });
    if (!name) return;
    this.view?.webview.postMessage({ type: 'layout.saveCurrentAs', layoutName: name.trim().slice(0, 60) });
    this.popoutPanel?.webview.postMessage({ type: 'layout.saveCurrentAs', layoutName: name.trim().slice(0, 60) });
  }

  /** tab-system-v2: prompt + load layout via host command. */
  async loadLayoutViaPrompt(): Promise<void> {
    const prefs = readUserPrefs(this.globalState);
    const layouts = prefs.tabLayouts ? Object.keys(prefs.tabLayouts) : [];
    if (layouts.length === 0) {
      void vscode.window.showInformationMessage('No saved layouts. Right-click a tab in the Cockpit sidebar → Save current layout as…');
      return;
    }
    const picked = await vscode.window.showQuickPick(layouts, {
      title: 'Load Tab Layout',
      placeHolder: 'Choose a saved layout',
    });
    if (!picked) return;
    const layout = prefs.tabLayouts?.[picked];
    if (!layout) return;
    await this.globalState.update(USER_PREFS_KEY, {
      ...prefs,
      currentLayoutName: picked,
      tabOrder: layout.tabOrder.slice(),
      pinnedTabs: layout.pinnedTabs.slice(),
      hiddenTabs: layout.hiddenTabs.slice(),
      tabComponents: { ...prefs.tabComponents, ...layout.tabComponents },
    });
    this.refresh();
  }

  /** Triggered from the command palette — same code path as the in-webview
   *  "Refresh graph" button (graph.refresh inbound message). */
  requestGraphRefresh(): void {
    void this.refreshGraph(undefined);
  }

  /** Triggered by the `claudeCockpit.gallery.installFromUrl` command. Routes
   *  through the same preview path the webview uses, so the user sees the
   *  SHA256 + 1KB excerpt before any disk write. */
  previewGalleryInstall(url: string): void {
    void this.handle({ type: 'gallery.installPreview', galleryUrl: url });
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
      case 'copyText':
        if (typeof msg.text === 'string' && msg.text) {
          void vscode.env.clipboard.writeText(msg.text).then(() => {
            const label = typeof msg.label === 'string' && msg.label ? msg.label : 'text';
            void vscode.window.setStatusBarMessage(`Copied ${label}`, 1500);
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
        if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) {
          logger.warn(`runRoutine: rejected invalid name "${name}"`);
          return;
        }
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
          || 'https://github.com/sboghossian/claude-code-cockpit/releases';
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
          tabComponents: isStringArrayMap(patch.tabComponents)
            ? patch.tabComponents
            : current.tabComponents,
          enabledTabs: Array.isArray(patch.enabledTabs)
            ? patch.enabledTabs
            : current.enabledTabs,
          theme: isCockpitTheme(patch.theme) ? patch.theme : current.theme,
          tabFilter:
            patch.tabFilter === 'all' || patch.tabFilter === 'requires' || patch.tabFilter === 'standalone'
              ? patch.tabFilter
              : current.tabFilter,
          discoverEnabled:
            typeof patch.discoverEnabled === 'boolean' ? patch.discoverEnabled : current.discoverEnabled,
          // === tab-system-v2 ===
          tabLayouts: isTabLayoutMap(patch.tabLayouts) ? patch.tabLayouts : current.tabLayouts,
          currentLayoutName:
            patch.currentLayoutName === null
              ? undefined
              : typeof patch.currentLayoutName === 'string'
                ? patch.currentLayoutName
                : current.currentLayoutName,
          pinnedTabs: isStringArray(patch.pinnedTabs) ? patch.pinnedTabs : current.pinnedTabs,
          hiddenTabs: isStringArray(patch.hiddenTabs) ? patch.hiddenTabs : current.hiddenTabs,
          tabOrder: isStringArray(patch.tabOrder) ? patch.tabOrder : current.tabOrder,
        };
        await this.globalState.update(USER_PREFS_KEY, next);
        this.refresh();
        return;
      }
      case 'markFirstRunComplete': {
        await this.globalState.update(FIRST_RUN_KEY, true);
        this.refresh();
        return;
      }
      case 'resetFirstRun': {
        await this.globalState.update(FIRST_RUN_KEY, false);
        this.refresh();
        return;
      }
      case 'openSettings': {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:dashable.claude-cockpit',
        );
        return;
      }
      case 'runSecurityScan': {
        if (this.securityInflight) return;
        // NOTE: scanSecurity is sync I/O (readFileSync per file) and blocks
        // the extension host while it runs. Keep this user-triggered only —
        // never call from a timer or auto-refresh.
        this.securityInflight = (async () => {
          try {
            // Yield once so we don't block the message-handling tick.
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
      case 'talkToClaude': {
        const text = (msg.talkText || '').trim();
        if (!text) return;
        const mode = msg.talkMode || 'new-session';
        // Pipe the message into a fresh `claude` invocation in a terminal.
        // Using a heredoc keeps quoting safe even when the message contains
        // special characters. Mode controls flag args.
        const flag = mode === 'resume' ? ' --continue' : mode === 'background' ? ' --print' : '';
        const term = vscode.window.createTerminal({ name: `talk: ${text.slice(0, 40)}` });
        term.show();
        // We send the message via stdin so quoting is bulletproof.
        const heredoc = `claude${flag} <<'COCKPIT_EOF'\n${text}\nCOCKPIT_EOF`;
        term.sendText(heredoc);
        return;
      }
      case 'triggerWisprFlow': {
        // Wispr Flow on macOS uses a global shortcut. We can't directly hook
        // into Wispr's IPC, but we can fire its default shortcut via
        // AppleScript (Fn-Fn double-tap by default — varies by user). Most
        // users will just press the shortcut themselves, but this surfaces
        // the option for one-click activation when they've remapped to a
        // synthesizable key.
        if (process.platform !== 'darwin') {
          void vscode.window.showInformationMessage('Wispr Flow handoff is macOS-only.');
          return;
        }
        const userShortcut = vscode.workspace
          .getConfiguration('claudeCockpit')
          .get<string>('wisprShortcut', '');
        if (!userShortcut) {
          void vscode.window.showInformationMessage(
            'Set claudeCockpit.wisprShortcut in settings to your Wispr key combo (e.g. "control+option+space"). Or just press your Wispr shortcut directly — Cockpit will pick up the dictated text from the active text input.',
          );
          return;
        }
        // Translate "control+option+space" → AppleScript form. Keep it
        // narrow — we only support common modifiers + a single key. Validate
        // strictly to avoid AppleScript injection through user settings.
        const parts = userShortcut.toLowerCase().split('+').map((s) => s.trim());
        const keyPart = parts.pop();
        if (!keyPart || !/^[a-z0-9 ]$/.test(keyPart)) {
          logger.warn(`wispr trigger: invalid key "${keyPart ?? ''}"`);
          return;
        }
        const allowedMods = new Set(['cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift', 'fn']);
        for (const p of parts) {
          if (!allowedMods.has(p)) {
            logger.warn(`wispr trigger: invalid modifier "${p}"`);
            return;
          }
        }
        const mods: string[] = [];
        if (parts.includes('control') || parts.includes('ctrl')) mods.push('control down');
        if (parts.includes('option') || parts.includes('alt')) mods.push('option down');
        if (parts.includes('command') || parts.includes('cmd')) mods.push('command down');
        if (parts.includes('shift')) mods.push('shift down');
        const using = mods.length ? ` using {${mods.join(', ')}}` : '';
        const ascript = `tell application "System Events" to keystroke "${keyPart}"${using}`;
        const term = vscode.window.createTerminal({ name: 'wispr trigger' });
        term.sendText(`osascript -e '${ascript.replace(/'/g, "'\\''")}'`);
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
      // === obsidian-graph ===
      case 'graph.refresh': {
        await this.refreshGraph(msg.graphVaultId);
        return;
      }
      case 'graph.openInObsidian': {
        if (!msg.graphVaultId || !msg.graphRelPath) return;
        const obs = readObsidianStatus();
        const v = obs.vaults.find((x) => x.id === msg.graphVaultId);
        if (!v) return;
        // Strip a leading scheme guard — relPath comes straight from the
        // graph nodes we built, but defense in depth: never let `obsidian://`
        // appear inside the file= param.
        const safeRel = msg.graphRelPath.replace(/^obsidian:\/\//i, '');
        void vscode.env.openExternal(vscode.Uri.parse(obsidianUriFor(v, safeRel)));
        return;
      }
      case 'graph.pickVault': {
        // Optional: future vault-picker. v1.0 ships using the primary vault
        // surfaced by readObsidianStatus(); we keep this case as a no-op
        // hook so the v1.1 vault-picker can land without a webview message
        // contract change.
        return;
      }
      // === permissions-audit ===
      case 'audit.refresh': {
        const n = typeof msg.auditTailN === 'number' && msg.auditTailN > 0 ? Math.min(msg.auditTailN, 1000) : 200;
        const events = readAuditTail(n);
        const domains = outboundDomainTail(50);
        this.view?.webview.postMessage({ type: 'audit.payload', events, domains });
        return;
      }
      case 'audit.search': {
        const q = typeof msg.auditQuery === 'string' ? msg.auditQuery : '';
        const events = q ? searchAudit(q) : readAuditTail(200);
        this.view?.webview.postMessage({ type: 'audit.searchResult', events, query: q });
        return;
      }
      case 'audit.export': {
        await this.exportAuditLog();
        return;
      }
      case 'audit.clearLog': {
        const choice = await vscode.window.showWarningMessage(
          'Clear the audit log? This deletes audit.log + rotated archives. Cannot be undone.',
          { modal: true },
          'Clear',
        );
        if (choice === 'Clear') {
          clearAuditLog();
          this.view?.webview.postMessage({ type: 'audit.cleared' });
          this.refresh();
        }
        return;
      }
      case 'audit.openLog': {
        const p = getAuditLogPath();
        if (fs.existsSync(p)) {
          void vscode.window.showTextDocument(vscode.Uri.file(p));
        } else {
          void vscode.window.showInformationMessage('Audit log is empty (no events recorded yet).');
        }
        return;
      }
      case 'keys.add': {
        if (!this.secrets) {
          void vscode.window.showWarningMessage('SecretStorage not available; cannot store key.');
          return;
        }
        const name = typeof msg.keyName === 'string' ? msg.keyName.trim() : '';
        const value = typeof msg.keyValue === 'string' ? msg.keyValue : '';
        if (!name || !value || !/^[A-Z0-9_]{1,64}$/.test(name)) {
          void vscode.window.showWarningMessage('Key name must be 1-64 chars, [A-Z0-9_]; value must be non-empty.');
          return;
        }
        await this.secrets.store(secretKeyFor(name), value);
        const index = await this.readKeyIndex();
        if (!index.includes(name)) {
          index.push(name);
          await this.globalState.update(KEYS_INDEX_KEY, index);
        }
        await this.globalState.update(keyAddedAtMsKey(name), Date.now());
        appendAuditEvent({
          ts: Date.now(),
          kind: 'key.access',
          detail: { op: 'add', name },
          worktree: 'permissions-audit',
        });
        await this.postKeysList();
        return;
      }
      case 'keys.delete': {
        if (!this.secrets) return;
        const name = typeof msg.keyName === 'string' ? msg.keyName.trim() : '';
        if (!name || !/^[A-Z0-9_]{1,64}$/.test(name)) return;
        await this.secrets.delete(secretKeyFor(name));
        const index = (await this.readKeyIndex()).filter((k) => k !== name);
        await this.globalState.update(KEYS_INDEX_KEY, index);
        await this.globalState.update(keyAddedAtMsKey(name), undefined);
        appendAuditEvent({
          ts: Date.now(),
          kind: 'key.access',
          detail: { op: 'delete', name },
          worktree: 'permissions-audit',
        });
        await this.postKeysList();
        return;
      }
      case 'keys.list': {
        await this.postKeysList();
        return;
      }
      // === skill-gallery (Phase 1) ===
      case 'gallery.openLocal': {
        try {
          const items = listGalleryItems(cwd);
          this.view?.webview.postMessage({ type: 'gallery.localItems', items });
        } catch (err) {
          this.view?.webview.postMessage({
            type: 'gallery.localError',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'gallery.share': {
        if (!msg.galleryId) return;
        const items = listGalleryItems(cwd);
        const item = items.find((i) => i.id === msg.galleryId);
        if (!item) {
          void vscode.window.showWarningMessage(`Gallery item not found: ${msg.galleryId}`);
          return;
        }
        try {
          const payload = formatShareManifest(item);
          await vscode.env.clipboard.writeText(payload.text);
          void vscode.window.setStatusBarMessage(
            `Copied ${item.name} share manifest`,
            2500,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Gallery share failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }
      case 'gallery.openItem': {
        if (!msg.galleryId) return;
        const items = listGalleryItems(cwd);
        const item = items.find((i) => i.id === msg.galleryId);
        if (!item) return;
        void vscode.window.showTextDocument(vscode.Uri.file(item.filePath));
        return;
      }
      case 'gallery.installPreview': {
        const u = msg.galleryUrl ?? '';
        const validation = validateInstallUrl(u);
        if (!validation.ok) {
          this.view?.webview.postMessage({
            type: 'gallery.installPreview',
            error: validation.reason,
          });
          return;
        }
        try {
          const preview = await previewInstall(validation.href);
          this.view?.webview.postMessage({ type: 'gallery.installPreview', preview });
        } catch (err) {
          this.view?.webview.postMessage({
            type: 'gallery.installPreview',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'gallery.installConfirm': {
        if (!msg.galleryUrl || !msg.gallerySha256) return;
        const choice = await vscode.window.showWarningMessage(
          `Install skill from ${msg.galleryUrl}?\n\nThis writes to ~/.claude/skills/. Cockpit verifies the SHA256 you saw in the preview matches the bytes it actually receives.`,
          { modal: true },
          'Install',
        );
        if (choice !== 'Install') {
          this.view?.webview.postMessage({
            type: 'gallery.installResult',
            error: 'User cancelled',
          });
          return;
        }
        try {
          const result = await installFromUrl({
            url: msg.galleryUrl,
            expectedSha256: msg.gallerySha256,
          });
          this.view?.webview.postMessage({
            type: 'gallery.installResult',
            filePath: result.filePath,
            sha256: result.sha256,
            inferredName: result.inferredName,
          });
          this.refresh();
          void vscode.window.showInformationMessage(
            `Installed skill: ${result.inferredName}`,
          );
        } catch (err) {
          this.view?.webview.postMessage({
            type: 'gallery.installResult',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'gallery.openPublishIssue': {
        void vscode.env.openExternal(
          vscode.Uri.parse(
            'https://github.com/sboghossian/cockpit-skills/issues/new?template=publish-skill.md',
          ),
        );
        return;
      }
      // === tab-system-v2 ===
      case 'layout.save': {
        if (!msg.layoutName || typeof msg.layoutName !== 'string') return;
        const name = msg.layoutName.trim().slice(0, 60);
        if (!name) return;
        const current = readUserPrefs(this.globalState);
        const layouts: Record<string, TabLayout> = current.tabLayouts ? { ...current.tabLayouts } : {};
        layouts[name] = {
          tabOrder: isStringArray(msg.tabOrder) ? msg.tabOrder : (current.tabOrder ?? []),
          pinnedTabs: isStringArray(msg.pinnedTabs) ? msg.pinnedTabs : (current.pinnedTabs ?? []),
          hiddenTabs: isStringArray(msg.hiddenTabs) ? msg.hiddenTabs : (current.hiddenTabs ?? []),
          tabComponents: current.tabComponents ?? {},
        };
        await this.globalState.update(USER_PREFS_KEY, {
          ...current,
          tabLayouts: layouts,
          currentLayoutName: name,
        });
        this.refresh();
        return;
      }
      case 'layout.load': {
        if (!msg.layoutName || typeof msg.layoutName !== 'string') return;
        const name = msg.layoutName;
        const current = readUserPrefs(this.globalState);
        const layout = current.tabLayouts?.[name];
        if (!layout) {
          logger.warn(`layout.load: no layout named "${name}" — no-op`);
          return;
        }
        await this.globalState.update(USER_PREFS_KEY, {
          ...current,
          currentLayoutName: name,
          tabOrder: layout.tabOrder.slice(),
          pinnedTabs: layout.pinnedTabs.slice(),
          hiddenTabs: layout.hiddenTabs.slice(),
          tabComponents: { ...current.tabComponents, ...layout.tabComponents },
        });
        this.refresh();
        return;
      }
      case 'layout.delete': {
        if (!msg.layoutName || typeof msg.layoutName !== 'string') return;
        const current = readUserPrefs(this.globalState);
        if (!current.tabLayouts || !current.tabLayouts[msg.layoutName]) return;
        const layouts = { ...current.tabLayouts };
        delete layouts[msg.layoutName];
        const wasActive = current.currentLayoutName === msg.layoutName;
        await this.globalState.update(USER_PREFS_KEY, {
          ...current,
          tabLayouts: layouts,
          currentLayoutName: wasActive ? undefined : current.currentLayoutName,
        });
        this.refresh();
        return;
      }
      case 'layout.reorderTabs': {
        if (!isStringArray(msg.tabOrder)) return;
        const current = readUserPrefs(this.globalState);
        await this.globalState.update(USER_PREFS_KEY, {
          ...current,
          tabOrder: msg.tabOrder.slice(),
        });
        this.refresh();
        return;
      }
      case 'layout.pin': {
        if (!msg.tabId || typeof msg.tabId !== 'string') return;
        const current = readUserPrefs(this.globalState);
        const pinned = (current.pinnedTabs ?? []).filter((t) => t !== msg.tabId);
        pinned.push(msg.tabId);
        const hidden = (current.hiddenTabs ?? []).filter((t) => t !== msg.tabId);
        await this.globalState.update(USER_PREFS_KEY, { ...current, pinnedTabs: pinned, hiddenTabs: hidden });
        this.refresh();
        return;
      }
      case 'layout.unpin': {
        if (!msg.tabId || typeof msg.tabId !== 'string') return;
        const current = readUserPrefs(this.globalState);
        const pinned = (current.pinnedTabs ?? []).filter((t) => t !== msg.tabId);
        await this.globalState.update(USER_PREFS_KEY, { ...current, pinnedTabs: pinned });
        this.refresh();
        return;
      }
      case 'layout.hide': {
        if (!msg.tabId || typeof msg.tabId !== 'string') return;
        const current = readUserPrefs(this.globalState);
        const hidden = (current.hiddenTabs ?? []).filter((t) => t !== msg.tabId);
        hidden.push(msg.tabId);
        const pinned = (current.pinnedTabs ?? []).filter((t) => t !== msg.tabId);
        await this.globalState.update(USER_PREFS_KEY, { ...current, hiddenTabs: hidden, pinnedTabs: pinned });
        this.refresh();
        return;
      }
      case 'layout.show': {
        if (!msg.tabId || typeof msg.tabId !== 'string') return;
        const current = readUserPrefs(this.globalState);
        const hidden = (current.hiddenTabs ?? []).filter((t) => t !== msg.tabId);
        await this.globalState.update(USER_PREFS_KEY, { ...current, hiddenTabs: hidden });
        this.refresh();
        return;
      }
      case 'layout.activateTab': {
        if (!msg.tabId || typeof msg.tabId !== 'string') return;
        this.setActiveTabFromHost(msg.tabId);
        return;
      }
      case 'layout.popOut': {
        this.openPopoutPanel();
        return;
      }
    }
  }

  // permissions-audit: name + last-added timestamp ONLY. Values are never sent
  // to the webview — they live in SecretStorage and stay there.
  private async postKeysList(): Promise<void> {
    const names = await this.readKeyIndex();
    const items = names.map((name) => ({
      name,
      addedAtMs: this.globalState.get<number>(keyAddedAtMsKey(name)) ?? 0,
    }));
    this.view?.webview.postMessage({ type: 'keys.payload', keys: items });
  }

  private async readKeyIndex(): Promise<string[]> {
    const raw = this.globalState.get<unknown>(KEYS_INDEX_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string' && /^[A-Z0-9_]{1,64}$/.test(x));
  }

  private async exportAuditLog(): Promise<void> {
    const tail = readAuditTail(10000);
    const ndjson = tail.map((e) => JSON.stringify(e)).join('\n');
    const target = await vscode.window.showSaveDialog({
      title: 'Export Cockpit audit log',
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'cockpit-audit.ndjson')),
      filters: { 'NDJSON': ['ndjson', 'jsonl'], 'All files': ['*'] },
    });
    if (!target) return;
    try {
      fs.writeFileSync(target.fsPath, ndjson, 'utf8');
      void vscode.window.showInformationMessage(`Exported ${tail.length} audit events.`);
    } catch (err) {
      logger.warn(`audit.export failed: ${String(err)}`);
      void vscode.window.showErrorMessage(`Audit export failed: ${String(err)}`);
    }
  }

  /**
   * Build (or load from cache) the graph for the chosen vault and ship it back
   * to the webview as a single message. Carrying it OUT-OF-BAND from the
   * regular snapshot keeps the snapshot small for vaults with thousands of
   * notes.
   */
  private async refreshGraph(vaultId: string | undefined): Promise<void> {
    const obs = readObsidianStatus();
    const vault = vaultId
      ? obs.vaults.find((v) => v.id === vaultId)
      : obs.primaryVault;
    if (!vault) {
      this.view?.webview.postMessage({
        type: 'graph.payload',
        payload: { error: 'no-vault' },
      });
      return;
    }
    let graph: VaultGraph;
    try {
      graph = await new Promise<VaultGraph>((resolve, reject) => {
        // Yield once so the message handler returns before the (potentially
        // multi-hundred-millisecond) walk runs.
        setImmediate(() => {
          try {
            resolve(getOrBuildGraph(vault));
          } catch (err) {
            reject(err);
          }
        });
      });
    } catch (err) {
      logger.warn(`graph: build failed for ${vault.name}: ${String(err)}`);
      this.view?.webview.postMessage({
        type: 'graph.payload',
        payload: { error: 'build-failed', message: String(err instanceof Error ? err.message : err) },
      });
      return;
    }
    this.view?.webview.postMessage({
      type: 'graph.payload',
      payload: {
        vaultId: graph.vaultId,
        vaultName: graph.vaultName,
        nodes: graph.nodes,
        edges: graph.edges,
        builtAt: graph.builtAt,
      },
    });
    // The summary may have grown — refresh the main snapshot so the badge
    // updates without the user having to reopen the tab.
    this.refresh();
  }

  // === tab-system-v2 ===
  // Pop-out full-screen panel. Reuses html() so the same script bundle runs;
  // the pop-out tags itself with `layout.popoutMode` so render() can switch
  // into a 4-col grid layout. We never spawn a second provider — both views
  // share this instance's globalState-backed prefs.
  private openPopoutPanel(): void {
    if (this.popoutPanel) {
      this.popoutPanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'claudeCockpit.fullscreen',
      'Claude Cockpit — Fullscreen',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage((m: InboundMessage) => this.handle(m));
    panel.onDidDispose(() => {
      this.popoutPanel = undefined;
    });
    this.popoutPanel = panel;
    // Kick a fresh snapshot so the panel doesn't sit on "Loading…".
    this.refresh();
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
    // a11y/theme palettes (feat/launch-a11y-theme): loaded AFTER sidebar.css
    // so the body[data-theme="..."] overrides win on tie. Empty file is a
    // no-op for users who haven't switched themes.
    const themesCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.themes.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'),
    );
    // === tab-system-v2 ===
    const layoutJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.layout.js'),
    );
    const nonce = makeNonce();
    // Plugin API (Phase 0): Phase-1 worktrees register sibling scripts via
    // plugin.registerSidebarScript(); each is rewritten to a webview-safe URI
    // and emitted with the same nonce as sidebar.js. Empty in v0.21.0 — no
    // behavior change for users who don't use the new API.
    const externalScriptTags = listSidebarScripts()
      .map((rel) => {
        const safeRel = rel.replace(/^\/+/, '').replace(/\.\./g, '');
        const segments = safeRel.split('/').filter((s) => s.length > 0);
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...segments));
        return `  <script nonce="${nonce}" src="${uri}"></script>`;
      })
      .join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; media-src 'self' blob:; connect-src 'none'; form-action 'none';" />
  <link rel="stylesheet" href="${cssUri}" />
  <link rel="stylesheet" href="${themesCssUri}" />
  <title>Claude Cockpit</title>
</head>
<body>
  <main id="root">
    <p class="empty">Loading…</p>
  </main>
  <script nonce="${nonce}" src="${jsUri}"></script>
  <script nonce="${nonce}" src="${layoutJsUri}"></script>
${externalScriptTags}
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
