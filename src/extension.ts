import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  BudgetConfig,
  computeCost,
  computeToday,
  findActiveSession,
  formatUsd,
  memoryIndexPath,
  modelFamilyOf,
  readSession,
  snapshot,
} from './claudeData';
import { logger } from './logger';
import {
  obsidianUriFor,
  readObsidianStatus,
  saveSessionToVault,
  SessionDigest,
} from './obsidian';
import { startAppUsageTracker } from './appUsage';
import { activateGallery } from './gallery';
import { CockpitSidebarProvider } from './sidebarProvider';
import { createStatusBar } from './statusBar';
import { setAuditEnabled } from './auditLog';
import {
  registerSidebarScript,
  registerSidebarStyle,
  registerTab,
  registerTrigger,
  registerWidget,
} from './plugin';
import { forksDir } from './replay';
import { notify } from './notifications';
import { ApprovalQueueStore, queuePath as approvalQueuePath } from './approvalQueue';
import { MobilePublisher, publicQueuePath, watchQueueAndPublish } from './mobileExport';

function registerOnboardingSandboxSurface(): void {
  // Phase-2 feat/launch-onboarding-sandbox. Registers the Tutorial tab + the
  // two widgets surfaced by media/sidebar.tutorial.js (tutorialRecs +
  // tutorialNudges). The sandbox itself doesn't need a tab — it's a tour-mode
  // overlay rendered inline in Welcome + on the Tutorial tab via the
  // sandbox-banner snippet.
  try {
    registerSidebarScript('media/sidebar.tutorial.js');
    registerWidget({
      id: 'tutorialRecs',
      label: 'Tutorial · Try this',
      category: 'Now',
      requiresCwd: false,
    });
    registerWidget({
      id: 'tutorialNudges',
      label: 'Tutorial · Patterns',
      category: 'Now',
      requiresCwd: false,
    });
    registerTab({
      id: 'tutorial',
      label: 'Tutorial',
      requiresCwd: false,
      hint: 'History-based recommendations + pattern nudges from your real prompts.',
      defaultWidgets: ['tutorialRecs', 'tutorialNudges'],
    });
    registerTrigger({
      command: 'claudeCockpit.tutorial.open',
      title: 'Claude Cockpit: Open Tutorial',
    });
    registerTrigger({
      command: 'claudeCockpit.sandbox.start',
      title: 'Claude Cockpit: Start 3-min Sandbox Demo',
    });
    registerTrigger({
      command: 'claudeCockpit.sandbox.exit',
      title: 'Claude Cockpit: Exit Sandbox Demo',
    });
    registerTrigger({
      command: 'claudeCockpit.audit.open',
      title: 'Claude Cockpit: Open Audit (Security tab)',
    });
    registerTrigger({
      command: 'claudeCockpit.talk.open',
      title: 'Claude Cockpit: Open Talk',
    });
    registerTrigger({
      command: 'claudeCockpit.notifications.test',
      title: 'Claude Cockpit: Test Notification',
    });
  } catch (err) {
    logger.warn(`onboarding-sandbox: registration failed: ${String(err)}`);
  }
}
import { configure as configurePosthog, capture as posthogCapture } from './posthog';
import { captureActivationFailure, setExtensionRoot } from './crash';
import * as crypto from 'crypto';
import * as os from 'os';

function registerReplaySurface(): void {
  // Phase-1 feat/launch-replay-timeline. Registers the Replay tab + the three
  // widgets (replayScrubber, replayDiff, replayCostProjection) by name in the
  // plugin registry; rendering happens in media/sidebar.replay.js (via the
  // EXTERNAL_COMPONENTS bridge in media/sidebar.js).
  try {
    registerSidebarScript('media/sidebar.replay.js');
    registerWidget({
      id: 'replayScrubber',
      label: 'Replay · scrubber',
      category: 'Replay',
      requiresCwd: true,
    });
    registerWidget({
      id: 'replayDiff',
      label: 'Replay · diff',
      category: 'Replay',
      requiresCwd: true,
    });
    registerWidget({
      id: 'replayCostProjection',
      label: 'Cost projection',
      category: 'Replay',
      requiresCwd: true,
    });
    registerTab({
      id: 'replay',
      label: 'Replay',
      requiresCwd: true,
      hint: 'Scrub backwards through your active session — see what changed at each step, fork from any point.',
      defaultWidgets: ['replayScrubber', 'replayDiff'],
    });
    registerTrigger({
      command: 'claudeCockpit.replay.openCurrent',
      title: 'Claude Cockpit: Open Replay (active session)',
    });
    registerTrigger({
      command: 'claudeCockpit.replay.exportDiff',
      title: 'Claude Cockpit: Export Replay Diff',
    });
  } catch (err) {
    logger.warn(`replay: registration failed: ${String(err)}`);
  }
}

