import { execFile, ExecFileException } from 'child_process';
import * as os from 'os';
import { logger } from './logger';

export interface DiskInfo {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPct: number;
  filesystem: string;
}

export interface MemoryInfo {
  totalGb: number;
  pressurePct: number;
  appUsedGb: number;
  wiredGb: number;
  compressedGb: number;
}

export interface BatteryInfo {
  pct: number;
  isCharging: boolean;
  isPluggedIn: boolean;
  timeRemaining: string | undefined;
  fullyCharged: boolean;
}

export interface CpuInfo {
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cores: number;
  loadPct1: number;
  uptime: { days: number; hours: number; minutes: number };
  // Rich detail (top -l 1 -n 0 + sysctl). All optional so legacy callers still work.
  userPct?: number;
  sysPct?: number;
  idlePct?: number;
  physicalCores?: number;
  model?: string;
}

export interface MemoryDetail {
  totalMb: number;
  wiredMb: number;
  activeMb: number;
  inactiveMb: number;
  compressedMb: number;
  freeMb: number;
  swapUsedMb: number;
  swapTotalMb: number;
}

export interface EnergyDetail {
  source: 'AC' | 'Battery' | 'Unknown';
  cycleCount?: number;
  designCapacityMah?: number;
  currentCapacityMah?: number;
  healthPct?: number;
  acWattage?: number;
  timeRemaining?: string;
}

export interface VolumeInfo {
  mount: string;
  totalGb: number;
  freeGb: number;
  pct: number;
}

export interface InterfaceInfo {
  name: string;
  ipv4?: string;
}

export interface NetworkInfo {
  interfaceName: string;
  ssid: string | undefined;
  rxKbps: number;
  txKbps: number;
}

export interface ExternalDrive {
  name: string;
  mountPoint: string;
  totalGb: number;
  availableGb: number;
  usedPct: number;
}

export interface BluetoothDevice {
  name: string;
  battery: number | undefined;
  connected: boolean;
  kind: string;
}

export interface MacHealthSnapshot {
  available: boolean;
  hostname: string;
  model: string | undefined;
  disk: DiskInfo | undefined;
  memory: MemoryInfo | undefined;
  battery: BatteryInfo | undefined;
  cpu: CpuInfo | undefined;
  network: NetworkInfo | undefined;
  externalDrives: ExternalDrive[];
  bluetooth: BluetoothDevice[];
  overallHealth: 'excellent' | 'good' | 'attention';
  // Rich detail (optional — populated on macOS, undefined elsewhere or on probe failure).
  memoryDetail?: MemoryDetail;
  energy?: EnergyDetail;
  volumes?: VolumeInfo[];
  interfaces?: InterfaceInfo[];
}

let cached: { snap: MacHealthSnapshot; ts: number } | undefined;
const CACHE_MS = 8_000;

let lastNet: { ts: number; rx: number; tx: number; iface: string } | undefined;

function run(cmd: string, args: string[], timeoutMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err: ExecFileException | null, stdout) => {
        if (err) {
          resolve('');
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : '');
      },
    );
  });
}

async function readDisk(): Promise<DiskInfo | undefined> {
  const out = await run('df', ['-k', '/']);
  // Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on
  const lines = out.trim().split('\n');
  if (lines.length < 2) return undefined;
  const cols = lines[1].split(/\s+/).filter(Boolean);
  if (cols.length < 5) return undefined;
  const total = Number(cols[1]) * 1024;
  const used = Number(cols[2]) * 1024;
  const avail = Number(cols[3]) * 1024;
  if (!Number.isFinite(total) || total <= 0) return undefined;
  return {
    filesystem: cols[0],
    totalGb: total / 1e9,
    usedGb: used / 1e9,
    availableGb: avail / 1e9,
    usedPct: (used / total) * 100,
  };
}

async function readMemory(): Promise<MemoryInfo | undefined> {
  const [vmStat, sysctlMem] = await Promise.all([
    run('vm_stat', []),
    run('sysctl', ['-n', 'hw.memsize']),
  ]);
  const totalBytes = Number(sysctlMem.trim());
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return undefined;
  const pageSize = (vmStat.match(/page size of (\d+)/) ?? ['', '4096'])[1];
  const ps = Number(pageSize);
  function field(key: string): number {
    const m = new RegExp(`${key}:\\s*(\\d+)`).exec(vmStat);
    return m ? Number(m[1]) * ps : 0;
  }
  const free = field('Pages free');
  const active = field('Pages active');
  const inactive = field('Pages inactive');
  const wired = field('Pages wired down');
  const compressed = field('Pages occupied by compressor');
  const used = active + wired + compressed; // app + wired + compressed
  const pressure = ((used + inactive) / totalBytes) * 100;
  void free;
  return {
    totalGb: totalBytes / 1e9,
    pressurePct: Math.min(100, pressure),
    appUsedGb: active / 1e9,
    wiredGb: wired / 1e9,
    compressedGb: compressed / 1e9,
  };
}

