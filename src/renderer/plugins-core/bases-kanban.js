/**
 * [INPUT]: Bases 行、分组键与真实 DOM 拖放；FileManager 提供 processFrontMatter 写回。
 * [OUTPUT]: 导出看板可写边界、卡片拖动与列投放绑定函数。
 * [POS]: 看板写回边界。只允许笔记标量属性跨列移动，落盘后按元数据重新分组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { propertyValue } from './bases-model.js';
import { baseEquals, safeKey } from './bases-values.js';

const activeDrags = new WeakMap(), fileQueues = new WeakMap();
const scalar = value => value == null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
const findKey = (object, property) => Object.keys(object).find(key => key.toLowerCase() === property.toLowerCase()) || property;
export function kanbanWriteInfo(controller, row = null, property = controller.view.groupBy?.property) {
  if (!property || /^(?:file|formula)\./.test(property) || property === 'file') return { writable: false, reason: '当前分组来自文件或公式，只读展示。' };
  const name = property.replace(/^note\./, '');
  try { safeKey(name); } catch (error) { return { writable: false, reason: error.message }; }
  if (!row) return { writable: true, name, property };
  if (row.file.extension !== 'md') return { writable: false, reason: '仅 Markdown 笔记支持跨列拖动。' };
  const frontmatter = controller.app.metadataCache.getFileCache(row.file)?.frontmatter || {}, key = findKey(frontmatter, name);
  let value;
  try { value = propertyValue(row.context, property); } catch (error) { return { writable: false, reason: error.message }; }
  if (!scalar(frontmatter[key]) || !scalar(value)) return { writable: false, reason: '日期、链接、列表和对象分组只读；跨列拖动仅支持文本、数字、复选框与空值。' };
  return { writable: true, name, property, key, value };
}
function validFrontmatter(source) {
  if (!/^---\s*\r?\n/.test(source)) return;
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error('笔记属性缺少结束标记，已取消移动。');
  const parsed = require('js-yaml').load(match[1]);
  if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('笔记属性必须是 YAML 对象。');
}
async function moveCard(controller, drag, target) {
  let queues = fileQueues.get(controller.app);
  if (!queues) { queues = new Map(); fileQueues.set(controller.app, queues); }
  const previous = queues.get(drag.file.path) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    if (controller.closed || !controller.enabled || controller.view.groupBy?.property !== drag.property) return;
    if (!scalar(target)) throw new Error('目标分组不是可写标量。');
    const file = controller.app.vault.getFileByPath(drag.file.path);
    if (!file || file.extension !== 'md') throw new Error('笔记已移除，无法移动。');
    validFrontmatter(await controller.app.vault.read(file));
    await controller.app.fileManager.processFrontMatter(file, frontmatter => {
      const key = findKey(frontmatter, drag.name), value = frontmatter[key] ?? null;
      if (!scalar(value) || !baseEquals(value, drag.value)) throw new Error('分组属性已变化，请重新拖动。');
      if (target == null) delete frontmatter[key]; else frontmatter[key] = target;
    });
    await controller.refresh();
  });
  queues.set(drag.file.path, operation);
  try { await operation; }
  finally { if (queues.get(drag.file.path) === operation) queues.delete(drag.file.path); }
}
export function bindKanbanCard(controller, card, row) {
  const info = kanbanWriteInfo(controller, row);
  card.draggable = info.writable;
  if (!info.writable) { card.title = info.reason; return; }
  card.addEventListener('dragstart', event => {
    if (controller.closed || !controller.enabled || !event.dataTransfer) { event.preventDefault(); return; }
    const latest = kanbanWriteInfo(controller, row);
    if (!latest.writable) { event.preventDefault(); return; }
    activeDrags.set(controller, { ...latest, file: row.file });
    event.dataTransfer.setData('application/x-opensidian-base-card', row.file.path);
    event.dataTransfer.effectAllowed = 'move'; card.classList.add('is-being-dragged'); event.stopPropagation();
  });
  card.addEventListener('dragend', () => {
    activeDrags.delete(controller); card.classList.remove('is-being-dragged');
    controller.container.querySelectorAll('.bases-kanban-drop-target').forEach(node => node.classList.remove('bases-kanban-drop-target'));
  });
}
export function bindKanbanColumn(controller, column, group) {
  if (!kanbanWriteInfo(controller).writable || !scalar(group.key)) return;
  const accepts = () => {
    const drag = activeDrags.get(controller);
    return drag && drag.property === controller.view.groupBy?.property && !baseEquals(drag.value, group.key);
  };
  column.addEventListener('dragover', event => {
    if (!accepts()) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; column.classList.add('bases-kanban-drop-target');
  });
  column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('bases-kanban-drop-target'); });
  column.addEventListener('drop', event => {
    if (!accepts()) return;
    event.preventDefault(); event.stopPropagation();
    const drag = activeDrags.get(controller); activeDrags.delete(controller); column.classList.remove('bases-kanban-drop-target');
    controller.queue = controller.queue.catch(() => {}).then(() => moveCard(controller, drag, group.key)).catch(error => {
      if (!controller.closed) controller.warning('移动卡片失败：' + error.message);
    });
  });
}
