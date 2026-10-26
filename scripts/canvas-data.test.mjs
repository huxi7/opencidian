/**
 * [INPUT]: Node assert、TypeScript 与画布 JSON 读取边界。
 * [OUTPUT]: {pass,count,checks}；覆盖兼容数据和坏数据拒绝。
 * [POS]: 验证外部数据不会接管保存基线，不启动 Electron。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseCanvasData } from '../src/renderer/views/canvas-data.ts';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

await check('空对象保持合法且不补写默认数组', () => assert.deepEqual(parseCanvasData('{}'), {}));
await check('缺省节点字段保持兼容', () => assert.deepEqual(parseCanvasData('{"nodes":[{}]}'), { nodes: [{}] }));
await check('空数组保持合法', () => assert.deepEqual(parseCanvasData('{"nodes":[],"edges":[]}'), { nodes: [], edges: [] }));
await check('节点与连线保留未知扩展字段', () => {
  const data = { extension: { version: 2 }, nodes: [{ id: 'a', x: 0, y: -2, custom: [1, { active: true }] }], edges: [{ id: 'e', custom: null }] };
  assert.deepEqual(parseCanvasData(JSON.stringify(data)), data);
});
await check('剪贴板中心与零坐标保持原值', () => {
  const data = { nodes: [{ x: 0, y: 0, width: 0, height: 0 }], center: { x: 0, y: -3 } };
  assert.deepEqual(parseCanvasData(JSON.stringify(data)), data);
});
await check('特殊扩展键不污染原型', () => {
  const data = parseCanvasData('{"__proto__":{"polluted":true},"nodes":[]}');
  assert.equal(Object.hasOwn(data, '__proto__'), true);
  assert.equal({}.polluted, undefined);
});
for (const [name, text] of [
  ['损坏 JSON', '{'], ['空文本', ''], ['null 根', 'null'], ['数组根', '[]'], ['字符串根', '"canvas"'],
  ['错类型节点数组', '{"nodes":{}}'], ['错类型连线数组', '{"edges":null}'],
  ['空节点对象', '{"nodes":[null]}'], ['数组节点', '{"nodes":[[]]}'],
  ['空连线对象', '{"edges":[null]}'], ['字符串连线', '{"edges":["edge"]}'],
  ['非有限坐标', '{"nodes":[{"x":1e309}]}'], ['非有限尺寸', '{"nodes":[{"height":-1e309}]}'],
  ['空中心', '{"center":null}'], ['缺失中心坐标', '{"center":{"x":0}}'],
  ['错类型中心', '{"center":{"x":"0","y":1}}'], ['非有限中心', '{"center":{"x":1e309,"y":0}}'],
]) {
  await check(`拒绝${name}`, () => assert.throws(() => parseCanvasData(text)));
}
for (const key of ['id', 'type', 'color', 'text', 'file', 'subpath', 'url', 'label', 'background', 'backgroundStyle']) {
  await check(`拒绝错类型节点 ${key}`, () => assert.throws(() => parseCanvasData(JSON.stringify({ nodes: [{ [key]: 12 }] }))));
}
for (const key of ['x', 'y', 'width', 'height']) {
  await check(`拒绝字符串几何 ${key}`, () => assert.throws(() => parseCanvasData(JSON.stringify({ nodes: [{ [key]: '12' }] }))));
}
for (const key of ['id', 'fromNode', 'toNode', 'fromSide', 'toSide', 'fromEnd', 'toEnd', 'label', 'color']) {
  await check(`拒绝错类型连线 ${key}`, () => assert.throws(() => parseCanvasData(JSON.stringify({ edges: [{ [key]: false }] }))));
}

function loadMethod(filename, className, methodName, globals = {}) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const method = declaration?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === methodName);
  assert.ok(method, `${className}.${methodName} 必须来自当前源码`);
  const javascript = ts.transpileModule(`class Subject { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(`${javascript}; Subject.prototype.${methodName}`, globals);
}

for (const cold of [true, false]) {
  await check(`${cold ? '冷开' : '切换'}坏白板不接管文件和保存基线`, async () => {
    const notices = [], missing = [];
    const method = loadMethod('src/renderer/views/canvas-view.ts', 'CanvasView', '_applyFileFromDisk', {
      parseCanvasData,
      Notice: class { constructor(message) { notices.push(message); } },
    });
    const previous = cold ? null : { path: 'source.canvas' };
    const host = {
      _loadSequence: 1, _closed: false, file: previous, _savedText: 'previous bytes',
      app: { vault: { getFileByPath: () => ({ path: 'broken.canvas', extension: 'canvas' }) } },
      renderMissingFile: (...args) => missing.push(args),
      setData: () => assert.fail('坏白板不可进入节点模型'),
      save: () => assert.fail('坏白板不可进入写盘'),
    };
    assert.equal(await method.call(host, 'broken.canvas', { text: '{"nodes":[{"x":"bad"}]}' }), false);
    assert.equal(host.file, previous);
    assert.equal(host._savedText, 'previous bytes');
    assert.equal(notices.length, 1);
    assert.equal(missing.length, cold ? 1 : 0);
  });
}

await check('块引用回退使用真实 lineCount 属性扫描正文', () => {
  const method = loadMethod('src/renderer/views/markdown-view.ts', 'MarkdownView', '_scrollEditorToSubpath');
  const scrolled = [], cursors = [], lines = ['one', 'target ^block-id', 'three'];
  const host = {
    file: { path: 'note.md' },
    app: { metadataCache: { getFileCache: () => null } },
    editor: { lineCount: lines.length, getLine: line => lines[line], scrollTo: (...args) => scrolled.push(args), setCursor: value => cursors.push(value) },
  };
  method.call(host, '#^block-id');
  assert.deepEqual(scrolled, [[1, 0]]);
  assert.equal(cursors[0].line, 1);
  assert.equal(cursors[0].ch, 0);
});

await check('幻灯片关闭按钮调用宿主销毁', () => {
  const elements = new Map();
  const createDiv = name => {
    const element = { createDiv, listeners: new Map(), setAttr() {}, focus() {}, addEventListener(type, callback) { this.listeners.set(type, callback); } };
    elements.set(name, element);
    return element;
  };
  const method = loadMethod('src/renderer/views/slides-presentation.ts', 'SlidesPresentation', '_buildDom', {
    document: { body: { createDiv }, addEventListener() {} }, setIcon() {},
  });
  let destroyed = 0;
  method.call({ destroy() { destroyed++; } });
  const click = elements.get('slides-close-btn').listeners.get('click');
  assert.equal(typeof click, 'function');
  click();
  assert.equal(destroyed, 1);
});

console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
