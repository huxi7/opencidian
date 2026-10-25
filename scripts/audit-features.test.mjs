/**
 * [INPUT]: esbuild、原版静态事实与 Bases 纯数据边界。
 * [OUTPUT]: 返回 {pass,count,checks}；验证默认视图、局部写回及排除缓存。
 * [POS]: 核心插件审计的 Node 回归。隔离输出到临时目录，不启动应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-audit-features-'));
const checks = [], check = (message, test) => { test(); checks.push(message); };
try {
  const outfile = path.join(temporary, 'model.cjs');
  await build({ stdin: { contents: `export * from './src/renderer/plugins-core/bases-model.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const { BaseDocument, queryBase } = createRequire(import.meta.url)(outfile);
  for (const source of ['', '# untouched\n', 'future: {token: keep}\n', '# untouched\nfuture: {token: keep}\nviews: []\n', '{future: {token: keep}, views: []}']) {
    const doc = new BaseDocument(source);
    check('合法空视图自动提供一个表格 ' + JSON.stringify(source), () => assert.equal(doc.getView().type, 'table'));
    check('默认视图只存在内存 ' + JSON.stringify(source), () => assert.equal(doc.source, source));
    const edited = doc.patch(['views', 0, 'limit'], 2);
    check('首次视图操作生成合法配置 ' + JSON.stringify(source), () => assert.equal(edited.getView().limit, 2));
    if (doc.data.future) check('首次操作保留未知值 ' + JSON.stringify(source), () => assert.deepEqual(edited.data.future, doc.data.future));
    if (source.startsWith('#')) check('首次操作保留独立注释', () => assert.ok(edited.source.startsWith('# untouched\n')));
  }
  const source = '# preserved\nfuture: {token: keep}\n';
  const filters = new BaseDocument(source).patch(['filters'], 'true');
  check('顶层筛选操作不会把内存默认视图写盘', () => assert.equal(filters.source.includes('views:'), false));
  check('新增筛选保持未知段原文', () => assert.ok(filters.source.startsWith(source)));
  for (const source of ['{vendor: {keep: 1}}', '{vendor: {keep: 1}, views: []}']) {
    for (const [key, value] of [['filters', 'true'], ['formulas', { test: '1' }]]) {
      const patched = new BaseDocument(source).patch([key], value);
      const raw = createRequire(import.meta.url)('js-yaml').load(patched.source);
      check('流式顶层 ' + key + ' 不写入合成默认视图 ' + source, () => assert.deepEqual(raw.views, source.includes('views:') ? [] : undefined));
      check('流式顶层 ' + key + ' 保留未知值 ' + source, () => assert.equal(raw.vendor.keep, 1));
    }
  }
  for (const prefix of ['# retained\n', '---\n# retained\n', '\uFEFF# retained\r\n---\r\n']) {
    const source = prefix + '{future: {token: keep}}';
    for (const [key, value] of [['filters', 'true'], ['views', [{ type: 'table', name: 'Edited' }]]]) {
      const patched = new BaseDocument(source).patch([key], value);
      check('前导注释和文档头流式写回保留前缀 ' + key + JSON.stringify(prefix), () => assert.ok(patched.source.startsWith(prefix)));
      check('前导注释和文档头流式写回保留未知值 ' + key + JSON.stringify(prefix), () => assert.equal(patched.data.future.token, 'keep'));
    }
  }
  for (const value of ['false', '0', 'text', '[]']) check('拒绝非对象而非伪装空数据库 ' + value, () => assert.throws(() => new BaseDocument(value), /YAML 对象/));
  const future = new BaseDocument('views:\n  - type: future\n    name: Future\n    custom: keep\n');
  check('未知视图不被默认表格替换', () => assert.equal(future.getView().type, 'future'));
  const files = ['Shown.md', 'Ignored.md'].map(name => ({ path: name, name, basename: name.slice(0, -3), extension: 'md', stat: {}, parent: { path: '/' } }));
  let ignored = false;
  const app = { vault: { getMarkdownFiles: () => files }, metadataCache: { getFileCache: () => ({}), isUserIgnored: name => ignored && name === 'Ignored.md' } };
  const doc = new BaseDocument(''), cache = { dirty: new Set() };
  check('普通查询可见全部候选', () => assert.equal(queryBase(app, doc, doc.getView(), null, cache).rows.length, 2));
  ignored = true;
  check('复用行缓存仍每次应用库级排除', () => assert.deepEqual(queryBase(app, doc, doc.getView(), null, cache).rows.map(row => row.file.path), ['Shown.md']));
  ignored = false;
  check('移除排除规则重新加入行', () => assert.equal(queryBase(app, doc, doc.getView(), null, cache).rows.length, 2));
  process.stdout.write(JSON.stringify({ pass: true, count: checks.length, checks }) + '\n');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
