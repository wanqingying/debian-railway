import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// A compact snapshot of the machine an agent runs on: current time, OS,
// user/resources, and which developer tools are installed. One call, one
// shape — there is no cheap/full split. Tool versions are cached briefly.
// Only non-sensitive values are read: never the whole process.env.

const VERSION_TIMEOUT_MS = 4_000;
const TOOLS_CACHE_TTL_MS = 300_000;

// Every listed tool is treated the same: presence is a free PATH scan, and a
// present tool gets one `--version` process so its version is reported.
// `label` renames the entry when the binary differs from the tool people know it
// by (e.g. the KasmVNC X server lives in `Xvnc`).
const TOOL_PROBES = [
  { name: 'git', args: ['--version'] },
  { name: 'node', args: ['--version'] },
  { name: 'npm', args: ['--version'] },
  { name: 'pnpm', args: ['--version'] },
  { name: 'bun', args: ['--version'] },
  { name: 'python3', args: ['--version'] },
  { name: 'pip3', args: ['--version'] },
  { name: 'uv', args: ['--version'] },
  { name: 'gcc', args: ['--version'] },
  { name: 'make', args: ['--version'] },
  { name: 'jq', args: ['--version'] },
  { name: 'ffmpeg', args: ['-version'] },
  { name: 'docker', args: ['--version'] },
  { name: 'go', args: ['version'] },
  { name: 'gh', args: ['--version'] },
  { name: 'railway', args: ['--version'] },
  { name: 'doppler', args: ['--version'] },
  { name: 'opencode', args: ['--version'] },
  { name: 'codegraph', args: ['--version'] },
  { name: 'openchamber', args: ['--version'] },
  // The rest of this dev container's own toolchain (see scripts/install-tools.sh
  // and docs/): Python/DB CLIs, the interactive browser, and the agent's web path.
  { name: 'neon', args: ['--version'] },
  { name: 'pdftotext', args: ['-v'] },
  { name: 'tini', args: ['--version'] },
  { name: 'ttyd', args: ['--version'] },
  { name: 'chromium', args: ['--version'] },
  { name: 'Xvnc', args: ['-version'], label: 'kasmvnc' },
  { name: 'playwright-cli', args: ['--version'] },
  { name: 'opencli', args: ['--version'] },
];

const formatUtcOffset = (minutes) => {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const mins = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}`;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)}${units[index]}`;
};

const readFirstLine = (value) => {
  const text = typeof value === 'string' ? value.replace(/\r/g, '') : '';
  const line = text.split('\n').find((entry) => entry.trim().length > 0);
  return line ? line.trim() : '';
};

const extractVersion = (text) => {
  const match = text.match(/\d+(?:\.\d+)+/);
  return match ? match[0] : '';
};

const collectTime = () => {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const local = `${shifted.toISOString().slice(0, 19)}${formatUtcOffset(offsetMinutes)}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
  return `${local} ${timezone} (${weekday})`;
};

const readLinuxDistro = () => {
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const fields = {};
    for (const line of raw.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) fields[match[1]] = match[2].replace(/^"|"$/g, '');
    }
    return fields.PRETTY_NAME || fields.NAME || null;
  } catch {
    return null;
  }
};

const readFileIfPresent = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const collectEnvFlags = () => {
  const flags = [];
  if (fs.existsSync('/.dockerenv')) flags.push('docker');
  const cgroup = readFileIfPresent('/proc/1/cgroup');
  if (/kubepods/.test(cgroup)) flags.push('kubernetes');
  else if (/containerd/.test(cgroup)) flags.push('containerd');
  else if (/docker/.test(cgroup) && !flags.includes('docker')) flags.push('docker');
  if (process.env.container && !flags.includes(process.env.container)) flags.push(process.env.container);
  if (process.env.WSL_DISTRO_NAME || /microsoft/i.test(readFileIfPresent('/proc/version'))) flags.push('wsl');
  if (process.env.CI) flags.push('ci');
  if (process.env.RAILWAY_ENVIRONMENT) flags.push('railway');
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) flags.push('proxy');
  return flags;
};

const collectUser = () => {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
};

const collectDisk = (target) => {
  try {
    const stats = fs.statfsSync(target);
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
};

const CGROUP_ROOT = '/sys/fs/cgroup';
const readCgroup = (name) => readFileIfPresent(path.join(CGROUP_ROOT, name)).trim();

const formatDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// `os.cpus()` and `os.totalmem()` report the *host*: in a container they can be
// 20x the real quota, and anything sized from them oversubscribes (a 48-thread
// build under an 8-core quota ran ~70x slower than one sized to the quota).
// cgroup v2 states what this machine may actually use, so that wins.
const collectLimits = () => {
  if (!fs.existsSync(path.join(CGROUP_ROOT, 'cgroup.controllers'))) return null;
  const limits = { source: 'cgroup v2' };

  const [quota, period] = readCgroup('cpu.max').split(/\s+/);
  if (quota && quota !== 'max') {
    const cores = Number(quota) / Number(period);
    if (Number.isFinite(cores) && cores > 0) {
      limits.cpuCores = Math.round(cores * 10) / 10;
      limits.cpu = `${limits.cpuCores} cores (cpu.max ${quota}/${period})`;
    }
  }

  const memoryMax = Number(readCgroup('memory.max'));
  if (Number.isFinite(memoryMax) && memoryMax > 0) {
    const used = Number(readCgroup('memory.current')) || 0;
    const peak = Number(readCgroup('memory.peak')) || 0;
    limits.memoryBytes = memoryMax;
    limits.memoryUsedBytes = used;
    const parts = [`${formatBytes(memoryMax)} limit`, `${formatBytes(used)} used`];
    if (peak > used) parts.push(`${formatBytes(peak)} peak`);
    limits.memory = parts.join(', ');
  }

  const pidsMax = Number(readCgroup('pids.max'));
  if (Number.isFinite(pidsMax) && pidsMax > 0) {
    limits.pidsMax = pidsMax;
    limits.pids = `${Number(readCgroup('pids.current')) || 0}/${pidsMax}`;
  }

  const hostCpu = os.cpus().length;
  const hostMemory = os.totalmem();
  if ((limits.cpuCores && limits.cpuCores < hostCpu) || (limits.memoryBytes && limits.memoryBytes < hostMemory)) {
    limits.hostView = `${hostCpu} cores / ${formatBytes(hostMemory)} (kernel view of the host; not this machine's quota)`;
  }

  return Object.keys(limits).length > 1 ? limits : null;
};

