import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CockpitSnapshot, snapshot, formatTokens } from './claudeData';
import { logger } from './logger';

interface InboundMessage {
  type:
    | 'refresh'
    | 'openMemory'
    | 'openMemoryFile'
    | 'openFile'
    | 'openSessionFile'
    | 'openProject'
    | 'openProjectSession';
  filename?: string;
  filePath?: string;
  decodedPath?: string;
  projectDir?: string;
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
    const snap = snapshot(cwd);
    this.onSnapshot(snap);
    const payload = {
      ...snap,
      stats: {
        ...snap.stats,
        totalTokensFormatted: formatTokens(snap.stats.totalTokens),
        inputTokensFormatted: formatTokens(snap.stats.inputTokens),
        outputTokensFormatted: formatTokens(snap.stats.outputTokens),
        cacheReadTokensFormatted: formatTokens(snap.stats.cacheReadTokens),
        cacheCreationTokensFormatted: formatTokens(snap.stats.cacheCreationTokens),
      },
      projects: snap.projects.map((p) => ({
        ...p,
        totalTokensFormatted: formatTokens(p.totalTokens),
      })),
    };
    this.view.webview.postMessage({ type: 'snapshot', snapshot: payload });
  }

  private watchActive(): void {
    this.watcher?.close();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const snap = snapshot(cwd);
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
    const snap = snapshot(cwd);
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

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
