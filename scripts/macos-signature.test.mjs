/**
 * [INPUT]: macOS 签名门禁、平台打包配置和系统 codesign。
 * [OUTPUT]: 无效签名、正确封存、身份不符与资源篡改的回归回执。
 * [POS]: 用隔离微型应用验证真实签名；其他平台只检查发布契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import verify from './verify-macos-signature.cjs';

const checks = [];
const test = async (label, fn) => { await fn(); checks.push(label); };
const config = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8'));
await test('无证书构建仍显式封存 macOS 应用', () => {
  assert.equal(config.mac.identity, '-');
  assert.equal(config.mac.hardenedRuntime, false);
  assert.equal(config.afterSign, 'scripts/verify-macos-signature.cjs');
});
await test('macOS 只使用原生图标，其他平台使用透明图标', () => {
  assert.equal(config.mac.icon, 'build/OpenSidian.icon');
  assert.equal(config.win.icon, 'build/icon.ico');
  assert.equal(config.linux.icon, 'build/icon.png');
  assert.equal(fs.existsSync('build/icon.icns'), false);
});
await test('非 macOS 门禁不运行 codesign', () => verify({ electronPlatformName: 'win32' }));

if (process.platform === 'darwin') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-signature-test-'));
  const bundle = path.join(folder, 'OpenSidian.app');
  const contents = path.join(bundle, 'Contents');
  const resource = path.join(contents, 'Resources/seal.txt');
  const context = { electronPlatformName: 'darwin', appOutDir: folder, packager: { appInfo: { productFilename: 'OpenSidian', id: 'app.opensidian' } } };
  try {
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.dirname(resource));
    fs.copyFileSync('/usr/bin/true', path.join(contents, 'MacOS/OpenSidian'));
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenSidian</string><key>CFBundleIdentifier</key><string>app.opensidian</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
    fs.writeFileSync(resource, 'original\n');
    await test('真实 codesign 拒绝未重新封存的应用', () => assert.rejects(verify(context)));
    execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'app.opensidian', bundle], { stdio: 'pipe' });
    await test('真实 codesign 接受正确的 ad-hoc 资源封装', () => verify(context));
    await test('有效签名仍须匹配应用身份', () => assert.rejects(verify({ ...context, packager: { appInfo: { productFilename: 'OpenSidian', id: 'wrong.identity' } } }), /签名身份/));
    fs.writeFileSync(resource, 'changed\n');
    await test('真实 codesign 拒绝签名后改动的资源', () => assert.rejects(verify(context)));
    fs.writeFileSync(resource, 'original\n');
    await test('恢复资源原始字节后重新通过', () => verify(context));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
