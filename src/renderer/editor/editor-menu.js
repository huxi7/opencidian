/**
 * [INPUT]: 依赖 core/menu.js 的 Menu（分节与子菜单）、core/i18n.js 的 t、core/ipc.js 的 Desktop。
 * [OUTPUT]: 导出 showEditorContextMenu(app, editor, owner, ev)。
 * [POS]: editor/ 的编辑器右键菜单。逐条对应原版 source-view onContextMenu：
 *        分节表 title/correction/spellcheck/open/selection-link/selection/selection.format/selection.paragraph/selection.insert/clipboard/info.info.copy/action/view/danger；
 *        selection 节按光标下可点击 token 分流（编辑链接 / 文件链接菜单 / 编辑标签）；
 *        结束前触发 workspace 的 editor-menu 事件供插件与核心监听器（重命名小标题/块 ID）扩展。
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
  // 原版 onContextMenu 的分节表：决定显示顺序与分隔线位置
  menu.addSections([
    'title', 'correction', 'spellcheck', 'open', 'selection-link', 'selection',
    'selection.format', 'selection.paragraph', 'selection.paragraph.list', 'selection.paragraph.heading',
    'selection.paragraph.block', 'selection.insert.basic', 'selection.insert.advanced', 'insert',
    'clipboard', 'info', 'info.copy', 'action', 'view', '', 'danger',
  ]);
  const file = (owner && owner.file) || null;
  const sourcePath = editor.sourcePath || (file ? file.path : '');

  addSpellcheckItems(menu, app, editor, ev, params);          // correction + spellcheck
  addClickableTokenItems(menu, app, editor, ev, sourcePath);  // selection / open / action / info
  addClipboardItems(menu, app, editor, params);               // clipboard
  addLinkInsertItems(menu, app, editor);                      // selection-link
  addFormattingItems(menu, app, editor);                      // selection.format + 子节 basic/advanced/danger
  addParagraphItems(menu, app, editor);                       // selection.paragraph + 子节 list/heading/block
  addInsertItems(menu, app, editor);                          // selection.insert + 子节 basic/advanced
  // 原版：复制路径子菜单由 file-menu 事件填充（内部链接右键时含 Obsidian URL/库相对路径/绝对路径）
  menu.setSectionSubmenu('info.copy', { title: t('interface.menu.copy-path'), icon: 'lucide-clipboard' });

  app.workspace.trigger('editor-menu', menu, editor, owner);
  menu.showAtMouseEvent(ev);
}

// ------------------------------------------------------------- 拼写（主进程参数）
function addSpellcheckItems(menu, app, editor, ev, params) {
  const word = params && params.misspelledWord;
  if (!word) return;
  const suggestions = (params.dictionarySuggestions || []).slice(0, 6);
  if (!suggestions.length) {
    menu.addItem((i) => i.setSection('correction').setDisabled(true)
      .setTitle(t('editor.spellcheck.no-suggestion') || 'No suggestions'));
  }
  for (const s of suggestions) {
    menu.addItem((i) => i.setSection('correction').setTitle(s).setIcon('lucide-repeat')
      .onClick(() => replaceWordAt(app, editor, ev, s)));
  }
  menu.addItem((i) => i.setSection('spellcheck').setTitle(t('editor.spellcheck.add-to-dictionary') || 'Add to dictionary')
    .setIcon('lucide-folder-tree')
    .onClick(() => {
      try { Desktop.spellcheckAddWord(word); } catch (e) { /* 通道缺失时仅替换 */ }
      replaceWordAt(app, editor, ev, word);
    }));
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

