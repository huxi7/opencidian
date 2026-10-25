/**
 * [INPUT]: Node 断言、esbuild 与 window-save 的 CAS 关闭前保存协议。
 * [OUTPUT]: 输出 {pass,count,checks}，覆盖竞争、恢复期间新输入、失败恢复与脏状态保护。
 * [POS]: 多窗口保存确定性测试。只用隔离内存文件与受控 IPC，不启动桌面应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-window-save-')), root = path.resolve(import.meta.dirname, '..');
try {
  const outfile = path.join(temporary, 'save.cjs');
  await build({ stdin: { contents: "export * from './src/renderer/core/window-save.ts'; export * from './src/renderer/core/window-save-conflict.ts';", resolveDir: root }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-desktop', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onResolve({ filter: /notices\.js$/ }, () => ({ path: 'notices', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'electron' ? 'exports.ipcRenderer={invoke:(...args)=>globalThis.__windowSaveInvoke(...args)};' : 'export class Notice { constructor(message){globalThis.__windowSaveNotices.push(message)} hide(){} }', loader: 'js' }));
  } }] });
  const { saveWindowView, hasUnsavedWindowView, flushWindowViews, reloadWindowViewFromDisk, saveWindowViewCopy } = createRequire(import.meta.url)(outfile);
  const checks = [], check = (message, action) => { action(); checks.push(message); }, files = new Map(), events = [];
  globalThis.__windowSaveNotices = [];
  const normalInvoke = async (channel, request) => { assert.equal(channel, 'vault-write-cas'); if (files.get(request.path) !== request.expected) return { ok: false, conflict: true }; files.set(request.path, request.text); return { ok: true }; };
  globalThis.__windowSaveInvoke = normalInvoke;
  const app = { vault: { read: async file => files.get(file.path), adapter: { stat: async () => ({ ctime: 1, mtime: 2, size: 3 }) }, trigger: (...args) => events.push(args) } };
  function markdown(name, loaded = 'original') { files.set(name, loaded); let value = loaded; const view = { app, file: { path: name }, _loadedText: loaded, getViewType: () => 'markdown', editor: { getValue: () => value, setValue: text => { value = text; } } }; view.save = () => saveWindowView(view); return view; }
  const first = markdown('normal.md'); first.editor.setValue('changed');
  check('本地编辑与已加载原文不同时判为dirty', () => assert.equal(hasUnsavedWindowView(first), true));
  check('正常保存返回成功', () => assert.equal(first.save instanceof Function, true)); await first.save();
  check('正常保存真实替换文件并更新基线', () => assert.deepEqual([files.get('normal.md'), first._loadedText, first._dirty], ['changed', 'changed', false]));
  check('保存成功后更新stat与modify事件', () => assert.deepEqual([first.file.stat.mtime, events.length, events[0][0]], [2, 1, 'modify']));
  const a = markdown('race.md'), b = markdown('race.md'); a.editor.setValue('draft A'); b.editor.setValue('draft B');
  const result = await Promise.all([a.save(), b.save()]);
  check('同原文双窗口保存恰好一个成功', () => assert.deepEqual(result.sort(), [false, true]));
  const loser = a._dirty ? a : b, winner = loser === a ? b : a;
  check('冲突不覆盖胜出窗口的数据', () => assert.equal(files.get('race.md'), winner.editor.getValue()));
  check('冲突保留未保存编辑和旧基线', () => assert.ok(loser._dirty && loser._loadedText === 'original' && loser.editor.getValue().startsWith('draft')));
  check('冲突提供可见提示及错误状态', () => assert.ok(loser._saveConflict && loser._saveError.includes('另一个窗口') && globalThis.__windowSaveNotices.length > 0));
  check('保存完成后清除writing标记', () => assert.equal(loser._writing, false));
  const identical = markdown('identical.md'); identical.editor.setValue('same content'); files.set('identical.md', 'same content');
  const identicalSaved = await identical.save();
  check('CAS冲突但磁盘已等于本地时采纳成功基线', () => assert.ok(identicalSaved && !identical._dirty && identical._loadedText === 'same content'));
  const stale = markdown('clean.md'); files.set('clean.md', 'external');
  check('干净但尚未回显的副本不误报保存失败', () => assert.equal(hasUnsavedWindowView(stale), false));
  const cleanSaved = await stale.save(); check('干净副本保存不覆盖新磁盘', () => assert.equal(cleanSaved, true));
  check('干净副本保持外部原文', () => assert.equal(files.get('clean.md'), 'external'));
  const retry = markdown('retry.md'); retry.editor.setValue('retry draft'); globalThis.__windowSaveInvoke = async () => ({ ok: false, error: 'injected write failure' });
  await retry.save();
  check('IO失败不清dirty且不提前更新加载基线', () => assert.ok(retry._dirty && retry._loadedText === 'original' && files.get('retry.md') === 'original'));
  globalThis.__windowSaveInvoke = normalInvoke; await retry.save();
  check('失败后同一队列能再次成功保存', () => assert.ok(!retry._dirty && files.get('retry.md') === 'retry draft'));
  const typing = markdown('typing.md'); typing.editor.setValue('snapshot');
  globalThis.__windowSaveInvoke = async (channel, request) => { typing.editor.setValue('newer input'); return normalInvoke(channel, request); };
  const typingSaved = await typing.save(); check('在途输入使旧快照保存返回未收敛', () => assert.equal(typingSaved, false));
  check('在途输入保留dirty及最新编辑', () => assert.deepEqual([typing._dirty, typing._loadedText, typing.editor.getValue()], [true, 'snapshot', 'newer input']));
  globalThis.__windowSaveInvoke = normalInvoke;
  const canvasRaw = '{"nodes":[],"edges":[],"vendor":true}', canvas = { app, file: { path: 'board.canvas' }, _savedText: canvasRaw, _savedDataText: JSON.stringify(JSON.parse(canvasRaw), null, '\t'), getViewType: () => 'canvas', data: JSON.parse(canvasRaw), getData() { return this.data; } };
  files.set(canvas.file.path, canvasRaw); canvas.save = () => saveWindowView(canvas);
  check('画布只因原始格式不同不判脏', () => assert.equal(hasUnsavedWindowView(canvas), false));
  canvas.data.nodes.push({ id: 'one', text: 'pending' }); await canvas.save();
  check('画布CAS用原始磁盘并保留未知键', () => assert.ok(JSON.parse(files.get(canvas.file.path)).vendor && canvas._savedText === canvas._savedDataText && !canvas._dirty));
  canvas.data.nodes[0].text = 'local conflict'; files.set(canvas.file.path, '{"nodes":[],"edges":[]}'); await canvas.save();
  check('画布冲突不丢节点或清dirty', () => assert.ok(canvas._dirty && canvas.data.nodes[0].text === 'local conflict' && JSON.parse(files.get(canvas.file.path)).nodes.length === 0));
  const leaves = [typing, stale].map(view => ({ view })); app.workspace = { getLeavesOfType: type => type === 'markdown' ? leaves : [] }; app.saveLayout = () => { throw Error('must not save layout'); };
  const flushed = await flushWindowViews(app); check('关闭前flush等待最后输入并且不写布局', () => assert.equal(flushed.ok, true));
  check('最后输入真正写盘', () => assert.equal(files.get('typing.md'), 'newer input'));
  app.workspace.getLeavesOfType = type => type === 'canvas' ? [{ view: canvas }] : [];
  const rejected = await flushWindowViews(app); check('画布冲突阻止窗口关闭并保留失败路径', () => assert.deepEqual(rejected.failures.map(item => item.path), ['board.canvas']));
  const deleted = markdown('deleted.md'); deleted._fileDeleted = true; deleted.editor.setValue('preserve');
  const deletedSaved = await deleted.save(); check('文件已删除时保存返回失败', () => assert.equal(deletedSaved, false));
  check('已删除文件的未保存内容保留', () => assert.ok(deleted._dirty && deleted.editor.getValue() === 'preserve'));
  const baseFlush = await flushWindowViews({ workspace: { getLeavesOfType: type => type === 'bases' ? [{ view: { file: { path: 'Draft.base' }, getViewType: () => 'bases', save: async () => false } }] : [] } });
  check('Bases新建浮层返回失败时阻止窗口关闭', () => assert.ok(!baseFlush.ok && baseFlush.failures[0].path === 'Draft.base'));
  const settingsFlush = await flushWindowViews({ isSettingsWindow: true }), initializingFlush = await flushWindowViews({});
  check('设置窗与初始化中窗口不写布局或误报未保存', () => assert.ok(settingsFlush.ok && initializingFlush.ok));
  const standardRead = app.vault.read;
  const reloading = markdown('reload.md'); reloading.editor.setValue('draft one'); reloading._dirty = true;
  let releaseRead; app.vault.read = () => new Promise(resolve => { releaseRead = resolve; });
  const pendingReload = reloadWindowViewFromDisk(reloading); reloading.editor.setValue('draft two'); releaseRead('disk');
  await assert.rejects(pendingReload, error => error.code === 'DRAFT_CHANGED');
  check('恢复读盘期间的新草稿不会被磁盘覆盖', () => assert.ok(reloading.editor.getValue() === 'draft two' && reloading._loadedText === 'original' && reloading._dirty));
  const changedFile = reloadWindowViewFromDisk(reloading); reloading.file = { path: 'other.md' }; reloading._loadedText = 'other baseline'; reloading.editor.setValue('other draft'); releaseRead('old disk');
  await assert.rejects(changedFile, error => error.code === 'DRAFT_CHANGED');
  check('恢复读盘期间切文件不会将旧文件内容写进新视图', () => assert.deepEqual([reloading.editor.getValue(), reloading._loadedText], ['other draft', 'other baseline']));
  const board = { app, file: { path: 'reload.canvas' }, _dirty: true, data: { nodes: [{ text: 'one' }], edges: [] }, getViewType: () => 'canvas', getData() { return this.data; }, _applyFileFromDisk: async () => { throw Error('must not apply stale snapshot'); } };
  const pendingBoard = reloadWindowViewFromDisk(board); board.data.nodes[0].text = 'two'; releaseRead('{"nodes":[],"edges":[]}');
  await assert.rejects(pendingBoard, error => error.code === 'DRAFT_CHANGED');
  check('画布恢复读盘期间的新节点编辑也保持dirty', () => assert.ok(board.data.nodes[0].text === 'two' && board._dirty));
  const copying = markdown('copy.md'); Object.assign(copying.file, { basename: 'copy', extension: 'md', parent: { path: '/' } }); copying.editor.setValue('copy version one'); copying._dirty = true;
  let openedCopy;
  app.fileManager = { createNewFile: async (_folder, name, text) => { files.set(name, text); return { path: name }; } };
  app.workspace = { openFile: async file => { openedCopy = file; } };
  let copyReadStarted;
  app.vault.read = () => new Promise(resolve => { releaseRead = resolve; copyReadStarted = true; });
  const pendingCopy = saveWindowViewCopy(copying); while (!copyReadStarted) await Promise.resolve();
  copying.editor.setValue('copy version two'); releaseRead('disk version'); const copyFile = await pendingCopy;
  check('副本后的恢复读盘竞态保留新输入并打开已保存副本', () => assert.ok(files.get(copyFile.path) === 'copy version one' && copying.editor.getValue() === 'copy version two' && copying._dirty && openedCopy === copyFile));
  app.vault.read = standardRead; files.set(copying.file.path, 'latest disk');
  await reloadWindowViewFromDisk(copying);
  check('草稿未变化时显式恢复仍正常载入磁盘并清dirty', () => assert.ok(copying.editor.getValue() === 'latest disk' && !copying._dirty));
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { delete globalThis.__windowSaveInvoke; delete globalThis.__windowSaveNotices; fs.rmSync(temporary, { recursive: true, force: true }); }