// =============================================================================
// telemetry-posthog: read settings + configure the (default-off) client.
// Returns the resolved enabled flag so callers can branch on it for the
// session.start ping.
// =============================================================================

function configureTelemetryFromSettings(extensionRoot: string, extensionVersion: string): boolean {
  const cfg = vscode.workspace.getConfiguration('claudeCockpit.telemetry');
  const enabled = cfg.get<boolean>('enabled', false);
  const crashReportsEnabled = cfg.get<boolean>('crashReports', false);
  const projectId = (cfg.get<string>('projectId', '') ?? '').trim();
  const host = ((cfg.get<string>('host', 'app.posthog.com') ?? '').trim()) || 'app.posthog.com';
  setExtensionRoot(extensionRoot);
  // Stable, anonymous-ish distinct id: salted SHA256 of os.hostname() truncated
  // to 16 hex. Salt is the constant string below — different salt per project
  // makes cross-correlation with HAQQ telemetry impossible even if a user
  // mistakenly re-uses the same hostname.
  const salt = 'claude-cockpit-vscode-2026';
  const distinctId = crypto
    .createHash('sha256')
    .update(`${salt}::${os.hostname()}`)
    .digest('hex')
    .slice(0, 16);
  configurePosthog({
    enabled: enabled && projectId.length > 0,
    crashReportsEnabled,
    projectId,
    host,
    distinctId,
    extensionVersion,
    vsCodeVersion: vscode.version,
  });
  return enabled && projectId.length > 0;
}

