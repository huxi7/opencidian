/**
 * [INPUT]: 依赖 core/menu.js 的 Menu、core/i18n.js 的 t、core/ipc.js 的 Desktop。
 * [OUTPUT]: 导出 showEditorContextMenu(app, editor, owner, ev)。
 * [POS]: editor/ 的编辑器右键菜单（原版 onContextMenu 结构：拼写建议 → 链接 → 剪贴板 → 链接插入 → 文本格式 → 段落设置 → 插入 → 复制路径），结束前触发 workspace 的 editor-menu 事件供插件扩展。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Editor context menu — mirrors the original source-view onContextMenu sections. */
import { Menu } from '../core/menu.js';
import { t } from '../core/i18n.js';
import { Desktop } from '../core/ipc.js';

/**
 * 弹出编辑器右键菜单。
 * 桌面端先向主进程申请本次 context-menu 参数（拼写建议/剪贴板状态）；90ms 内未回来则不等待。
 */
export function showEditorContextMenu(app, editor, owner, ev) {
  if (ev.defaultPrevented) return;   // 组件自己处理过（如属性行菜单）
  ev.preventDefault();
  let armed = false;
  try { Desktop.setCustomContextMenu(); armed = true; } catch (e) { armed = false; }
  const show = (params) => buildMenu(app, editor, owner, ev, params);
  if (!armed) { show(null); return; }
  let done = false;
  const waiter = (params) => { if (done) return; done = true; show(params); };
  (app._contextParamWaiters = app._contextParamWaiters || []).push(waiter);
  setTimeout(() => {
    if (done) return;
    const list = app._contextParamWaiters || [];
    const idx = list.indexOf(waiter);
    if (idx >= 0) list.splice(idx, 1);
    done = true;
    show(null);
  }, 90);
}

function buildMenu(app, editor, owner, ev, params) {
  const menu = new Menu(app);
  const file = (owner && owner.file) || null;
  const sourcePath = editor.sourcePath || (file ? file.path : '');

  addSpellcheckItems(menu, app, editor, ev, params);
  addLinkItems(menu, app, editor, ev, sourcePath);
  addClipboardItems(menu, app, editor, params);
  addLinkInsertItems(menu, app, editor);
  addFormattingItems(menu, app, editor);
  addParagraphItems(menu, app, editor);
  addInsertItems(menu, app, editor);
  addCopyPathItems(menu, app, file);

  app.workspace.trigger('editor-menu', menu, editor, owner);
  menu.showAtMouseEvent(ev);
}

// ------------------------------------------------------------- 拼写（主进程参数）
function addSpellcheckItems(menu, app, editor, ev, params) {
  const word = params && params.misspelledWord;
  if (!word) return;
  const suggestions = (params.dictionarySuggestions || []).slice(0, 6);
  if (!suggestions.length) {
    menu.addItem((i) => i.setTitle(t('editor.spellcheck.no-suggestion') || 'No suggestions').setDisabled(true));
  }
  for (const s of suggestions) {
    menu.addItem((i) => i.setTitle(s).setIcon('lucide-repeat').onClick(() => replaceWordAt(app, editor, ev, s)));
  }
  menu.addItem((i) => i.setTitle(t('editor.spellcheck.add-to-dictionary') || 'Add to dictionary')
    .setIcon('lucide-folder-tree')
    .onClick(() => {
      try { Desktop.spellcheckAddWord(word); } catch (e) { /* 通道缺失时仅替换 */ }
      replaceWordAt(app, editor, ev, word);
    }));
  menu.addSeparator();
}