// Wall-clock start and age of PID 1 — the container's own lifetime, unlike
// /proc/uptime, which counts from the *host* boot.
const collectContainer = () => {
  const info = {};
  const init = readFileIfPresent('/proc/1/cmdline').split('\0').filter(Boolean).join(' ');
  if (init) info.init = init;

  const stat = readFileIfPresent('/proc/1/stat');
  const boot = /^btime (\d+)$/m.exec(readFileIfPresent('/proc/stat'));
  const afterComm = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  const startTicks = Number(afterComm[19]); // field 22 (`starttime`); fields[0] is field 3
  if (boot && Number.isFinite(startTicks)) {
    const startedMs = Number(boot[1]) * 1000 + startTicks * 10; // USER_HZ is always 100
    if (startedMs > 0 && startedMs <= Date.now()) {
      info.started = `${new Date(startedMs).toISOString().slice(0, 16).replace('T', ' ')}Z`;
      info.uptime = formatDuration(Date.now() - startedMs);
    }
  }

  return Object.keys(info).length > 0 ? info : null;
};

// A listening socket's local address, in the kernel's hex form: 4 bytes for
// IPv4 (little-endian) or 4 little-endian words for IPv6. Only loopback needs
// recognising — it separates services reachable from outside the container
// from ones that need a tunnel.
const isLoopbackAddress = (hex) => {
  if (hex.length === 8) return hex.slice(6, 8).toUpperCase() === '7F';
  if (/^0{16}FFFF0000$/i.test(hex.slice(0, 24))) return hex.slice(30, 32).toUpperCase() === '7F';
  return /^0{24}01000000$/.test(hex); // ::1
};

const collectListeningPorts = () => {
  const bound = new Map(); // port -> every listener on it is loopback
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    for (const line of readFileIfPresent(file).split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] !== '0A') continue; // 0A = LISTEN
      const [address, portHex] = fields[1].split(':');
      const port = Number.parseInt(portHex, 16);
      if (!Number.isInteger(port) || port <= 0) continue;
      bound.set(port, (bound.get(port) ?? true) && isLoopbackAddress(address));
    }
  }
  const ports = [...bound.keys()].sort((a, b) => a - b);
  const listening = {};
  const external = ports.filter((port) => !bound.get(port));
  const loopback = ports.filter((port) => bound.get(port));
  if (external.length > 0) listening.external = external;
  if (loopback.length > 0) listening.loopback = loopback;
  return listening;
};

// Ports the process was told to serve on (`PORT`, `SSH_PORT`, …) plus the ones
// actually listening, split by whether the container may be reached on them.
const collectPorts = () => {
  const ports = {};
  const configured = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:[A-Z0-9]+_)*PORT$/.test(key) || key.startsWith('RAILWAY_')) continue;
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65_536) configured[key] = port;
  }
  if (Object.keys(configured).length > 0) ports.configured = configured;
  const listening = collectListeningPorts();
  if (Object.keys(listening).length > 0) ports.listening = listening;
  return Object.keys(ports).length > 0 ? ports : null;
};

