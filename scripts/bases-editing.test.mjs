/**
 * [INPUT]: esbuild、Node 断言与 Bases 配置事务、属性转换模块。
 * [OUTPUT]: 输出 {pass,count,checks}，验证重排、歧义、并发写入及类型边界。
 * [POS]: Bases 编辑确定性单测。使用隔离内存 Vault，不读取真实库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-base-editing-'));
const checks = [], check = (message, action) => { action(); checks.push(message); };
try {
  const outfile = path.join(temporary, 'editing.cjs');
  await build({ stdin: { contents: `export * from './src/renderer/plugins-core/bases-edit-store.ts'; export * from './src/renderer/plugins-core/bases-edit-values.ts'; export * from './src/renderer/plugins-core/bases-edit-suggest.ts'; export * from './src/renderer/plugins-core/bases-model.ts'; export * from './src/renderer/plugins-core/bases-values.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [{ name: 'no-electron', setup(builder) { builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' })); builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'exports.ipcRenderer = {};', loader: 'js' })); } }] });
  const { BaseDocument, resolveBaseView, transactBaseDocument, parseBaseEditInput, baseValueToFrontmatter, BaseDate, BaseLink, readBaseFrontmatter, writeBaseProperty, baseWriteInfo, createContext, queryBase, collectBaseSuggestions, applyBaseSuggestion, basePropertyType, formatBaseEditValue } = createRequire(import.meta.url)(outfile);
  const yaml = createRequire(import.meta.url)(path.join(root, 'node_modules/js-yaml'));
  let source = 'future: {preserve: true}\nviews:\n  - type: table\n    name: Second\n  - type: table\n    name: First\n';
  const file = { path: 'Main.base' }, app = { vault: { read: async () => { await new Promise(resolve => setTimeout(resolve, 4)); return source; }, modify: async (_file, text) => { await new Promise(resolve => setTimeout(resolve, 3)); source = text; } } };
  const identity = { name: 'First' };
  await transactBaseDocument(app, file, current => { const { index } = resolveBaseView(current, identity); return current.patch(['views', index, 'limit'], 3); });
  check('视图外部重排后按名称修改原视图', () => assert.deepEqual(yaml.load(source).views.map(view => view.limit), [undefined, 3]));
  const work = [transactBaseDocument(app, file, current => current.patch(['properties'], { 'note.x': { displayName: 'X' } })), transactBaseDocument(app, file, current => current.patch(['filters'], 'true'))];
  await Promise.all(work);
  check('多控制器同文件事务保留各自更改', () => assert.deepEqual({ properties: yaml.load(source).properties, filters: yaml.load(source).filters }, { properties: { 'note.x': { displayName: 'X' } }, filters: 'true' }));
  check('配置写回保留未知键', () => assert.equal(yaml.load(source).future.preserve, true));
  check('已删除目标拒绝误写其它视图', () => assert.throws(() => resolveBaseView(new BaseDocument('views: [{name: Second, type: table}]'), identity), /重命名或删除/));
  check('重名目标拒绝任取第一项', () => assert.throws(() => resolveBaseView(new BaseDocument('views: [{name: First, type: table}, {name: First, type: list}]'), identity), /名称重复/));
  check('无效数组索引拒绝写回', () => assert.throws(() => new BaseDocument(source).patch(['views', -1, 'limit'], 4), /索引/));
  check('原型键拒绝写回', () => assert.throws(() => new BaseDocument(source).patch(['__proto__', 'polluted'], true), /禁止/));
  check('数字零保持数字', () => assert.equal(parseBaseEditInput('0', 'number'), 0));
  check('数字无穷拒绝写入', () => assert.throws(() => parseBaseEditInput('Infinity', 'number'), /数字/));
  check('空输入清除属性', () => assert.equal(parseBaseEditInput('', 'number'), null));
  check('YAML Date 在日期编辑器显示 ISO 日而非空输入', () => assert.equal(formatBaseEditValue({ value: new BaseDate('2024-02-29T00:00:00Z'), rawValue: new Date('2024-02-29T00:00:00Z'), type: 'date' }), '2024-02-29'));
  check('YAML Date 在日期时间编辑器保留秒', () => assert.equal(formatBaseEditValue({ value: new BaseDate('2024-02-29T12:34:56Z'), rawValue: new Date('2024-02-29T12:34:56Z'), type: 'datetime' }), '2024-02-29T12:34:56'));
  check('日期文本在日期编辑器不添加时间', () => assert.equal(formatBaseEditValue({ value: new BaseDate(new Date(2024, 1, 29), false), rawValue: '2024-02-29', type: 'date' }), '2024-02-29'));
  check('复选 false 保持布尔', () => assert.equal(parseBaseEditInput('false', 'checkbox'), false));
  check('无效复选输入拒绝', () => assert.throws(() => parseBaseEditInput('yes', 'checkbox'), /复选框/));
  check('闰日能编辑并保持日期', () => assert.equal(baseValueToFrontmatter(parseBaseEditInput('2024-02-29', 'date')), '2024-02-29'));
  check('无效日期拒绝自动滚到下个月', () => assert.throws(() => parseBaseEditInput('2025-02-29', 'date'), /有效日期/));
  check('多值编辑支持含逗号与链接的 JSON 列表', () => assert.deepEqual(parseBaseEditInput('["a,b", "[[Target]]"]', 'multitext'), ['a,b', '[[Target]]']));
  check('多值普通逗号输入去空项', () => assert.deepEqual(parseBaseEditInput('a, b,,c', 'multitext'), ['a', 'b', 'c']));
  check('链接组写为 wikilink 原文', () => assert.equal(baseValueToFrontmatter(new BaseLink('Target', 'Shown')), '[[Target|Shown]]'));
  check('日期组写为 ISO 日期文本', () => assert.equal(baseValueToFrontmatter(new BaseDate(new Date(2024, 1, 29), false)), '2024-02-29'));
  check('列表组递归转换链接和日期', () => assert.deepEqual(baseValueToFrontmatter([new BaseLink('X'), new BaseDate(new Date(2024, 0, 1), false)]), ['[[X]]', '2024-01-01']));
  check('复杂对象组拒绝假写入', () => assert.throws(() => baseValueToFrontmatter({ nested: true }), /不能写入/));
  check('非法 YAML 属性拒绝修复性覆盖', () => assert.throws(() => readBaseFrontmatter('---\nwrong: [\n---\nbody'), /unexpected/));
  check('缺结束分隔线拒绝', () => assert.throws(() => readBaseFrontmatter('---\nscore: 2\nbody'), /结束标记/));
  check('数组 frontmatter 拒绝', () => assert.throws(() => readBaseFrontmatter('---\n- a\n---\nbody'), /YAML 对象/));
  const note = { path: 'A.md', name: 'A.md', basename: 'A', extension: 'md', parent: { path: '/' }, stat: {} };
  let fm = { Status: 'open', other: 5 }, body = '# Keep';
  Object.assign(app.vault, { getFileByPath: p => p === note.path ? note : null, getFolderByPath: p => p === 'Next' || p === '/' ? { path: p } : null, read: async item => item === note ? '---\n' + yaml.dump(fm) + '---\n' + body : source });
  app.metadataCache = { getFileCache: () => ({ frontmatter: fm }) };
  app.fileManager = { processFrontMatter: async (_file, action) => { const fresh = { ...fm }; await action(fresh); fm = fresh; }, renameFile: async (item, p) => { item.path = p; item.parent = { path: 'Next' }; return true; } };
  const controller = { app, enabled: true, closed: false }, row = { file: note, context: createContext(app, note) };
  const info = baseWriteInfo(controller, row, 'note.status');
  await writeBaseProperty(controller, row, info, 'done');
  check('大小写属性编辑保留原键及其它字段', () => assert.deepEqual(fm, { Status: 'done', other: 5 }));
  await assert.rejects(writeBaseProperty(controller, row, info, 'stale'), /属性已变化/);
  check('过时属性编辑拒绝覆盖新数据', () => assert.equal(fm.Status, 'done'));
  const nextRow = { file: note, context: createContext(app, note) };
  await writeBaseProperty(controller, nextRow, baseWriteInfo(controller, nextRow, 'note.status'), null);
  check('空值编辑按原版移除键', () => assert.deepEqual(fm, { other: 5 }));
  check('公式保持真实只读', () => assert.equal(baseWriteInfo(controller, row, 'formula.calc').writable, false));
  check('文件 folder 是唯一可移动文件字段', () => assert.equal(baseWriteInfo(controller, row, 'file.folder').writable, true));
  await writeBaseProperty(controller, row, baseWriteInfo(controller, row, 'file.folder'), 'Next');
  check('文件夹分组调用真实文件移动', () => assert.equal(note.path, 'Next/A.md'));
  const notes = [0, 1, 2].map(index => ({ path: 'Cache' + index + '.md', name: 'Cache' + index + '.md', basename: 'Cache' + index, extension: 'md', parent: { path: '/' }, stat: {} }));
  const properties = new Map(notes.map((item, index) => [item.path, { score: index }]));
  const queryApp = { vault: { getMarkdownFiles: () => notes }, metadataCache: { getFileCache: item => ({ frontmatter: properties.get(item.path) }) } };
  const document = new BaseDocument('filters: score >= 0\nviews: [{name: Cache, type: table, order: [file.name, note.score]}]'), cache = { dirty: new Set() };
  const initial = queryBase(queryApp, document, document.getView(), null, cache);
  check('首次查询对真实文件列表完整求值', () => assert.deepEqual([initial.rows.length, cache.evaluated], [3, 3]));
  const rowBefore = initial.rows[1]; queryBase(queryApp, document, document.getView(), null, cache);
  check('未变化行重绘复用上下文且不重算筛选', () => assert.equal(cache.evaluated, 0));
  properties.set(notes[0].path, { score: -2 }); cache.dirty.add(notes[0].path);
  const incremental = queryBase(queryApp, document, document.getView(), null, cache);
  check('单文件属性变化仅重算该行', () => assert.deepEqual([incremental.rows.length, cache.evaluated], [2, 1]));
  check('增量查询保留其它行上下文对象', () => assert.ok(incremental.rows.includes(rowBefore)));
  const dependency = new BaseDocument('filters: score >= 0\nformulas: {clock: "now()"}\nviews: [{name: Cache, type: table}]');
  queryBase(queryApp, dependency, dependency.getView(), null, cache); cache.dirty.add(notes[0].path); queryBase(queryApp, dependency, dependency.getView(), null, cache);
  check('跨文件和时钟公式发生文件变化时全量失效', () => assert.equal(cache.evaluated, 3));
  const beforeConcurrent = source;
  await assert.rejects(transactBaseDocument(app, file, async current => { source = current.source + '\nexternal: true\n'; return current.patch(['filters'], 'false'); }), /外部修改/);
  check('事务等待期间外部修改拒绝覆盖', () => assert.equal(yaml.load(source).external, true));
  await transactBaseDocument(app, file, current => current.patch(['filters'], 'true'));
  check('失败事务不会毒化后续写入队列', () => assert.equal(yaml.load(source).filters, 'true'));
  const firstView = { name: 'Other' };
  await transactBaseDocument(app, file, current => current.patch(['views'], [...current.data.views, { type: 'table', name: 'Third' }]));
  await transactBaseDocument(app, file, current => current.patch(['views'], [...current.data.views].reverse()));
  check('最新数组新增与重排保留其它视图', () => assert.deepEqual(yaml.load(source).views.map(view => view.name), ['Third', 'First', 'Second']));
  await transactBaseDocument(app, file, current => current.patch(['views'], current.data.views.filter(view => view.name !== 'First')));
  check('删除目标后名称定位拒绝错写', () => assert.throws(() => resolveBaseView(new BaseDocument(source), identity), /重命名或删除/));
  const suggestNotes = [
    { path: 'One.md', basename: 'One', extension: 'md', name: 'One.md' },
    { path: 'Folder/Two.md', basename: 'Two', extension: 'md', name: 'Two.md' },
  ];
  const suggestionApp = { vault: { getFiles: () => suggestNotes, getMarkdownFiles: () => suggestNotes, getRoot: () => ({ path: '/', children: [{ path: 'Folder', children: [] }] }) }, metadataCache: { getFileCache: item => ({ frontmatter: item === suggestNotes[0] ? { Status: 'open', items: ['a', 'b'], aliases: ['First'] } : { Status: 'done', items: ['b', 'c'] } }), getTags: () => ({ '#project': 2, '#private': 1 }) } };
  check('文本候选忽略属性键大小写并按输入过滤', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'status', type: 'text' }, 'op').map(item => item.value), ['open']));
  check('列表候选去重且排除已选项', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'items', type: 'multitext' }, '["a"]').map(item => item.value), ['b', 'c']));
  check('标签候选来源于真实标签索引', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'tags', type: 'tags' }, '#proj').map(item => item.value), ['project']));
  check('链接候选包含真实文件路径与别名', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'related', type: 'text' }, '[[Fir').map(item => item.value), ['[[One|First]]']));
  suggestionApp.vault.getFileByPath = p => suggestNotes.find(item => item.path === p);
  suggestionApp.metadataCache.getFirstLinkpathDest = () => suggestNotes[0];
  const getSuggestCache = suggestionApp.metadataCache.getFileCache;
  suggestionApp.metadataCache.getFileCache = item => ({ ...getSuggestCache(item), headings: [{ heading: 'Details', level: 2 }], blocks: { existing: { id: 'existing' } } });
  check('链接标题候选来自目标笔记实际标题', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'related', type: 'text' }, '[[One#Det').map(item => item.value), ['[[One#Details]]']));
  check('链接块候选只建议已有块ID', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'related', type: 'text' }, '[[One#^ex').map(item => item.value), ['[[One#^existing]]']));
  check('文件夹候选只来自现有文件夹', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { folder: true, property: 'file.folder' }, 'Fol').map(item => item.value), ['Folder']));
  check('日期与数字不提供错误字符串候选', () => assert.deepEqual(collectBaseSuggestions(suggestionApp, { name: 'status', type: 'number' }, ''), []));
  check('列表候选选择追加到已有列表', () => assert.equal(applyBaseSuggestion({ type: 'multitext' }, '["a"]', { value: 'c' }), '["a","c"]'));
  check('文本候选选择替换输入', () => assert.equal(applyBaseSuggestion({ type: 'text' }, 'op', { value: 'open' }), 'open'));
  check('库级显式属性类型优先于数值猜测', () => assert.equal(basePropertyType({ metadataTypeManager: { getTypeInfo: () => ({ expected: { type: 'multitext' } }) } }, 'status', 7), 'multitext'));
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
