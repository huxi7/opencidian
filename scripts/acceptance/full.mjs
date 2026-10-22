/**
 * [INPUT]: 正式场景文件、链式阶段、--skip-build、--only 与 --output。
 * [OUTPUT]: 每次执行的真实断言、日志路径与全量汇总；失败退出 1。
 * [POS]: full.sh 的锁内执行器。排除 probe-* 诊断与 starter 伴随脚本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const args = JSON.parse(process.env.OPENSIDIAN_FULL_ARGS || '[]');
const outputIndex = args.indexOf('--output');
const output = outputIndex < 0 ? fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-full-')) : path.resolve(args[outputIndex + 1]);
fs.mkdirSync(output, { recursive: true });
console.log('全量验收输出：' + output);
if (!args.includes('--skip-build')) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: repository, encoding: 'utf8', timeout: 300000 });
  fs.writeFileSync(path.join(output, 'build.log'), (build.stdout || '') + (build.stderr || ''));
  if (build.status !== 0) { console.error('构建失败：' + path.join(output, 'build.log')); process.exit(1); }
}
const onlyIndex = args.indexOf('--only');
const selected = onlyIndex < 0 ? null : new Set(args[onlyIndex + 1].split(','));
if (selected?.has('settings-restart')) selected.add('settings-write');
if (selected?.has('graph-persist-read')) selected.add('graph-persist-write');
const names = fs.readdirSync(directory).filter(name => name.endsWith('.js') && !name.startsWith('probe-') && !name.endsWith('.starter.js')).map(name => name.slice(0, -3)).filter(name => !selected || selected.has(name)).sort();
if (!names.length) throw new Error('--only 没有匹配正式场景');
if (selected) for (const name of selected) if (!names.includes(name)) throw new Error('未知场景：' + name);
const chainedReaders = new Set(['settings-restart', 'graph-persist-read']);
const records = [];
function execute(scenario, options = []) {
  const command = ['scripts/acceptance/run.mjs', scenario, ...options, '--no-screenshot'];
  const result = spawnSync(process.execPath, command, { cwd: repository, encoding: 'utf8', timeout: 360000 });
  const label = scenario + (options.length ? '-' + options.filter(value => !value.startsWith('--') && !value.includes('/')).join('-') : '');
  const file = path.join(output, String(records.length + 1).padStart(3, '0') + '-' + label + '.log');
  const raw = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(file, raw);
  const objects = (result.stdout || '').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const receipt = objects.findLast(value => typeof value.pass === 'boolean' && Array.isArray(value.checks));
  const pass = result.status === 0 && receipt?.pass === true && receipt.count === receipt.checks.length;
  const record = { scenario, options, command: process.execPath + ' ' + command.join(' '), pass, count: receipt?.count ?? 0, checks: receipt?.checks || [], vault: receipt?.vault || objects[0]?.vault, logfile: file, electronLog: receipt?.logfile, error: result.error?.message || (!receipt ? '缺少规范回执' : undefined) };
  records.push(record);
  console.log((pass ? 'PASS ' : 'FAIL ') + label + '：' + record.count + ' 项；' + file);
  fs.writeFileSync(path.join(output, 'runs.json'), JSON.stringify(records, null, 2));
  return record;
}
for (const name of names) {
  if (chainedReaders.has(name)) continue;
  const options = name === 'vault-switcher' ? ['--seed-vaults', '3'] : name === 'graph-perf' ? ['--nodes', '1000'] : [];
  const run = execute(name, options);
  if (!run.pass) continue;
  const phases = name === 'notes' ? ['reload', 'daily-notes', 'templates', 'note-composer', 'zk-prefixer', 'template-picker', 'extract-heading', 'result'] : name === 'recovery' ? ['restart', 'history', 'layout', 'slides', 'slides-check'] : ['audio-recorder', 'core-ribbon', 'sidebar-shell'].includes(name) ? ['restart'] : [];
  for (const phase of phases) execute(name, ['--vault', run.vault, '--phase', phase]);
  if (name === 'sidebar-shell') { execute(name, ['--phase', 'switch']); execute(name, ['--screen', 'narrow']); }
  if (['quick-switcher', 'drag-drop', 'settings-window'].includes(name)) execute(name, ['--screen', 'dark']);
  if (name === 'view-header') execute(name, ['--screen', 'light']);
  if (name === 'graph') for (const screen of ['local', 'filter', 'menu']) execute(name, ['--screen', screen]);
  if (name === 'settings-write') execute('settings-restart', ['--vault', run.vault]);
  if (name === 'graph-persist-write') execute('graph-persist-read', ['--vault', run.vault]);
  if (name === 'graph-perf') for (const nodes of ['100', '5000']) execute(name, ['--nodes', nodes]);
  if (name === 'notes-settings') for (const tab of ['daily-notes', 'note-composer', 'zk-prefixer']) execute(name, ['--tab', tab]);
}
const summary = { pass: records.every(record => record.pass), scenarios: new Set(records.map(record => record.scenario)).size, runs: records.length, passed: records.filter(record => record.pass).length, failed: records.filter(record => !record.pass).length, count: records.reduce((sum, record) => sum + record.count, 0), output, records };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
const text = `${summary.pass ? 'PASS' : 'FAIL'} ${summary.scenarios} 场景 / ${summary.runs} 次执行 / ${summary.count} 项断言 / ${summary.failed} 次失败\n` + records.map(record => `${record.pass ? 'PASS' : 'FAIL'} ${record.scenario} ${record.options.join(' ')} ${record.count} ${record.logfile}`).join('\n') + '\n';
fs.writeFileSync(path.join(output, 'summary.txt'), text);
console.log(text.split('\n')[0]);
if (!summary.pass) process.exitCode = 1;
