/**
 * [INPUT]: 控制器筛选/分组、模板、Editor、FileManager 与主进程 CAS。
 * [OUTPUT]: 导出新笔记推导、浮层开关与返回关闭成败的释放接口。
 * [POS]: Bases 新建交互。冲突保留输入，强制释放前先验证草稿已另存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Editor } from '../editor/editor.js';
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
import { Desktop } from '../core/ipc.js';
import { compileExpression } from './bases-expression.js';
import { createContext } from './bases-context.js';
import { baseValueToFrontmatter } from './bases-edit-values.js';
import { enqueueBaseFile } from './bases-edit-store.js';
const yaml = require('js-yaml');
function clauses(source) {
  const result = []; let from = 0, depth = 0, quote = '', escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character)) depth--;
    if (!depth && ['&&', '||'].includes(source.slice(index, index + 2))) { result.push(source.slice(from, index)); from = index + 2; index++; }
  }
  result.push(source.slice(from)); return result.map(value => value.trim());
}
function rules(filter, negated = false) {
  if (typeof filter === 'string') return negated ? [] : clauses(filter);
  if (!filter || typeof filter !== 'object') return [];
  const key = Object.keys(filter)[0];
  return (filter[key] || []).flatMap(value => rules(value, negated !== (key === 'not')));
}
function property(source) {
  const text = source.trim();
  if (/^file\.[\w]+$/.test(text)) return { type: 'file', name: text.slice(5) };
  if (text.startsWith('formula.')) return null;
  if (/^note\[("(?:\\.|[^"\\])*")\]$/.test(text)) return { type: 'note', name: JSON.parse(text.slice(5, -1)) };
  if (/^(?:note\.)?[\p{L}_$][\p{L}\p{N}_$.]*$/u.test(text)) return { type: 'note', name: text.replace(/^note\./, '') };
  return null;
}
const serializable = value => value?.kind === 'file' ? '[[' + value.path + ']]' : Array.isArray(value) ? value.map(serializable) : baseValueToFrontmatter(value);
export function inferBaseNewItem(controller, groupKey, hasGroup = false) {
  const context = createContext(controller.app, controller.sourceFile || controller.file, controller.document.data.formulas, controller.sourceFile || controller.file);
  const frontmatter: Record<string, any> = {}, state = { folder: '', frontmatter };
  const assign = (prop, value) => {
    if (!prop) return;
    if (prop.type === 'file') { if (prop.name === 'folder' && typeof value === 'string') state.folder = value; return; }
    if (['__proto__', 'prototype', 'constructor'].includes(prop.name)) return;
    frontmatter[prop.name] = serializable(value);
  };
  const evaluate = source => compileExpression(source)(context);
  for (let rule of [...rules(controller.document.data.filters), ...rules(controller.view.filters)]) {
    while (rule.startsWith('(') && rule.endsWith(')') && clauses(rule.slice(1, -1)).length === 1) rule = rule.slice(1, -1).trim();
    try {
      const comparison = rule.match(/^(.+?)\s*(==|>=|<=)\s*(.+)$/);
      if (comparison) { assign(property(comparison[1]), evaluate(comparison[3])); continue; }
      const empty = rule.match(/^!\s*(.+)\.isEmpty\(\)$/);
      if (empty) { const prop = property(empty[1]); if (prop?.type === 'note' && !Object.hasOwn(frontmatter, prop.name)) assign(prop, ''); continue; }
      const call = rule.match(/^(.+)\.(startsWith|endsWith|contains|containsAll|containsAny|hasTag|inFolder|hasProperty)\((.*)\)$/);
      if (!call) continue;
      const [, receiver, name, args] = call, prop = property(receiver), value = evaluate('[' + args + ']');
      const argument = value.length === 1 ? value[0] : value;
      if (receiver === 'file') {
        if (name === 'inFolder' && typeof argument === 'string') state.folder = argument;
        else if (name === 'hasTag' && typeof argument === 'string') frontmatter.tags = [...(frontmatter.tags || []), argument.replace(/^#/, '')];
        else if (name === 'hasProperty' && typeof argument === 'string') assign({ type: 'note', name: argument }, null);
      } else if (receiver === 'file.tags') frontmatter.tags = name === 'containsAny' ? [serializable(Array.isArray(argument) ? argument[0] : argument)] : (Array.isArray(argument) ? argument : [argument]).map(serializable);
      else if (prop?.type === 'note') {
        const type = controller.app.metadataTypeManager?.getTypeInfo?.(prop.name)?.inferred?.type;
        let next = name === 'containsAny' && Array.isArray(argument) ? argument[0] : argument;
        if (type === 'multitext' && !Array.isArray(next)) next = [next];
        assign(prop, next);
      }
    } catch { /* 原版忽略无法推导的规则；笔记仍可创建并显示筛选提示。 */ }
  }
  for (const key of controller.view.order || []) {
    const prop = property(key); if (prop?.type === 'note' && !Object.hasOwn(frontmatter, prop.name)) assign(prop, null);
  }
  if (hasGroup && controller.view.groupBy) assign(property(controller.view.groupBy.property), groupKey);
  return state;
}
function lockDraft(state, delta) { state.saveLocks = Math.max(0, (state.saveLocks || 0) + delta); if (!state.closed) state.editor.setReadOnly(state.saveLocks > 0); }
function el(parent, tag, cls, text?) { const node = parent.ownerDocument.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; parent.appendChild(node); return node; }
export async function closeBaseNewItem(controller, { preserveOnFailure = false } = {}) {
  const state = controller?._basesNewItem; if (!state) return true;
  if (state.closing) { const result = await state.closing; if (result || !preserveOnFailure) return result; }
  lockDraft(state, 1);
  const operation = (async () => {
    clearTimeout(state.timer); const saved = await state.flush();
    if (!saved && (!preserveOnFailure || !await state.saveDraft(false))) return false;
    if (controller._basesNewItem === state) controller._basesNewItem = null;
    state.closed = true; state.abort.abort(); state.editor.destroy(); state.panel.remove();
    controller.container.querySelector('.bases-toolbar-new-item-menu button')?.classList.remove('has-active-menu');
    if (!controller.container.isConnected && !controller.closed) controller.destroy();
    return true;
  })();
  state.closing = operation;
  try { return await operation; } finally { if (state.closing === operation) state.closing = null; lockDraft(state, -1); }
}
export async function toggleBaseNewItem(controller, anchor, groupKey?, hasGroup = false) {
  if (controller._basesNewItem) { await closeBaseNewItem(controller); return null; }
  if (controller._basesCreating) return null; controller._basesCreating = true;
  try {
    const app = controller.app, data = controller.document.data, inferred = inferBaseNewItem(controller, groupKey, hasGroup);
    const template = data.newItemTemplate && app.vault.getFileByPath(data.newItemTemplate);
    const templateProperties = template?.extension === 'md' ? app.metadataCache.getFileCache(template)?.frontmatter : null;
    let folderPath = hasGroup && controller.view.groupBy?.property === 'file.folder' ? String(groupKey || '/') : data.newItemFolder || (templateProperties ? template.parent?.path : '') || inferred.folder;
    if (!folderPath) folderPath = app.fileManager.getNewFileParent(controller.sourceFile?.path || controller.file.path).path;
    if (folderPath !== '/' && (folderPath.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || /[\\:*?"<>|]/.test(folderPath))) throw Error('新笔记文件夹无效。');
    let folder = app.vault.getFolderByPath(folderPath);
    if (!folder) folder = await app.vault.createFolder(folderPath);
    const frontmatter = { ...(templateProperties || inferred.frontmatter) }; delete frontmatter.position;
    if (hasGroup && controller.view.groupBy) { const group = property(controller.view.groupBy.property); if (group?.type === 'note') frontmatter[group.name] = serializable(groupKey); }
    const body = Object.keys(frontmatter).length ? '---\n' + yaml.dump(frontmatter, { lineWidth: -1 }) + '---\n' : '';
    const file = await app.fileManager.createNewMarkdownFile(folder, 'Untitled.md', body);
    if (controller.closed || !controller.enabled) return file;
    const doc = controller.container.ownerDocument, panel = el(doc.body, 'div', 'hover-popover popover hover-editor bases-new-item-popover');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', tt('plugins.bases.label-new-item', '新建'));
    const state: Record<string, any> = controller._basesNewItem = { panel, file, abort: new AbortController(), saved: body, queue: Promise.resolve(), closed: false, timer: null };
    anchor?.classList.add('has-active-menu');
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : controller.container.querySelector('.bases-toolbar-new-item-menu').getBoundingClientRect();
    const width = Math.min(450, doc.documentElement.clientWidth - 16);
    panel.style.cssText = `position:fixed;z-index:1000;width:${width}px;left:${Math.max(8, Math.min(rect.right - width, doc.documentElement.clientWidth - width - 8))}px;top:${Math.min(rect.bottom + 8, doc.documentElement.clientHeight - 280)}px`;
    const head = el(panel, 'div', 'bases-new-item-header');
    const title = el(head, 'input', 'inline-title'); title.value = file.basename; title.setAttribute('aria-label', '新笔记名称');
    const close = el(head, 'button', 'clickable-icon'); close.type = 'button'; close.setAttribute('aria-label', '关闭新笔记'); setIcon(close, 'lucide-x'); close.addEventListener('click', () => closeBaseNewItem(controller));
    const error = el(panel, 'div', 'bases-filter-error'); error.setAttribute('role', 'status');
    const preserve = el(panel, 'button', 'bases-new-item-save-draft', '另存草稿并载入最新内容'); preserve.type = 'button'; preserve.hidden = true;
    const editor = state.editor = new Editor(el(panel, 'div', 'markdown-source-view mod-cm6'), app, { doc: body, livePreview: false }); editor.sourcePath = file.path;
    state.flush = () => {
      clearTimeout(state.timer); const value = editor.getValue();
      state.queue = state.queue.catch(() => {}).then(() => enqueueBaseFile(app, file, async () => {
        if (value === state.saved) { state.failed = false; return true; }
        const result = await Desktop.compareAndSwapFile({ path: file.path, expected: state.saved, text: value });
        if (!result?.ok) throw Error(result?.conflict ? '笔记已被其他窗口修改，原始数据未覆盖。请另存草稿或重新载入。' : result?.error || '无法保存笔记。');
        state.saved = value; state.failed = false; error.textContent = ''; preserve.hidden = true;
        try { const stat = await app.vault.adapter.stat(file.path); file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size }; } catch {}
        app.vault.trigger('modify', file); return true;
      })).catch(failure => { state.failed = true; error.textContent = failure.message; preserve.hidden = false; return false; });
      return state.queue;
    };
    state.saveDraft = async (reload = true) => {
      if (state.preserving) return state.preserving;
      lockDraft(state, 1);
      const operation = (async () => {
        try {
          const text = editor.getValue();
          let draft = state.preservedText === text && state.preservedFile;
          if (!draft || !await app.vault.adapter.exists(draft.path)) {
            const name = file.basename + ' draft ' + require('crypto').randomUUID() + '.md';
            draft = await app.fileManager.createNewMarkdownFile(file.parent, name, text);
          }
          if (!draft || await app.vault.read(draft) !== text) throw Error('草稿尚未完整写盘，已取消关闭。');
          state.preservedFile = draft; state.preservedText = text;
          if (reload) { const latest = await app.vault.read(file); state.saved = latest; editor.setValue(latest); state.failed = false; preserve.hidden = true; }
          error.textContent = '草稿已另存为：' + draft.path; return true;
        } catch (failure) { state.failed = true; error.textContent = failure.message; preserve.hidden = false; return false; }
      })();
      state.preserving = operation;
      try { return await operation; } finally { if (state.preserving === operation) state.preserving = null; lockDraft(state, -1); }
    };
    preserve.addEventListener('click', () => state.saveDraft(true));
    editor.onChange(() => { clearTimeout(state.timer); state.timer = setTimeout(state.flush, 200); });
    title.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); title.blur(); editor.focus(); } else if (event.key === 'Escape') { event.preventDefault(); title.value = file.basename; title.blur(); } });
    title.addEventListener('blur', async () => {
      const name = title.value.trim();
      if (name === file.basename) return;
      if (!name || /[\\/:*?"<>|\r\n]/.test(name) || name.startsWith('.')) { error.textContent = '笔记名称无效。'; title.value = file.basename; return; }
      if (!await state.flush()) { title.value = file.basename; return; }
      const next = (file.parent.path === '/' ? '' : file.parent.path + '/') + name + '.md';
      if (await app.fileManager.renameFile(file, next)) editor.sourcePath = file.path;
      else title.value = file.basename;
    });
    doc.addEventListener('pointerdown', event => { if (!panel.contains(event.target) && !controller.container.querySelector('.bases-toolbar-new-item-menu')?.contains(event.target)) closeBaseNewItem(controller); }, { signal: state.abort.signal });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape' && event.target !== title) { event.preventDefault(); closeBaseNewItem(controller); } });
    title.focus({ preventScroll: true }); title.select();
    await app.metadataCache.parseFile(file); await controller.refresh();
    if (!controller.result.rows.some(row => row.file.path === file.path)) el(panel, 'div', 'bases-filter-query-message', tt('plugins.bases.msg-new-item-filtered', '新建笔记已保存，但不符合当前筛选条件。'));
    return file;
  } catch (error) { controller.warning('新建失败：' + error.message); return null; }
  finally { controller._basesCreating = false; }
}
