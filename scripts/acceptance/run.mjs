/**
 * [INPUT]: Node 文件与进程 API、Electron、场景名称和可选既有测试库。
 * [OUTPUT]: 独立临时库、日志与退出码；--no-screenshot 跳过截图。
 * [POS]: 桌面验收运行器。只打开带验收标记的临时库，不自行构建。
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
const scenarios = fs.readdirSync(directory).filter(name => name.endsWith('.js')).map(name => name.slice(0, -3));
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
const output = fs.mkdtempSync(path.join(base, scenario + '-' + phase + '-result-'));
const screenshot = arguments_.includes('--no-screenshot') ? null : path.join(output, 'screen.png');
const logfile = path.join(output, 'run.log');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('OBS_')) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
const source = fs.readFileSync(path.join(directory, scenario + '.js'), 'utf8');
const guard = `if (require('fs').realpathSync(app.vaultPath) !== ${JSON.stringify(vault)}) throw Error('错误的验收库');`;
Object.assign(env, {
  OBS_ALLOW_MULTI: '1', OBS_VAULT_PATH: vault,
  OBS_ACT: JSON.stringify({ action: 'eval', js: guard + '\n' + source }),
  OBS_SCREENSHOT: screenshot || '', OBS_SCREENSHOT_DELAY: '2500', OBS_SCREENSHOT_EXIT: '1',
  OBS_RECOVERY_PHASE: phase, OBS_NOTES_STAGE: phase,
  OBS_NOTES_SETTINGS: option('--tab', 'templates'),
  OBS_GRAPH_SCREEN: option('--screen', 'global'),
  OBS_SIDEBAR_VIEW: option('--screen', 'outline'),
});
const require = createRequire(import.meta.url);
const electron = require(path.join(repository, 'node_modules/electron'));
console.log(JSON.stringify({ scenario, phase, vault, screenshot, logfile }));
const child = spawn(electron, ['--user-data-dir=' + path.join(vault, '.electron-user-data'), repository], {
  cwd: repository, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk.toString(); });
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
fs.writeFileSync(logfile, log);
const receipt = log.split('\n').find(line => line.startsWith('[dev] eval: '));
const failure = /\[dev\] act failed|\[error\]|\[unhandledrejection\]|uncaught|TypeError:|ReferenceError:|setState failed|View failed to load/i.test(log);
let result;
try { result = JSON.parse(receipt?.slice('[dev] eval: '.length)); } catch { result = null; }
const passed = code === 0 && !failure && (!screenshot || fs.existsSync(screenshot)) &&
  (result?.pass === true || result?.passed === true || result?.passed > 0 || result?.ok === true || result?.status === 'PASS');
console.log(JSON.stringify({ passed, checks: result?.count || result?.checks?.length || result?.assertions?.length || result?.passed, logfile, screenshot, vault }));
if (!passed) { console.error(log.slice(-6000)); process.exitCode = 1; }
