import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { logger } from './logger';

// Polling-based app focus tracker. Samples the frontmost macOS app once per
// minute via lsappinfo and persists per-day counts in globalState. Works only
// while VSCode is running, so the data is partial — the Help tab calls this
// out clearly for users who expect full Screen Time-level coverage.

export interface AppUsageDay {
  date: string; // YYYY-MM-DD
  totalSeconds: number;
  perApp: Record<string, number>; // appName -> seconds
  perHour: Record<string, Record<string, number>>; // hour (00-23) -> appName -> seconds
}

export interface AppUsageStatus {
  available: boolean;
  enabled: boolean;
  today: AppUsageDay;
  yesterday: AppUsageDay | undefined;
  topApps: { name: string; seconds: number; pct: number }[];
  hourly: { hour: number; total: number; topApp: string | undefined }[];
  lastSampledAt: string | undefined;
}

const STORAGE_KEY = 'claudeCockpit.appUsage';
const SAMPLE_INTERVAL_MS = 60_000;
const SAMPLE_BUCKET_SEC = 60; // each sample counts as 60s

interface PersistedShape {
  enabled: boolean;
  days: Record<string, AppUsageDay>;
  lastSampledAt: string | undefined;
}

function emptyDay(date: string): AppUsageDay {
  return { date, totalSeconds: 0, perApp: {}, perHour: {} };
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  return `${y}-${MM}-${DD}`;
}

function todayKey(): string {
  // Use local date so it agrees with `new Date().getHours()` in `perHour`.
  return localDateKey(new Date());
}

function yesterdayKey(): string {
  return localDateKey(new Date(Date.now() - 86_400_000));
}

function load(state: vscode.Memento): PersistedShape {
  return state.get<PersistedShape>(STORAGE_KEY, {
    enabled: false,
    days: {},
    lastSampledAt: undefined,
  });
}

function save(state: vscode.Memento, val: PersistedShape): Thenable<void> {
  // Cap retention to last 30 days to keep globalState lean.
  const cutoff = localDateKey(new Date(Date.now() - 30 * 86_400_000));
  for (const k of Object.keys(val.days)) {
    if (k < cutoff) delete val.days[k];
  }
  return state.update(STORAGE_KEY, val);
}

function readFrontmost(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/lsappinfo',
      ['front'],
      { timeout: 800 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(undefined);
          return;
        }
        // "ASN:0x0-0x4abeac8: "Visual Studio Code" ASN:..."
        const m = /"([^"]+)"/.exec(stdout);
        resolve(m ? m[1] : undefined);
      },
    );
  });
}

export function startAppUsageTracker(state: vscode.Memento): () => void {
  // Always-on for darwin. No-op elsewhere.
  if (process.platform !== 'darwin') return () => undefined;
  let persisted = load(state);
  if (!persisted.enabled) {
    // First-run: enable by default since data is purely local.
    persisted = { ...persisted, enabled: true };
    void save(state, persisted);
  }
  async function sample(): Promise<void> {
    try {
      const app = await readFrontmost();
      if (!app) return;
      const day = todayKey();
      const hour = new Date().getHours().toString().padStart(2, '0');
      const fresh = load(state);
      const todayDay = fresh.days[day] ?? emptyDay(day);
      todayDay.totalSeconds += SAMPLE_BUCKET_SEC;
      todayDay.perApp[app] = (todayDay.perApp[app] ?? 0) + SAMPLE_BUCKET_SEC;
      const hourBucket = todayDay.perHour[hour] ?? {};
      hourBucket[app] = (hourBucket[app] ?? 0) + SAMPLE_BUCKET_SEC;
      todayDay.perHour[hour] = hourBucket;
      fresh.days[day] = todayDay;
      fresh.lastSampledAt = new Date().toISOString();
      await save(state, fresh);
    } catch (err) {
      logger.warn(`appUsage: sample failed: ${String(err)}`);
    }
  }
  // Sample once on start so users see something fast, then on interval.
  void sample();
  let timer: NodeJS.Timeout | undefined = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}

export function readAppUsage(state: vscode.Memento): AppUsageStatus {
  const persisted = load(state);
  const today = persisted.days[todayKey()] ?? emptyDay(todayKey());
  const yesterday = persisted.days[yesterdayKey()];

  const total = today.totalSeconds || 1;
  const topApps = Object.entries(today.perApp)
    .map(([name, seconds]) => ({ name, seconds, pct: (seconds / total) * 100 }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);

  const hourly: { hour: number; total: number; topApp: string | undefined }[] = [];
  for (let h = 0; h < 24; h++) {
    const key = h.toString().padStart(2, '0');
    const bucket = today.perHour[key] ?? {};
    let totalH = 0;
    let topApp: string | undefined;
    let topSec = 0;
    for (const [app, sec] of Object.entries(bucket)) {
      totalH += sec;
      if (sec > topSec) {
        topSec = sec;
        topApp = app;
      }
    }
    hourly.push({ hour: h, total: totalH, topApp });
  }

  return {
    available: process.platform === 'darwin',
    enabled: persisted.enabled,
    today,
    yesterday,
    topApps,
    hourly,
    lastSampledAt: persisted.lastSampledAt,
  };
}

export function clearAppUsage(state: vscode.Memento): Thenable<void> {
  return state.update(STORAGE_KEY, undefined);
}
