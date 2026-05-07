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

  // === onboarding-sandbox: 3 new status bar widgets. ============================
  // Pending approvals — clickable, jumps to the Approval tab.
  const approvalItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  approvalItem.command = 'claudeCockpit.approval.openQueue';
  approvalItem.tooltip = 'Cockpit · pending approval count';

  // Audit alert — red dot when audit log saw a blocked tool.invoke in last 24h.
  const auditItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  auditItem.command = 'claudeCockpit.audit.export';
  auditItem.tooltip = 'Cockpit · audit log alerts';

  // Talk launcher — quick one-click into the Talk tab.
  const talkItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
  talkItem.command = 'claudeCockpit.talk.open';
  talkItem.tooltip = 'Cockpit · open Talk';

  return {
    update(snap) {
      if (!snap || !snap.cwd) {
        if (snap && snap.projects.length > 0) {
          cwdItem.text = `$(folder) ${snap.projects.length} projects`;
          cwdItem.show();
        } else {
          cwdItem.hide();
        }
        tokenItem.hide();
        filesItem.hide();
      } else {
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
      }

      // Approvals.
      const pending = snap?.approvalCounts?.pending ?? 0;
      if (pending > 0) {
        approvalItem.text = `$(check) ${pending}`;
        approvalItem.tooltip = `Cockpit · ${pending} approval${pending === 1 ? '' : 's'} pending — click to open queue`;
        approvalItem.show();
      } else {
        approvalItem.hide();
      }

      // Audit dot — only on if audit ran and any of: lastDomain present (the
      // 24h rollup is non-empty) and last24h > 0. We surface the dot as a
      // soft signal; the dedicated audit-blocked notification handles the
      // hard alert.
      const audit = snap?.audit;
      if (audit && audit.last24h > 0) {
        auditItem.text = `$(shield) ${audit.last24h}`;
        auditItem.tooltip = audit.lastDomain
          ? `Cockpit · ${audit.last24h} audit events / 24h · last: ${audit.lastDomain}`
          : `Cockpit · ${audit.last24h} audit events / 24h`;
        auditItem.show();
      } else {
        auditItem.hide();
      }

      // Talk launcher always visible once any cockpit data is present so the
      // user can invoke voice/text input without hunting through the sidebar.
      if (snap) {
        talkItem.text = '$(comment) Talk';
        talkItem.show();
      } else {
        talkItem.hide();
      }
    },
    dispose() {
      cwdItem.dispose();
      tokenItem.dispose();
      filesItem.dispose();
      approvalItem.dispose();
      auditItem.dispose();
      talkItem.dispose();
    },
  };
}
