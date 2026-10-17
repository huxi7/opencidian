/* Core plugin: word-count — shows word/character counts in the status bar. */
import { t, getNouns } from '../core/i18n.js';
import { Modal } from '../core/modals.js';

export const nameKey = 'plugins.word-count';

function countWords(text) {
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

function countChars(text) {
  if (!text) return 0;
  return [...text.replace(/\s/g, '')].length;
}

export function create(app) {
  let itemEl = null;
  let last = { words: 0, chars: 0 };

  function activeView() {
    const view = app.workspace.getActiveViewOfType('markdown');
    if (view && view.editor) return view;
    return null;
  }

  function currentText(view) {
    if (view && view.editor) return view.editor.getValue();
    const file = app.workspace.getActiveFile();
    if (!file) return null;
    try { return app.vault.read(file); } catch (e) { return null; }
  }

  function update() {
    if (!itemEl) return;
    const view = app.workspace.getActiveViewOfType('markdown');
    if (!view) { itemEl.toggle(false); return; }
    const text = view.editor ? view.editor.getValue() : null;
    if (text == null) { itemEl.toggle(false); return; }
    const words = countWords(text);
    const chars = countChars(text);
    last = { words, chars };
    itemEl.toggle(true);
    itemEl.setText(getNouns().word(words));
  }

  function showDetails() {
    const modal = new Modal(app);
    modal.setTitle(t('plugins.word-count.name') || 'Word count');
    const view = app.workspace.getActiveViewOfType('markdown');
    const text = view && view.editor ? view.editor.getValue()
      : (view && view.file ? app.vault.read(view.file) : '');
    const words = countWords(text || '');
    const chars = countChars(text || '');
    last = { words, chars };
    const grid = modal.contentEl.createDiv('word-count-details');
    const make = (label, value) => {
      const row = grid.createDiv('word-count-detail');
      row.createDiv('word-count-detail-label').setText(label);
      row.createDiv('word-count-detail-value').setText(String(value));
    };
    make(getNouns().word(words), words);
    make(getNouns().character(chars), chars);
    modal.open();
  }

  return {
    onload() {
      itemEl = app.workspace.statusBar.createDiv('status-bar-item plugin-word-count');
      itemEl.onclick = () => showDetails();
      app.workspace.on('editor-change', update);
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
