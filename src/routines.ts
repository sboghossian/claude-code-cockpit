import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface LocalRoutine {
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  bodyBytes: number;
  mtimeMs: number;
  cadenceHint: string | undefined;
}

export interface RoutinesStatus {
  scheduledTasksDir: string;
  scheduledTasksDirExists: boolean;
  local: LocalRoutine[];
  cloudEnabled: boolean;
  cloudUrl: string;
}

const SCHEDULED_TASKS_REL = path.join('.claude', 'scheduled-tasks');
const CLOUD_ROUTINES_URL = 'https://claude.ai/settings/automations';

function parseFrontmatter(raw: string): Record<string, string> {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

// Routines don't store cron expressions on disk — we infer cadence from the
// description so the user gets a useful hint (daily / weekly / monthly) without
// opening each file.
function inferCadence(description: string): string | undefined {
  const d = description.toLowerCase();
  if (/\bhourly\b/.test(d)) return 'hourly';
  if (/\bdaily\b|\beach day\b|\bevery day\b/.test(d)) return 'daily';
  if (/\bweekly\b|\beach week\b|\bevery week\b/.test(d)) return 'weekly';
  if (/\bmonthly\b|\beach month\b/.test(d)) return 'monthly';
  if (/\bquarterly\b/.test(d)) return 'quarterly';
  return undefined;
}

export function readLocalRoutines(): LocalRoutine[] {
  const root = path.join(os.homedir(), SCHEDULED_TASKS_REL);
  if (!fs.existsSync(root)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LocalRoutine[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const skill = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skill)) continue;
    let raw: string;
    let stat: fs.Stats;
    try {
      raw = fs.readFileSync(skill, 'utf8');
      stat = fs.statSync(skill);
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    const description = fm.description || '';
    out.push({
      name: fm.name || e.name,
      description,
      filePath: skill,
      dirPath: dir,
      bodyBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      cadenceHint: inferCadence(description),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function readRoutinesStatus(cloudEnabled: boolean): RoutinesStatus {
  const root = path.join(os.homedir(), SCHEDULED_TASKS_REL);
  return {
    scheduledTasksDir: root,
    scheduledTasksDirExists: fs.existsSync(root),
    local: readLocalRoutines(),
    cloudEnabled,
    cloudUrl: CLOUD_ROUTINES_URL,
  };
}
