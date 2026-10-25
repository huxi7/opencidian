/**
 * [INPUT]: 真实临时磁盘、主进程 CAS 与菜单模块；Electron IPC 和 Menu 替身。
 * [OUTPUT]: 输出 {pass,count,checks}，验证跨窗口写入与原生菜单资源释放。
 * [POS]: 主进程边界回归；不启动 Electron，不访问用户库或系统菜单。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-main-boundary-'));
const checks = [], check = (name, action) => { action(); checks.push(name); };
try {
  const handlers = new Map(), listeners = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, handler) => listeners.set(channel, handler) };
  let throwPopup = false;
  class Menu {
    constructor(items) { this.items = items; }
    static buildFromTemplate(items) { return new Menu(items); }
    popup() { if (throwPopup) throw Error('injected popup failure'); }
    closePopup() {}
    getMenuItemById(id) { const find = items => { for (const item of items) { if (item.id === id) return item; const child = Array.isArray(item.submenu) && find(item.submenu); if (child) return child; } }; return find(this.items); }
  }
  const sender = new EventEmitter(); sender.id = 1;
  const win = { webContents: { getZoomFactor: () => 1 } };
  globalThis.__opensidianMainElectron = { Menu, BrowserWindow: { fromWebContents: () => win } };
  const bundled = await build({ stdin: { contents: "export * from './src/main/vault-write.ts'; export * from './src/main/native-menu.ts';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', plugins: [{ name: 'electron-boundary', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'module.exports=globalThis.__opensidianMainElectron;', loader: 'js' }));
  } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const vault = path.join(temporary, 'vault'); fs.mkdirSync(vault);
  const file = path.join(vault, 'shared.md'); fs.writeFileSync(file, 'baseline');
  module.exports.registerVaultWriteIpc({ ipcMain, vaultPathForSender: () => vault });
  const write = request => handlers.get('vault-write-cas')({ sender }, request);
  const concurrent = await Promise.all(['draft A', 'draft B'].map(text => write({ path: 'shared.md', expected: 'baseline', text })));
  check('同原文并发CAS仅一个写入成功', () => assert.equal(concurrent.filter(result => result.ok).length, 1));
  check('失败窗口收到冲突且胜出草稿保留', () => { assert.equal(concurrent.filter(result => result.conflict).length, 1); assert.ok(['draft A', 'draft B'].includes(fs.readFileSync(file, 'utf8'))); });
  const saved = fs.readFileSync(file, 'utf8');
  const invalid = await write({ path: 'shared.md', expected: saved, text: 123 });
  check('坏类型写入请求拒绝且原文件不变', () => { assert.equal(invalid.ok, false); assert.equal(fs.readFileSync(file, 'utf8'), saved); });
  const outside = path.join(temporary, 'outside.md'); fs.writeFileSync(outside, 'outside retained');
  const escape = await write({ path: '../outside.md', expected: 'outside retained', text: 'bad' });
  check('库外路径拒绝且外部文件保留', () => { assert.equal(escape.ok, false); assert.equal(fs.readFileSync(outside, 'utf8'), 'outside retained'); });
  fs.symlinkSync(outside, path.join(vault, 'linked.md'));
  const linked = await write({ path: 'linked.md', expected: 'outside retained', text: 'bad' });
  check('符号链接库外目标同样拒绝', () => { assert.equal(linked.ok, false); assert.equal(fs.readFileSync(outside, 'utf8'), 'outside retained'); });
  const retry = await write({ path: 'shared.md', expected: saved, text: 'retry succeeds' });
  check('冲突和坏请求后写入队列可继续工作', () => { assert.equal(retry.ok, true); assert.equal(fs.readFileSync(file, 'utf8'), 'retry succeeds'); });
  check('CAS结算后不遗留临时文件', () => assert.deepEqual(fs.readdirSync(vault).sort(), ['linked.md', 'shared.md']));
  module.exports.registerNativeMenuIpc({ ipcMain, isE2E: false });
  const popup = payload => handlers.get('native-menu-popup')({ sender }, payload);
  const first = popup({ token: 1, items: [{ label: 'First' }] });
  check('菜单打开仅增加一个销毁监听', () => assert.equal(sender.listenerCount('destroyed'), 1));
  const second = popup({ token: 2, items: [{ label: 'Second' }] });
  const replaced = await first;
  check('替换菜单结算旧请求并释放旧监听', () => { assert.equal(replaced.selected, null); assert.equal(sender.listenerCount('destroyed'), 1); });
  listeners.get('native-menu-close')({ sender }, 1);
  check('旧token不能关闭当前菜单', () => assert.equal(sender.listenerCount('destroyed'), 1));
  listeners.get('native-menu-close')({ sender }, 2); await second;
  check('显式关闭菜单释放全部销毁监听', () => assert.equal(sender.listenerCount('destroyed'), 0));
  const destroyed = popup({ token: 3, items: [] }); sender.emit('destroyed'); await destroyed;
  check('发送方销毁时结算菜单请求并释放监听', () => assert.equal(sender.listenerCount('destroyed'), 0));
  throwPopup = true;
  const rejected = await popup({ token: 4, items: [{ label: 'Failure' }] });
  check('系统菜单弹出失败保留原因且不泄漏监听', () => { assert.equal(rejected.error, 'injected popup failure'); assert.equal(sender.listenerCount('destroyed'), 0); });
  const malformed = await popup({ token: 'invalid', items: [] });
  check('非法菜单token不会注册生命周期监听', () => { assert.equal(malformed.selected, null); assert.equal(sender.listenerCount('destroyed'), 0); });
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { delete globalThis.__opensidianMainElectron; fs.rmSync(temporary, { recursive: true, force: true }); }
