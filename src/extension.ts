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
import { CockpitSidebarProvider } from './sidebarProvider';
import { createStatusBar } from './statusBar';
import { registerSidebarScript } from './plugin';

export function activate(context: vscode.ExtensionContext): void {
  logger.info('claude-cockpit activating');
  // Phase-1 obsidian-graph: register the d3 vendor + graph renderer scripts.
  // The sidebar provider will rewrite each path to a webview-safe URI at
  // render time. Vendor goes first so window.d3 exists before sidebar.graph.js
  // touches it.
  registerSidebarScript('media/vendor/d3.min.js');
  registerSidebarScript('media/sidebar.graph.js');
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
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CockpitSidebarProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCockpit.refresh', () => provider.refresh()),
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

  context.subscriptions.push({ dispose: () => status.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose() });
}

export function deactivate(): void {
  logger.info('claude-cockpit deactivating');
}
