/**
 * [INPUT]: Node 的 test/assert/fs/path/url/vm；读取工作区源码，模拟 DOM、扩展名注册表、视图与 IPC。
 * [OUTPUT]: 提供可独立运行的工作区逻辑回归，不进入 renderer 依赖图。
 * [POS]: 固定叶子操作、后台可见项与查重数量、隔离布局、侧栏焦点与链接路径转换。
 * 只读源码，不启动 Electron，不读写仓库配置或真实笔记。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 执行：node --experimental-vm-modules src/renderer/core/workspace-regression.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const core = path.dirname(fileURLToPath(import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// 内存 DOM：只实现工作区使用的树、类名与事件能力。
// ---------------------------------------------------------------------------
class ElementStub {
  constructor(info = '') {
    this.classes = new Set();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.offsetWidth = 600;
    this.offsetHeight = 400;
    const cls = typeof info === 'string' ? info : info.cls || '';
    this.addClass(...cls.split(' ').filter(Boolean));
    this.textContent = typeof info === 'object' ? info.text || '' : '';
  }
  get isConnected() { return !!this.mounted || !!this.parentElement?.isConnected; }
  appendChild(child) {
    child.detach();
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
  prepend(child) {
    child.detach();
    this.children.unshift(child);
    child.parentElement = this;
    return child;
  }
  insertBefore(child, ref) {
    if (child === ref) return child;
    child.detach();
    const index = this.children.indexOf(ref);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentElement = this;
    return child;
  }
  detach() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  empty() { for (const child of [...this.children]) child.detach(); this.textContent = ''; }
  createDiv(info) { return this.appendChild(new ElementStub(info)); }
  createEl(tag, info) { return this.createDiv(info); }
  createSpan(info) { return this.createDiv(info); }
  addClass(...names) { names.forEach((name) => this.classes.add(name)); }
  removeClass(...names) { names.forEach((name) => this.classes.delete(name)); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, value = !this.hasClass(name)) {
    if (value) this.addClass(name); else this.removeClass(name);
  }
  toggle(show) { this.style.display = show ? '' : 'none'; }
  setText(text) { this.textContent = text; }
  setAttr(name, value) { this.attributes[name] = value; }
  getAttr(name) { return this.attributes[name]; }
  matches(selector) {
    return selector.split(',').some((part) =>
      part.trim().split('.').filter(Boolean).every((name) => this.hasClass(name)));
  }
  findAll(selector) {
    return this.children.flatMap((child) =>
      [...(child.matches(selector) ? [child] : []), ...child.findAll(selector)]);
  }
  querySelector(selector) { return this.findAll(selector)[0] || null; }
  closest(selector) {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  addEventListener(name, callback) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
  }
  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((fn) => fn !== callback));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 };
  }
  async emit(name, extra = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    if (this['on' + name]) await this['on' + name](event);
    for (const callback of this.listeners.get(name) || []) await callback(event);
  }
}

class MenuStub {
  constructor(app) { this.app = app; this.items = []; }
  addItem(callback) {
    const item = { onClick(fn) { this.callback = fn; return this; } };
    for (const key of ['Title', 'Icon', 'Checked']) {
      item['set' + key] = function(value) { this[key.toLowerCase()] = value; return this; };
    }
    callback(item);
    this.items.push(item);
  }
  addSeparator() {}
  showAtMouseEvent() { this.app.menu = this; }
}

// ---------------------------------------------------------------------------
// 模块加载：实际载入工作区与 Events；外部渲染依赖使用内存替身。
// ---------------------------------------------------------------------------
async function harness(settings = {}) {
  const notices = [], lifecycle = [], errors = [], lookups = [], modules = new Map();
  class DocumentStub {}
  const documentStub = {
    body: new ElementStub(),
    hasFocus: () => true,
    createElement: () => new ElementStub(),
    createElementNS: () => new ElementStub(),
    createTextNode: (text) => ({ textContent: text }),
  };
  const context = createContext({
    console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    createDiv: (info) => new ElementStub(info),
    navigator: { platform: 'MacIntel' },
    Element: ElementStub,
    Document: DocumentStub,
    document: documentStub,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    window: new ElementStub(),
    requestAnimationFrame: () => 1,
    ResizeObserver: class {
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const mocks = {
    'i18n.js': { t: (key) => key, tt: (key, fallback) => fallback },
    'tab-animation.js': { animateTabIn() {}, animateTabOut() {} },
    'workspace-profile.js': { createVaultProfile: () => new ElementStub('workspace-sidedock-vault-profile') },
    'icons.js': { setIcon: (el, icon) => el.setAttr('data-icon', icon) },
    'notices.js': { Notice: class { constructor(text) { notices.push(text); } } },
    'menu.js': { Menu: MenuStub },
    'ipc.js': { Desktop: { setTitle() {} }, ipcOn() {} },
    // vault.js 需要 Node require（fs/chokidar），内存回归只用到路径归一化与 TFolder 身份
    'vault.js': {
      TFolder: class TFolder { isRoot() { return false; } },
      normalizePath: (value) => {
        if (!value) return '/';
        const parts = [];
        for (const part of String(value).replace(/\\/g, '/').split('/')) {
          if (!part || part === '.') continue;
          if (part === '..') { parts.pop(); continue; }
          parts.push(part);
        }
        return parts.join('/');
      },
    },
  };
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const mock = mocks[path.basename(filename)];
    const module = mock
      ? new SyntheticModule(Object.keys(mock), function() {
          for (const [key, value] of Object.entries(mock)) this.setExport(key, value);
        }, { context, identifier: filename })
      : new SourceTextModule(readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    return module;
  }
  const entry = load(path.join(core, 'workspace.js'));
  await entry.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  await entry.evaluate();
  const api = entry.namespace;
  const files = new Map(['A.md', 'B.md', 'C.md', 'Board.canvas', 'Tasks.base', 'picture.png', 'clip.mp4', 'voice.mp3', 'paper.pdf']
    .map((name) => [name, { path: name, name, basename: name.split('.')[0], extension: name.split('.').pop() }]));
  const factories = new Map();
  for (const type of ['empty', 'markdown', 'graph', 'search', 'outline', 'canvas', 'bases', 'image', 'video', 'audio', 'pdf']) {
    factories.set(type, (leaf) => ({
      leaf, state: {}, _children: [() => lifecycle.push(['dispose', type])],
      getViewType() { return type; },
      getState() { return this.state; },
      getDisplayText() { return this.state.file || type; },
      getIcon() { return 'file'; },
      async load() { lifecycle.push(['load', type]); },
      async setState(state) { this.state = { ...state }; lifecycle.push(['state', type, this.state]); },
      onClose() { lifecycle.push(['close', type]); },
      async save() { lifecycle.push(['save', type]); },
      onResize() { lifecycle.push(['resize', type]); },
      onLayoutReady() { lifecycle.push(['ready', type]); },
      onFocus() { lifecycle.push(['focus', type]); },
      getEphemeralState() { return this.ephemeral || {}; },
      setEphemeralState(state) { this.ephemeral = state; },
    }));
  }
  const app = {
    settings: { appSettings: { focusNewTab: true, defaultViewMode: 'source', livePreview: true, ...settings }, config: {} },
    vault: {
      getFileByPath: (filePath) => { lookups.push(filePath); return files.get(filePath) || null; },
      getName: () => 'Test vault',
    },
    metadataCache: { getFirstLinkpathDest: () => 'A.md' },
    viewRegistry: {
      getViewCreator: (type) => factories.get(type),
      getTypeByExtension: (ext) => ext === 'canvas' ? 'canvas' : ext === 'base' && factories.has('bases') ? 'bases' : null,
    },
  };
  const workspace = new api.Workspace(app);
  app.workspace = workspace;
  const container = new ElementStub();
  container.mounted = true;
  workspace.mount(container);
  const leaf = workspace.getLeaf('tab');
  await leaf.setViewState({ type: 'empty' });
  workspace.setActiveLeaf(leaf, { focus: false });
  const file = (name) => files.get(name);
  return { api, modules, app, workspace, leaf, file, notices, lifecycle, errors, lookups };
}

// ---------------------------------------------------------------------------
// 接口与叶子操作。
// ---------------------------------------------------------------------------
test('保留六个导出、节点构造器身份与继承关系', async () => {
  const { api, modules, workspace } = await harness();
  assert.deepEqual(Object.keys(api).sort(), [
    'Workspace', 'WorkspaceItem', 'WorkspaceLeaf', 'WorkspaceSplit', 'WorkspaceTabs', 'parseSubpath',
  ]);
  const model = modules.get(path.join(core, 'workspace-model.js')).namespace;
  for (const name of ['WorkspaceItem', 'WorkspaceLeaf', 'WorkspaceSplit', 'WorkspaceTabs']) {
    assert.equal(api[name], model[name]);
  }
  assert.ok(workspace.rootSplit instanceof api.WorkspaceItem);
  assert.equal(api.parseSubpath('A#heading'), 'heading');
  assert.equal(api.parseSubpath('A'), '');
  assert.equal(api.parseSubpath(null), '');
});

test('getLeaf 复用、新建、插入与显式父标签组', async () => {
  const { workspace: ws, leaf: first, api } = await harness();
  assert.equal(ws.getLeaf(), first);
  assert.equal(ws.getLeaf(false), first);
  const last = ws.getLeaf(true);
  ws.setActiveLeaf(first, { focus: false });
  const middle = ws.getLeaf('tab');
  assert.deepEqual(Array.from(first.parent.children), [first, middle, last]);
  const sideTabs = new api.WorkspaceTabs(ws);
  ws.leftSplit.insertChild(0, sideTabs);
  const sideLeaf = ws.getLeaf('tab', sideTabs);
  ws.setActiveLeaf(sideLeaf, { focus: false });
  assert.equal(ws.getLeaf(false), first);
  assert.equal(ws.getLeaf('tab', first).parent, first.parent);
});

test('标签新建、标题点击与列表菜单保留宿主行为', async () => {
  const { workspace: ws, leaf: first, app } = await harness();
  const next = ws._onNewTab(first.parent);
  await Promise.resolve();
  assert.equal(next.view.getViewType(), 'empty');
  assert.equal(ws.activeLeaf, next);
  await first._tabHeaderEl.emit('click');
  assert.equal(ws.activeLeaf, first);
  ws._showTabListMenu({}, first.parent);
  await app.menu.items[1].callback();
  assert.equal(ws.activeLeaf, next);
});

test('openFile 普通打开复用叶子，模式与文件类型保持映射', async () => {
  const { workspace: ws, leaf, file, app } = await harness();
  assert.equal(await ws.openFile(file('A.md')), leaf);
  assert.deepEqual(plain(leaf.view.getState()), { file: 'A.md', mode: 'live' });
  const view = leaf.view;
  app.settings.appSettings.livePreview = false;
  await ws.openFile(file('B.md'));
  assert.equal(leaf.view, view);
  assert.equal(view.getState().mode, 'source');
  app.settings.appSettings.defaultViewMode = 'preview';
  await ws.openFile(file('C.md'));
  assert.equal(view.getState().mode, 'preview');
  for (const [name, type] of [['Board.canvas', 'canvas'], ['Tasks.base', 'bases'], ['picture.png', 'image'],
    ['clip.mp4', 'video'], ['voice.mp3', 'audio'], ['paper.pdf', 'pdf']]) {
    assert.equal(ws._getViewStateForFile(file(name)).type, type);
  }
  assert.equal(ws._getViewStateForFile({ extension: 'unknown' }).type, 'empty');
  app.viewRegistry.getTypeByExtension = () => null;
  assert.equal(ws._getViewStateForFile(file('Tasks.base')).type, 'empty');
});

test('新标签保留 focusNewTab、查重与 always 分支', async () => {
  const { workspace: ws, leaf, file, app } = await harness({ focusNewTab: false });
  await leaf.setViewState({ type: 'graph' });
  const note = await ws.openFile(file('A.md'), { newLeaf: true, eState: { line: 4 } });
  assert.notEqual(note, leaf);
  assert.equal(ws.activeLeaf, leaf);
  assert.equal(leaf.view.getViewType(), 'graph');
  assert.deepEqual(plain(note.view.getEphemeralState()), { line: 4 });
  assert.equal(leaf.parent.activeLeaf, leaf);
  const beforeCount = ws._leafMap.size;
  assert.equal(await ws.openFile(file('A.md'), { newLeaf: true }), note);
  assert.equal(ws.activeLeaf, leaf);
  assert.equal(leaf.parent.activeLeaf, leaf);
  assert.equal(ws._leafMap.size, beforeCount);
  app.settings.appSettings.focusNewTab = true;
  const duplicate = await ws.openFile(file('A.md'), { newLeaf: 'always' });
  assert.notEqual(duplicate, note);
  assert.equal(ws.activeLeaf, duplicate);
  assert.deepEqual(plain(ws.lastOpenFiles), ['A.md']);
});

test('左右/上下分割保持方向、顺序与父节点', async () => {
  const { workspace: ws, leaf, api } = await harness();
  const firstTabs = leaf.parent;
  const right = ws.createLeafBySplit(leaf, 'vertical');
  assert.equal(firstTabs.parent.direction, 'vertical');
  assert.deepEqual(Array.from(firstTabs.parent.children), [firstTabs, right.parent]);
  const left = ws.createLeafBySplit(leaf, 'vertical', true);
  assert.deepEqual(Array.from(firstTabs.parent.children), [left.parent, firstTabs, right.parent]);
  const below = ws.createLeafBySplit(leaf, 'horizontal');
  assert.equal(below.parent.parent.direction, 'horizontal');
  assert.ok(below.parent.parent instanceof api.WorkspaceSplit);
  assert.deepEqual(Array.from(below.parent.parent.children), [firstTabs, below.parent]);
  const splitLeaf = ws.getLeaf('split', right);
  assert.equal(splitLeaf.parent.parent, right.parent.parent);
});

test('布局重绘迁移视图根，不重开或关闭视图', async () => {
  const { workspace: ws, leaf, file, lifecycle } = await harness();
  await ws.openFile(file('A.md'));
  const root = leaf.view._rootEl;
  const view = leaf.view;
  const observer = leaf._resizeObserver;
  const before = lifecycle.filter(([event]) => event === 'load' || event === 'close').length;
  ws.createLeafBySplit(leaf, 'vertical');
  ws.render();
  assert.equal(leaf.view, view);
  assert.equal(leaf.view._rootEl, root);
  assert.equal(root.parentElement, leaf.contentEl);
  assert.equal(observer.disconnected, true);
  assert.equal(lifecycle.filter(([event]) => event === 'load' || event === 'close').length, before);
});

test('关闭叶子清理标签、观察器与索引，并保持中心空标签', async () => {
  const { workspace: ws, leaf, lifecycle } = await harness();
  const next = ws.getLeaf(true);
  await next.setViewState({ type: 'markdown', state: { file: 'A.md' } });
  ws.setActiveLeaf(next, { focus: false });
  const observer = next._resizeObserver;
  const count = lifecycle.filter(([event]) => event === 'close').length;
  next.detach();
  next.detach();
  assert.equal(lifecycle.filter(([event]) => event === 'close').length, count + 1);
  assert.equal(observer.disconnected, true);
  assert.equal(ws._leafMap.has(next.id), false);
  assert.equal(ws.activeLeaf, leaf);
  leaf.detach();
  await Promise.resolve();
  assert.equal(ws.centerSplit.children.length, 1);
  assert.equal(ws._firstLeafInCenter().view.getViewType(), 'empty');
});

// ---------------------------------------------------------------------------
// 链接回归：metadata 的返回值是路径，openFile 的参数是文件对象。
// ---------------------------------------------------------------------------
test('图谱新标签链接将路径解析为文件，并发布文件对象', async () => {
  const { workspace: ws, leaf, app, file, lookups } = await harness();
  await leaf.setViewState({ type: 'graph' });
  const calls = [], opened = [];
  app.metadataCache.getFirstLinkpathDest = (...args) => { calls.push(args); return 'A.md'; };
  ws.on('file-open', (value) => opened.push(value));
  const result = await ws.openLinkText('A', 'B.md', true);
  assert.equal(result, undefined);
  assert.deepEqual(calls, [['A', 'B.md']]);
  assert.ok(lookups.includes('A.md'));
  assert.equal(ws.getLeavesOfType('markdown').length, 1);
  assert.equal(ws.getLeavesOfType('markdown')[0].view.getState().file, 'A.md');
  assert.equal(leaf.view.getViewType(), 'graph');
  assert.deepEqual(opened, [file('A.md')]);
});

test('带锚点与同文件链接保留 subpath，普通打开复用标签', async () => {
  const { workspace: ws, leaf, app } = await harness();
  app.metadataCache.getFirstLinkpathDest = () => 'A.md';
  await ws.openLinkText('A#Heading', 'B.md', false);
  assert.equal(ws.activeLeaf, leaf);
  assert.equal(leaf.view.getState().file, 'A.md');
  assert.deepEqual(plain(leaf.getEphemeralState()), { subpath: 'Heading' });
  await ws.openLinkText('#^block', 'A.md');
  assert.deepEqual(plain(leaf.getEphemeralState()), { subpath: '^block' });
});

test('不存在或已删除的链接只提示，不新增空标签', async () => {
  const { workspace: ws, leaf, app, notices } = await harness();
  const before = ws._leafMap.size;
  app.metadataCache.getFirstLinkpathDest = () => null;
  await ws.openLinkText('Missing', '', true);
  app.metadataCache.getFirstLinkpathDest = () => 'deleted.md';
  await ws.openLinkText('Deleted', '', true);
  assert.equal(notices.length, 2);
  assert.equal(ws._leafMap.size, before);
  assert.equal(ws.activeLeaf, leaf);
});

test('链接新标签关闭自动聚焦时保留图谱活动叶子', async () => {
  const { workspace: ws, leaf } = await harness({ focusNewTab: false });
  await leaf.setViewState({ type: 'graph' });
  await ws.openLinkText('A', '', true);
  assert.equal(ws.activeLeaf, leaf);
  assert.equal(ws.getLeavesOfType('markdown').length, 1);
});

// ---------------------------------------------------------------------------
// 布局往返：恢复入口统一保存并关闭旧视图，拒绝失败后重建。
// ---------------------------------------------------------------------------
test('嵌套分栏与侧栏布局序列化/恢复往返一致', async () => {
  const { workspace: ws, leaf, file, errors } = await harness();
  await ws.openFile(file('A.md'));
  const right = ws.createLeafBySplit(leaf, 'vertical');
  await right.setViewState({ type: 'markdown', state: { file: 'B.md', mode: 'preview' } });
  await ws.ensureSideLeaf('search', 'left', { state: { query: 'needle' } });
  await ws.ensureSideLeaf('outline', 'right');
  ws.leftSplit.size = 260;
  ws.rightSplit.size = 330;
  ws.hideSidebar('left');
  ws.setActiveLeaf(right, { focus: false });
  const layout = plain(ws.getLayout());
  assert.deepEqual(Object.keys(layout).sort(), ['active', 'lastOpenFiles', 'left', 'leftActive',
    'leftCollapsed', 'leftWidth', 'main', 'right', 'rightCollapsed', 'rightWidth'].sort());
  const next = await harness();
  next.lifecycle.length = 0;
  const activeId = await next.workspace.loadLayout(layout);
  assert.equal(next.lifecycle.filter(([event]) => event === 'close').length, 1);
  await next.workspace.postLayoutLoad(activeId);
  assert.deepEqual(plain(next.workspace.getLayout()), layout);
  assert.equal(next.workspace.getActiveFile().path, 'B.md');
  assert.equal(next.workspace.getSidebarCollapsed('left'), true);
  assert.equal(next.workspace.getShownSidebarLeaves('right')[0].view.getViewType(), 'outline');
  const lastState = next.lifecycle.findLastIndex(([event]) => event === 'state');
  const firstReady = next.lifecycle.findIndex(([event]) => event === 'ready');
  assert.ok(firstReady > lastState);
  assert.deepEqual(errors, []);
  assert.deepEqual(next.errors, []);
});

test('布局恢复统一保存和关闭旧视图一次', async () => {
  const { workspace: ws, lifecycle } = await harness();
  const layout = plain(ws.getLayout()); lifecycle.length = 0;
  const active = await ws.loadLayout(layout); await ws.postLayoutLoad(active);
  assert.equal(lifecycle.filter(([event]) => event === 'save').length, 1);
  assert.equal(lifecycle.filter(([event]) => event === 'close').length, 1);
});

test('恢复保留 tab 索引边界与活动叶子兜底', async () => {
  const { workspace: ws } = await harness();
  const layout = plain(ws.getLayout());
  layout.main.children[0].currentTab = 50;
  layout.active = 'missing';
  await ws.loadLayout(layout);
  await ws.postLayoutLoad(layout.active);
  assert.equal(ws.activeLeaf, ws._firstLeafInCenter());
  assert.equal(ws.activeLeaf.parent.currentTab, 0);
  assert.equal(await ws.deserializeNode(null), null);
  assert.equal(await ws.deserializeNode({ type: 'unknown' }), null);
  assert.equal(await ws.loadLayout(null), false);
});

test('拖拽落点边界与标签内重排保持原行为', async () => {
  const { workspace: ws, leaf } = await harness();
  assert.deepEqual([[0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9], [0.5, 0.5]]
    .map(([x, y]) => ws._dropZone(x, y)), ['left', 'right', 'top', 'bottom', 'center']);
  const next = ws.getLeaf(true);
  await next.setViewState({ type: 'empty' });
  const bar = leaf.parent._headersInner;
  // 内存 DOM 没有完整 render；补上真实 DOM 中 bar 所属的 .workspace-tabs 容器语义。
  if (bar.parentElement) {
    bar.parentElement.addClass('workspace-tabs');
    bar.parentElement._tabs = leaf.parent;
  }
  ws._setupTabDrag(leaf._tabHeaderEl, leaf);
  ws._dragData = { leaf };
  ws._tabDropTarget = null;
  await bar.emit('drop');
  assert.equal(leaf.parent.children.length, 2);
  assert.equal(leaf.parent.children[0], next);
  assert.equal(leaf.parent.children[1], leaf);
  assert.equal(leaf.parent.currentTab, 1);
  assert.equal(ws._dragData, null);
});

test('侧栏保留最近中心文件，文件视图包含画布', async () => {
  const { workspace: ws, file, api } = await harness();
  await ws.openFile(file('A.md'));
  const tabs = new api.WorkspaceTabs(ws);
  ws.rightSplit.insertChild(0, tabs);
  const side = ws.createLeafInTabGroup(tabs);
  await side.setViewState({ type: 'outline' });
  ws.revealLeaf(side);
  assert.equal(ws.getActiveFile(), file('A.md'));
  await ws.openFile(file('Board.canvas'));
  assert.equal(ws.getActiveFile(), file('Board.canvas'));
});

test('侧栏工具不提供关闭、新建、拖动菜单，文档标签保持原交互', async () => {
  const { workspace: ws, api, app, leaf: documentLeaf } = await harness();
  const tabs = new api.WorkspaceTabs(ws);
  ws.leftSplit.insertChild(0, tabs);
  const side = ws.createLeafInTabGroup(tabs);
  await side.setViewState({ type: 'outline' });
  ws.render();
  assert.equal(ws.canCloseLeaf(side), false);
  assert.equal(side._tabHeaderEl.getAttr('draggable'), 'false');
  assert.equal(side._tabHeaderEl.querySelector('.workspace-tab-header-inner-close-button'), null);
  assert.equal(tabs._headersOuter.querySelector('.workspace-tab-header-new-tab'), null);
  assert.equal(ws._onNewTab(tabs), null);
  await side._tabHeaderEl.emit('auxclick', { button: 1 });
  assert.ok(ws._leafMap.has(side.id));
  ws._showTabContextMenu({}, side);
  assert.equal(app.menu, undefined);
  assert.ok(documentLeaf._tabHeaderEl.querySelector('.workspace-tab-header-inner-close-button'));
  assert.equal(ws.canCloseLeaf(documentLeaf), true);
});

test('侧栏有焦点时新文档仍在中心，底部库栏经过重绘保持同一节点', async () => {
  const { workspace: ws, api, file } = await harness();
  const tabs = new api.WorkspaceTabs(ws);
  ws.leftSplit.insertChild(0, tabs);
  const side = ws.createLeafInTabGroup(tabs);
  await side.setViewState({ type: 'outline' });
  ws.render();
  const profile = ws.vaultProfileEl;
  ws.setActiveLeaf(side);
  const next = ws.getLeaf('tab');
  assert.equal(ws._sideOf(next), 'center');
  const opened = await ws.openFile(file('A.md'), { newLeaf: true });
  assert.equal(ws._sideOf(opened), 'center');
  ws.hideSidebar('left');
  assert.equal(ws.vaultProfileEl, profile);
  ws.showSidebar('left');
  assert.equal(ws.vaultProfileEl, profile);
  assert.equal(profile.parentElement, ws.leftSplit.containerEl);
});


test('同步关闭明确拒绝时保留标签与所有资源', async () => {
  const { workspace: ws, leaf, lifecycle } = await harness(); const view = leaf.view, parent = leaf.parent;
  view.onClose = () => false; lifecycle.length = 0;
  assert.equal(leaf.detach(), false); assert.equal(leaf.parent, parent); assert.equal(leaf.view, view);
  assert.ok(ws._leafMap.has(leaf.id)); assert.equal(leaf._closed, false);
  assert.equal(lifecycle.filter(([event]) => event === 'dispose').length, 0);
});

test('异步关闭等待成功后撤DOM且重复关闭共用结果', async () => {
  const { workspace: ws, leaf } = await harness(); let done;
  leaf.view.onClose = () => new Promise(resolve => { done = resolve; });
  const pending = leaf.detach(); assert.equal(leaf.detach(), pending); assert.ok(leaf.parent && ws._leafMap.has(leaf.id));
  done(true); assert.equal(await pending, true); assert.equal(leaf.parent, null); assert.equal(ws._leafMap.has(leaf.id), false);
});

test('异步关闭失败和异常均保留未保存叶子', async () => {
  const { workspace: ws, leaf } = await harness(); const parent = leaf.parent;
  leaf.view.onClose = async () => false; assert.equal(await leaf.detach(), false); assert.equal(leaf.parent, parent);
  leaf.view.onClose = async () => { throw Error('save failure'); }; assert.equal(await leaf.detach(), false);
  assert.equal(leaf.parent, parent); assert.ok(ws._leafMap.has(leaf.id));
});

test('同类型setState失败不推进文件状态或发布file-open', async () => {
  const { workspace: ws, leaf, file } = await harness(); await ws.openFile(file('A.md'));
  const before = leaf.viewState, recent = [...ws.lastOpenFiles]; let opened = 0;
  ws.on('file-open', () => opened++); leaf.view.setState = async () => false;
  await ws.openFile(file('B.md')); assert.equal(leaf.viewState, before); assert.deepEqual([...ws.lastOpenFiles], recent); assert.equal(opened, 0);
});

test('异类型onClose失败不创建新视图或释放旧根', async () => {
  const { leaf, lifecycle } = await harness(); const view = leaf.view, root = view._rootEl;
  view.onClose = async () => false; lifecycle.length = 0;
  assert.equal(await leaf.setViewState({ type: 'markdown', state: { file: 'A.md' } }), false);
  assert.equal(leaf.view, view); assert.equal(view._rootEl, root); assert.equal(lifecycle.length, 0);
});

test('布局批量保存失败不关闭任何视图或清空树索引', async () => {
  const { workspace: ws, leaf, lifecycle, file } = await harness(); const extra = await ws.openFile(file('A.md'), { newLeaf: true });
  const before = plain(ws.getLayout()), count = ws._leafMap.size;
  extra.view.save = async () => false; lifecycle.length = 0;
  assert.equal(await ws.loadLayout(before), false); assert.deepEqual(plain(ws.getLayout()), before); assert.equal(ws._leafMap.size, count);
  assert.equal(lifecycle.filter(([event]) => event === 'close').length, 0); assert.ok(leaf.parent && extra.parent);
});

test('批量关闭后段拒绝时重建已关闭的干净视图', async () => {
  const { workspace: ws, leaf, file } = await harness(); const extra = await ws.openFile(file('A.md'), { newLeaf: true });
  const before = plain(ws.getLayout()), old = leaf.view; extra.view.onClose = async () => false;
  assert.equal(await ws.loadLayout(before), false); assert.deepEqual(plain(ws.getLayout()), before);
  assert.notEqual(leaf.view, old); assert.equal(leaf.view.getViewType(), 'empty'); assert.equal(extra.view.getState().file, 'A.md');
});


test('空对象和损坏子节点布局不保存关闭或污染当前索引', async () => {
  const { workspace: ws, leaf, lifecycle, file } = await harness(); await ws.openFile(file('A.md'));
  const view = leaf.view, root = view._rootEl, original = plain(ws.getLayout()), map = ws._leafMap;
  for (const malformed of [{}, { ...original, main: { ...original.main, children: { wrong: true } } }, { ...original, lastOpenFiles: 'not an array' }]) {
    lifecycle.length = 0; assert.equal(await ws.loadLayout(malformed), false);
    assert.equal(ws._leafMap, map); assert.deepEqual(plain(ws.getLayout()), original); assert.equal(leaf.view, view); assert.equal(view._rootEl, root);
    assert.equal(lifecycle.filter(([event]) => event === 'save' || event === 'close').length, 0);
  }
});

test('布局节点ID重复时在关闭旧视图前拒绝', async () => {
  const { workspace: ws, leaf, lifecycle } = await harness(); const layout = plain(ws.getLayout()), map = ws._leafMap;
  layout.left.id = layout.main.id; lifecycle.length = 0;
  assert.equal(await ws.loadLayout(layout), false); assert.equal(ws._leafMap, map); assert.ok(leaf.parent);
  assert.equal(lifecycle.filter(([event]) => event === 'close').length, 0);
});

test('隔离反序列化期间仍能访问原树，成功后保留堆叠与活动叶子', async () => {
  const { workspace: ws, leaf, file } = await harness(); await ws.openFile(file('A.md')); leaf.parent.setStacked(true);
  const layout = plain(ws.getLayout()), map = ws._leafMap, pending = ws.loadLayout(layout);
  assert.equal(ws._leafMap, map); assert.equal(ws._leafMap.get(leaf.id), leaf);
  const active = await pending; await ws.postLayoutLoad(active);
  assert.equal(ws.activeLeaf.id, layout.active); assert.ok(ws.activeLeaf.parent.isStacked);
  assert.notEqual(ws._leafMap, map); assert.notEqual(ws._leafMap.get(leaf.id), leaf); assert.equal(ws.activeLeaf.workspace, ws);
});


test('收起活动侧栏返回最近中心叶，重新展开不夺回焦点', async () => {
  const { workspace: ws, api, file, lifecycle } = await harness();
  await ws.openFile(file('A.md')); const center = ws.activeLeaf;
  center.view.editor = {};
  const tabs = new api.WorkspaceTabs(ws); ws.rightSplit.insertChild(0, tabs);
  const panel = ws.createLeafInTabGroup(tabs); await panel.setViewState({ type: 'outline' });
  ws.render(); ws.setActiveLeaf(center, { focus: false }); ws.setActiveLeaf(panel, { focus: false });
  assert.equal(ws.getActiveEditor(), null); lifecycle.length = 0;
  ws.hideSidebar('right');
  assert.equal(ws.activeLeaf, center); assert.equal(ws.getActiveEditor(), center.view);
  assert.ok(lifecycle.some(entry => entry[0] === 'focus' && entry[1] === 'markdown'));
  ws.showSidebar('right'); assert.equal(ws.activeLeaf, center);
});
