import * as fs from 'fs';
import * as path from 'path';

export interface ChangelogVersion {
  version: string;
  date: string | undefined;
  body: string;
  isCurrent: boolean;
}

export interface ChangelogStatus {
  filePath: string;
  exists: boolean;
  fullText: string;
  versions: ChangelogVersion[];
  currentVersion: string;
}

export function readChangelog(extensionRoot: string, currentVersion: string): ChangelogStatus {
  const file = path.join(extensionRoot, 'CHANGELOG.md');
  if (!fs.existsSync(file)) {
    return { filePath: file, exists: false, fullText: '', versions: [], currentVersion };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { filePath: file, exists: false, fullText: '', versions: [], currentVersion };
  }
  return {
    filePath: file,
    exists: true,
    fullText: raw,
    versions: parseVersions(raw, currentVersion),
    currentVersion,
  };
}

// Parses `## [0.12.0] — 2026-05-06` style headers. Anything between two
// headers is the body for the upper version. Tolerates "##" without brackets.
export function parseVersions(raw: string, currentVersion: string): ChangelogVersion[] {
  const out: ChangelogVersion[] = [];
  const lines = raw.split(/\r?\n/);
  let cur: ChangelogVersion | undefined;
  const headerRe = /^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)\]?\s*(?:[—\-–]\s*(.+?))?\s*$/;
  for (const line of lines) {
    const m = headerRe.exec(line);
    if (m) {
      if (cur) {
        cur.body = cur.body.trim();
        out.push(cur);
      }
      cur = {
        version: m[1],
        date: m[2] ? m[2].trim() : undefined,
        body: '',
        isCurrent: m[1] === currentVersion,
      };
      continue;
    }
    if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) {
    cur.body = cur.body.trim();
    out.push(cur);
  }
  return out;
}
