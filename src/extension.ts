import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  findActiveSession,
  memoryIndexPath,
  snapshot,
} from './claudeData';
import { logger } from './logger';
import { CockpitSidebarProvider } from './sidebarProvider';
import { createStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  logger.info('claude-cockpit activating');
  const status = createStatusBar();

  const provider = new CockpitSidebarProvider(context.extensionUri, (snap) => status.update(snap));
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

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  status.update(snapshot(cwd));

  context.subscriptions.push({ dispose: () => status.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose() });
}

export function deactivate(): void {
  logger.info('claude-cockpit deactivating');
}