function replaceWordAt(app, editor, ev, replacement) {
  const view = editor.cm;
  const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
  if (pos == null) return;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  const re = /[\w'-]+/g;
  let m;
  while ((m = re.exec(line.text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      view.dispatch({ changes: { from: line.from + m.index, to: line.from + m.index + m[0].length, insert: replacement } });
      view.focus();
      return;
    }
  }
}

// ------------------------------------------------------------- 链接（光标下）
function tokenAtMouse(editor, ev) {
  const view = editor.cm;
  const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
  if (pos == null) return null;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  let m;
  const wiki = /\[\[([^\]\n]+)\]\]/g;
  while ((m = wiki.exec(line.text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'internal', raw: m[0], link: m[1].split('|')[0].split('#')[0], start: line.from + m.index, end: line.from + m.index + m[0].length };
    }
  }
  const md = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  while ((m = md.exec(line.text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'external', raw: m[0], link: m[2], start: line.from + m.index, end: line.from + m.index + m[0].length };
    }
  }
  return null;
}

function addLinkItems(menu, app, editor, ev, sourcePath) {
  const token = tokenAtMouse(editor, ev);
  if (!token) return;
  const selectToken = () => {
    editor.cm.dispatch({ selection: { anchor: token.start, head: token.end } });
    editor.cm.focus();
  };
  menu.addItem((i) => i.setTitle(t('editor.menu.edit-link') || 'Edit link').setIcon('lucide-text-cursor-input').onClick(selectToken));
  if (token.type === 'internal') {
    menu.addItem((i) => i.setTitle(t('interface.menu.open-link') || 'Open link').setIcon('lucide-file-symlink')
      .onClick(() => openInternal(app, token.link, sourcePath, false)));
    menu.addItem((i) => i.setTitle(t('interface.menu.open-in-new-tab') || 'Open in new tab').setIcon('lucide-file-plus')
      .onClick(() => openInternal(app, token.link, sourcePath, true)));
  } else {
    menu.addItem((i) => i.setTitle(t('interface.menu.open-in-browser') || 'Open in browser').setIcon('lucide-external-link')
      .onClick(() => { try { Desktop.openExternal(token.link); } catch (e) { window.open(token.link, '_blank'); } }));
  }
  menu.addItem((i) => i.setTitle(t('interface.menu.copy-url') || 'Copy link').setIcon('lucide-copy')
    .onClick(() => { try { navigator.clipboard.writeText(token.link); } catch (e) { /* ignore */ } }));
  menu.addSeparator();
}

function openInternal(app, link, sourcePath, newLeaf) {
  // getFirstLinkpathDest 返回路径字符串；兼容将来返回 TFile 的形态
  const dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath || '');
  const target = dest && dest.path ? dest : (dest ? app.vault.getFileByPath(dest) : null);
  if (target) app.workspace.openFile(target, { newLeaf });
}

// ------------------------------------------------------------- 剪贴板
function addClipboardItems(menu, app, editor, params) {
  const flags = (params && params.editFlags) || {};
  const selection = editor.getSelection() || '';
  const hasSelection = selection.length > 0;
  const canCut = typeof flags.canCut === 'boolean' ? flags.canCut : hasSelection;
  const canCopy = typeof flags.canCopy === 'boolean' ? flags.canCopy : hasSelection;
  const canPaste = typeof flags.canPaste === 'boolean' ? flags.canPaste : true;
  menu.addItem((i) => i.setTitle(t('interface.menu.cut') || 'Cut').setIcon('lucide-scissors').setDisabled(!canCut)
    .onClick(() => app.commands.executeCommandById('editor:cut')));
  menu.addItem((i) => i.setTitle(t('interface.menu.copy') || 'Copy').setIcon('lucide-copy').setDisabled(!canCopy)
    .onClick(() => app.commands.executeCommandById('editor:copy')));
  menu.addItem((i) => i.setTitle(t('interface.menu.paste') || 'Paste').setIcon('lucide-clipboard-check').setDisabled(!canPaste)
    .onClick(() => app.commands.executeCommandById('editor:paste')));
  menu.addItem((i) => i.setTitle(t('interface.menu.paste-as-plain-text') || 'Paste as plain text').setIcon('lucide-clipboard-type').setDisabled(!canPaste)
    .onClick(() => app.commands.executeCommandById('editor:paste')));
  menu.addItem((i) => i.setTitle(t('interface.menu.select-all') || 'Select all').setIcon('lucide-box-select')
    .onClick(() => app.commands.executeCommandById('editor:select-all')));
  menu.addSeparator();
}

