import * as path from 'path';
import * as vscode from 'vscode';
import { CockpitSnapshot, formatTokens } from './claudeData';

export interface StatusBar {
  update(snap: CockpitSnapshot | undefined): void;
  dispose(): void;
}

export function createStatusBar(): StatusBar {
  const cwdItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  cwdItem.command = 'workbench.view.extension.claudeCockpit';
  cwdItem.tooltip = 'Open Claude Cockpit';

  const tokenItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  tokenItem.command = 'claudeCockpit.openSessionFile';
  tokenItem.tooltip = 'Token burn this session — click to open the JSONL';

  const filesItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  filesItem.command = 'claudeCockpit.refresh';
  filesItem.tooltip = 'Files Claude has touched this session';

  return {
    update(snap) {
      if (!snap) {
        cwdItem.hide();
        tokenItem.hide();
        filesItem.hide();
        return;
      }
      const folder = path.basename(snap.cwd);
      cwdItem.text = `$(folder) ${folder}`;
      cwdItem.show();
      if (snap.stats.sessionFile) {
        tokenItem.text = `$(symbol-numeric) ${formatTokens(snap.stats.totalTokens)}`;
        tokenItem.show();
        filesItem.text = `$(files) ${snap.stats.filesTouched.length}`;
        filesItem.show();
      } else {
        tokenItem.hide();
        filesItem.hide();
      }
    },
    dispose() {
      cwdItem.dispose();
      tokenItem.dispose();
      filesItem.dispose();
    },
  };
}
