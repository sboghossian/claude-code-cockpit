// Lightweight in-process telemetry for cockpit's own refresh costs.
// Records the last N runs of every labeled section so the Self tab can
// answer "is cockpit cheap to run?" honestly.

const RING_SIZE = 50;

interface RunRecord {
  label: string;
  durationMs: number;
  timestamp: number;
  ok: boolean;
}

interface SectionStats {
  label: string;
  runs: number;
  lastDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastRunAt: number | undefined;
  errorCount: number;
}

const ring: RunRecord[] = [];
const counts = new Map<
  string,
  { runs: number; sumMs: number; maxMs: number; errors: number; lastAt: number }
>();

export function record<T>(label: string, fn: () => T): T {
  const start = Date.now();
  let ok = true;
  try {
    return fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    pushRecord({ label, durationMs: Date.now() - start, timestamp: start, ok });
  }
}

export async function recordAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    pushRecord({ label, durationMs: Date.now() - start, timestamp: start, ok });
  }
}

function pushRecord(r: RunRecord): void {
  ring.push(r);
  if (ring.length > RING_SIZE) ring.shift();
  const cur = counts.get(r.label) ?? { runs: 0, sumMs: 0, maxMs: 0, errors: 0, lastAt: 0 };
  cur.runs += 1;
  cur.sumMs += r.durationMs;
  cur.maxMs = Math.max(cur.maxMs, r.durationMs);
  cur.lastAt = r.timestamp;
  if (!r.ok) cur.errors += 1;
  counts.set(r.label, cur);
}

function lastDurationFor(label: string): number {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].label === label) return ring[i].durationMs;
  }
  return 0;
}

export function getSectionStats(): SectionStats[] {
  const out: SectionStats[] = [];
  for (const [label, c] of counts.entries()) {
    out.push({
      label,
      runs: c.runs,
      lastDurationMs: lastDurationFor(label),
      avgDurationMs: c.runs > 0 ? Math.round(c.sumMs / c.runs) : 0,
      maxDurationMs: c.maxMs,
      lastRunAt: c.lastAt > 0 ? c.lastAt : undefined,
      errorCount: c.errors,
    });
  }
  return out.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
}

export function getRecentRuns(limit = 25): RunRecord[] {
  return ring.slice(-limit).reverse();
}

export interface TelemetrySnapshot {
  sections: SectionStats[];
  recentRuns: RunRecord[];
  totalRuns: number;
  totalErrors: number;
  startedAt: number;
}

const startedAt = Date.now();

export function getTelemetrySnapshot(): TelemetrySnapshot {
  const sections = getSectionStats();
  let totalRuns = 0;
  let totalErrors = 0;
  for (const s of sections) {
    totalRuns += s.runs;
    totalErrors += s.errorCount;
  }
  return {
    sections,
    recentRuns: getRecentRuns(),
    totalRuns,
    totalErrors,
    startedAt,
  };
}
