/**
 * [INPUT]: 主进程窗口图标策略与最终图标摘要。
 * [OUTPUT]: 默认、自定义、缺失、恢复及全部窗口更新的回归回执。
 * [POS]: 隔离 Electron 替身验证图标选择；像素与安装包由 Python 验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const checks = [];
const test = (label, fn) => { fn(); checks.push(label); };
const source = fs.readFileSync('src/main/main.ts', 'utf8');
const functions = source.slice(source.indexOf('function customIconPath()'), source.indexOf('const VAULTS')) +
  source.slice(source.indexOf('function frameWindowOptions()'), source.indexOf('function defaultWindowOptions'))
    .replace(': Electron.BrowserWindowConstructorOptions', '');
const updates = [];
const config = {};
const context = vm.createContext({ config, path, ASSETS_DIR: '/assets', IS_MAC: false,
  fs: { existsSync: file => file === '/custom.png' },
  BrowserWindow: { getAllWindows: () => ['vault', 'starter', 'settings', 'document'].map(name => ({ setIcon: icon => updates.push([name, icon]) })) },
  app: { dock: { setIcon: icon => updates.push(['dock', icon]) } },
});
vm.runInContext(functions, context);
for (const frame of ['hidden', 'custom', 'native']) test(`${frame} 窗口使用最终默认图标`, () => {
  config.frame = frame;
  assert.equal(vm.runInContext('frameWindowOptions().icon', context), path.join('/assets', 'app-icon.png'));
});
test('已有自定义图标优先', () => {
  config.customIcon = '/custom.png';
  assert.equal(vm.runInContext('frameWindowOptions().icon', context), '/custom.png');
});
test('缺失自定义文件回退最终默认图标', () => {
  config.customIcon = '/missing.png';
  assert.equal(vm.runInContext('frameWindowOptions().icon', context), path.join('/assets', 'app-icon.png'));
});
test('恢复默认图标同步全部窗口', () => {
  delete config.customIcon;
  vm.runInContext('applyAppIcon()', context);
  assert.equal(updates.length, 4);
  assert(updates.every(([, icon]) => icon === path.join('/assets', 'app-icon.png')));
});
test('macOS Dock 使用最终默认图标', () => {
  context.IS_MAC = true;
  vm.runInContext('applyAppIcon()', context);
  assert.deepEqual(updates.at(-1), ['dock', path.join('/assets', 'app-icon.png')]);
});
const manifest = JSON.parse(fs.readFileSync('build/icons.sha256.json', 'utf8'));
for (const [file, expected] of Object.entries(manifest)) test(`${file} 与批准摘要一致`, () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
