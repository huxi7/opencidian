/**
 * [INPUT]: Node 断言、真实尺寸分配模块、序列化模块与受控 DOM/窗口事件。
 * [OUTPUT]: 输出 {pass,count,checks}，验证侧栏目标、分配守恒、比例与监听释放。
 * [POS]: 工作区拖宽确定性单测。不启动 Electron，不访问真实库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-resize-'));
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, info = {}) { const event = { type, preventDefault() {}, stopPropagation() {}, ...info }; for (const fn of [...this.listeners.get(type) || []]) fn(event); }
  count() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}
class Element extends Target {
  constructor(width = 300, height = 500) { super(); this.style = {}; this.width = width; this.height = height; this.isConnected = true; this.classes = new Set(); this.ownerDocument = document; }
  getBoundingClientRect() { return { width: this.style.width ? parseFloat(this.style.width) : this.width, height: this.style.height ? parseFloat(this.style.height) : this.height }; }
  addClass(...names) { names.forEach(name => this.classes.add(name)); }
  removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
}
const window = new Target(); window.innerWidth = 1000;
const document = { defaultView: window }; document.body = new Element();
globalThis.__resizeCreate = () => new Element();
const checks = [], check = (message, action) => { action(); checks.push(message); };
try {
  const outfile = path.join(temporary, 'resize.cjs');
  await build({ stdin: { contents: `export * from './src/renderer/core/workspace-resize.ts'; export * from './src/renderer/core/workspace-serialize.ts'; export * from './src/renderer/core/workspace-model.ts';`, resolveDir: root }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'fake-dom', setup(builder) {
    builder.onResolve({ filter: /\/(?:dom|workspace-sidebar-transition|workspace-model)\.(?:js|ts)$/ }, args => ({ path: path.resolve(args.resolveDir, args.path).replace(/\.js$/, '.ts'), namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: /\/dom\.(?:js|ts)$/.test(args.path) ? 'export const createDiv=()=>globalThis.__resizeCreate();' : /\/workspace-model\.(?:js|ts)$/.test(args.path) ? 'export class WorkspaceLeaf {} export class WorkspaceTabs {} export class WorkspaceSplit {}' : 'export function settleSidebarTransitions(){}', loader: 'js' }));
  } }] });
  const { createWorkspaceResizeHandle: create, cancelWorkspaceResize: cancel, sidebarResizeTarget: target, computeWorkspaceResizeSizes: compute, serializeNode, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit } = createRequire(import.meta.url)(outfile);
  const left = { side: 'left', size: 300, containerEl: new Element(300) }, center = { side: 'center', containerEl: new Element(400) }, right = { side: 'right', size: 300, containerEl: new Element(300) };
  const parent = { children: [left, center, right] };
  let saves = 0;
  const workspace = { rootSplit: parent, leftSplit: left, rightSplit: right, centerSplit: center, containerEl: { clientWidth: 1000 }, _updateLeafSizes() {}, trigger() {}, app: { saveLayout() { saves++; } }, hideSidebar(side) { this[side + 'Split'].collapsed = true; }, showSidebar(side) { this[side + 'Split'].collapsed = false; } };
  check('根左边界识别真实左栏而非中心双栏', () => assert.equal(target(workspace, parent, 0, 'vertical').split, left));
  check('根右边界识别真实右栏', () => assert.equal(target(workspace, parent, 1, 'vertical').split, right));
  check('侧栏内部横向手柄不误判成宽度拖动', () => assert.equal(target(workspace, right, 0, 'horizontal'), null));
  check('中心分配保持总尺寸', () => assert.deepEqual(compute([300, 400], 0, 60), [360, 340]));
  check('最近项触底后继续向后分配', () => assert.deepEqual(compute([300, 220, 400], 0, 100), [400, 200, 320]));
  check('向前收缩与向后增长对称', () => assert.deepEqual(compute([400, 220, 300], 1, -100), [320, 200, 400]));
  check('越界拖动受200像素下限约束', () => assert.deepEqual(compute([300, 220], 0, 10000), [320, 200]));
  check('非有限坐标和非法索引不污染尺寸', () => { assert.deepEqual(compute([300, 400], 0, NaN), [300, 400]); assert.deepEqual(compute([300, 400], 0.5, 2), [300, 400]); });
  const mouse = (x, y = 20, button = 0) => ({ type: 'mousedown', clientX: x, clientY: y, button, buttons: button === 0 ? 1 : 2, preventDefault() {}, stopPropagation() {} });
  const handle = create(workspace, parent, 1, 'vertical');
  handle.onmousedown(mouse(700)); window.emit('mousemove', { clientX: 640, clientY: 20, buttons: 1 }); window.emit('mouseup');
  check('右栏拖宽只改自身尺寸', () => assert.deepEqual([left.size, right.size, center.containerEl.style.flex, center.size], [300, 360, undefined, undefined]));
  check('鼠标收尾释放监听和拖动态', () => assert.ok(window.count() === 0 && !document.body.classes.size && workspace._workspaceResizeSession === null));
  const before = right.size; handle.onmousedown(mouse(700, 20, 2)); window.emit('mousemove', { clientX: 500, buttons: 2 });
  check('右键不会启动尺寸拖动', () => assert.ok(right.size === before && window.count() === 0));
  handle.onmousedown(mouse(700)); window.emit('mousemove', { clientX: 680, buttons: 1 }); window.emit('blur'); const blurred = right.size; window.emit('mousemove', { clientX: 500, buttons: 1 });
  check('失焦后不再继续改尺寸', () => assert.ok(right.size === blurred && window.count() === 0));
  handle.onmousedown(mouse(700)); window.emit('mousemove', { clientX: 660, buttons: 1 }); cancel(workspace); const canceled = right.size; window.emit('mousemove', { clientX: 450, buttons: 1 });
  check('DOM重建取消入口释放全部监听', () => assert.ok(right.size === canceled && window.count() === 0 && !document.body.classes.size));
  handle.emit('pointerdown', { pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: 700, clientY: 20 });
  window.emit('pointermove', { pointerId: 7, clientX: 680, clientY: 20, buttons: 1 }); window.emit('mouseup');
  check('Pointer拖动也接受窗口mouseup兜底并清理', () => assert.ok(window.count() === 0 && !document.body.classes.size));
  handle.onmousedown(mouse(700)); const replacement = { size: 300 }; workspace.rightSplit = replacement; window.emit('mousemove', { clientX: 990, clientY: 20, buttons: 1 });
  check('布局更换侧栏模型后旧拖动不改变新侧栏', () => assert.ok(replacement.size === 300 && !replacement.collapsed && window.count() === 0)); workspace.rightSplit = right;
  const internal = { children: [{ containerEl: new Element(300, 400) }, { containerEl: new Element(300, 400) }] };
  const innerHandle = create(workspace, internal, 0, 'horizontal'); innerHandle.onmousedown(mouse(900, 400)); window.emit('mousemove', { clientX: 900, clientY: 450, buttons: 1 }); window.emit('mouseup');
  check('内部横向拆分只用clientY调整高度', () => assert.deepEqual(internal.children.map(child => child.dimension), [56.25, 43.75]));
  check('内部拖动结束清理临时像素并保留弹性比例', () => assert.ok(internal.children.every(child => child.containerEl.style.flex.endsWith(' 1 0%') && child.containerEl.style.height === '' && Number(child.containerEl.style.flexGrow) > 0)));
  const dimensionsBeforeZero = internal.children.map(child => child.dimension), stylesBeforeZero = internal.children.map(child => ({ ...child.containerEl.style }));
  innerHandle.onmousedown(mouse(900, 400)); window.emit('mousemove', { clientX: 900, clientY: 400, buttons: 1 }); window.emit('mouseup');
  check('零位移move和up不残留临时像素也不改原比例', () => { assert.deepEqual(internal.children.map(child => child.dimension), dimensionsBeforeZero); assert.deepEqual(internal.children.map(child => child.containerEl.style), stylesBeforeZero); });
  check('合法拖动完成请求布局保存', () => assert.ok(saves >= 3));
  const leaf = Object.assign(new WorkspaceLeaf(), { id: 'one', dimension: 30, view: { getViewType: () => 'empty', getState: () => ({}) } });
  const tabs = Object.assign(new WorkspaceTabs(), { id: 'tabs', dimension: 40, currentTab: 0, children: [leaf] });
  const split = Object.assign(new WorkspaceSplit(), { id: 'split', dimension: 60, direction: 'vertical', children: [tabs] });
  const serializeWorkspace = { serializeNode(node) { return serializeNode(this, node); } };
  const serialized = serializeWorkspace.serializeNode(split);
  check('三种节点均保存有限正数dimension', () => assert.deepEqual([serialized.dimension, serialized.children[0].dimension, serialized.children[0].children[0].dimension], [60, 40, 30]));
  for (const invalid of [NaN, Infinity, -1, 0]) { leaf.dimension = invalid; check('非法dimension不落入布局JSON：' + invalid, () => assert.equal('dimension' in serializeWorkspace.serializeNode(leaf), false)); }
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { delete globalThis.__resizeCreate; fs.rmSync(temporary, { recursive: true, force: true }); }
