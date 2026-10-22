/**
 * [INPUT]: esbuild、Node 断言与 Bases CSV/查询模块。
 * [OUTPUT]: 输出 {pass,count,checks}，检查转义、富值与取消/失败写盘边界。
 * [POS]: CSV 的确定性单测。只写独立临时目录，不启动 Electron。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
process.env.TZ = 'UTC';
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-csv-unit-'));
try {
  const outfile = path.join(temporary, 'csv.cjs');
  await build({ stdin: { contents: `export * from './src/renderer/plugins-core/bases-csv.js'; export * from './src/renderer/plugins-core/bases-values.js';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [{ name: 'no-electron', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'exports.ipcRenderer = {};', loader: 'js' }));
  } }] });
  const require = createRequire(import.meta.url);
  const { serializeBaseCsv, saveBaseCsv, BaseDate } = require(outfile);
  const checks = [], check = (message, action) => { action(); checks.push(message); };
  const document = { data: { properties: { 'note.title': { displayName: 'Title, shown' } } } };
  const columns = ['note.title', 'note.count', 'note.done', 'note.empty', 'note.items', 'note.due'];
  const context = { note: { title: 'Hello,\n"world"', count: 0, done: false, empty: null, items: ['中', '文'], due: new BaseDate('2024-02-29T00:00:00Z', false) }, file: {}, formula: {} };
  const result = { rows: [{ context }], columns, warnings: [] };
  const csv = serializeBaseCsv(document, result);
  check('CSV 按原版 LF 和引号规则转义，保留零/假/空值/数组/日期', () => assert.equal(csv, '"Title, shown",count,done,empty,items,due\n"Hello,\n""world""",0,false,,"中, 文",2024-02-29'));
  check('CSV 没有 BOM 或额外尾换行', () => assert.equal(/^\uFEFF|\n$/.test(csv), false));
  check('空结果只导出表头', () => assert.equal(serializeBaseCsv(document, { ...result, rows: [] }), '"Title, shown",count,done,empty,items,due'));
  check('错误公式单元格留空，其它单元格继续导出', () => {
    const formula = Object.defineProperty({}, 'bad', { get() { throw Error('bad formula'); } });
    assert.equal(serializeBaseCsv(document, { rows: [{ context: { ...context, formula } }], columns: ['formula.bad', 'note.count'] }), 'formula.bad,count\n,0');
  });
  check('查询降级警告拒绝生成假 CSV', () => assert.throws(() => serializeBaseCsv(document, { ...result, warnings: ['未知筛选'] }), /未知筛选/));
  const files = ['Alpha', 'Beta'].map((name, index) => ({ path: name + '.md', name: name + '.md', basename: name, extension: 'md', parent: { path: '/' }, stat: { size: index + 1, ctime: 0, mtime: 0 } }));
  const sourceFile = { path: 'Data.base' };
  let source = 'views:\n  - type: table\n    name: Main\n    order: [file.name, note.score]\n    sort: [{property: note.score, direction: DESC}]\n    limit: 1\n';
  const app = { vault: { read: async () => source, getMarkdownFiles: () => files, getFileByPath: p => files.find(file => file.path === p) || null }, metadataCache: { getFileCache: file => ({ frontmatter: { score: file.basename === 'Beta' ? 9 : 2 } }), resolvedLinks: {} } };
  const controller = { app, file: sourceFile, sourceFile, enabled: true, closed: false, viewName: 'Main', view: { name: 'Main' } };
  let promptOptions;
  controller.promptCsvSavePath = options => { promptOptions = options; return { canceled: true }; };
  const canceled = await saveBaseCsv(controller);
  check('取消保存不写任何 CSV', () => assert.deepEqual({ canceled, files: fs.readdirSync(temporary).filter(name => name.endsWith('.csv')) }, { canceled: null, files: [] }));
  check('默认文件名采用视图名', () => assert.equal(promptOptions.defaultPath, 'Main.csv'));
  const target = path.join(temporary, 'Actual.csv');
  controller.promptCsvSavePath = () => ({ canceled: false, filePath: target });
  const saved = await saveBaseCsv(controller);
  check('保存应用真实排序和 limit', () => assert.deepEqual({ rows: saved.rows, text: fs.readFileSync(target, 'utf8') }, { rows: 1, text: 'file.name,score\nBeta,9' }));
  source = source.replace('direction: DESC', 'direction: ASC');
  await saveBaseCsv(controller);
  check('保存重读磁盘，不用控制器旧结果', () => assert.equal(fs.readFileSync(target, 'utf8'), 'file.name,score\nAlpha,2'));
  source = source.replace('type: table', 'type: future');
  const rejected = path.join(temporary, 'Rejected.csv');
  await assert.rejects(saveBaseCsv(controller, { filePath: rejected }), /尚不支持的视图类型/);
  check('未知视图失败不写占位文件', () => assert.ok(!fs.existsSync(rejected)));
  controller.closed = true;
  const closedResult = await saveBaseCsv(controller, { filePath: rejected });
  check('已关闭视图拒绝导出', () => assert.equal(closedResult, null));
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
