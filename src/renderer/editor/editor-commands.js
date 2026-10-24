/**
 * [INPUT]: 依赖 core/i18n.js 的 t；依赖 core/notices.js 的 Notice；依赖 core/ipc.js 的 Desktop；依赖 ./attachments.js 的 saveAttachment/pastedImageBaseName；依赖 folding 的单层折叠、@codemirror/language 的全部折叠与 @codemirror/commands 的选区换行；经 app 使用 commands/fileManager/workspace/metadataCache。
 * [OUTPUT]: 导出 registerEditorCommands(app)，注册全部 editor:* 与 markdown:* 命令。
 * [POS]: editor/ 的命令注册层，由 main.js 在 App 构造后调用。命令体只做编辑器级动作或薄转发：editor:download-attachments 门控活动文件为 md 后委托 fileManager.downloadAttachmentsForNote；attach-file 与 paste 的附件落盘共用 attachments.js。
 *        编辑器解析只有一处 getEditor(app)：先取 workspace.getActiveEditor()（画布卡片正文优先），回落活动叶子视图；宿主带 getMode 且为 preview 时拒绝。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Built-in editor / markdown commands (ported behaviors from the original). */
import { t } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { Desktop } from '../core/ipc.js';
import { saveAttachment, pastedImageBaseName } from './attachments.js';
import { foldAll, unfoldAll } from '@codemirror/language';
import { moveLineUp, moveLineDown } from '@codemirror/commands';
import { foldSelectionStep } from './folding.js';

/** 编辑器解析入口：workspace.activeEditor 优先（画布卡片正文可被 editor:* 命令作用）。 */
function getEditor(app) {
  const workspace = app.workspace;
  const active = workspace && workspace.getActiveEditor ? workspace.getActiveEditor() : null;
  if (!active || !active.editor) return null;
  if (active.getMode && active.getMode() === 'preview') return null;
  return active.editor;
}

function wrap(editor, before, after = before) {
  const sel = editor.listSelections();
  if (!sel.length) return;
  const changes = [];
  for (const range of sel) {
    if (range.from.line === range.to.line && range.from.ch === range.to.ch) {
      // no selection: expand to word
      const line = editor.getLine(range.from.line);
      let start = range.from.ch, end = range.from.ch;
      while (start > 0 && /[\w\u4e00-\u9fff-]/.test(line[start - 1])) start--;
      while (end < line.length && /[\w\u4e00-\u9fff-]/.test(line[end])) end++;
      if (start !== end) {
        changes.push({ from: { line: range.from.line, ch: start }, to: { line: range.from.line, ch: end }, text: before + line.slice(start, end) + after });
        continue;
      }
    }
    changes.push({ from: range.from, to: range.to, text: before + editor.getRange(range.from, range.to) + after });
  }
  applyMultiChanges(editor, changes);
}

function applyMultiChanges(editor, changes) {
  // apply from bottom to top so earlier offsets stay valid
  const cm = editor.cm;
  const specs = changes.map((c) => ({ from: editor.posToOffset(c.from), to: editor.posToOffset(c.to), insert: c.text }))
    .sort((a, b) => b.from - a.from);
  cm.dispatch({ changes: specs });
}

function unwrapIfWrapped(editor, marker) {
  const sel = editor.listSelections();
  let rewrote = false;
  const changes = [];
  for (const range of sel) {
    const text = editor.getRange({ line: range.from.line, ch: Math.max(0, range.from.ch - marker.length) }, { line: range.to.line, ch: range.to.ch + marker.length });
    if (text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)) {
      changes.push({
        from: { line: range.from.line, ch: Math.max(0, range.from.ch - marker.length) },
        to: { line: range.to.line, ch: range.to.ch + marker.length },
        text: text.slice(marker.length, text.length - marker.length),
      });
      rewrote = true;
    }
  }
  if (rewrote) { applyMultiChanges(editor, changes); return true; }
  return false;
}

function toggleWrapCommand(before, after) {
  return (editor) => {
    const marker = before;
    if (!unwrapIfWrapped(editor, marker)) wrap(editor, before, after);
  };
}

