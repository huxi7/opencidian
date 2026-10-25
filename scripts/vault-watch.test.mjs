/**
 * [INPUT]: Node 临时磁盘、真实 Chokidar 与 Vault 初次扫描/监听生命周期。
 * [OUTPUT]: 输出 {pass,count,checks}，证明扫描空档新增、修改、删除和重复启停不会漏同步。
 * [POS]: 监听启动竞态的确定性回归。只读写独立临时目录，不启动 Electron。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-vault-watch-'));
const checks = [], check = (message, action) => { action(); checks.push(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (test, message) => { const end = Date.now() + 5000; while (!await test()) { if (Date.now() > end) throw Error(message); await delay(20); } };
let vault;
try {
  const outfile = path.join(temporary, 'vault.cjs');
  await build({ entryPoints: [path.join(root, 'src/renderer/core/vault.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const exports = {}, module = { exports };
  new Function('exports', 'require', 'module', fs.readFileSync(outfile, 'utf8'))(exports, createRequire(path.join(root, 'package.json')), module);
  const { Vault, FileSystemAdapter } = module.exports;
  const directory = path.join(temporary, 'vault'); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'Same.md'), '# same\n');
  fs.writeFileSync(path.join(directory, 'Changed.md'), '# before\n');
  fs.writeFileSync(path.join(directory, 'Deleted.md'), '# deleted\n');
  fs.mkdirSync(path.join(directory, 'DeletedFolder')); fs.writeFileSync(path.join(directory, 'DeletedFolder', 'Child.md'), '# child\n');
  vault = new Vault(new FileSystemAdapter(directory)); await vault.initialize();
  const same = vault.getFileByPath('Same.md'), changed = vault.getFileByPath('Changed.md'), created = [], modified = [], removed = [];
  vault.on('create', file => created.push(file.path)); vault.on('modify', file => modified.push(file.path)); vault.on('delete', file => removed.push(file.path));
  // 确定性扫描空档：这些磁盘动作全部发生在 initialize 已完成、watch 尚未调用时。
  fs.writeFileSync(path.join(directory, 'Gap.md'), '# gap\n');
  fs.mkdirSync(path.join(directory, 'GapFolder')); fs.writeFileSync(path.join(directory, 'GapFolder', 'Nested.md'), '# nested\n');
  fs.writeFileSync(path.join(directory, 'Changed.md'), '# changed before watcher startup\n');
  fs.unlinkSync(path.join(directory, 'Deleted.md')); fs.rmSync(path.join(directory, 'DeletedFolder'), { recursive: true });
  fs.mkdirSync(path.join(directory, '.hidden')); fs.writeFileSync(path.join(directory, '.hidden', 'Private.md'), '# hidden\n');
  const ready = vault.watch(), watcher = vault.watcher;
  check('watch返回可等待的就绪Promise', () => assert.equal(typeof ready.then, 'function'));
  check('重复watch复用同一监听实例与就绪Promise', () => assert.ok(vault.watch() === ready && vault.watcher === watcher));
  const readyValue = await ready; check('启动队列与磁盘对账完成后ready为true', () => assert.equal(readyValue, true));
  check('首次扫描后启动监听前新建文件不会漏掉', () => assert.ok(vault.getFileByPath('Gap.md') && created.includes('Gap.md')));
  check('空档新增目录与嵌套文件均进入真实树', () => assert.ok(vault.getFolderByPath('GapFolder')?.children.includes(vault.getFileByPath('GapFolder/Nested.md'))));
  check('空档删除文件从模型移除', () => assert.ok(!vault.getFileByPath('Deleted.md') && removed.includes('Deleted.md')));
  check('空档删除目录连同子文件移除', () => assert.ok(!vault.getFolderByPath('DeletedFolder') && !vault.getFileByPath('DeletedFolder/Child.md')));
  check('空档修改保持文件身份并发布modify', () => assert.ok(vault.getFileByPath('Changed.md') === changed && modified.includes('Changed.md')));
  check('空档修改刷新文件stat', () => assert.equal(changed.stat.size, Buffer.byteLength('# changed before watcher startup\n')));
  check('初始add不重建已扫描文件身份或重复create', () => assert.ok(vault.getFileByPath('Same.md') === same && !created.includes('Same.md')));
  check('初次补扫不暴露隐藏路径', () => assert.equal(vault.getAbstractFileByPath('.hidden/Private.md'), null));
  check('每个父目录不产生重复子项', () => { for (const folder of vault.all.values()) if (Array.isArray(folder.children)) assert.equal(new Set(folder.children).size, folder.children.length); });
  fs.writeFileSync(path.join(directory, 'Live.md'), '# live\n'); await until(() => vault.getFileByPath('Live.md'), '运行期新增未同步');
  check('ready后的新建文件正常同步', () => assert.ok(created.includes('Live.md')));
  fs.writeFileSync(path.join(directory, 'Same.md'), '# changed live\n'); await until(() => modified.includes('Same.md'), '运行期修改未同步');
  const liveText = await vault.read(same); check('ready后的修改正常同步内容与stat', () => assert.equal(liveText, '# changed live\n'));
  fs.unlinkSync(path.join(directory, 'Live.md')); await until(() => !vault.getFileByPath('Live.md'), '运行期删除未同步');
  check('ready后的删除正常同步', () => assert.ok(removed.includes('Live.md')));
  await vault.stopWatch();
  check('stopWatch等待底层close且释放当前实例', () => assert.ok(vault.watcher === null && watcher.closed));
  fs.writeFileSync(path.join(directory, 'Stopped.md'), '# stopped\n');
  fs.unlinkSync(path.join(directory, 'Gap.md')); fs.writeFileSync(path.join(directory, 'Changed.md'), '# changed while stopped\n');
  check('停止期间模型不会被旧回调修改', () => assert.equal(vault.getFileByPath('Stopped.md'), null));
  const restarted = vault.watch(); check('重启创建新的就绪Promise与监听实例', () => assert.ok(restarted !== ready && vault.watcher !== watcher)); await restarted;
  check('重启补齐停止期间新增、删除和修改', () => assert.ok(vault.getFileByPath('Stopped.md') && !vault.getFileByPath('Gap.md') && changed.stat.size === Buffer.byteLength('# changed while stopped\n')));
  const restarting = vault.watch(); await vault.stopWatch();
  const historicalReady = await restarting; check('对已就绪实例停止不会改变历史成功结果', () => assert.equal(historicalReady, true));
  const interrupted = vault.watch(); const stopping = vault.stopWatch();
  const canceled = await interrupted; check('启动期间停止会结算等待者而不挂起', () => assert.equal(canceled, false)); await stopping;
  const stoppedAgain = await vault.stopWatch(); check('连续重复stopWatch幂等', () => assert.equal(stoppedAgain, undefined));
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { await vault?.stopWatch(); fs.rmSync(temporary, { recursive: true, force: true }); }
