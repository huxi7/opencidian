/**
 * [INPUT]: Bases 行、富值分组键与真实 DOM 拖放；共用属性写回边界。
 * [OUTPUT]: 导出看板可写边界、卡片拖动与列投放绑定函数。
 * [POS]: 看板拖放适配器。支持日期、链接、列表、空值和文件夹，公式维持只读。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { baseEquals } from './bases-values.js';
import { baseWriteInfo, baseValueToFrontmatter, writeBaseProperty } from './bases-edit-values.js';
const activeDrags = new WeakMap();
export function kanbanWriteInfo(controller, row = null, property = controller.view.groupBy?.property) {
  const info = baseWriteInfo(controller, row, property);
  if (!info.writable && /^(?:file|formula)/.test(property || '')) info.reason = '当前分组来自文件或公式，只读展示。';
  return info;
}
export function bindKanbanCard(controller, card, row) {
  const info = kanbanWriteInfo(controller, row);
  card.draggable = info.writable;
  if (!info.writable) { card.title = info.reason; return; }
  card.addEventListener('dragstart', event => {
    if (controller.closed || !controller.enabled || !event.dataTransfer || event.target.closest('input,textarea,select')) { event.preventDefault(); return; }
    const latest = kanbanWriteInfo(controller, row);
    if (!latest.writable) { event.preventDefault(); return; }
    activeDrags.set(controller, { ...latest, row });
    event.dataTransfer.setData('application/x-opensidian-base-card', row.file.path);
    event.dataTransfer.effectAllowed = 'move'; card.classList.add('is-being-dragged'); event.stopPropagation();
  });
  card.addEventListener('dragend', () => {
    activeDrags.delete(controller); card.classList.remove('is-being-dragged');
    controller.container.querySelectorAll('.bases-kanban-drop-target').forEach(node => node.classList.remove('bases-kanban-drop-target'));
  });
}
export function bindKanbanColumn(controller, column, group) {
  if (!kanbanWriteInfo(controller).writable) return;
  try { baseValueToFrontmatter(group.key); } catch { return; }
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
    controller.queue = controller.queue.catch(() => {}).then(() => {
      if (controller.closed || !controller.enabled || controller.view.groupBy?.property !== drag.property) return;
      return writeBaseProperty(controller, drag.row, drag, group.key);
    }).then(() => controller.refresh()).catch(error => {
      if (!controller.closed) controller.warning('移动卡片失败：' + error.message);
    });
  });
}