// ------------------------------------------------------------- 链接插入
function addLinkInsertItems(menu, app, editor) {
  const oneLine = !/[\r\n]/.test(editor.getSelection() || '');
  menu.addItem((i) => i.setTitle(t('interface.formatting.insert-link') || 'Insert internal link').setIcon('lucide-link')
    .setDisabled(!oneLine).onClick(() => app.commands.executeCommandById('editor:insert-wikilink')));
  menu.addItem((i) => i.setTitle(t('interface.formatting.insert-external-link') || 'Insert external link').setIcon('lucide-external-link')
    .setDisabled(!oneLine).onClick(() => app.commands.executeCommandById('editor:insert-link')));
  menu.addSeparator();
}

// ------------------------------------------------------------- 文本格式
function formatState(editor) {
  const view = editor.cm;
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const lineStart = doc.lineAt(sel.from).from;
  const lineEnd = doc.lineAt(sel.to).to;
  const text = doc.sliceString(lineStart, lineEnd);
  const a = sel.from - lineStart;
  const b = sel.to - lineStart;
  const inside = (marker) => {
    const open = text.lastIndexOf(marker, Math.max(0, a - 1));
    if (open < 0) return false;
    return text.indexOf(marker, b) >= 0;
  };
  return {
    bold: inside('**'),
    italic: !inside('**') && inside('*'),
    strikethrough: inside('~~'),
    highlight: inside('=='),
    code: inside('`'),
    math: inside('$'),
    comment: inside('%%'),
  };
}

function headingState(editor) {
  const view = editor.cm;
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  let level = null;
  let uniform = true;
  for (let n = doc.lineAt(sel.from).number; n <= doc.lineAt(sel.to).number; n += 1) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    const m = text.match(/^\s*(#{1,6})\s+/);
    const l = m ? m[1].length : 0;
    if (level === null) level = l;
    else if (l !== level) uniform = false;
  }
  return { uniform, level: level === null ? 0 : level };
}

function addFormattingItems(menu, app, editor) {
  const fmt = formatState(editor);
  const formatItem = menu.addItem((i) => i.setTitle(t('interface.formatting.label-formatting') || 'Formatting').setIcon('lucide-paintbrush'));
  const sub = formatItem.setSubmenu();
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-bold') || 'Bold').setIcon('lucide-bold').setChecked(fmt.bold).onClick(() => run(app, 'editor:toggle-bold')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-italics') || 'Italic').setIcon('lucide-italic').setChecked(fmt.italic).onClick(() => run(app, 'editor:toggle-italics')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-strikethrough') || 'Strikethrough').setIcon('lucide-strikethrough').setChecked(fmt.strikethrough).onClick(() => run(app, 'editor:toggle-strikethrough')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-highlight') || 'Highlight').setIcon('lucide-highlighter').setChecked(fmt.highlight).onClick(() => run(app, 'editor:toggle-highlight')));
  sub.addSeparator();
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-code') || 'Code').setIcon('lucide-code-2').setChecked(fmt.code).onClick(() => run(app, 'editor:toggle-code')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-math') || 'Math').setIcon('lucide-sigma').setChecked(fmt.math).onClick(() => run(app, 'editor:toggle-inline-math')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-comments') || 'Comment').setIcon('lucide-percent').setChecked(fmt.comment).onClick(() => run(app, 'editor:toggle-comments')));
  sub.addSeparator();
  sub.addItem((i) => i.setTitle(t('interface.formatting.clear') || 'Clear formatting').setIcon('lucide-eraser').onClick(() => run(app, 'editor:clear-formatting')));
}