function eachLine(editor, fn) {
  const ranges = editor.listSelections();
  const seen = new Set();
  const changes = [];
  for (const r of ranges) {
    for (let l = r.from.line; l <= r.to.line; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const out = fn(editor.getLine(l), l);
      if (out !== null && out !== undefined) changes.push({ from: { line: l, ch: 0 }, to: { line: l, ch: editor.getLine(l).length }, text: out });
    }
  }
  if (changes.length) applyMultiChanges(editor, changes);
}

export function registerEditorCommands(app) {
  const add = (spec) => app.commands.addCommand(spec);

  const editorCmd = (id, name, cb) => add({ id, name, editorCallback: (editor) => cb(editor) });
  const editorCheckCmd = (id, name, cb) => add({ id, name, editorCheckCallback: (checking, editor) => { if (checking) return true; cb(editor); } });

  editorCmd('editor:save-file', 'Save current file', (editor) => {
    const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
    if (view && view.save) view.save();
  });
  add({
    id: 'editor:download-attachments',
    name: t('commands.download-attachments') || 'Download attachments for current file',
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) app.fileManager.downloadAttachmentsForNote(file);
      return true;
    },
  });

  editorCmd('editor:undo', 'Undo', (e) => e.undo());
  editorCmd('editor:redo', 'Redo', (e) => e.redo());
  editorCmd('editor:select-all', 'Select all', (e) => e.setSelection({ line: 0, ch: 0 }, { line: e.lastLine(), ch: e.getLine(e.lastLine()).length }));
  /* 系统剪贴板：渲染层有 nodeIntegration，优先用 Electron clipboard（菜单点击后编辑器失焦，execCommand 会空转） */
  const sysClipboard = () => {
    try { const cb = require('electron').clipboard; return cb && cb.readText ? cb : null; } catch (e) { return null; }
  };
  editorCmd('editor:copy', 'Copy', (e) => {
    const text = e.getRange(e.getCursor('from'), e.getCursor('to'));
    if (!text) return;
    const cb = sysClipboard();
    if (cb) cb.writeText(text);
    else { try { document.execCommand('copy'); } catch (err) {} }
  });
  editorCmd('editor:paste', 'Paste', async () => {
    // 剪贴板图片优先（原版：截图/图片 → "Pasted image <时间戳>" 落盘 + 嵌入）
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((tp) => tp.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
        const file = await saveAttachment(app, pastedImageBaseName(), ext, await blob.arrayBuffer(), (getEditor(app) || {}).sourcePath || '');
        const link = '!' + app.fileManager.generateMarkdownLink(file, (getEditor(app) || {}).sourcePath || '', '', '', undefined);
        const e = getEditor(app); if (e) e.replaceSelection(link);
        return;
      }
    } catch (err) { /* 无图片或权限 → 文本路径 */ }
    const cb = sysClipboard();
    try {
      const text = cb ? cb.readText() : await navigator.clipboard.readText();
      const e = getEditor(app);
      if (e && text) e.replaceSelection(text);
    } catch (err) {}
  });
  editorCmd('editor:cut', 'Cut', async (e) => {
    if (!e) return;
    const text = e.getRange(e.getCursor('from'), e.getCursor('to'));
    const cb = sysClipboard();
    if (cb) cb.writeText(text);
    else { try { await navigator.clipboard.writeText(text); } catch (err) {} }
    e.replaceSelection('');
  });

  editorCmd('editor:toggle-bold', 'Toggle bold', toggleWrapCommand('**', '**'));
  editorCmd('editor:toggle-italics', 'Toggle italics', toggleWrapCommand('*', '*'));
  editorCmd('editor:toggle-strikethrough', 'Toggle strikethrough', toggleWrapCommand('~~', '~~'));
  editorCmd('editor:toggle-highlight', 'Toggle highlight', toggleWrapCommand('==', '=='));
  editorCmd('editor:toggle-code', 'Toggle code', toggleWrapCommand('`', '`'));
  editorCmd('editor:toggle-comments', 'Toggle comment', toggleWrapCommand('%%', '%%'));
  editorCmd('editor:toggle-inline-math', 'Toggle inline math', toggleWrapCommand('$', '$'));

  editorCmd('editor:toggle-checklist-status', 'Toggle checklist status', (editor) => {
    eachLine(editor, (line) => {
      const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/);
      if (!m) return null;
      const next = m[2].toLowerCase() === 'x' ? '[ ]' : '[x]';
      return m[1] + next + line.slice(m[0].length);
    });
  });

  editorCmd('editor:toggle-bullet-list', 'Toggle bullet list', (editor) => {
    eachLine(editor, (line) => {
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
      if (m) return line.slice(m[0].length);
      const indent = line.match(/^\s*/)[0];
      return indent + '- ' + line.slice(indent.length);
    });
  });
  editorCmd('editor:toggle-numbered-list', 'Toggle numbered list', (editor) => {
    eachLine(editor, (line) => {
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
      if (m) return line.slice(m[0].length);
      const indent = line.match(/^\s*/)[0];
      return indent + '1. ' + line.slice(indent.length);
    });
  });
  editorCmd('editor:cycle-list-checklist', 'Cycle bullet/checkbox', (editor) => {
    eachLine(editor, (line) => {
      let m = line.match(/^(\s*)[-*+]\s+\[[ xX]\]\s+/);
      if (m) return m[1] + '- ' + line.slice(m[0].length);
      m = line.match(/^(\s*)[-*+]\s+/);
      if (m) return m[1] + '- [ ] ' + line.slice(m[0].length);
      const indent = line.match(/^\s*/)[0];
      return indent + '- ' + line.slice(indent.length);
    });
  });

  editorCmd('editor:insert-link', 'Insert markdown link', (editor) => {
    const sel = editor.getSelection();
    const text = editor.getRange(sel.anchor, sel.head);
    if (sel.anchor.line === sel.head.line && sel.anchor.ch === sel.head.ch) editor.replaceSelection('[[]]');
    else editor.replaceSelection('[[' + text + ']]');
    if (sel.anchor.line === sel.head.line && sel.anchor.ch === sel.head.ch) {
      const ch = editor.getCursor().ch;
      editor.setCursor({ line: editor.getCursor().line, ch: ch - 2 });
    }
  });
  editorCmd('editor:insert-wikilink', 'Insert link', (editor) => {
    editor.replaceSelection('[[]]');
    const c = editor.getCursor();
    editor.setCursor({ line: c.line, ch: c.ch - 2 });
  });
  editorCmd('editor:insert-embed', 'Insert embed', (editor) => {
    editor.replaceSelection('![[]]');
    const c = editor.getCursor();
    editor.setCursor({ line: c.line, ch: c.ch - 2 });
  });
  editorCmd('editor:insert-tag', 'Insert tag', (editor) => { editor.replaceSelection('#'); });

  editorCmd('editor:insert-callout', 'Insert callout', (editor) => {
    editor.replaceSelection('> [!note]\n> ');
  });
  editorCmd('editor:insert-codeblock', 'Insert code block', (editor) => {
    editor.replaceSelection('```\n\n```');
    const c = editor.getCursor();
    editor.setCursor({ line: c.line - 1, ch: 0 });
  });
  editorCmd('editor:insert-mathblock', 'Insert math block', (editor) => {
    editor.replaceSelection('$$\n\n$$');
    const c = editor.getCursor();
    editor.setCursor({ line: c.line - 1, ch: 0 });
  });
  editorCmd('editor:insert-table', 'Insert table', (editor) => {
    editor.replaceSelection('| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |');
  });
  editorCmd('editor:insert-footnote', 'Insert footnote', (editor) => {
    editor.replaceSelection('[^1]\n\n[^1]: ');
  });
  editorCmd('editor:insert-horizontal-rule', 'Insert horizontal rule', (editor) => {
    editor.replaceSelection('\n---\n');
  });

  // 原版 editor:set-heading-1..6 与“正文”（菜单项的 checked 由当前标题层级决定）
  const setHeading = (editor, level) => {
    eachLine(editor, (line) => {
      const indent = line.match(/^\s*/)[0];
      const rest = line.slice(indent.length).replace(/^#{1,6}\s+/, '');
      if (level === 0) return indent + rest;
      return indent + '#'.repeat(level) + ' ' + rest;
    });
  };
  for (let level = 1; level <= 6; level += 1) {
    editorCmd('editor:set-heading-' + level, 'Set as heading ' + level, (e) => setHeading(e, level));
  }
  editorCmd('editor:set-heading-0', 'Set as body text', (e) => setHeading(e, 0));

  editorCmd('editor:toggle-blockquote', 'Toggle blockquote', (editor) => {
    eachLine(editor, (line) => {
      const m = line.match(/^(\s*)>\s?/);
      if (m) return m[1] + line.slice(m[0].length);
      const indent = line.match(/^\s*/)[0];
      return indent + '> ' + line.slice(indent.length);
    });
  });

  editorCmd('editor:clear-formatting', 'Clear formatting', (editor) => {
    const changes = [];
    for (const range of editor.listSelections()) {
      const text = editor.getRange(range.from, range.to);
      if (!text) continue;
      const cleaned = text
        .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
        .replace(/__([\s\S]*?)__/g, '$1')
        .replace(/~~([\s\S]*?)~~/g, '$1')
        .replace(/==([\s\S]*?)==/g, '$1')
        .replace(/%%([\s\S]*?)%%/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\$([^$\n]*)\$/g, '$1')
        .replace(/(\*|_)([^*_\n]+)\1/g, '$2');
      if (cleaned !== text) changes.push({ from: range.from, to: range.to, text: cleaned });
    }
    if (changes.length) applyMultiChanges(editor, changes);
  });

  // 原版 editor:attach-file：选文件 → 复制进库（附件目录）→ 插入嵌入链接
  editorCmd('editor:attach-file', 'Insert attachment', async (editor) => {
    let result = null;
    try { result = Desktop.openDialog({ properties: ['openFile', 'multiSelections'] }); } catch (e) { result = null; }
    if (!result || result.canceled || !result.filePaths || !result.filePaths.length) return;
    const fs = require('fs');
    for (let i = 0; i < result.filePaths.length; i += 1) {
      const abs = result.filePaths[i];
      const base = abs.split('/').pop() || 'attachment';
      const dot = base.lastIndexOf('.');
      const name = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot + 1) : '';
      let data = null;
      try { data = fs.readFileSync(abs); } catch (e) { continue; }
      const file = await saveAttachment(app, name, ext, data, editor.sourcePath || '');
      const link = '!' + app.fileManager.generateMarkdownLink(file, editor.sourcePath || '', '', '', undefined);
      editor.replaceSelection(link + (i < result.filePaths.length - 1 ? '\n\n' : ''));
    }
  });

  editorCmd('editor:delete-paragraph', 'Delete paragraph', (editor) => {
    const cur = editor.getCursor();
    let start = cur.line, end = cur.line;
    while (start > 0 && editor.getLine(start - 1).trim() !== '') start--;
    while (end < editor.lastLine() && editor.getLine(end + 1).trim() !== '') end++;
    const from = { line: start, ch: 0 };
    const to = { line: end, ch: editor.getLine(end).length };
    editor.replaceRange('', from, to);
    const nextLine = editor.getLine(end + 1);
    if (nextLine !== undefined && nextLine.trim() === '') editor.replaceRange('', { line: end, ch: 0 }, { line: end + 1, ch: 0 });
  });

  // 复用CM6事务：整体移动选中的行，并保留正向/反向选区与撤销历史。
  editorCmd('editor:swap-line-up', 'Swap line up', (editor) => moveLineUp(editor.cm));
  editorCmd('editor:swap-line-down', 'Swap line down', (editor) => moveLineDown(editor.cm));

  editorCmd('editor:indent-list', 'Indent list', (editor) => {
    eachLine(editor, (line) => line.match(/^\s*(?:[-*+]|\d+[.)]|>)/) ? '  ' + line : null);
  });
  editorCmd('editor:outdent-list', 'Outdent list', (editor) => {
    eachLine(editor, (line) => {
      const m = line.match(/^(\t| {1,2})/);
      if (m && line.match(/^\s*(?:[-*+]|\d+[.)]|>)/)) return line.slice(m[0].length);
      return null;
    });
  });

  editorCmd('editor:fold-less', 'Fold less', (editor) => foldSelectionStep(editor.cm, false));
  editorCmd('editor:fold-more', 'Fold more', (editor) => foldSelectionStep(editor.cm, true));
  editorCmd('editor:fold-all', 'Fold all', (editor) => { try { foldAll(editor.cm); } catch (e) {} });
  editorCmd('editor:unfold-all', 'Unfold all', (editor) => { try { unfoldAll(editor.cm); } catch (e) {} });

  editorCmd('editor:open-search', 'Search current file', (editor) => {
    editor.openSearch();
    const input = editor.cm.dom.querySelector('.cm-search input[name="search"]');
    if (input) input.focus();
  });
  editorCmd('editor:open-search-replace', 'Search & replace in current file', (editor) => {
    editor.openSearch();
    const input = editor.cm.dom.querySelector('.cm-search input[name="replace"]');
    if (input) input.focus();
  });

  editorCmd('editor:focus', 'Focus editor', (e) => e.focus());
  editorCmd('editor:focus-top', 'Move cursor to start', (e) => { e.setCursor({ line: 0, ch: 0 }); e.focus(); });
  editorCmd('editor:focus-bottom', 'Move cursor to end', (e) => { const l = e.lastLine(); e.setCursor({ line: l, ch: e.getLine(l).length }); e.focus(); });

  editorCmd('editor:follow-link', 'Follow link under cursor', (editor) => followLink(app, editor, false));
  editorCmd('editor:open-link-in-new-leaf', 'Open link under cursor in new tab', (editor) => followLink(app, editor, 'tab'));
  editorCmd('editor:open-link-in-new-split', 'Open link under cursor to the right', (editor) => followLink(app, editor, 'split'));

  // Section navigation
  editorCmd('editor:go-to-next-heading', 'Go to next heading', (editor) => gotoHeading(app, editor, 1));
  editorCmd('editor:go-to-previous-heading', 'Go to previous heading', (editor) => gotoHeading(app, editor, -1));

  // markdown view commands
  add({
    id: 'markdown:toggle-preview',
    name: 'Toggle reading view',
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
      if (!view || view.getViewType() !== 'markdown') return false;
      if (!checking) view.toggleMode();
      return true;
    },
  });
  add({
    id: 'markdown:add-metadata-property',
    name: 'Add file property',
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
      if (!view || view.getViewType() !== 'markdown') return false;
      if (!checking) view.promptAddProperty && view.promptAddProperty();
      return true;
    },
  });
  add({
    id: 'markdown:clear-metadata-properties',
    name: 'Remove file properties',
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
      const file = app.workspace.getActiveFile();
      if (!view || view.getViewType() !== 'markdown' || !file) return false;
      if (!checking) {
        app.fileManager.processFrontMatter(file, (fm) => { for (const k of Object.keys(fm)) delete fm[k]; });
      }
      return true;
    },
  });

  add({
    id: 'editor:toggle-source',
    name: 'Toggle source mode',
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
      if (!view || view.getViewType() !== 'markdown') return false;
      if (!checking) view.toggleSourceLive && view.toggleSourceLive();
      return true;
    },
  });
}

