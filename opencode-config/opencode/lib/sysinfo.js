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
    if (result.status === 'present') value.present.push(result.version ? `${probe.name} ${result.version}` : probe.name);
    else if (result.status === 'error') value.errored.push(probe.name);
    else value.missing.push(probe.name);
  }
  toolsCache = { at: now, value };
  return value;
};

export const collectSystemInfo = ({ diskTarget } = {}) => {
  const platform = os.platform();
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
    cpu: os.cpus().length,
    mem: `${formatBytes(os.totalmem())} total, ${formatBytes(os.freemem())} free`,
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
