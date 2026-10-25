/**
 * [INPUT]: Node 临时磁盘、真实 Vault/FileManager 与隔离系统回收站替身。
 * [OUTPUT]: 输出 {pass,count,checks}，验证回收站、移动树与创建碰撞。
 * [POS]: 文件数据安全回归。系统回收站仅替换边界，不接触用户文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const repository = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-audit-storage-'));
const checks = [], check = (message, action) => { action(); checks.push(message); };
const reject = async (message, action) => { await assert.rejects(action); checks.push(message); };
let vault;
try {
  const outfile = path.join(temporary, 'storage.cjs');
  await build({ stdin: { contents: "export * from './src/renderer/core/vault.ts'; export * from './src/renderer/core/fileManager.ts';", resolveDir: repository },
    outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'isolate-unused-ui', setup(builder) {
      builder.onResolve({ filter: /(?:i18n|notices|modals|attachments-downloader|frontmatter-write)\.js$/ }, args => ({ path: args.path, namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export const t=()=>''; export const tt=(_k,f)=>f; export class Notice{} export class Modal{} export const confirmDialog=async()=>true; export const downloadAttachmentsForNote=()=>{}; export const processFrontMatter=()=>{};", loader: 'js' }));
    } }] });
  const module = { exports: {} };
  new Function('exports', 'require', 'module', fs.readFileSync(outfile, 'utf8'))(module.exports, createRequire(path.join(repository, 'package.json')), module);
  const { Vault, FileSystemAdapter, FileManager } = module.exports;
  const root = path.join(temporary, 'vault'), systemTrash = path.join(temporary, 'system-trash'); fs.mkdirSync(root); fs.mkdirSync(systemTrash);
  vault = new Vault(new FileSystemAdapter(root)); await vault.initialize();
  const deleted = [], app = { vault, settings: { appSettings: { promptDelete: false, trashOption: 'system' } },
    metadataCache: { onFileDelete: file => deleted.push(file.path) }, workspace: { trigger() {} } };
  const manager = new FileManager(app), disk = name => path.join(root, name);
  let systemCalls = 0;
  globalThis.__electronTrash = async absolute => { systemCalls++; fs.renameSync(absolute, path.join(systemTrash, path.basename(absolute))); return true; };
  const system = await vault.create('system.md', 'system retained'); await manager.deleteFile(system);
  check('system选项调用系统回收站一次', () => assert.equal(systemCalls, 1));
  check('系统回收站保留实际文件内容', () => assert.equal(fs.readFileSync(path.join(systemTrash, 'system.md'), 'utf8'), 'system retained'));
  check('成功回收后才移除树和通知删除', () => assert.ok(!vault.getFileByPath('system.md') && deleted.includes('system.md')));
  const folder = await vault.createFolder('SystemFolder'); await vault.create('SystemFolder/Child.md', 'folder retained'); await manager.deleteFile(folder);
  check('system文件夹也进入系统回收站', () => assert.equal(systemCalls, 2));
  check('系统回收站文件夹保留子文件', () => assert.equal(fs.readFileSync(path.join(systemTrash, 'SystemFolder/Child.md'), 'utf8'), 'folder retained'));
  check('文件夹回收清理所有子模型', () => assert.equal(vault.getFileByPath('SystemFolder/Child.md'), null));
  app.settings.appSettings.trashOption = 'local';
  const local = await vault.create('local.md', 'local retained'); await manager.deleteFile(local);
  check('local选项不调用系统回收站', () => assert.equal(systemCalls, 2));
  check('本地回收站保留真实内容', () => assert.equal(fs.readFileSync(disk('.trash/local.md'), 'utf8'), 'local retained'));
  check('本地回收不把隐藏文件加入模型', () => assert.ok(!vault.getFileByPath('local.md') && !vault.getFileByPath('.trash/local.md')));
  const duplicate = await vault.create('local.md', 'second retained'); await manager.deleteFile(duplicate, true);
  check('跳过确认仍遵守local策略且重名不覆盖', () => assert.equal(fs.readFileSync(disk('.trash/local 2.md'), 'utf8'), 'second retained'));
  check('第一次回收的同名内容保持不变', () => assert.equal(fs.readFileSync(disk('.trash/local.md'), 'utf8'), 'local retained'));
  const localFolder = await vault.createFolder('LocalFolder'); await vault.create('LocalFolder/Nested.md', 'nested retained'); await manager.deleteFile(localFolder);
  check('本地回收文件夹保留嵌套内容', () => assert.equal(fs.readFileSync(disk('.trash/LocalFolder/Nested.md'), 'utf8'), 'nested retained'));
  app.settings.appSettings.trashOption = 'system'; globalThis.__electronTrash = async () => false;
  const fallback = await vault.create('fallback.md', 'fallback retained'); await manager.deleteFile(fallback);
  check('系统回收失败安全降级本地回收站', () => assert.equal(fs.readFileSync(disk('.trash/fallback.md'), 'utf8'), 'fallback retained'));
  globalThis.__electronTrash = async () => { throw Error('system unavailable'); };
  const throwing = await vault.create('throwing.md', 'throw retained'); await manager.deleteFile(throwing);
  check('系统回收抛错也降级本地保留', () => assert.equal(fs.readFileSync(disk('.trash/throwing.md'), 'utf8'), 'throw retained'));
  const failed = await vault.create('failure.md', 'never delete'); const beforeDeleted = deleted.length;
  const originalRename = vault.adapter.rename; vault.adapter.rename = async () => { throw Error('injected local IO failure'); };
  await reject('系统及本地均失败时拒绝删除操作', () => manager.deleteFile(failed));
  check('回收失败保留磁盘文件与原模型', () => assert.ok(fs.readFileSync(disk('failure.md'), 'utf8') === 'never delete' && vault.getFileByPath('failure.md') === failed));
  check('回收失败不发删除完成通知', () => assert.equal(deleted.length, beforeDeleted)); vault.adapter.rename = originalRename;
  app.settings.appSettings.trashOption = 'none'; const permanent = await vault.create('permanent.md', 'explicit permanent'); await manager.deleteFile(permanent);
  check('仅none选项永久删除', () => assert.equal(fs.existsSync(disk('permanent.md')), false));
  await reject('拒绝删除库根目录', () => vault.delete(vault.getRoot(), true));
  check('库根目录仍保留且模型身份不变', () => assert.ok(fs.existsSync(root) && vault.getAbstractFileByPath('/') === vault.getRoot()));
  const a = await vault.createFolder('A'), b = await vault.createFolder('B');
  const moved = await vault.create('A/z.md', 'move'), first = await vault.create('B/a.md', 'sort');
  await vault.rename(moved, 'B/z.md');
  check('跨目录移动从旧父目录移除', () => assert.equal(a.children.includes(moved), false));
  check('跨目录移动向新父目录加入且身份不变', () => assert.ok(b.children.includes(moved) && vault.getFileByPath('B/z.md') === moved && moved.parent === b));
  check('移动后按名称排序且无重复', () => assert.deepEqual(b.children.map(file => file.name), ['a.md', 'z.md']));
  await vault.rename(moved, 'B/0.md');
  check('同目录重命名立即重新排序', () => assert.deepEqual(b.children, [moved, first]));
  const subtree = await vault.createFolder('A/Sub'); const child = await vault.create('A/Sub/Child.md', 'subtree');
  await vault.rename(subtree, 'B/Renamed');
  check('文件夹移动同时更新父目录结构', () => assert.ok(!a.children.includes(subtree) && b.children.includes(subtree) && subtree.parent === b));
  check('文件夹移动保留子身份并更新完整路径', () => assert.ok(subtree.children[0] === child && child.path === 'B/Renamed/Child.md' && child.parent === subtree));
  check('旧目录映射全部消失', () => assert.ok(!vault.getFolderByPath('A/Sub') && !vault.getFileByPath('A/Sub/Child.md')));
  await reject('拒绝把目录移动到自身子目录', () => vault.rename(subtree, 'B/Renamed/Nested'));
  check('拒绝后磁盘与模型均保持原样', () => assert.ok(fs.existsSync(disk('B/Renamed/Child.md')) && vault.getFolderByPath('B/Renamed') === subtree));
  fs.writeFileSync(disk('rename-target.md'), 'external rename target');
  await reject('移动拒绝未索引的磁盘同名目标', () => vault.rename(moved, 'rename-target.md'));
  check('移动碰撞保留目标及来源磁盘内容', () => assert.ok(fs.readFileSync(disk('rename-target.md'), 'utf8') === 'external rename target' && fs.readFileSync(disk('B/0.md'), 'utf8') === 'move'));
  check('移动失败保留来源模型与父子树', () => assert.ok(moved.path === 'B/0.md' && b.children.includes(moved) && vault.getFileByPath('B/0.md') === moved));
  const external = disk('external.md'); fs.writeFileSync(external, 'external original');
  await reject('创建文本拒绝未进入索引的磁盘同名文件', () => vault.create('external.md', 'overwrite'));
  check('创建碰撞保留既有磁盘内容与模型', () => assert.ok(fs.readFileSync(external, 'utf8') === 'external original' && !vault.getFileByPath('external.md')));
  fs.writeFileSync(disk('external.bin'), Buffer.from([1, 2, 3]));
  await reject('创建附件同样拒绝未索引磁盘碰撞', () => vault.createBinary('external.bin', Buffer.from([9])));
  check('附件碰撞不改变原始字节', () => assert.deepEqual(fs.readFileSync(disk('external.bin')), Buffer.from([1, 2, 3])));
  const simultaneous = await Promise.allSettled([vault.create('race.md', 'first'), vault.create('race.md', 'second')]);
  check('同名并发创建仅一个成功', () => assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1));
  const winner = simultaneous.find(result => result.status === 'fulfilled').value;
  check('创建胜出内容与唯一模型相符', () => assert.ok(vault.getFileByPath('race.md') === winner && ['first', 'second'].includes(fs.readFileSync(disk('race.md'), 'utf8')) && vault.getRoot().children.filter(file => file.path === 'race.md').length === 1));
  const binary = await vault.createBinary('stats.bin', Buffer.from([1, 2, 3, 4]));
  check('新附件立即具有实际文件stat', () => assert.ok(binary.stat.size === 4 && binary.stat.mtime > 0));
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} catch (error) { console.log(JSON.stringify({ pass: false, count: checks.length, checks, error: error.message })); process.exitCode = 1; }
finally { await vault?.stopWatch(); delete globalThis.__electronTrash; fs.rmSync(temporary, { recursive: true, force: true }); }
