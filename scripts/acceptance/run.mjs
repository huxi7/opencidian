/**
 * [INPUT]: Node 文件与进程 API、Electron、场景名称、--seed-vaults 与同名 .starter.js。
 * [OUTPUT]: 独立临时库、规范 {pass,count,checks} 回执与可选浅深截图、日志与退出码；--no-screenshot 跳过截图。
 * [POS]: 桌面验收运行器。.starter.js 不作为独立场景，由同名主场景触发；不自行构建。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const [scenario, ...arguments_] = process.argv.slice(2);
const scenarios = fs.readdirSync(directory)
  .filter(name => name.endsWith('.js') && !name.endsWith('.starter.js'))
  .map(name => name.slice(0, -3));
if (!scenarios.includes(scenario)) throw new Error('场景：' + scenarios.join(', '));
const option = (name, fallback) => {
  const index = arguments_.indexOf(name);
  return index < 0 ? fallback : arguments_[index + 1];
};
const phase = option('--phase', scenario === 'recovery' ? 'exercise' : 'run');
const base = '/tmp/obs-copy-acceptance';
fs.mkdirSync(base, { recursive: true });
const selected = option('--vault', null);
const vault = fs.realpathSync(selected || fs.mkdtempSync(path.join(base,
  scenario === 'graph' ? 'graph-vault-' : 'obs-copy-' + scenario + '-')));
const temporaryRoots = ['/tmp', os.tmpdir()].map(root => fs.realpathSync(root));
if (!temporaryRoots.some(root => vault.startsWith(root + path.sep))) throw new Error('拒绝非临时 vault');
const marker = path.join(vault, '.obs-copy-acceptance-fixture');
if (selected && !fs.existsSync(marker)) throw new Error('拒绝没有验收标记的既有 vault');
fs.writeFileSync(marker, 'acceptance\n');
fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
if (scenario === 'recovery' && !selected) {
  fs.writeFileSync(path.join(vault, '.obs-copy-recovery-fixture'), 'recovery\n');
  fs.writeFileSync(path.join(vault, '.obsidian/file-recovery.json'), '{"intervalSeconds":0,"keepDays":7}');
}
if (scenario === 'graph-perf' && !selected) {
  const nodeCount = parseInt(option('--nodes', '1000'), 10);
  if (!Number.isFinite(nodeCount) || nodeCount < 1 || nodeCount > 20000) throw new Error('--nodes 需为 1..20000');
  const dir = path.join(vault, 'Nodes');
  fs.mkdirSync(dir, { recursive: true });
  // 环形 + 跳跃出链：每节点 2 条 wiki 链接，保证图规模可复算
  for (let i = 0; i < nodeCount; i++) {
    const next = (i + 1) % nodeCount;
    const skip = (i + 7) % nodeCount;
    fs.writeFileSync(path.join(dir, 'n' + i + '.md'), '# Node ' + i + '\n\n[[n' + next + ']] [[n' + skip + ']]\n');
  }
}
const output = fs.mkdtempSync(path.join(base, scenario + '-' + phase + '-result-'));
const screenshot = arguments_.includes('--no-screenshot') ? null : path.join(output, 'screen.png');
// 第二窗口（starter）：同名 .starter.js 会在该窗口中执行，并单独截图。
const starterPath = path.join(directory, scenario + '.starter.js');
const starterSource = fs.existsSync(starterPath) ? fs.readFileSync(starterPath, 'utf8') : null;
const starterScreenshot = starterSource && !arguments_.includes('--no-screenshot')
  ? path.join(output, 'starter.png') : null;
const starterLightScreenshot = starterSource && !arguments_.includes('--no-screenshot')
  ? path.join(output, 'starter-light.png') : null;
const logfile = path.join(output, 'run.log');

// 预置“未打开”的仓库到主进程注册表：先于 Electron 启动写入 userData/opensidian.json。
// 用于验证 starter 的多行列表与“移除不打开的书库”路径；只允许落在临时根目录。
const seedVaults = parseInt(option('--seed-vaults', '0'), 10);
if (Number.isFinite(seedVaults) && seedVaults > 0) {
  const userData = path.join(vault, '.electron-user-data');
  fs.mkdirSync(userData, { recursive: true });
  const configPath = path.join(userData, 'opensidian.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { config = {}; }
  config.vaults = config.vaults || {};
  for (let i = 0; i < seedVaults; i++) {
    const seeded = path.join(path.dirname(vault), 'vault-switcher-seeded-' + String.fromCharCode(65 + i));
    fs.rmSync(seeded, { recursive: true, force: true });
    fs.mkdirSync(seeded, { recursive: true });
    config.vaults['vault-switcher-seed-' + i] = { path: seeded, ts: i + 1 };
  }
  fs.writeFileSync(configPath, JSON.stringify(config));
}

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('OBS_')) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
const source = fs.readFileSync(path.join(directory, scenario + '.js'), 'utf8');
const guard = `if (require('fs').realpathSync(app.vaultPath) !== ${JSON.stringify(vault)}) throw Error('错误的验收库');`;
Object.assign(env, {
  E2E: '1',   // 验收模式：不抢系统焦点、不进 Dock（main.js 的单一开关）
  OBS_ALLOW_MULTI: '1', OBS_VAULT_PATH: vault,
  OBS_ACT: JSON.stringify({ action: 'eval', js: guard + '\n' + source }),
  OBS_SCREENSHOT: screenshot || '', OBS_SCREENSHOT_DELAY: '2500', OBS_SCREENSHOT_EXIT: '1',
  OBS_RECOVERY_PHASE: phase, OBS_NOTES_STAGE: phase,
  OBS_NOTES_SETTINGS: option('--tab', 'templates'),
  OBS_GRAPH_SCREEN: option('--screen', 'global'),
  OBS_SIDEBAR_VIEW: option('--screen', 'outline'),
  OBS_GRAPH_PERF_NODES: option('--nodes', ''),
});
if (starterSource) {
  Object.assign(env, {
    OBS_STARTER_ACT: JSON.stringify({ action: 'eval', js: starterSource }),
    OBS_STARTER_SCREENSHOT: starterScreenshot || '',
    OBS_STARTER_SCREENSHOT_LIGHT: starterLightScreenshot || '',
    OBS_STARTER_SCREENSHOT_DELAY: '800',
  });
}
const require = createRequire(import.meta.url);
const electron = require(path.join(repository, 'node_modules/electron'));
console.log(JSON.stringify({ scenario, phase, vault, screenshot, logfile }));
const timeoutMs = Number(option('--timeout', '300000'));
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout 需为至少 1000ms');
const child = spawn(electron, ['--user-data-dir=' + path.join(vault, '.electron-user-data'), repository], {
  cwd: repository, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
let timedOut = false;
const stopOwnedChild = signal => {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
let forceTimer;
const timeout = setTimeout(() => {
  timedOut = true;
  log += '\n[acceptance] Electron timeout after ' + timeoutMs + 'ms\n';
  stopOwnedChild('SIGTERM');
  forceTimer = setTimeout(() => stopOwnedChild('SIGKILL'), 3000);
}, timeoutMs);
const interrupted = () => { stopOwnedChild('SIGKILL'); process.exit(130); };
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk.toString(); });
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
clearTimeout(timeout);
clearTimeout(forceTimer);
if (timedOut) stopOwnedChild('SIGKILL');
process.removeListener('SIGINT', interrupted);
process.removeListener('SIGTERM', interrupted);
fs.writeFileSync(logfile, log);
const lines = log.split('\n');
const receipt = lines.find(line => line.startsWith('[dev] eval: '));
const starterReceipt = lines.find(line => line.startsWith('[dev-starter] eval: '));
const failure = /\[dev(?:-starter)?\] act failed|\[dev(?:-starter)?\] screenshot failed|\[error\]|\[unhandledrejection\]|uncaught|TypeError:|ReferenceError:|setState failed|View failed to load/i.test(log);
let result;
try { result = JSON.parse(receipt?.slice('[dev] eval: '.length)); } catch { result = null; }
let starterResult;
try { starterResult = JSON.parse(starterReceipt?.slice('[dev-starter] eval: '.length)); } catch { starterResult = null; }
const valid = value => value?.pass === true && Array.isArray(value.checks) &&
  Number.isInteger(value.count) && value.count === value.checks.length;
const starterOk = !starterSource || (starterReceipt && valid(starterResult) &&
  (!starterScreenshot || fs.existsSync(starterScreenshot)) &&
  (!starterLightScreenshot || fs.existsSync(starterLightScreenshot)));
const passed = !timedOut && code === 0 && !failure && (!screenshot || fs.existsSync(screenshot)) && starterOk && valid(result);
const checks = [...(Array.isArray(result?.checks) ? result.checks : []),
  ...(Array.isArray(starterResult?.checks) ? starterResult.checks : [])];
console.log(JSON.stringify({
  pass: passed, count: checks.length, checks,
  logfile, screenshot, starterScreenshot, starterLightScreenshot,
  starterCount: starterResult?.count || 0, vault,
}));
if (!passed) { console.error(log.slice(-6000)); process.exitCode = 1; }