// ------------------------------------------------------------- 可点击 token（链接 / 标签）
/** 原版 getClickableTokenAt 的菜单子集；未识别的类型返回 null。 */
function clickableTokenAt(editor, ev) {
  const target = ev.target;
  const view = editor.cm;
  const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
  if (pos == null) return null;
  if (!target || !target.closest) return null;
  // 原版：右键落在普通文本行上不提供链接/标签菜单
  if (target.classList && target.classList.contains('cm-line')) return null;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  let m;
  const wiki = /\[\[([^\]\n]+)\]\]/g;
  while ((m = wiki.exec(line.text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'internal-link', text: m[1].split('|')[0].split('#')[0], start: line.from + m.index, end: line.from + m.index + m[0].length };
    }
  }
  const md = /\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  while ((m = md.exec(line.text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'external-link', text: m[2], start: line.from + m.index, end: line.from + m.index + m[0].length };
    }
  }
  const tag = /(^|[\s([{>])#([\p{L}\p{N}_\-/]+)/gu;
  while ((m = tag.exec(line.text))) {
    const start = m.index + m[1].length;
    const end = start + 1 + m[2].length;
    if (offset >= start && offset <= end) {
      return { type: 'tag', text: m[2], start: line.from + start, end: line.from + end };
    }
  }
  return null;
}

function addClickableTokenItems(menu, app, editor, ev, sourcePath) {
  const token = clickableTokenAt(editor, ev);
  if (!token) return;
  if (token.type === 'internal-link' || token.type === 'external-link') {
    menu.addItem((i) => i.setSection('selection')
      .setTitle(t('editor.menu.edit-link') || 'Edit link').setIcon('lucide-text-cursor-input')
      .onClick(() => {
        editor.cm.focus();
        editor.cm.dispatch({ selection: { anchor: token.start, head: token.end } });
      }));
  }
  if (token.type === 'internal-link') {
    // 原版：链接菜单由 workspace 统一生成（编辑器与阅读视图共用）
    app.workspace.handleLinkContextMenu(menu, token.text, sourcePath, ev);
  } else if (token.type === 'external-link') {
    app.workspace.handleExternalLinkContextMenu(menu, token.text);
  } else if (token.type === 'tag') {
    menu.addItem((i) => i.setSection('selection')
      .setTitle(t('editor.menu.edit-tag') || 'Edit tag').setIcon('lucide-text-cursor-input')
      .onClick(() => {
        editor.cm.focus();
        // 原版 nP(k.start,1)：跳过 # 只选标签本体
        editor.cm.dispatch({ selection: { anchor: token.start + 1, head: token.end } });
      }));
  }
}

// ------------------------------------------------------------- 剪贴板
function addClipboardItems(menu, app, editor, params) {
  const flags = (params && params.editFlags) || {};
  // 本复刻 editor.getSelection() 返回 {anchor, head}（与原版返回文本不同）；选中文本统一经 getRange 取。
  const range = editor.getSelection();
  const selection = range && range.anchor ? editor.getRange(range.anchor, range.head) : '';
  const hasSelection = selection.length > 0;
  // Electron 的 editFlags 读的是原生 DOM 选区，CM6 选区不在其中 → canCopy/canCut 恒 false。
  // 编辑器有真实选区时必须覆盖原生标志；否则“复制/剪切”永远置灰。
  const canCut = hasSelection || flags.canCut === true;
  const canCopy = hasSelection || flags.canCopy === true;
  const canPaste = typeof flags.canPaste === 'boolean' ? flags.canPaste : true;
  menu.addItem((i) => i.setSection('clipboard').setTitle(t('interface.menu.cut') || 'Cut').setIcon('lucide-scissors').setDisabled(!canCut)
    .onClick(() => app.commands.executeCommandById('editor:cut')));
  menu.addItem((i) => i.setSection('clipboard').setTitle(t('interface.menu.copy') || 'Copy').setIcon('lucide-copy').setDisabled(!canCopy)
    .onClick(() => app.commands.executeCommandById('editor:copy')));
  menu.addItem((i) => i.setSection('clipboard').setTitle(t('interface.menu.paste') || 'Paste').setIcon('lucide-clipboard-check').setDisabled(!canPaste)
    .onClick(() => app.commands.executeCommandById('editor:paste')));
  menu.addItem((i) => i.setSection('clipboard').setTitle(t('interface.menu.paste-as-plain-text') || 'Paste as plain text').setIcon('lucide-clipboard-type').setDisabled(!canPaste)
    .onClick(() => app.commands.executeCommandById('editor:paste')));
  menu.addItem((i) => i.setSection('clipboard').setTitle(t('interface.menu.select-all') || 'Select all').setIcon('lucide-box-select')
    .onClick(() => app.commands.executeCommandById('editor:select-all')));
}

// ------------------------------------------------------------- 链接插入（selection-link）
function addLinkInsertItems(menu, app, editor) {
  const linkRange = editor.getSelection();
  const linkSelection = linkRange && linkRange.anchor ? editor.getRange(linkRange.anchor, linkRange.head) : '';
  const oneLine = !/[\r\n]/.test(linkSelection);
  menu.addItem((i) => i.setSection('selection-link').setTitle(t('interface.formatting.insert-link') || 'Insert internal link').setIcon('lucide-link')
    .setDisabled(!oneLine).onClick(() => app.commands.executeCommandById('editor:insert-wikilink')));
  menu.addItem((i) => i.setSection('selection-link').setTitle(t('interface.formatting.insert-external-link') || 'Insert external link').setIcon('lucide-external-link')
    .setDisabled(!oneLine).onClick(() => app.commands.executeCommandById('editor:insert-link')));
}

// ------------------------------------------------------------- 文本格式（selection.format）
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

/** 原版 NV()：Formatting 子菜单的 basic/advanced/danger 三节。 */
function addFormattingItems(menu, app, editor) {
  const fmt = formatState(editor);
  const sub = menu.addItem((i) => i.setSection('selection.format')
    .setTitle(t('interface.formatting.label-formatting') || 'Formatting').setIcon('lucide-paintbrush').setSubmenu()).submenu;
  // 原版 NV() 的分节表：basic / advanced / danger 三节，子菜单内插分隔线
  sub._sectioned = true;
  sub.addItem((i) => i.setSection('selection.format.basic').setTitle(t('interface.formatting.toggle-bold') || 'Bold').setIcon('lucide-bold').setChecked(fmt.bold).onClick(() => run(app, 'editor:toggle-bold')));
  sub.addItem((i) => i.setSection('selection.format.basic').setTitle(t('interface.formatting.toggle-italics') || 'Italic').setIcon('lucide-italic').setChecked(fmt.italic).onClick(() => run(app, 'editor:toggle-italics')));
  sub.addItem((i) => i.setSection('selection.format.basic').setTitle(t('interface.formatting.toggle-strikethrough') || 'Strikethrough').setIcon('lucide-strikethrough').setChecked(fmt.strikethrough).onClick(() => run(app, 'editor:toggle-strikethrough')));
  sub.addItem((i) => i.setSection('selection.format.basic').setTitle(t('interface.formatting.toggle-highlight') || 'Highlight').setIcon('lucide-highlighter').setChecked(fmt.highlight).onClick(() => run(app, 'editor:toggle-highlight')));
  sub.addItem((i) => i.setSection('selection.format.advanced').setTitle(t('interface.formatting.toggle-code') || 'Code').setIcon('lucide-code-2').setChecked(fmt.code).onClick(() => run(app, 'editor:toggle-code')));
  sub.addItem((i) => i.setSection('selection.format.advanced').setTitle(t('interface.formatting.toggle-math') || 'Math').setIcon('lucide-sigma').setChecked(fmt.math).onClick(() => run(app, 'editor:toggle-inline-math')));
  sub.addItem((i) => i.setSection('selection.format.advanced').setTitle(t('interface.formatting.toggle-comments') || 'Comment').setIcon('lucide-percent').setChecked(fmt.comment).onClick(() => run(app, 'editor:toggle-comments')));
  sub.addItem((i) => i.setSection('selection.format.danger').setTitle(t('interface.formatting.clear') || 'Clear formatting').setIcon('lucide-eraser').onClick(() => run(app, 'editor:clear-formatting')));
}

// ------------------------------------------------------------- 段落设置（selection.paragraph）
function addParagraphItems(menu, app, editor) {
  menu.setSectionSubmenu('selection.paragraph', {
    title: t('interface.formatting.label-paragraph') || 'Paragraph',
    disabled: editor.inTableCell === true,
    icon: 'lucide-pilcrow',
  });
  menu.addItem((i) => i.setSection('selection.paragraph.list').setTitle(t('interface.formatting.toggle-bullet-list') || 'Bullet list').setIcon('lucide-list').onClick(() => run(app, 'editor:toggle-bullet-list')));
  menu.addItem((i) => i.setSection('selection.paragraph.list').setTitle(t('interface.formatting.toggle-numbered-list') || 'Numbered list').setIcon('lucide-list-ordered').onClick(() => run(app, 'editor:toggle-numbered-list')));
  menu.addItem((i) => i.setSection('selection.paragraph.list').setTitle(t('interface.formatting.toggle-checklist') || 'Checklist').setIcon('lucide-check-square').onClick(() => run(app, 'editor:toggle-checklist-status')));
  const heading = headingState(editor);
  for (let level = 1; level <= 6; level += 1) {
    const title = (t('interface.formatting.set-heading') || 'Heading {{level}}').replace('{{level}}', String(level));
    menu.addItem((i) => i.setSection('selection.paragraph.heading').setTitle(title).setIcon('lucide-heading-' + level)
      .setChecked(heading.uniform && heading.level === level)
      .onClick(() => run(app, 'editor:set-heading-' + level)));
  }
  menu.addItem((i) => i.setSection('selection.paragraph.heading').setTitle(t('interface.formatting.no-heading') || 'Body').setIcon('lucide-text')
    .setChecked(heading.uniform && heading.level === 0)
    .onClick(() => run(app, 'editor:set-heading-0')));
  menu.addItem((i) => i.setSection('selection.paragraph.block').setTitle(t('interface.formatting.toggle-quote') || 'Quote').setIcon('lucide-quote').onClick(() => run(app, 'editor:toggle-blockquote')));
}

// ------------------------------------------------------------- 插入（selection.insert）
function addInsertItems(menu, app, editor) {
  menu.setSectionSubmenu('selection.insert', {
    title: t('interface.formatting.label-insert') || 'Insert',
    disabled: editor.inTableCell === true,
    icon: 'lucide-list-plus',
  });
  menu.addItem((i) => i.setSection('selection.insert.basic').setTitle(t('interface.formatting.insert-footnote') || 'Footnote').setIcon('lucide-file-signature').onClick(() => run(app, 'editor:insert-footnote')));
  menu.addItem((i) => i.setSection('selection.insert.basic').setTitle(t('interface.formatting.insert-table') || 'Table').setIcon('lucide-table').onClick(() => run(app, 'editor:insert-table')));
  menu.addItem((i) => i.setSection('selection.insert.basic').setTitle(t('interface.formatting.insert-callout') || 'Callout').setIcon('lucide-quote').onClick(() => run(app, 'editor:insert-callout')));
  menu.addItem((i) => i.setSection('selection.insert.basic').setTitle(t('interface.formatting.insert-horizontal-rule') || 'Horizontal rule').setIcon('lucide-minus').onClick(() => run(app, 'editor:insert-horizontal-rule')));
  menu.addItem((i) => i.setSection('selection.insert.advanced').setTitle(t('interface.formatting.insert-code-block') || 'Code block').setIcon('lucide-code').onClick(() => run(app, 'editor:insert-codeblock')));
  menu.addItem((i) => i.setSection('selection.insert.advanced').setTitle(t('interface.formatting.insert-math-block') || 'Math block').setIcon('lucide-sigma-square').onClick(() => run(app, 'editor:insert-mathblock')));
}

function run(app, id) {
  app.commands.executeCommandById(id);
}
