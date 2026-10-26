/**
 * [INPUT]: Bases 文档与查询结果；属性和富值共用数据层；Desktop 提供保存路径。
 * [OUTPUT]: 导出 serializeBaseCsv、saveBaseCsv 与 exportBaseCsv。
 * [POS]: 数据库 CSV 导出边界。按当前列和筛选结果输出；取消不写盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BaseQueryRow, BaseQueryResult } from './bases-types.js';
import type { BasesController } from './bases-view.js';
import { BaseDocument, propertyValue, queryBase } from './bases-model.js';
import { formatBaseValue } from './bases-values.js';
import { Desktop } from '../core/ipc.js';
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
const fs = require('fs');

const quote = (value: string) => /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;

/** 原版 FF.toCSV：表头开启，逗号分隔，LF 换行，无 BOM 或尾换行。 */
export function serializeBaseCsv(document: BaseDocument, result: BaseQueryResult) {
  if (result.warnings?.length) throw new Error(result.warnings.join('\n'));
  const headers = result.columns.map((property: string) => String(document.data.properties?.[property]?.displayName || property.replace(/^note\./, '')));
  const rows = result.rows.map((row: BaseQueryRow) => result.columns.map((property: string) => {
    try { return formatBaseValue(propertyValue(row.context, property)); }
    catch (_) { return ''; }
  }));
  return [headers, ...rows].map((row: string[]) => row.map(quote).join(',')).join('\n');
}

export async function saveBaseCsv(controller: BasesController, options: { filePath?: string } = {}) {
  if (controller.closed || !controller.enabled || !controller.view) return null;
  const basename = controller.view.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'Base';
  const prompt = controller.promptCsvSavePath || Desktop.saveDialog;
  const selected = options.filePath ? { canceled: false, filePath: options.filePath } : await prompt.call(controller, {
    title: tt('plugins.bases.action-export-c-s-v', '导出 CSV…'),
    defaultPath: basename + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!selected || selected.canceled || !selected.filePath || controller.closed || !controller.enabled) return null;
  // 保存对话框可能等待很久。以最新磁盘为起点，避免导出旧结果。
  const document = new BaseDocument(await controller.app.vault.read(controller.file));
  const view = document.getView(controller.viewName);
  if (!view) throw new Error('找不到数据库视图');
  const result = queryBase(controller.app, document, view, controller.sourceFile || controller.file);
  const csv = serializeBaseCsv(document, result);
  if (controller.closed || !controller.enabled) return null;
  await fs.promises.writeFile(selected.filePath, csv, 'utf8');
  return { filePath: selected.filePath, csv, rows: result.rows.length, columns: result.columns.length };
}

/** UI 入口显示真实失败；纯保存 API 保留拒绝结果供验收。 */
export async function exportBaseCsv(controller: BasesController, options?: { filePath?: string }) {
  try { return await saveBaseCsv(controller, options); }
  catch (error) {
    new Notice(tt('interface.msg-failed-to-export', '导出 {{filename}} 失败。', { filename: (controller.view?.name || 'Base') + '.csv' }) + ' ' + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}
