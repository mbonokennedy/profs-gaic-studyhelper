// `npm run doctor`: checks this machine is ready to run IO Offline. Read-only.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { homedir, networkInterfaces, totalmem } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { allDownloadNames, modelSrc } from '../src/models.mjs';
import { IO_DB_PATH, ioAvailable } from '../src/io-connector.mjs';

const rows = [];
const check = (name, ok, detail, fix = '') => rows.push({ name, ok, detail, fix });

// Node
const [maj, min] = process.versions.node.split('.').map(Number);
check('Node.js', (maj === 22 && min >= 21) || maj > 24 || (maj === 24 && min >= 9), `v${process.versions.node}`, 'Install Node 22.21+ or 24.9+');

// RAM
const gb = totalmem() / 1024 ** 3;
check('Memory', gb >= 8, `${gb.toFixed(1)} GB`, 'Use LLM_MODEL=QWEN3_600M_INST_Q4 on machines under 8 GB');

// Disk
try {
  const s = statfsSync(homedir());
  const free = (s.bavail * s.bsize) / 1024 ** 3;
  check('Free disk', free >= 5, `${free.toFixed(1)} GB free`, 'Models need ~2.5 GB plus headroom');
} catch { check('Free disk', true, 'unknown'); }

// Vulkan (QVAC needs it on Windows/Linux even for CPU)
let vk = 'not checked';
try { vk = execSync('vulkaninfo --summary', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().match(/apiVersion\s*=\s*(\S+)/)?.[1] ?? 'present'; } catch { vk = ''; }
check('Vulkan', vk !== '', vk || 'vulkaninfo not found (usually fine: GPU drivers ship the runtime)', 'Update GPU drivers if model loading fails');

// Models cached
const cache = join(homedir(), '.qvac', 'models');
// Single-file models live in the cache root; multi-file ones (e.g. Bergamot) under sets/<hash>/.
const files = existsSync(cache) ? readdirSync(cache, { recursive: true }).map(String) : [];
for (const name of allDownloadNames()) {
  const base = String(modelSrc(name).src ?? '').split('/').pop();
  const hit = files.find((f) => base && f.replaceAll('\\', '/').split('/').pop().endsWith(base));
  check(`Model ${name}`, !!hit, hit ? `${(statSync(join(cache, hit)).size / 1e6).toFixed(0)} MB` : 'not cached', 'Run `npm run setup` while online');
}

// Content
check('Course index', existsSync('data/index.json'), existsSync('data/index.json') ? 'data/index.json' : 'missing', 'Run `npm run sync-io` (or just `npm start`, which syncs on first run)');
check('IO database (optional)', true, ioAvailable() ? IO_DB_PATH : 'not found, sample content will be used');

// Network
const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map((i) => i.address);
check('LAN address for phone', ips.length > 0, ips.join(', ') || 'none', 'Join Wi-Fi or turn on Windows Mobile Hotspot');
const free = (port) => new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(port, '0.0.0.0'); });
for (const p of [+(process.env.PORT || 8787), +(process.env.HTTPS_PORT || 8788)]) check(`Port ${p}`, await free(p), (await free(p)) ? 'free' : 'in use (fine if IO Offline is already running)', 'Set PORT / HTTPS_PORT');

console.log('\nIO Offline doctor\n');
for (const r of rows) console.log(`  ${r.ok ? '✔' : '✖'} ${r.name.padEnd(34)} ${r.detail}${!r.ok && r.fix ? `\n      → ${r.fix}` : ''}`);
const bad = rows.filter((r) => !r.ok && !r.name.startsWith('Port')).length;
console.log(bad ? `\n${bad} problem(s) found.\n` : '\nAll good.\n');
process.exit(bad ? 1 : 0);
