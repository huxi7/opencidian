/**
 * [INPUT]: Bases 富值、库级 PropertyTypes 类型与最新 Markdown 文本。
 * [OUTPUT]: 导出可写属性描述、输入格式化与转换、组键转换和带过时检查的属性写入。
 * [POS]: 表格编辑和看板共用笔记写入语义。拒绝无效 YAML、公式和只读文件字段。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseDate, BaseLink, BaseTag, safeKey, ownKey, baseEquals, parseBaseDate } from './bases-values.js';
import { propertyValue } from './bases-model.js';
import { convertBaseProperty } from './bases-values-file.js';
import { enqueueBaseFile } from './bases-edit-store.js';
import { getPropertyTypes } from '../markdown/properties-types.js';
const yaml = require('js-yaml');
export function readBaseFrontmatter(source) {
  if (!/^---\s*\r?\n/.test(source)) return {};
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw Error('笔记属性缺少结束标记，已取消写入。');
  const value = yaml.load(match[1]);
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw Error('笔记属性必须是 YAML 对象。');
  return value || {};
}
export function basePropertyType(app, name, value) {
  const manager = app.metadataTypeManager || (app.vault.getBasePath && app.metadataCache.on ? getPropertyTypes(app) : null);
  const declared = manager?.getTypeInfo?.(name)?.expected?.type;
  if (declared) return declared;
  if (['tags', 'aliases', 'cssclasses'].includes(name.toLowerCase())) return 'multitext';
  if (Array.isArray(value)) return 'multitext';
  if (value instanceof BaseDate || value instanceof Date) return value.time === false ? 'date' : 'datetime';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.length === 10 ? 'date' : 'datetime';
  return 'text';
}
export function baseWriteInfo(controller, row = null, property) {
  if (property === 'file.folder') return { writable: true, property, folder: true, value: row?.file.parent?.path || '/' };
  if (!property || /^(?:file|formula)\./.test(property) || property === 'file') return { writable: false, reason: '公式与此文件属性只读。' };
  const name = property.replace(/^note\./, '');
  try { safeKey(name); } catch (error) { return { writable: false, reason: error.message }; }
  if (!row) return { writable: true, name, property };
  if (row.file.extension !== 'md') return { writable: false, reason: '仅 Markdown 笔记支持属性写入。' };
  try {
    const value = propertyValue(row.context, property);
    const type = basePropertyType(controller.app, name, value);
    if (type === 'unknown') return { writable: false, reason: '该属性类型没有可用编辑器。' };
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof BaseDate) && !(value instanceof BaseLink) && !(value instanceof BaseTag)) return { writable: false, reason: '对象属性只读。' };
    baseValueToFrontmatter(value);
    const frontmatter = controller.app.metadataCache.getFileCache(row.file)?.frontmatter || {};
    const key = ownKey(frontmatter, name) ?? name;
    return { writable: true, name, property, value, type, rawValue: frontmatter[key] };
  } catch (error) { return { writable: false, reason: error.message }; }
}
export function baseValueToFrontmatter(value) {
  if (value == null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof BaseDate) { if (!Number.isFinite(value.date.getTime())) throw Error('日期无效。'); return value.toString(); }
  if (value instanceof BaseLink) return value.toString();
  if (value instanceof BaseTag) return value.value.replace(/^#/, '');
  if (Array.isArray(value)) return value.map(baseValueToFrontmatter);
  throw Error('目标值不能写入笔记属性。');
}
export function formatBaseEditValue(info) {
  const value = baseValueToFrontmatter(info.value);
  if (info.type === 'date' || info.type === 'datetime') {
    if (info.rawValue instanceof Date && Number.isFinite(info.rawValue.getTime())) return info.rawValue.toISOString().slice(0, info.type === 'date' ? 10 : 19);
    const text = value == null ? '' : String(value);
    if (!text) return '';
    if (info.type === 'date') return text.slice(0, 10);
    return text.length === 10 ? text + 'T00:00' : text;
  }
  return Array.isArray(value) ? JSON.stringify(value) : value == null ? '' : String(value);
}
export function parseBaseEditInput(text, type) {
  if (text === '') return null;
  if (type === 'number') { const value = Number(text); if (!Number.isFinite(value)) throw Error('请输入有效数字。'); return value; }
  if (type === 'checkbox') { if (text !== 'true' && text !== 'false') throw Error('复选框只接受 true 或 false。'); return text === 'true'; }
  if (type === 'date' || type === 'datetime') {
    const date = parseBaseDate(text, false);
    if (!date || !Number.isFinite(date.date.getTime()) || date.toString().slice(0, 10) !== text.slice(0, 10)) throw Error('请输入有效日期。');
    return date;
  }
  if (type === 'multitext' || type === 'tags' || type === 'aliases') {
    if (text.trimStart().startsWith('[')) { const list = yaml.load(text); if (!Array.isArray(list) || list.some(item => !['string', 'number', 'boolean'].includes(typeof item))) throw Error('列表需包含文本、数字或复选值。'); return list; }
    return text.split(',').map(value => value.trim()).filter(Boolean);
  }
  return text;
}
export function writeBaseProperty(controller, row, info, target) {
  return enqueueBaseFile(controller.app, row.file, async () => {
    if (controller.closed || !controller.enabled) return;
    const file = controller.app.vault.getFileByPath(row.file.path);
    if (!file) throw Error('笔记已移除，无法写入。');
    if (info.folder) {
      if (typeof target !== 'string') throw Error('目标文件夹无效。');
      const path = target === '/' ? '/' : target.replace(/^\/+|\/+$/g, '');
      if (path.split('/').some(part => part === '..' || part === '.') || path.includes('\\')) throw Error('目标文件夹无效。');
      const folder = controller.app.vault.getFolderByPath(path);
      if (!folder) throw Error('目标文件夹不存在：' + target);
      if ((file.parent?.path || '/') !== info.value) throw Error('笔记文件夹已变化，请重新操作。');
      const next = (path === '/' ? '' : path + '/') + file.name;
      if (next !== file.path && !await controller.app.fileManager.renameFile(file, next)) throw Error('移动失败：目标已存在或不可写。');
      return;
    }
    let next = baseValueToFrontmatter(target);
    if ((info.type === 'multitext' || Array.isArray(info.value)) && next != null && !Array.isArray(next)) next = [next];
    readBaseFrontmatter(await controller.app.vault.read(file));
    await controller.app.fileManager.processFrontMatter(file, frontmatter => {
      const key = ownKey(frontmatter, info.name) ?? info.name;
      const current = convertBaseProperty(frontmatter[key] ?? null, controller.app, file.path, key);
      if (!baseEquals(current, info.value)) throw Error('属性已变化，请重新操作，原始数据未覆盖。');
      if (next == null) delete frontmatter[key]; else frontmatter[key] = next;
    });
  });
}