// ------------------------------------------------------------- 段落设置
function addParagraphItems(menu, app, editor) {
  const paragraph = menu.addItem((i) => i.setTitle(t('interface.formatting.label-paragraph') || 'Paragraph').setIcon('lucide-pilcrow'));
  const sub = paragraph.setSubmenu();
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-bullet-list') || 'Bullet list').setIcon('lucide-list').onClick(() => run(app, 'editor:toggle-bullet-list')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-numbered-list') || 'Numbered list').setIcon('lucide-list-ordered').onClick(() => run(app, 'editor:toggle-numbered-list')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-checklist') || 'Checklist').setIcon('lucide-check-square').onClick(() => run(app, 'editor:toggle-checklist-status')));
  sub.addSeparator();
  const heading = headingState(editor);
  for (let level = 1; level <= 6; level += 1) {
    const title = (t('interface.formatting.set-heading') || 'Heading {{level}}').replace('{{level}}', String(level));
    sub.addItem((i) => i.setTitle(title).setIcon('lucide-heading-' + level)
      .setChecked(heading.uniform && heading.level === level)
      .onClick(() => run(app, 'editor:set-heading-' + level)));
  }
  sub.addItem((i) => i.setTitle(t('interface.formatting.no-heading') || 'Body').setIcon('lucide-text')
    .setChecked(heading.uniform && heading.level === 0)
    .onClick(() => run(app, 'editor:set-heading-0')));
  sub.addSeparator();
  sub.addItem((i) => i.setTitle(t('interface.formatting.toggle-quote') || 'Quote').setIcon('lucide-quote').onClick(() => run(app, 'editor:toggle-blockquote')));
}

// ------------------------------------------------------------- 插入
function addInsertItems(menu, app, editor) {
  const insert = menu.addItem((i) => i.setTitle(t('interface.formatting.label-insert') || 'Insert').setIcon('lucide-list-plus'));
  const sub = insert.setSubmenu();
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-footnote') || 'Footnote').setIcon('lucide-file-signature').onClick(() => run(app, 'editor:insert-footnote')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-table') || 'Table').setIcon('lucide-table').onClick(() => run(app, 'editor:insert-table')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-callout') || 'Callout').setIcon('lucide-quote').onClick(() => run(app, 'editor:insert-callout')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-horizontal-rule') || 'Horizontal rule').setIcon('lucide-minus').onClick(() => run(app, 'editor:insert-horizontal-rule')));
  sub.addSeparator();
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-code-block') || 'Code block').setIcon('lucide-code').onClick(() => run(app, 'editor:insert-codeblock')));
  sub.addItem((i) => i.setTitle(t('interface.formatting.insert-math-block') || 'Math block').setIcon('lucide-sigma-square').onClick(() => run(app, 'editor:insert-mathblock')));
}

// ------------------------------------------------------------- 复制路径
function addCopyPathItems(menu, app, file) {
  if (!file) return;
  const copy = (text) => { try { navigator.clipboard.writeText(text); } catch (e) { /* ignore */ } };
  const copyItem = menu.addItem((i) => i.setTitle(t('interface.menu.copy-path') || 'Copy path').setIcon('lucide-clipboard'));
  const sub = copyItem.setSubmenu();
  sub.addItem((i) => i.setTitle(t('interface.menu.copy-vault-path') || 'Vault relative path').onClick(() => copy(file.path)));
  sub.addItem((i) => i.setTitle(t('interface.menu.copy-full-path') || 'Absolute path')
    .onClick(() => copy(app.vault.adapter.toAbs(file.path))));
  sub.addItem((i) => i.setTitle(t('interface.menu.copy-obsidian-url') || 'Obsidian URL')
    .onClick(() => copy('obsidian://open?vault=' + encodeURIComponent(app.vault.getName()) + '&file=' + encodeURIComponent(file.path.replace(/\.md$/, '')))));
}

function run(app, id) {
  app.commands.executeCommandById(id);
}
