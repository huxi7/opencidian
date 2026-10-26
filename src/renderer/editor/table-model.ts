/**
 * [INPUT]: 无依赖。纯函数层，不接触 DOM 与 CM6。
 * [OUTPUT]: 导出 splitRow、parseAlignment、parseTableText、alignmentRow、serializeTable、moveInArray、clamp、cellTextFromInput、cellTextToInput 与常量 MIN_COL_WIDTH。
 * [POS]: editor/ 表格部件的 Markdown 模型层。table-widget.js 经此读写表格文本，table-selection.js 用它序列化选区子表格。
 *        解析口径对齐原版 getTableString/makeAlignmentRow：单元格按未转义 `|` 切分，分隔行进出对齐信息。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** 列最小宽度。原版从 5 起算；这里取 7，使任意对齐的分隔行都至少三个连字符（居中是 `:---:`）。 */
export type TableAlignment = 'left' | 'center' | 'right' | null;
export interface TableModel { rows: string[][]; alignments: TableAlignment[]; }
export const MIN_COL_WIDTH = 7;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** 拆一行表格：按未转义的 `|` 切分，去掉首尾空段，单元格取 trim 后的原文。 */
export function splitRow(line: string | null | undefined) {
  let body = String(line == null ? '' : line).trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let current = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '\\' && index + 1 < body.length) {
      current += char + body[index + 1];
      index++;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** 分隔行单元格 → 对齐：`:--` 左、`:-:` 中、`--:` 右、`---` 默认（null）。 */
export function parseAlignment(cell: string | null | undefined): TableAlignment {
  const value = String(cell == null ? '' : cell).trim();
  if (!/^:?-+:?$/.test(value)) return null;
  const start = value.startsWith(':');
  const end = value.endsWith(':');
  if (start && end) return 'center';
  if (start) return 'left';
  if (end) return 'right';
  return null;
}

/** 解析表格 Markdown 为 { rows, alignments }；rows[0] 是表头行，分隔行不入模型。无法解析时返回 null。 */
export function parseTableText(text: string): TableModel | null {
  const lines = String(text == null ? '' : text).split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]);
  if (!header.length || header.length !== delimiter.length) return null;
  if (!delimiter.every((cell) => /^:?-+:?$/.test(cell))) return null;
  const alignments = delimiter.map(parseAlignment);
  const rows = [header];
  for (let index = 2; index < lines.length; index++) rows.push(splitRow(lines[index]));
  for (const row of rows) {
    while (row.length < alignments.length) row.push('');
    row.length = alignments.length;
  }
  return { rows, alignments };
}

/** 分隔行：镜像原版 makeAlignmentRow 的冒号与连字符写回。 */
export function alignmentRow(alignments: TableAlignment[], widths: number[]) {
  let line = '';
  for (let col = 0; col < alignments.length; col++) {
    const width = Math.max(MIN_COL_WIDTH, widths[col]);
    switch (alignments[col]) {
      case 'left': line += '| :' + '-'.repeat(width - 3) + ' '; break;
      case 'center': line += '| :' + '-'.repeat(width - 4) + ': '; break;
      case 'right': line += '| ' + '-'.repeat(width - 3) + ': '; break;
      default: line += '| ' + '-'.repeat(width - 2) + ' ';
    }
  }
  return line + '|';
}

/** 序列化回 Markdown：单元格按列宽补空格，左/中/右对齐决定留白位置。 */
export function serializeTable(rows: string[][], alignments: TableAlignment[]) {
  const colCount = alignments.length;
  const widths = new Array(colCount).fill(MIN_COL_WIDTH);
  for (const row of rows) {
    for (let col = 0; col < colCount; col++) {
      widths[col] = Math.max(widths[col], String(row[col] == null ? '' : row[col]).length + 2);
    }
  }
  const lines = [];
  for (let index = 0; index < rows.length; index++) {
    let line = '';
    for (let col = 0; col < colCount; col++) {
      const cell = String(rows[index][col] == null ? '' : rows[index][col]);
      const pad = Math.max(2, widths[col] - cell.length);
      let left = 1;
      let right = pad - 1;
      if (alignments[col] === 'right') { left = pad - 1; right = 1; }
      else if (alignments[col] === 'center') { left = Math.floor(pad / 2); right = Math.ceil(pad / 2); }
      line += '|' + ' '.repeat(left) + cell + ' '.repeat(right);
    }
    lines.push(line + '|');
    if (index === 0) lines.push(alignmentRow(alignments, widths));
  }
  return lines.join('\n');
}

/** 原版 ac：把数组元素从 from 移到 to。 */
export function moveInArray<T>(array: T[], from: number, to: number) {
  const value = array.splice(from, 1)[0];
  array.splice(to, 0, value);
  return array;
}

/** 单元格内容 → Markdown 文本：换行落成 `<br>`，未转义 `|` 补反斜杠（原版 HA 的写回口径）。 */
export function cellTextFromInput(value: unknown) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')
    .replace(/(\\*)\|/g, (match, backslashes) => (
      backslashes.length % 2 === 1 ? match : backslashes + '\\|'
    ));
}

/** 原版 zA：把 `<br>` 还原成换行、`\|` 还原成 `|`，代码段内不改写。 */
export function cellTextToInput(text: string) {
  return String(text == null ? '' : text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\([\\|])/g, '$1');
}
