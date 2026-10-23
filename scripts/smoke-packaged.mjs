/**
 * [INPUT]: release/ 下的 OpenSidian 可执行文件、隔离临时库与可选 --no-screenshot。
 * [OUTPUT]: {pass,count,checks}、运行日志与失败退出码；不生成截图。
 * [POS]: 打包产物的真实启动冒烟。先比对 ASAR 身份、当前代码及全部样式，再校验编辑器、Bases、公式、CSV 和 SVG。
 * 回执后必须自行正常退出；超时只终止自建进程组，不接触用户应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--') && arg !== '--no-screenshot')) throw new Error('只支持 --no-screenshot');
const positional = args.filter(arg => !arg.startsWith('--'));
if (positional.length > 1) throw new Error('只接受一个打包可执行文件路径');
const binary = path.resolve(repository, positional[0] || `release/mac-${process.arch}/OpenSidian.app/Contents/MacOS/OpenSidian`);
if (!/^OpenSidian(?:\.exe)?$/.test(path.basename(binary))) throw new Error('只允许启动 OpenSidian 打包产物');
if (!fs.existsSync(binary)) throw new Error('打包可执行文件不存在：' + binary);
const expectedVersion = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8')).version;
const expectedElectron = JSON.parse(fs.readFileSync(path.join(repository, 'node_modules/electron/package.json'), 'utf8')).version;
const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const archive = path.resolve(path.dirname(binary), '../Resources/app.asar');
const preflightChecks = [];
const preflight = (value, label) => { if (!value) throw Error(label); preflightChecks.push(label); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString());
  preflight(metadata.name === 'opensidian' && metadata.productName === 'OpenSidian' && metadata.version === expectedVersion, 'ASAR 身份和版本与当前项目一致');
  preflight(digest(extractFile(archive, 'LICENSE')) === digest(fs.readFileSync(path.join(repository, 'LICENSE'))), '打包许可证与仓库原文一致');
  const files = fs.readdirSync(path.join(repository, 'src/main')).filter(name => name.endsWith('.js')).map(name => 'src/main/' + name);
  files.push('dist/renderer.js', 'dist/starter.js', 'dist/graph-sim-worker.js', 'src/renderer/index.html', 'src/renderer/starter.html');
  files.push(...fs.readdirSync(path.join(repository, 'src/renderer/styles')).filter(name => name.endsWith('.css')).map(name => 'src/renderer/styles/' + name));
  for (const file of files) preflight(digest(extractFile(archive, file)) === digest(fs.readFileSync(path.join(repository, file))), '打包文件与当前构建一致：' + file);
} catch (error) {
  console.log(JSON.stringify({ pass: false, count: preflightChecks.length, checks: preflightChecks, binary, failureReason: error.message, screenshot: null }));
  process.exit(1);
}
const archiveSha256 = digest(fs.readFileSync(archive));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-packaged-result-'));
const logfile = path.join(output, 'run.log');
const vault = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-packaged-smoke-')));
fs.writeFileSync(path.join(vault, '.obs-copy-acceptance-fixture'), 'smoke\n');
fs.mkdirSync(path.join(vault, '.obsidian'));

const js = String.raw`
(async () => {
  const fs = require('fs'), path = require('path'), { ipcRenderer } = require('electron');
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label) => { for (let i = 0; i < 100; i++) { if (condition()) return; await wait(50); } throw Error(label); };
  check(fs.realpathSync(app.vaultPath) === ${JSON.stringify(vault)}, '隔离库路径正确');
  check(fs.existsSync(path.join(app.vaultPath, '.electron-user-data', 'opensidian.json')), '主进程配置保存在隔离 userData');
  check(ipcRenderer.sendSync('is-dev') === false, '运行打包模式');
  check(ipcRenderer.sendSync('version') === ${JSON.stringify(expectedVersion)}, '版本 IPC 与打包清单一致');
  check(process.versions.electron === ${JSON.stringify(expectedElectron)}, 'Electron 与构建依赖版本一致');
  check(location.protocol === 'app:' && location.hostname === 'opensidian.app', '应用资源走 app 协议');
  check(fs.existsSync(path.join(process.resourcesPath, 'app.asar')), '运行 ASAR 产物');
  const body = '# packaged\n';
  const file = await app.vault.create('Packaged-Boot.md', body);
  check(await app.vault.read(file) === body, '创建笔记内容真实落盘');
  await app.workspace.openFile(file);
  check(app.workspace.getActiveFile()?.path === file.path, '工作区打开新笔记');
  check(app.workspace.activeLeaf.view.getViewType() === 'markdown', 'Markdown 视图注册可用');
  check(app.workspace.activeLeaf.view.editor.getValue() === body, 'CodeMirror 读取笔记内容');
  const plugin = app.plugins.getInternalPlugin('bases');
  check(plugin?.enabled === true, 'Bases 核心插件默认启用');
  const base = await plugin.instance.createNewBase();
  check(base.extension === 'base' && await app.vault.adapter.exists(base.path), '打包版真实创建 base 文件');
  const view = app.workspace.activeLeaf.view, controller = view.controller;
  check(view.getViewType() === 'bases' && !!controller, '打包版打开 Bases 视图');
  check(controller.result.rows.some(row => row.file.path === file.path), 'Bases 查询真实笔记');
  await controller.patch(['formulas'], { sample: '2 * 3' });
  await controller.patchView('order', ['file.name', 'formula.sample']);
  check(controller.result.rows[0].context.formula.sample === 6, '打包版公式引擎求值正确');
  await controller.patchView('type', 'list');
  check(!!view.contentEl.querySelector('.bases-list-item'), '打包版列表布局可渲染');
  const csvPath = path.join(app.vaultPath, 'Packaged.csv');
  controller.promptCsvSavePath = () => ({ canceled: false, filePath: csvPath });
  check(app.commands.findCommand('bases:export-csv')?.checkCallback(true) === true, '打包版 CSV 命令可用');
  app.commands.executeCommandById('bases:export-csv');
  await until(() => fs.existsSync(csvPath) && fs.readFileSync(csvPath, 'utf8').includes('Packaged-Boot,6'), '等待 CSV 写盘');
  check(fs.readFileSync(csvPath, 'utf8').split('\n').length === 2, '打包版 CSV 写出表头和真实结果');
  const svg = await app.vault.create('Packaged.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2"><rect width="1" height="2"/></svg>');
  const image = new Image();
  image.src = app.vault.adapter.getResourcePath(svg.path);
  await Promise.race([image.decode(), wait(5000).then(() => { throw Error('SVG 解码超时'); })]);
  check(image.naturalWidth === 1 && image.naturalHeight === 2, '打包版 SVG 资源协议可解码');
  return { pass: true, count: checks.length, checks, version: ipcRenderer.sendSync('version'), electron: process.versions.electron };
})()
`;

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('OBS_')) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
Object.assign(env, { E2E: '1', OBS_ALLOW_MULTI: '1', OBS_VAULT_PATH: vault, OBS_SCREENSHOT_EXIT: '1', OBS_ACT: JSON.stringify({ action: 'eval', js }) });
const started = Date.now();
const child = spawn(binary, ['--user-data-dir=' + path.join(vault, '.electron-user-data')], {
  env, cwd: repository, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '', result = null, failureReason = '', stopRequested = false, forceTimer, exitTimer;
const killOwned = signal => {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') failureReason ||= error.message; }
};
const stop = () => {
  if (stopRequested) return;
  stopRequested = true;
  killOwned('SIGTERM');
  forceTimer = setTimeout(() => killOwned('SIGKILL'), 1500);
};
const badLog = /\[dev\] act failed|\[error\]|\[unhandledrejection\]|uncaught|TypeError:|ReferenceError:|setState failed|View failed to load/i;
const timeout = setTimeout(() => { failureReason = '等待打包版回执超时'; stop(); }, 45000);
const interrupted = () => { failureReason = '冒烟被中断'; stop(); };
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
const consume = chunk => {
  log += chunk.toString();
  if (badLog.test(log)) { failureReason ||= '运行日志包含异常'; stop(); return; }
  const receipt = log.split('\n').find(line => line.startsWith('[dev] eval: '));
  if (!receipt) return;
  try { result = JSON.parse(receipt.slice('[dev] eval: '.length)); } catch { return; }
  if (!exitTimer) exitTimer = setTimeout(() => { failureReason ||= '收到回执后 15 秒仍未自行退出'; stop(); }, 15000);
};
for (const stream of [child.stdout, child.stderr]) stream.on('data', consume);
const { exitCode, exitSignal } = await new Promise(resolve => {
  child.once('error', error => { failureReason = error.message; resolve({ exitCode: null, exitSignal: null }); });
  child.once('close', (code, signal) => resolve({ exitCode: code, exitSignal: signal }));
});
clearTimeout(timeout);
clearTimeout(forceTimer);
clearTimeout(exitTimer);
process.removeListener('SIGINT', interrupted);
process.removeListener('SIGTERM', interrupted);
if (stopRequested) killOwned('SIGKILL');
fs.writeFileSync(logfile, log);
const valid = result?.pass === true && Number.isInteger(result.count) && result.count > 0 &&
  Array.isArray(result.checks) && result.count === result.checks.length;
if (!valid) failureReason ||= '缺少规范的打包冒烟回执';
if (exitCode !== 0 || exitSignal || stopRequested) failureReason ||= '打包进程未自行正常退出：' + (exitSignal || exitCode);
const checks = [...preflightChecks, ...(Array.isArray(result?.checks) ? result.checks : [])];
if (!failureReason && exitCode === 0 && !exitSignal && !stopRequested) checks.push('打包进程自行正常退出');
const report = {
  pass: !failureReason && !badLog.test(log) && valid,
  count: checks.length, checks, preflightCount: preflightChecks.length, archiveSha256,
  version: result?.version, electron: result?.electron,
  binary, vault, logfile, screenshot: null, bootMs: Date.now() - started,
  exitCode, exitSignal, ...(failureReason ? { failureReason } : {}),
};
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.pass) { console.error(log.slice(-4000)); process.exitCode = 1; }