function readPackageVersion(extensionRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Emit a single `cockpit.command.invoke` PostHog event with the given command
 * id. No-op when telemetry is opted out. Sends ONLY the command id — never
 * the args, never any user input the command later prompts for.
 */
function pingCommand(commandId: string): void {
  void posthogCapture('cockpit.command.invoke', { command: commandId });
}

export function activate(context: vscode.ExtensionContext): void {
  try {
    activateInner(context);
  } catch (err) {
    // ALWAYS log + (when opted-in) report. Re-throw so VSCode's "Extension
    // failed to activate" surface still fires — the user must know.
    captureActivationFailure(err);
    throw err;
  }
}

function activateInner(context: vscode.ExtensionContext): void {
  logger.info('claude-cockpit activating');
  // === telemetry-posthog (Phase 2): default-off, opt-in. configure() runs
  // unconditionally so isEnabled() reflects user settings; capture() is a
  // no-op until the user flips claudeCockpit.telemetry.enabled. ===
  const extensionRoot = context.extensionUri.fsPath;
  const extensionVersion = readPackageVersion(extensionRoot);
  const telemetryOn = configureTelemetryFromSettings(extensionRoot, extensionVersion);
  if (telemetryOn) {
    void posthogCapture('cockpit.session.start', {
      activatedAt: Date.now(),
    });
  }
  // Phase-1 obsidian-graph: register the d3 vendor + graph renderer scripts.
  // Vendor goes first so window.d3 exists before sidebar.graph.js touches it.
  registerSidebarScript('media/vendor/d3.min.js');
  registerSidebarScript('media/sidebar.graph.js');
  // Phase-1 approval-queue: register the approval sibling script + style.
  registerSidebarScript('media/sidebar.approval.js');
  registerSidebarStyle('media/sidebar.approval.css');
  // Phase-1 worktrees register their widgets / tabs via the plugin API BEFORE
  // the webview provider mounts; activation order matters so listSidebarScripts()
  // returns the gallery sibling script when html() runs.
  activateGallery();
  registerReplaySurface();
  registerOnboardingSandboxSurface();
  const status = createStatusBar();

  function readBudgetConfig(): BudgetConfig {
    const cfg = vscode.workspace.getConfiguration('claudeCockpit.budget');
    return {
      enabled: cfg.get<boolean>('enabled') ?? false,
      dailyCapUsd: cfg.get<number>('dailyCapUsd') ?? 0,
      sessionCapUsd: cfg.get<number>('sessionCapUsd') ?? 0,
      weeklyCapUsd: cfg.get<number>('weeklyCapUsd') ?? 0,
      monthlyCapUsd: cfg.get<number>('monthlyCapUsd') ?? 0,
      yearlyCapUsd: cfg.get<number>('yearlyCapUsd') ?? 0,
    };
  }

  const provider = new CockpitSidebarProvider(
    context.extensionUri,
    context.globalState,
    readBudgetConfig,
    (snap) => status.update(snap),
  );
  // permissions-audit (Phase 1): wire the audit-log toggle + SecretStorage
  // handle, and register the sibling sidebar script that owns the audit /
  // keys / leaks / outbound sub-views inside the Security tab.
  const auditEnabled = vscode.workspace
    .getConfiguration('claudeCockpit')
    .get<boolean>('audit.enabled', true);
  setAuditEnabled(auditEnabled);
  provider.setSecretStorage(context.secrets);
  registerSidebarScript('media/sidebar.audit.js');
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CockpitSidebarProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.refresh', () => {
      pingCommand('claudeCockpit.refresh');
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.audit.export', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('security');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.keys.add', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Key name (e.g. ANTHROPIC_API_KEY)',
        placeHolder: 'A-Z, 0-9, _ — up to 64 chars',
        validateInput: (v) => /^[A-Z0-9_]{1,64}$/.test(v) ? null : 'Must match [A-Z0-9_]{1,64}',
      });
      if (!name) return;
      const value = await vscode.window.showInputBox({
        prompt: `Value for ${name}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!value) return;
      await context.secrets.store(`claudeCockpit.audit.secret.${name}`, value);
      const idx = context.globalState.get<string[]>('claudeCockpit.audit.keysIndex', []);
      if (!idx.includes(name)) {
        idx.push(name);
        await context.globalState.update('claudeCockpit.audit.keysIndex', idx);
      }
      await context.globalState.update(`claudeCockpit.audit.keyAddedAt.${name}`, Date.now());
      void vscode.window.showInformationMessage(`Stored key ${name} in SecretStorage.`);
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.openMemory', () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        return;
      }
      const file = memoryIndexPath(cwd);
      if (!fs.existsSync(file)) {
        void vscode.window.showInformationMessage('No MEMORY.md for this workspace yet.');
        return;
      }
      void vscode.window.showTextDocument(vscode.Uri.file(file));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.openSessionFile', () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        return;
      }
      const file = findActiveSession(cwd);
      if (!file) {
        void vscode.window.showInformationMessage('No active Claude Code session for this workspace.');
        return;
      }
      void vscode.window.showTextDocument(vscode.Uri.file(file));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.saveToObsidian', async () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) {
        void vscode.window.showInformationMessage('Open a workspace folder first.');
        return;
      }
      const sessionFile = findActiveSession(cwd);
      if (!sessionFile) {
        void vscode.window.showInformationMessage('No active Claude Code session for this workspace.');
        return;
      }
      const obs = readObsidianStatus();
      if (!obs.installed || obs.vaults.length === 0) {
        void vscode.window.showWarningMessage(
          'No Obsidian vaults found. Open Obsidian and add a vault, then try again.',
        );
        return;
      }
      const choice = obs.vaults.length === 1
        ? obs.vaults[0]
        : await (async () => {
            const picked = await vscode.window.showQuickPick(
              obs.vaults.map((v) => ({ label: v.name, description: v.path, vault: v })),
              { title: 'Save session to which Obsidian vault?' },
            );
            return picked?.vault;
          })();
      if (!choice) return;
      const stats = readSession(sessionFile, cwd);
      const today = computeToday();
      void today;
      const digest: SessionDigest = {
        cwd,
        sessionId: stats.sessionId,
        startedAt: stats.startedAt,
        lastActivityAt: stats.lastActivityAt,
        totalTokens: stats.totalTokens,
        totalUsd: computeCost({
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          cacheReadTokens: stats.cacheReadTokens,
          cacheCreationTokens: stats.cacheCreationTokens,
          modelFamily: modelFamilyOf(stats.lastModel),
        }).totalUsd,
        filesTouched: stats.filesTouched.map((f) => ({
          filePath: f.filePath,
          tool: f.tool,
          count: f.count,
        })),
        topTools: stats.toolHistogram,
        pilotName: undefined,
      };
      const written = saveSessionToVault(choice, digest);
      if (!written) {
        void vscode.window.showErrorMessage('Could not save session to vault.');
        return;
      }
      const open = await vscode.window.showInformationMessage(
        `Saved session to ${choice.name}`,
        'Open in Obsidian',
        'Open in editor',
      );
      if (open === 'Open in Obsidian') {
        const rel = path.relative(choice.path, written);
        void vscode.env.openExternal(vscode.Uri.parse(obsidianUriFor(choice, rel)));
      } else if (open === 'Open in editor') {
        void vscode.window.showTextDocument(vscode.Uri.file(written));
      }
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.searchAllSessions', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search across all Claude session JSONLs',
        placeHolder: 'phrase, file path, error message…',
      });
      if (!query) return;
      provider.runSearch(query);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.openVault', async () => {
      const obs = readObsidianStatus();
      if (!obs.primaryVault) {
        void vscode.window.showInformationMessage('No Obsidian vault detected.');
        return;
      }
      void vscode.env.openExternal(
        vscode.Uri.parse(`obsidian://open?vault=${encodeURIComponent(obs.primaryVault.name)}`),
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.obsidian.refreshGraph', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('obsidian');
      // Tell the webview to ask for a fresh graph payload. The provider
      // routes 'graph.refresh' through refreshGraph() which posts back a
      // 'graph.payload' message the renderer mounts.
      provider.requestGraphRefresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.watchtower', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('watchtower');
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCockpit.budget')) {
        provider.refresh();
      }
      if (e.affectsConfiguration('claudeCockpit.audit.enabled')) {
        const v = vscode.workspace
          .getConfiguration('claudeCockpit')
          .get<boolean>('audit.enabled', true);
        setAuditEnabled(v);
        provider.refresh();
      }
      if (e.affectsConfiguration('claudeCockpit.telemetry')) {
        configureTelemetryFromSettings(extensionRoot, extensionVersion);
        provider.refresh();
      }
    }),
  );

  // === telemetry-posthog: command palette toggle ===
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.telemetry.toggle', async () => {
      pingCommand('claudeCockpit.telemetry.toggle');
      const cfg = vscode.workspace.getConfiguration('claudeCockpit.telemetry');
      const current = cfg.get<boolean>('enabled', false);
      const projectId = (cfg.get<string>('projectId', '') ?? '').trim();
      if (!current && !projectId) {
        const choice = await vscode.window.showInformationMessage(
          'Cockpit telemetry needs a PostHog project id (claudeCockpit.telemetry.projectId). Open settings to add one?',
          'Open settings',
          'Cancel',
        );
        if (choice === 'Open settings') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:dashable.claude-cockpit telemetry',
          );
        }
        return;
      }
      await cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        !current
          ? 'Cockpit telemetry: ON. Aggregate counters + (optionally) crash stacks will POST to PostHog. See PRIVACY.md.'
          : 'Cockpit telemetry: OFF. Cockpit is back to 100% local.',
      );
    }),
  );

  // === skill-gallery (Phase 1) ===
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.gallery.openTab', () => {
      pingCommand('claudeCockpit.gallery.openTab');
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('gallery');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.gallery.installFromUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Public HTTPS URL to a SKILL.md (GitHub raw or registry mirror)',
        placeHolder: 'https://raw.githubusercontent.com/.../SKILL.md',
        validateInput: (v) => {
          if (!v) return 'URL is required';
          if (!/^https:\/\//.test(v)) return 'Only https:// URLs are accepted';
          return null;
        },
      });
      if (!url) return;
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('gallery');
      provider.previewGalleryInstall(url);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.setDailyCap', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Daily budget cap in USD (0 to disable)',
        value: String(readBudgetConfig().dailyCapUsd),
        validateInput: (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? null : 'Must be ≥ 0'),
      });
      if (input == null) return;
      const value = Number(input);
      const cfg = vscode.workspace.getConfiguration('claudeCockpit.budget');
      await cfg.update('dailyCapUsd', value, vscode.ConfigurationTarget.Global);
      await cfg.update('enabled', value > 0, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        value > 0 ? `Daily cap set to ${formatUsd(value)}` : 'Daily cap disabled',
      );
    }),
  );

  // === tab-system-v2 ===
  // Layout + keyboard navigation commands. cmd+1..9 jump to tab N in the
  // user's CURRENT visible order; tab.next/prev cycle. Pop-out opens the
  // fullscreen webview panel. Save / Load drive the named-layout presets.
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.layout.save', () => provider.saveLayoutViaPrompt()),
    vscode.commands.registerCommand('claudeCockpit.layout.load', () => provider.loadLayoutViaPrompt()),
    vscode.commands.registerCommand('claudeCockpit.layout.popOut', () => provider.popOutFullscreen()),
    vscode.commands.registerCommand('claudeCockpit.tab.next', () => provider.cycleTab('next')),
    vscode.commands.registerCommand('claudeCockpit.tab.prev', () => provider.cycleTab('prev')),
  );
  for (let i = 1; i <= 9; i++) {
    const idx = i - 1;
    context.subscriptions.push(
      vscode.commands.registerCommand(`claudeCockpit.tab.${i}`, () => provider.jumpToTabIndex(idx)),
    );
  }
  // === replay-timeline =====================================================
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.replay.openCurrent', () => {
      pingCommand('claudeCockpit.replay.openCurrent');
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('replay');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.replay.exportDiff', () => {
      // Reveals the forks dir; the user picks a fork or the live JSONL and
      // the in-tab "Export Diff" button (registered in sidebar.replay.js)
      // takes care of the rest. Surfacing the dir lets users discover prior
      // forks even when the tab isn't open.
      const dir = forksDir();
      void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),
  );

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  status.update(snapshot(cwd, readBudgetConfig()));

  const appUsageEnabled = vscode.workspace
    .getConfiguration('claudeCockpit')
    .get<boolean>('surfaces.appUsage', true);
  if (appUsageEnabled) {
    const stopUsage = startAppUsageTracker(context.globalState);
    context.subscriptions.push({ dispose: stopUsage });
  } else {
    logger.info('app usage tracker disabled via claudeCockpit.surfaces.appUsage');
  }

  // === approval-queue: command palette entries forwarded to the webview. ===
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.approval.openQueue', () => {
      pingCommand('claudeCockpit.approval.openQueue');
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('approval');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.approval.bulkApprove', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Approve every pending Cockpit-source action? This bypasses per-action review.',
        { modal: true },
        'Approve all',
      );
      if (choice !== 'Approve all') return;
      // Reuse the webview message bus rather than duplicating the loop.
      provider.handleHostMessage({ type: 'approval.bulkApprove' });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.approval.bulkReject', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reject every pending Cockpit-source action?',
        { modal: true },
        'Reject all',
      );
      if (choice !== 'Reject all') return;
      provider.handleHostMessage({ type: 'approval.bulkReject' });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.approval.revertLast', async () => {
      const id = provider.lastRollbackableId();
      if (!id) {
        void vscode.window.showInformationMessage('No revertible Cockpit approval found.');
        return;
      }
      provider.handleHostMessage({ type: 'approval.rollback', approvalId: id });
    }),
  );

  // === onboarding-sandbox: command palette entries. ===
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.tutorial.open', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('tutorial');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.sandbox.start', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.handleHostMessage({ type: 'sandbox.start' });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.sandbox.exit', () => {
      provider.handleHostMessage({ type: 'sandbox.exit' });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.audit.open', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('security');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.talk.open', () => {
      void vscode.commands.executeCommand('workbench.view.extension.claudeCockpit');
      provider.setActiveTabFromHost('talk');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.notifications.test', () => {
      void notify({
        key: 'cockpit.notifications.test',
        level: 'info',
        message: 'Cockpit notifications are working.',
      });
    }),
  );

  // === mobile-companion (Phase 2) ==========================================
  // Read-only mobile mirror of the approval queue. Default OFF behind
  // `claudeCockpit.mobile.enabled`. When enabled we publish a SANITIZED
  // snapshot to ~/.claude/.cockpit/queue.public.json; the user is responsible
  // for serving that file via their existing Cloudflare Tunnel + Cloudflare
  // Access SSO. Cockpit itself makes ZERO outbound calls for this feature.
  const mobileQueueStore = new ApprovalQueueStore();
  const mobilePublisher = new MobilePublisher({
    supplier: () => {
      mobileQueueStore.reload();
      return mobileQueueStore.list();
    },
    isEnabled: () =>
      vscode.workspace
        .getConfiguration('claudeCockpit')
        .get<boolean>('mobile.enabled', false) === true,
  });
  const mobileWatcher = watchQueueAndPublish(mobilePublisher, approvalQueuePath());
  context.subscriptions.push({ dispose: () => mobileWatcher.dispose() });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCockpit.mobile.enabled')) {
        // Toggle: invalidate the digest so the next publish() writes (or
        // clears) immediately rather than waiting for a queue mutation.
        mobilePublisher.invalidate();
        mobilePublisher.publish();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.mobile.copyPath', async () => {
      await vscode.env.clipboard.writeText(publicQueuePath());
      void vscode.window.showInformationMessage(
        `Copied: ${publicQueuePath()}. Expose this file via your Cloudflare Tunnel + Cloudflare Access to use the mobile companion.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.mobile.openSetup', () => {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://cockpit.dashable.dev/mobile/'),
      );
    }),
  );

  context.subscriptions.push({ dispose: () => status.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose() });
}

export function deactivate(): void {
  logger.info('claude-cockpit deactivating');
  // Best-effort session.end ping. Fire-and-forget — VSCode gives extensions a
  // 5s grace window on shutdown but doesn't await the returned promise, so a
  // dropped event here is expected and fine.
  void posthogCapture('cockpit.session.end', { deactivatedAt: Date.now() });
}
