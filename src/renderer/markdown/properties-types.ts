/**
 * [INPUT]: Events、i18n、Moment、Vault 元数据与 Node fs/path；库级 .obsidian/types.json。
 * [OUTPUT]: PropertyTypes、getPropertyTypes、PROPERTY_WIDGETS、inferPropertyType。
 * [POS]: 属性类型唯一事实源。赋值按键名忽略大小写，保留未知配置；类型变化刷新已挂载面板并通知工作区。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Events, type EventRef } from '../core/events.js';
import { t } from '../core/i18n.js';

const fs: typeof import('node:fs') = require('fs');
const path: typeof import('node:path') = require('path');
const reserved = Object.freeze({ aliases: 'aliases', cssclasses: 'multitext', tags: 'tags' });
const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && require('moment')(value, 'YYYY-MM-DD', true).isValid();
const validDatetime = (value: unknown) => typeof value === 'string' && require('moment')(value, ['YYYY-MM-DD[T]HH:mm', 'YYYY-MM-DD[T]HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss'], true).isValid();
const widget = (type: string, icon: string, validate: (value: unknown) => boolean, reservedKeys?: string[]) => ({ type, icon: 'lucide-' + icon, name: () => t('properties.types.option-' + type), validate, reservedKeys });
export const PROPERTY_WIDGETS: Record<string, ReturnType<typeof widget>> = {
  aliases: widget('aliases', 'forward', value => typeof value === 'string' || Array.isArray(value), ['aliases']),
  checkbox: widget('checkbox', 'check-square', value => typeof value === 'boolean'),
  date: widget('date', 'calendar', validDate),
  datetime: widget('datetime', 'clock', validDatetime),
  multitext: widget('multitext', 'list', Array.isArray),
  number: widget('number', 'binary', value => typeof value === 'number' && Number.isFinite(value)),
  tags: widget('tags', 'tags', value => typeof value === 'string' || Array.isArray(value), ['tags']),
  text: widget('text', 'text', value => typeof value === 'string'),
};
const unknown = widget('unknown', 'help-circle', () => true);
export function inferPropertyType(value: unknown) {
  if (value == null) return 'text';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'multitext';
  if (value instanceof Date) return value.toISOString().endsWith('T00:00:00.000Z') ? 'date' : 'datetime';
  if (typeof value === 'string') return validDate(value) ? 'date' : validDatetime(value) ? 'datetime' : 'text';
  return 'unknown';
}

interface PropertyInfo { name: string; widget: string; empty?: boolean; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export class PropertyTypes extends Events<{ changed: [key?: string] }> {
  declare app: App;
  declare registeredTypeWidgets: Record<string, ReturnType<typeof widget>>;
  declare file: string;
  declare panels: Set<WeakRef<HTMLElement>>;
  declare properties: Record<string, PropertyInfo> | null;
  declare _refs: EventRef[];
  declare _onConfigChange: () => void;
  declare _onUnload: () => void;
  declare loadError: unknown;
  assignedWidgets: Record<string, PropertyInfo> = {};

  constructor(app: App, { watch = true } = {}) {
    super();
    this.app = app;
    this.registeredTypeWidgets = PROPERTY_WIDGETS;
    this.file = path.join(app.vault.getBasePath(), app.vault.configDir || '.obsidian', 'types.json');
    this.panels = new Set();
    this.properties = null;
    const invalidate = () => { this.properties = null; };
    this._refs = [app.metadataCache.on('changed', invalidate), app.metadataCache.on('resolved', invalidate), app.vault.on('delete', invalidate)];
    this.loadData();
    this._onConfigChange = () => this.loadData(true);
    if (watch) fs.watchFile(this.file, { persistent: false, interval: 250 }, this._onConfigChange);
    this._onUnload = () => this.dispose();
    globalThis.addEventListener?.('beforeunload', this._onUnload, { once: true });
  }
  _read(): Record<string, unknown> {
    try { const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8')); return record(data) ? data : {}; }
    catch (error) { if (record(error) && error.code === 'ENOENT') return {}; throw error; }
  }
  loadData(notify = false) {
    let data;
    try { data = this._read(); }
    catch (error) { this.loadError = error; return; }
    this.loadError = null;
    const types = record(data.types) ? data.types : {};
    const assigned: Record<string, PropertyInfo> = Object.create(null);
    for (const [name, type] of Object.entries(types)) {
      const key = name.toLowerCase();
      if (!Object.hasOwn(assigned, key)) assigned[key] = { name, widget: typeof type === 'string' ? type : 'unknown' };
    }
    for (const [name, type] of Object.entries(reserved)) assigned[name] = { name, widget: type };
    const changed = JSON.stringify(assigned) !== JSON.stringify(this.assignedWidgets);
    this.assignedWidgets = assigned;
    if (notify && changed) this._notify();
  }
  isReserved(key: string) { return Object.hasOwn(reserved, key.toLowerCase()); }
  getAssignedWidget(key: string) { return this.assignedWidgets?.[key.toLowerCase()]?.widget || null; }
  getWidget(type: string) { return PROPERTY_WIDGETS[type] || unknown; }
  getAllProperties() {
    if (!this.properties) {
      const properties: Record<string, PropertyInfo> = Object.create(null);
      for (const file of this.app.vault.getMarkdownFiles()) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        for (const [name, value] of Object.entries(fm || {})) {
          const key = name.toLowerCase();
          if (!Object.hasOwn(properties, key) || properties[key].empty) properties[key] = { name, widget: inferPropertyType(value), empty: value == null };
        }
      }
      this.properties = properties;
    }
    return { ...this.properties, ...this.assignedWidgets };
  }
  getPropertyInfo(key: string) {
    const assigned = this.assignedWidgets?.[key.toLowerCase()];
    if (assigned) return assigned;
    return this.getAllProperties()[key.toLowerCase()] || { name: key, widget: 'text' };
  }
  getTypeInfo(key: string, value?: unknown) {
    const assigned = this.getAssignedWidget(key);
    const expected = assigned ? this.getWidget(assigned) : null;
    if (expected && (value == null || expected.validate(value))) return { expected, inferred: expected };
    const inferred = this.getWidget(value == null ? this.getPropertyInfo(key).widget : inferPropertyType(value));
    return { expected: expected || inferred, inferred };
  }
  async setType(key: string, type: string) {
    if (this.isReserved(key) || !Object.hasOwn(PROPERTY_WIDGETS, type) || PROPERTY_WIDGETS[type].reservedKeys) return;
    this._save(key, type);
  }
  async unsetType(key: string) {
    if (!this.isReserved(key)) this._save(key, null);
  }
  _save(key: string, type: string | null) {
    // 每次修改重新读取，避免覆盖另一个窗口刚写入的属性类型和未知键。
    const data = this._read();
    const types = record(data.types) ? { ...data.types } : {};
    const existing = Object.keys(types).find(name => name.toLowerCase() === key.toLowerCase());
    if (existing) delete types[existing];
    if (type) types[existing || key] = type;
    for (const [name, value] of Object.entries(reserved)) types[name] = value;
    data.types = types;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + process.pid + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(data, null, 2)); fs.renameSync(temp, this.file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    this.loadData();
    this._notify(key.toLowerCase());
  }
  registerPanel(panel: HTMLElement) {
    for (const ref of this.panels) if (!ref.deref()?.isConnected) this.panels.delete(ref);
    this.panels.add(new WeakRef(panel));
  }
  _notify(key?: string) {
    for (const ref of this.panels) {
      const panel = ref.deref();
      if (panel?.isConnected) panel.refreshPropertyTypes?.();
      else this.panels.delete(ref);
    }
    this.trigger('changed', key);
    this.app.workspace.trigger('properties-type-change', key);
  }
  dispose() {
    fs.unwatchFile(this.file, this._onConfigChange);
    globalThis.removeEventListener?.('beforeunload', this._onUnload);
    this.panels.clear();
    for (const ref of this._refs) ref.unregister();
    this._refs = [];
  }
}
export function getPropertyTypes(app: App) {
  return app.metadataTypeManager || (app.metadataTypeManager = new PropertyTypes(app));
}