async function followLink(app, editor, newLeaf) {
  const cur = editor.getCursor();
  const line = editor.getLine(cur.line);
  // find link under cursor
  const wl = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  let m;
  while ((m = wl.exec(line))) {
    const start = m.index, end = m.index + m[0].length;
    if (cur.ch >= start && cur.ch <= end) {
      const inner = m[2].split('|')[0];
      await app.workspace.openLinkText(inner, app.workspace.getActiveFile() ? app.workspace.getActiveFile().path : '', newLeaf === 'tab');
      return;
    }
  }
  const ml = /(?<!!)\[([^\[\]\n]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = ml.exec(line))) {
    const start = m.index, end = m.index + m[0].length;
    if (cur.ch >= start && cur.ch <= end) {
      const url = m[2];
      if (/^https?:/i.test(url)) Desktop.openExternal(url);
      else await app.workspace.openLinkText(decodeURIComponent(url), app.workspace.getActiveFile() ? app.workspace.getActiveFile().path : '', newLeaf === 'tab');
      return;
    }
  }
  // plain url under cursor
  const urlRe = /https?:\/\/[^\s)]+/g;
  while ((m = urlRe.exec(line))) {
    if (cur.ch >= m.index && cur.ch <= m.index + m[0].length) {
      Desktop.openExternal(m[0]);
      return;
    }
  }
}

function gotoHeading(app, editor, dir) {
  const file = app.workspace.getActiveFile();
  if (!file) return;
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.headings) return;
  const line = editor.getCursor().line;
  const headings = cache.headings;
  let target = null;
  if (dir > 0) target = headings.find((h) => h.position.start.line > line);
  else target = [...headings].reverse().find((h) => h.position.start.line < line);
  if (target) editor.scrollTo(target.position.start.line, 0);
}
