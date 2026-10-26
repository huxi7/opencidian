/**
 * [INPUT]: 依赖 ../core/i18n.js 的 getNouns；依赖 workspace 的 editor-change / editor-selection-change / active-leaf-change / file-open 事件。
 * [OUTPUT]: 导出 create(app)（word-count 核心插件实例）。
 * [POS]: plugins-core/ 的字数统计。对齐原版：状态栏一个条目内两个 segment（词数 + 字符数），
 *        字符数取文本长度（含空白）；有选区时只统计选区；无点击行为（原版无弹窗）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: word-count — word & character counts in the status bar. */
import { getNouns } from '../core/i18n.js';
import { View } from '../core/view.js';

export const nameKey = 'plugins.word-count';

function countWords(text: string) {
  // Obsidian counts CJK characters individually and runs of latin as words
  if (!text) return 0;
  let words = 0;
  // CJK ranges: Han, Hiragana, Katakana, Hangul
  const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
  const withoutCjk = text.replace(cjk, ' ');
  words += (text.match(cjk) || []).length;
  const latin = withoutCjk.match(/[A-Za-z0-9_\u00c0-\u024f'’-]+/g);
  if (latin) words += latin.length;
  return words;
}

export function create(app: App) {
  let itemEl: HTMLDivElement|null = null;
  let wordEl: HTMLSpanElement|null = null;
  let charEl: HTMLSpanElement|null = null;

  function activeView() {
    const view = app.workspace.getActiveViewOfType('markdown');
    if (view && view.editor) return view;
    return null;
  }

  /** 原版 onSelection：有选区时只统计选区文本。 */
  function selectionText(view: View) {
    const cm = view && view.editor && view.editor.cm;
    if (!cm || !cm.state) return null;
    const main = cm.state.selection && cm.state.selection.main;
    if (!main || main.empty) return null;
    return cm.state.sliceDoc(main.from, main.to);
  }

  function update() {
    if (!itemEl || !wordEl || !charEl) return;
    const view = activeView();
    if (!view) { itemEl.toggle(false); return; }
    const selection = selectionText(view);
    const text = selection != null ? selection : (view.editor ? view.editor.getValue() : '');
    if (text == null) { itemEl.toggle(false); return; }
    const words = countWords(text);
    const chars = text.length; // 原版 charCount = e.length（含空白）
    itemEl.toggle(true);
    wordEl.setText(getNouns().word(words));
    charEl.setText(getNouns().character(chars));
  }

  return {
    onload() {
      if (!app.workspace.statusBar) return;
      itemEl = app.workspace.statusBar.createDiv('status-bar-item plugin-word-count');
      wordEl = itemEl.createSpan('status-bar-item-segment');
      charEl = itemEl.createSpan('status-bar-item-segment');
      app.workspace.on('editor-change', update);
      app.workspace.on('editor-selection-change', update);
      app.workspace.on('active-leaf-change', update);
      app.workspace.on('file-open', update);
      app.workspace.on('markdown-view-file-loaded', update);
      update();
    },
    onunload() {
      if (itemEl) itemEl.detach();
    },
  };
}