// How this container is exposed publicly: Railway's TCP proxy mapping for the
// SSH endpoint and the HTTP domain for the web UI.
const collectRailway = () => {
  const info = {};
  const sources = {
    project: 'RAILWAY_PROJECT_NAME',
    service: 'RAILWAY_SERVICE_NAME',
    environment: 'RAILWAY_ENVIRONMENT_NAME',
    region: 'RAILWAY_REPLICA_REGION',
    deployment: 'RAILWAY_DEPLOYMENT_ID',
    volume: 'RAILWAY_VOLUME_MOUNT_PATH',
  };
  for (const [key, name] of Object.entries(sources)) {
    const value = process.env[name];
    if (value) info[key] = key === 'deployment' ? value.slice(0, 8) : value;
  }

  const tcpHost = process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const tcpPort = process.env.RAILWAY_TCP_PROXY_PORT;
  const target = process.env.RAILWAY_TCP_APPLICATION_PORT;
  if (tcpHost && tcpPort) info.tcpProxy = target ? `${tcpHost}:${tcpPort} -> ${target}` : `${tcpHost}:${tcpPort}`;

  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
  if (domain) info.publicDomain = domain;

  return Object.keys(info).length > 0 ? info : null;
};

const resolveExecutable = (name) => {
  const platform = os.platform();
  const pathValue = process.env.PATH || process.env.Path || '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions = platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const fileName = platform === 'win32' ? `${name}${extension.toLowerCase()}` : name;
      const candidate = path.join(directory, fileName);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep looking; this candidate is not an executable file.
      }
    }
  }

  return null;
};

const probeTool = (name, args) => {
  const executable = resolveExecutable(name);
  if (!executable) return { status: 'absent' };

  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error) return { status: 'error' };
  const output = readFirstLine(result.stdout) || readFirstLine(result.stderr);
  if (result.status !== 0 && !output) return { status: 'error' };
  return { status: 'present', version: extractVersion(output) || output || null };
};

// Versions change slowly; cache the spawn results so repeated calls stay cheap.
let toolsCache = null;
const collectTools = () => {
  const now = Date.now();
  if (toolsCache && now - toolsCache.at < TOOLS_CACHE_TTL_MS) {
    return toolsCache.value;
  }
  const value = { present: [], missing: [], errored: [] };
  for (const probe of TOOL_PROBES) {
    const result = probeTool(probe.name, probe.args);
    const label = probe.label || probe.name;
    if (result.status === 'present') value.present.push(result.version ? `${label} ${result.version}` : label);
    else if (result.status === 'error') value.errored.push(label);
    else value.missing.push(label);
  }
  toolsCache = { at: now, value };
  return value;
};

export const collectSystemInfo = ({ diskTarget } = {}) => {
  const platform = os.platform();
  const limits = collectLimits();
  const snapshot = {
    time: collectTime(),
    os: `${os.type()} ${os.arch()}`,
    distro: platform === 'linux' ? readLinuxDistro() : null,
    kernel: os.release(),
    shell: platform === 'win32' ? (process.env.ComSpec || null) : (process.env.SHELL || null),
    user: collectUser(),
    host: os.hostname(),
    locale: process.env.LANG || process.env.LC_ALL || null,
    env: collectEnvFlags(),
    cpu: limits?.cpuCores || os.cpus().length,
    mem: limits?.memoryBytes
      ? `${formatBytes(limits.memoryBytes - limits.memoryUsedBytes)} free of ${formatBytes(limits.memoryBytes)}`
      : `${formatBytes(os.freemem())} free of ${formatBytes(os.totalmem())}`,
    limits,
    container: collectContainer(),
    ports: collectPorts(),
    railway: collectRailway(),
  };

  const disk = collectDisk(diskTarget || process.cwd());
  if (disk) snapshot.disk = `${formatBytes(disk.free)} free of ${formatBytes(disk.total)}`;

  const venv = process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX;
  if (venv) snapshot.venv = venv;

  const tools = collectTools();
  snapshot.tools = tools.present;
  snapshot.missing = tools.missing;
  if (tools.errored.length > 0) snapshot.errored = tools.errored;

  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === null || snapshot[key] === undefined) delete snapshot[key];
  }
  return snapshot;
};

// Run this file directly for a snapshot without OpenCode: `node sysinfo.js`.
// `import.meta.main` is false when OpenCode imports it as a tool dependency.
if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(collectSystemInfo(), null, 2)}\n`);
}
