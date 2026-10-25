/**
 * [INPUT]: 依赖 core/i18n.js 的 t；依赖 editor/table-model.js 的 cellTextFromInput；经 widget 的 model/edit/updateCell 读写单元格。
 * [OUTPUT]: 导出 buildFormattingSubmenu、cellFormatState、toggleMarker、clearMarkers。
 * [POS]: editor/ 表格部件的文本格式层（原版 NV 的 selection.format 段）。无选区单元格菜单的「文本格式」子菜单：
 *        条目、图标、section 对齐原版三段 selection.basic / selection.advanced / selection.danger。
 *        原版动作调单元格 CM 的 toggleMarkdownFormatting；这里单元格是 textarea，改用同一套标记包裹单元格文本或编辑器内的选区。
 *        table-selection.js 的单元格菜单是唯一调用方；本文件不接触 DOM 渲染与 CM6。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t } from '../core/i18n.js';
import { cellTextFromInput } from './table-model.js';

/** 文本格式条目 —— 原版 NV 的图标与 section；marker 是 textarea 单元格的等价标记。 */
const FORMAT_ITEMS = [
  { section: 'selection.basic', icon: 'lucide-bold', title: 'interface.formatting.toggle-bold', key: 'bold', marker: '**' },
  { section: 'selection.basic', icon: 'lucide-italic', title: 'interface.formatting.toggle-italics', key: 'italic', marker: '*' },
  { section: 'selection.basic', icon: 'lucide-strikethrough', title: 'interface.formatting.toggle-strikethrough', key: 'strikethrough', marker: '~~' },
  { section: 'selection.basic', icon: 'lucide-highlighter', title: 'interface.formatting.toggle-highlight', key: 'highlight', marker: '==' },
  { section: 'selection.advanced', icon: 'lucide-code-2', title: 'interface.formatting.toggle-code', key: 'code', marker: '`' },
  { section: 'selection.advanced', icon: 'lucide-sigma', title: 'interface.formatting.toggle-math', key: 'math', marker: '$' },
  { section: 'selection.advanced', icon: 'lucide-percent', title: 'interface.formatting.toggle-comments', key: 'comment', marker: '%%' },
];

/** 清除格式：原版 clearMarkdownFormatting 覆盖的标记集合（双字符在前，避免先删单字符）。 */
const CLEAR_MARKERS = ['**', '__', '~~', '==', '%%', '*', '`', '$'];

function isWrapped(text, marker) {
  return text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker);
}

/** 单元格文本的格式状态：整格被 marker 成对包裹即勾选（原版 hf(state, range) 的单元格等价物）。 */
export function cellFormatState(text) {
  const value = String(text == null ? '' : text).trim();
  return {
    bold: isWrapped(value, '**') || isWrapped(value, '__'),
    italic: !isWrapped(value, '**') && isWrapped(value, '*'),
    strikethrough: isWrapped(value, '~~'),
    highlight: isWrapped(value, '=='),
    code: isWrapped(value, '`') && !isWrapped(value, '```'),
    math: isWrapped(value, '$'),
    comment: isWrapped(value, '%%'),
  };
}

/** 包裹/取消包裹：已成对就去标记，否则两侧补标记（原版 toggleMarkdownFormatting 的开关语义）。 */
export function toggleMarker(text, marker) {
  const value = String(text == null ? '' : text).trim();
  if (isWrapped(value, marker)) return value.slice(marker.length, value.length - marker.length).trim();
  return marker + value + marker;
}

/** 清除格式：删除全部标记字符（含单字符标记），去掉首尾空白。 */
export function clearMarkers(text) {
  let value = String(text == null ? '' : text);
  for (const marker of CLEAR_MARKERS) value = value.split(marker).join('');
  return value.trim();
}

/** 「文本格式」子菜单：三段之间插分隔线，勾选态取自单元格文本。 */
export function buildFormattingSubmenu(menu, widget, view, cell) {
  const model = widget.model();
  const state = cellFormatState(model && model.rows[cell.row] ? model.rows[cell.row][cell.col] : '');
  const item = menu.addItem((entry) => entry
    .setSection('selection').setIcon('lucide-paintbrush').setTitle(t('interface.formatting.label-formatting')));
  const submenu = item.setSubmenu();
  let section = null;
  for (const format of FORMAT_ITEMS) {
    if (section !== format.section) {
      if (section) submenu.addSeparator();
      section = format.section;
    }
    submenu.addItem((entry) => entry
      .setSection(format.section).setIcon(format.icon).setTitle(t(format.title))
      .setChecked(!!state[format.key])
      .onClick(() => applyMarker(widget, view, cell, format.marker)));
  }
  submenu.addSeparator();
  submenu.addItem((entry) => entry
    .setSection('selection.danger').setIcon('lucide-eraser').setTitle(t('interface.formatting.clear'))
    .onClick(() => applyMarker(widget, view, cell, null)));
  return item;
}

/** 标记为 null 即清除格式；编辑器内有选区时只包裹选区，否则整格包裹。 */
function applyMarker(widget, view, cell, marker) {
  const model = widget.model();
  if (!model || !model.rows[cell.row]) return false;
  const editor = widget.edit && widget.edit.row === cell.row && widget.edit.col === cell.col
    ? widget.edit.textarea
    : null;
  let next;
  if (marker === null) {
    next = clearMarkers(model.rows[cell.row][cell.col]);
  } else if (editor && editor.selectionEnd > editor.selectionStart) {
    const value = editor.value;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    next = cellTextFromInput(value.slice(0, start) + toggleMarker(value.slice(start, end), marker) + value.slice(end));
  } else {
    next = toggleMarker(model.rows[cell.row][cell.col], marker);
  }
  return widget.updateCell(view, cell.row, cell.col, next, {
    focus: { row: cell.row, col: cell.col, selectAll: false },
  });
}