async function readBattery(): Promise<BatteryInfo | undefined> {
  const out = await run('pmset', ['-g', 'batt']);
  // "Now drawing from 'AC Power'" / "Now drawing from 'Battery Power'"
  // " -InternalBattery-0 (id=...) 100%; charged; 0:00 remaining present: true"
  const pctMatch = /(\d+)%;/.exec(out);
  if (!pctMatch) return undefined;
  const pct = Number(pctMatch[1]);
  const isCharging = /charging/i.test(out) && !/discharging/i.test(out);
  const isPluggedIn = /AC Power/i.test(out) || /charging/i.test(out) || /charged/i.test(out);
  const fullyCharged = /charged/i.test(out) && !/charging/i.test(out);
  const timeMatch = /(\d{1,2}:\d{2})\s+remaining/.exec(out);
  return {
    pct,
    isCharging,
    isPluggedIn,
    timeRemaining: timeMatch ? timeMatch[1] : undefined,
    fullyCharged,
  };
}

async function readCpu(): Promise<CpuInfo | undefined> {
  const [loadOut, cores] = await Promise.all([
    run('sysctl', ['-n', 'vm.loadavg']),
    Promise.resolve(os.cpus().length),
  ]);
  // "{ 1.23 1.45 1.67 }"
  const m = /([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(loadOut);
  if (!m) return undefined;
  const l1 = Number(m[1]);
  const l5 = Number(m[2]);
  const l15 = Number(m[3]);
  const upSec = os.uptime();
  return {
    loadAvg1: l1,
    loadAvg5: l5,
    loadAvg15: l15,
    cores,
    loadPct1: Math.min(100, (l1 / cores) * 100),
    uptime: {
      days: Math.floor(upSec / 86400),
      hours: Math.floor((upSec % 86400) / 3600),
      minutes: Math.floor((upSec % 3600) / 60),
    },
  };
}

async function readNetwork(): Promise<NetworkInfo | undefined> {
  // Find primary interface (default route).
  const route = await run('route', ['-n', 'get', 'default']);
  const ifaceMatch = /interface:\s*(\S+)/.exec(route);
  const iface = ifaceMatch ? ifaceMatch[1] : 'en0';

  const ssid = await readSsid(iface);

  // netstat -bI <iface> shows byte counters.
  const out = await run('netstat', ['-bI', iface]);
  // Header + "Link" line(s) + "Inet" line. We want any Link# line — locate
  // the Link by scanning for a `<Link#…>` token (column position varies by
  // macOS version) rather than relying on column 0 matching the iface name.
  // Columns include: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
  const lines = out.trim().split('\n').slice(1); // skip header
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    const cols = line.split(/\s+/).filter(Boolean);
    if (cols.length < 10) continue;
    const linkIdx = cols.findIndex((c) => /^<Link#\d+>$/.test(c));
    if (linkIdx < 0) continue;
    // Ibytes/Obytes sit at offsets +3 and +6 from the <Link#…> column.
    const ib = Number(cols[linkIdx + 3]);
    const ob = Number(cols[linkIdx + 6]);
    if (Number.isFinite(ib)) rx += ib;
    if (Number.isFinite(ob)) tx += ob;
  }
  if (!rx && !tx) return { interfaceName: iface, ssid, rxKbps: 0, txKbps: 0 };

  const now = Date.now();
  let rxKbps = 0;
  let txKbps = 0;
  if (lastNet && lastNet.iface === iface) {
    const dt = (now - lastNet.ts) / 1000;
    if (dt > 0.5 && dt < 60) {
      rxKbps = Math.max(0, ((rx - lastNet.rx) / 1024) / dt);
      txKbps = Math.max(0, ((tx - lastNet.tx) / 1024) / dt);
    }
  }
  lastNet = { ts: now, rx, tx, iface };
  return { interfaceName: iface, ssid, rxKbps, txKbps };
}

async function readSsid(iface: string): Promise<string | undefined> {
  // Newer macOS deprecates `airport`; try networksetup as fallback.
  const out = await run('/usr/sbin/networksetup', ['-getairportnetwork', iface]);
  const m = /Current Wi-Fi Network:\s*(.+?)\s*$/m.exec(out);
  return m ? m[1].trim() : undefined;
}

async function readExternalDrives(): Promise<ExternalDrive[]> {
  const out = await run('df', ['-k']);
  const lines = out.trim().split('\n').slice(1);
  const drives: ExternalDrive[] = [];
  for (const line of lines) {
    const cols = line.split(/\s+/).filter(Boolean);
    if (cols.length < 9) continue;
    const mount = cols.slice(8).join(' ');
    if (!mount.startsWith('/Volumes/')) continue;
    const total = Number(cols[1]) * 1024;
    const used = Number(cols[2]) * 1024;
    const avail = Number(cols[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;
    drives.push({
      name: mount.replace('/Volumes/', ''),
      mountPoint: mount,
      totalGb: total / 1e9,
      availableGb: avail / 1e9,
      usedPct: (used / total) * 100,
    });
  }
  return drives;
}

async function readBluetooth(): Promise<BluetoothDevice[]> {
  // system_profiler is slow (~1.5s). We tolerate that since we cache 8s.
  const out = await run('system_profiler', ['SPBluetoothDataType', '-json'], 4000);
  if (!out) return [];
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return [];
  }
  const devices: BluetoothDevice[] = [];
  const dataType = parsed?.SPBluetoothDataType?.[0];
  // Connected devices live under device_connected; some macOS versions use
  // device_title. Walk both.
  const lists: unknown[] = [];
  if (Array.isArray(dataType?.device_connected)) lists.push(...dataType.device_connected);
  if (Array.isArray(dataType?.device_title)) lists.push(...dataType.device_title);
  for (const entry of lists) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [name, raw] of Object.entries(entry as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const info = raw as Record<string, unknown>;
      const battStr =
        (info.device_batteryLevelMain as string | undefined) ??
        (info.device_batteryLevelLeft as string | undefined) ??
        (info.device_batteryLevel as string | undefined);
      const battery = battStr ? Number(String(battStr).replace('%', '')) : undefined;
      const connected = info.device_isconnected === 'attrib_Yes' || info.device_connected === 'attrib_Yes';
      const minorType = (info.device_minorType as string | undefined) ?? '';
      devices.push({
        name,
        battery: Number.isFinite(battery) ? battery : undefined,
        connected,
        kind: minorType,
      });
    }
  }
  // Filter to connected, sort by name.
  return devices
    .filter((d) => d.connected || typeof d.battery === 'number')
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readModel(): Promise<string | undefined> {
  const out = await run('sysctl', ['-n', 'hw.model']);
  const trimmed = out.trim();
  return trimmed || undefined;
}

// --- Rich detail collectors (cached via the parent snapshot's CACHE_MS). ---

async function readCpuDetail(): Promise<{
  userPct?: number;
  sysPct?: number;
  idlePct?: number;
  physicalCores?: number;
  model?: string;
}> {
  try {
    const [topOut, ncpu, physical, modelOut] = await Promise.all([
      run('top', ['-l', '1', '-n', '0'], 2500),
      run('sysctl', ['-n', 'hw.ncpu']),
      run('sysctl', ['-n', 'hw.physicalcpu']),
      // hw.model is laptop ID; CPU brand string is on macOS via machdep.cpu.brand_string.
      run('sysctl', ['-n', 'machdep.cpu.brand_string']),
    ]);
    void ncpu;
    // "CPU usage: 4.12% user, 6.18% sys, 89.69% idle"
    const m = /CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys,\s*([\d.]+)%\s*idle/i.exec(topOut);
    const physicalCores = Number(physical.trim()) || undefined;
    const model = modelOut.trim() || undefined;
    if (!m) return { physicalCores, model };
    return {
      userPct: Number(m[1]),
      sysPct: Number(m[2]),
      idlePct: Number(m[3]),
      physicalCores,
      model,
    };
  } catch {
    return {};
  }
}

async function readMemoryDetail(totalBytes: number): Promise<MemoryDetail | undefined> {
  try {
    const [vmStat, swap] = await Promise.all([
      run('vm_stat', []),
      run('sysctl', ['-n', 'vm.swapusage']),
    ]);
    const pageSize = Number((vmStat.match(/page size of (\d+)/) ?? ['', '4096'])[1]);
    function field(key: string): number {
      const m = new RegExp(`${key}:\\s*(\\d+)`).exec(vmStat);
      return m ? Number(m[1]) * pageSize : 0;
    }
    const wired = field('Pages wired down');
    const active = field('Pages active');
    const inactive = field('Pages inactive');
    const compressed = field('Pages occupied by compressor');
    const free = field('Pages free');
    // "total = 2048.00M  used = 512.00M  free = 1536.00M (encrypted)"
    const sm = /total\s*=\s*([\d.]+)M\s+used\s*=\s*([\d.]+)M/i.exec(swap);
    const swapTotalMb = sm ? Number(sm[1]) : 0;
    const swapUsedMb = sm ? Number(sm[2]) : 0;
    return {
      totalMb: totalBytes / 1024 / 1024,
      wiredMb: wired / 1024 / 1024,
      activeMb: active / 1024 / 1024,
      inactiveMb: inactive / 1024 / 1024,
      compressedMb: compressed / 1024 / 1024,
      freeMb: free / 1024 / 1024,
      swapUsedMb,
      swapTotalMb,
    };
  } catch {
    return undefined;
  }
}

async function readEnergyDetail(): Promise<EnergyDetail | undefined> {
  try {
    const [batt, ac, profile] = await Promise.all([
      run('pmset', ['-g', 'batt']),
      run('pmset', ['-g', 'ac']),
      run('system_profiler', ['SPPowerDataType', '-json'], 4000),
    ]);
    // Source from first line: "Now drawing from 'AC Power'" / "'Battery Power'"
    const srcMatch = /drawing from '([^']+)'/i.exec(batt);
    const source: EnergyDetail['source'] = srcMatch
      ? (/AC/i.test(srcMatch[1]) ? 'AC' : 'Battery')
      : 'Unknown';
    const timeMatch = /(\d{1,2}:\d{2})\s+remaining/.exec(batt);
    const wattMatch = /Wattage\s*=\s*(\d+)/i.exec(ac);
    let cycleCount: number | undefined;
    let designCapacityMah: number | undefined;
    let currentCapacityMah: number | undefined;
    let healthPct: number | undefined;
    if (profile) {
      try {
        const parsed = JSON.parse(profile) as { SPPowerDataType?: Array<Record<string, unknown>> };
        const items = parsed.SPPowerDataType ?? [];
        // Find the entry with sppower_battery_health_info.
        for (const it of items) {
          const health = it['sppower_battery_health_info'] as Record<string, unknown> | undefined;
          if (health) {
            const cc = Number(health['sppower_battery_health_maximum_capacity']);
            // Some macOS versions stash the Mah values under different keys.
            const cyc = Number(
              health['sppower_battery_cycle_count'] ??
                (it['sppower_battery_charge_info'] as Record<string, unknown> | undefined)?.[
                  'sppower_battery_cycle_count'
                ],
            );
            if (Number.isFinite(cyc)) cycleCount = cyc;
            if (Number.isFinite(cc)) healthPct = cc;
          }
          const charge = it['sppower_battery_charge_info'] as Record<string, unknown> | undefined;
          if (charge) {
            const cyc = Number(charge['sppower_battery_cycle_count']);
            if (Number.isFinite(cyc) && cycleCount === undefined) cycleCount = cyc;
          }
        }
      } catch {
        // ignore JSON parse error
      }
    }
    return {
      source,
      cycleCount,
      designCapacityMah,
      currentCapacityMah,
      healthPct,
      acWattage: wattMatch ? Number(wattMatch[1]) : undefined,
      timeRemaining: timeMatch ? timeMatch[1] : undefined,
    };
  } catch {
    return undefined;
  }
}

async function readVolumes(): Promise<VolumeInfo[]> {
  const out = await run('df', ['-k']);
  const lines = out.trim().split('\n').slice(1);
  const vols: VolumeInfo[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const cols = line.split(/\s+/).filter(Boolean);
    if (cols.length < 9) continue;
    const mount = cols.slice(8).join(' ');
    if (!mount.startsWith('/')) continue;
    // Skip pseudo / system mounts that aren't user-meaningful.
    if (mount.startsWith('/System/Volumes/') && mount !== '/System/Volumes/Data') continue;
    if (mount.startsWith('/dev')) continue;
    if (mount.startsWith('/private/var/vm')) continue;
    if (seen.has(mount)) continue;
    seen.add(mount);
    const total = Number(cols[1]) * 1024;
    const used = Number(cols[2]) * 1024;
    const avail = Number(cols[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;
    vols.push({
      mount,
      totalGb: total / 1e9,
      freeGb: avail / 1e9,
      pct: (used / total) * 100,
    });
  }
  return vols;
}

async function readInterfaces(): Promise<InterfaceInfo[]> {
  const out = await run('ifconfig', ['-a']);
  if (!out) return [];
  const blocks = out.split(/^(?=\S)/m);
  const ifaces: InterfaceInfo[] = [];
  for (const block of blocks) {
    const headerMatch = /^([a-zA-Z0-9]+):/m.exec(block);
    if (!headerMatch) continue;
    const name = headerMatch[1];
    if (!/^(en|utun|bridge|awdl|llw)\d*$/.test(name)) continue;
    // Only include interfaces in UP state.
    if (!/\bflags=[^\s]*UP/.test(block) && !/status:\s*active/.test(block)) {
      // Still allow utun if it has an inet line — utun won't always show UP.
      if (!/^\s+inet\s+/m.test(block)) continue;
    }
    const inetMatch = /^\s+inet\s+([0-9.]+)/m.exec(block);
    if (!inetMatch) continue;
    ifaces.push({ name, ipv4: inetMatch[1] });
  }
  return ifaces;
}

function deriveOverall(snap: Omit<MacHealthSnapshot, 'overallHealth'>): MacHealthSnapshot['overallHealth'] {
  let bad = 0;
  let warn = 0;
  if (snap.disk && snap.disk.usedPct > 90) bad += 1;
  else if (snap.disk && snap.disk.usedPct > 80) warn += 1;
  if (snap.memory && snap.memory.pressurePct > 90) bad += 1;
  else if (snap.memory && snap.memory.pressurePct > 75) warn += 1;
  if (snap.battery && !snap.battery.isPluggedIn && snap.battery.pct < 15) bad += 1;
  if (snap.cpu && snap.cpu.loadPct1 > 200) bad += 1;
  else if (snap.cpu && snap.cpu.loadPct1 > 100) warn += 1;
  if (bad > 0) return 'attention';
  if (warn > 0) return 'good';
  return 'excellent';
}

export async function readMacHealth(): Promise<MacHealthSnapshot> {
  if (process.platform !== 'darwin') {
    return {
      available: false,
      hostname: os.hostname(),
      model: undefined,
      disk: undefined,
      memory: undefined,
      battery: undefined,
      cpu: undefined,
      network: undefined,
      externalDrives: [],
      bluetooth: [],
      overallHealth: 'good',
    };
  }
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return cached.snap;
  }
  try {
    const [
      model,
      disk,
      memory,
      battery,
      cpu,
      network,
      drives,
      bt,
      cpuDetail,
      energy,
      volumes,
      interfaces,
    ] = await Promise.all([
      readModel(),
      readDisk(),
      readMemory(),
      readBattery(),
      readCpu(),
      readNetwork(),
      readExternalDrives(),
      readBluetooth(),
      readCpuDetail(),
      readEnergyDetail(),
      readVolumes(),
      readInterfaces(),
    ]);
    // Total bytes for memoryDetail; reuse the value already computed in readMemory
    // by re-reading sysctl is cheap enough (cached at OS level).
    const totalBytesOut = await run('sysctl', ['-n', 'hw.memsize']);
    const totalBytes = Number(totalBytesOut.trim());
    const memoryDetail = Number.isFinite(totalBytes) && totalBytes > 0
      ? await readMemoryDetail(totalBytes)
      : undefined;

    const cpuMerged: CpuInfo | undefined = cpu
      ? { ...cpu, ...cpuDetail }
      : undefined;

    const partial = {
      available: true,
      hostname: os.hostname(),
      model,
      disk,
      memory,
      battery,
      cpu: cpuMerged,
      network,
      externalDrives: drives,
      bluetooth: bt,
    };
    const snap: MacHealthSnapshot = {
      ...partial,
      overallHealth: deriveOverall(partial),
      memoryDetail,
      energy,
      volumes,
      interfaces,
    };
    cached = { snap, ts: Date.now() };
    return snap;
  } catch (err) {
    logger.warn(`mac-health: read failed: ${String(err)}`);
    return {
      available: false,
      hostname: os.hostname(),
      model: undefined,
      disk: undefined,
      memory: undefined,
      battery: undefined,
      cpu: undefined,
      network: undefined,
      externalDrives: [],
      bluetooth: [],
      overallHealth: 'good',
    };
  }
}

export function readMacHealthSync(): MacHealthSnapshot {
  if (cached) return cached.snap;
  return {
    available: process.platform === 'darwin',
    hostname: os.hostname(),
    model: undefined,
    disk: undefined,
    memory: undefined,
    battery: undefined,
    cpu: undefined,
    network: undefined,
    externalDrives: [],
    bluetooth: [],
    overallHealth: 'good',
  };
}
