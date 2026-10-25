/**
 * [INPUT]: Vault 文件与 MetadataCache 的属性、引用和解析结果。
 * [OUTPUT]: 导出 BaseFile 和 convertBaseProperty，提供公式可见的文件与笔记富值。
 * [POS]: Bases 元数据适配器。把宿主文件能力收窄为只读字段和白名单查询。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseDate, BaseLink, BaseTag, parseBaseDate, ownKey, safeKey } from './bases-values.js';
const owners = new WeakMap();
export function convertBaseProperty(value, app: App, sourcePath = '', key = '') {
  if (key.toLowerCase() === 'tags') {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values.map(tag => new BaseTag(tag));
  }
  if (value instanceof Date) return new BaseDate(value, true);
  if (typeof value === 'string') {
    if (/^\[\[.*\]\]$/.test(value) || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) return new BaseLink(value, null, app, sourcePath);
    return parseBaseDate(value, false) || value;
  }
  if (Array.isArray(value)) return value.map(item => convertBaseProperty(item, app, sourcePath));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const name of Object.keys(value)) {
      if (name === 'position' && key === '') continue;
      safeKey(name); result[name] = convertBaseProperty(value[name], app, sourcePath, name);
    }
    return result;
  }
  return value ?? null;
}
export class BaseFile {
  declare kind: string;
  declare path: any;

  constructor(app: App, file) { this.kind = 'file'; this.path = file.path; owners.set(this, { app, file, cache: new Map() }); }
  toString() { return this.path; }
  owner() { return owners.get(this); }
  memo(key, create) { const { cache } = this.owner(); if (!cache.has(key)) cache.set(key, create()); return cache.get(key); }
  access(key) {
    const name = String(key).toLowerCase(), { app, file } = this.owner();
    const values = { name: file.extension === 'md' ? file.basename : file.name, basename: file.basename, fullname: file.name, path: file.path, folder: file.parent?.path || '/', ext: file.extension, size: file.stat?.size || 0 };
    if (name === 'file') return this;
    if (Object.hasOwn(values, name)) return values[name];
    if (name === 'ctime' || name === 'mtime') return this.memo(name, () => new BaseDate(file.stat?.[name] || 0));
    if (name === 'properties') return this.properties();
    if (name === 'links' || name === 'embeds') return this.refs(name);
    if (name === 'backlinks') return this.memo(name, () => Object.keys(app.metadataCache.resolvedLinks || {}).filter(path => Object.hasOwn(app.metadataCache.resolvedLinks[path] || {}, file.path)).map(path => new BaseLink(path, path.split('/').pop()?.replace(/\.md$/, ''), app)));
    if (name === 'tags') return this.tags();
    throw new Error('文件没有属性：' + key);
  }
  properties() { const { app, file } = this.owner(); return this.memo('properties', () => convertBaseProperty(app.metadataCache.getFileCache(file)?.frontmatter || {}, app, file.path)); }
  refs(kind = 'links') {
    return this.memo(kind, () => {
      const { app, file } = this.owner(), refs = [], cache = app.metadataCache.getFileCache(file) || {};
      // 原版 links 使用 iterateRefsForFile：正文链接、嵌入和属性链接均参与。
      if (kind === 'links' && app.metadataCache.iterateRefsForFile) app.metadataCache.iterateRefsForFile(file, ref => refs.push(ref));
      else if (kind === 'links') refs.push(...(cache.links || []), ...(cache.embeds || []), ...(cache.frontmatterLinks || []));
      else refs.push(...(cache.embeds || []));
      return refs.map(ref => new BaseLink(ref.link, ref.displayText || null, app, file.path));
    });
  }
  tags() {
    return this.memo('tags', () => {
      const { app, file } = this.owner(), cache = app.metadataCache.getFileCache(file) || {};
      const front = cache.frontmatter?.[ownKey(cache.frontmatter || {}, 'tags')];
      const frontTags = Array.isArray(front) ? front : typeof front === 'string' ? front.split(/[,\s]+/) : [];
      const tags = [...(cache.tags || []).map(tag => tag.tag), ...frontTags].map(tag => '#' + String(tag).replace(/^#/, ''));
      return [...new Set(tags)].map(tag => new BaseTag(tag));
    });
  }
  inFolder(folder) { const name = folder.replace(/^\/+|\/+$/g, ''); return !name || this.path.startsWith(name + '/'); }
  hasTag(...tags) { return this.tags().some(tag => tags.some(value => tag.matches(value))); }
  hasProperty(name) { return ownKey(this.properties(), name) !== undefined; }
  asLink(display = null) { return new BaseLink(this.path, display, this.owner().app); }
  hasLink(target) {
    const { app } = this.owner();
    const file = target instanceof BaseFile ? target.owner().file : target instanceof BaseLink ? target.resolve() : app.metadataCache.getFirstLinkpathDest(String(target).replace(/^\[\[|\]\]$/g, '').split('#')[0], '');
    const resolved = typeof file === 'string' ? app.vault.getFileByPath(file) : file;
    return this.refs().some(link => resolved ? link.resolve()?.path === resolved.path : link.path === String(target));
  }
}
export function resolveBaseFile(context, input) {
  if (input instanceof BaseFile) return input;
  const resolved = input instanceof BaseLink ? input.resolve() : context.app?.metadataCache.getFirstLinkpathDest(String(input).replace(/^\[\[|\]\]$/g, '').split('#')[0], '');
  const file = typeof resolved === 'string' ? context.app.vault.getFileByPath(resolved) : resolved;
  return file ? new BaseFile(context.app, file) : null;
}
