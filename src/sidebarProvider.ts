import * as fs from 'fs';
import * as vscode from 'vscode';
import { CockpitSnapshot, snapshot, formatTokens } from './claudeData';
import { logger } from './logger';

interface InboundMessage {
  type: 'refresh' | 'openMemory' | 'openMemoryFile' | 'openFile' | 'openSessionFile';
  filename?: string;
  filePath?: string;
}

export class CockpitSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeCockpit.sidebar';

  private view: vscode.WebviewView | undefined;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
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
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      this.view.webview.postMessage({ type: 'snapshot', snapshot: null });
      return;
    }
    const snap = snapshot(cwd);
    this.onSnapshot(snap);
    this.view.webview.postMessage({ type: 'snapshot', snapshot: snap });
  }

  private watchActive(): void {
    this.watcher?.close();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      return;
    }
    const snap = snapshot(cwd);
    if (!snap.projectDir) {
      return;
    }
    try {
      this.watcher = fs.watch(snap.projectDir, { recursive: true }, () => {
        if (this.debounce) {
          clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => this.refresh(), 400);
      });
    } catch (err) {
      logger.warn(`watch failed for ${snap.projectDir}: ${String(err)}`);
    }
  }

  private handle(msg: InboundMessage): void {
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
          const snap = snapshot(cwd);
          if (snap.projectDir) {
            const target = vscode.Uri.file(`${snap.projectDir}/memory/${msg.filename}`);
            void vscode.window.showTextDocument(target);
          }
        }
        return;
      case 'openFile':
        if (msg.filePath) {
          void vscode.window.showTextDocument(vscode.Uri.file(msg.filePath));
        }
        return;
    }
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
  <script nonce="${nonce}">window.__formatTokens = ${formatTokens.toString()};</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
