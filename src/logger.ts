import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function ensure(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Claude Cockpit');
  }
  return channel;
}

function fmt(level: string, msg: string): string {
  return `[${new Date().toISOString()}] ${level} ${msg}`;
}

export const logger = {
  info(msg: string): void {
    ensure().appendLine(fmt('INFO ', msg));
  },
  warn(msg: string): void {
    ensure().appendLine(fmt('WARN ', msg));
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err !== undefined ? String(err) : '';
    ensure().appendLine(fmt('ERROR', detail ? `${msg} — ${detail}` : msg));
  },
  show(): void {
    ensure().show();
  },
  dispose(): void {
    channel?.dispose();
    channel = undefined;
  },
};
