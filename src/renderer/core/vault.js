/**
 * [INPUT]: 依赖 ./events.js 的 Events；Node 内置 fs/path/chokidar/os；监听首次扫描与运行事件队列
 * 文件时间按原版 Ul 使用取整的 birthtimeMs/mtimeMs，ctime 不随属性编辑漂移。
 * [OUTPUT]: 导出 Vault、TFile、TFolder、TAbstractFile、FileSystemAdapter、isHiddenPath；watch 返回就绪 Promise，stopWatch 返回关闭 Promise
 * [POS]: core/ 的文件模型与磁盘适配层，全应用唯一文件真相源。监听 ready 前补齐扫描空档，事件按代次串行。首次扫描与文件监听均拒绝点开头路径段（原版 nu() 语义）——.obsidian 配置经适配器直读，不暴露给插件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Vault + file system adapter. Mirrors Obsidian's Vault/TFile/TFolder model. */
import { Events } from './events.js';

const fs = require('fs');
const nodePath = require('path');
const chokidar = require('chokidar');
const os = require('os');

export const TAbstractFile = class {
  constructor(vault, path) {
    this.vault = vault;
    this.path = path;
    this.name = path.split('/').pop();
  }
  get parent() {
    const parentPath = this.path.split('/').slice(0, -1).join('/');
    return this.vault.getAbstractFileByPath(parentPath) || this.vault.getRoot();
  }
};

export class TFile extends TAbstractFile {
  constructor(vault, path) {
    super(vault, path);
    const dot = this.name.lastIndexOf('.');
    if (dot > 0) {
      this.extension = this.name.slice(dot + 1);
      this.basename = this.name.slice(0, dot);
    } else {
      this.extension = '';
      this.basename = this.name;
    }
    this.stat = { ctime: 0, mtime: 0, size: 0 };
  }
}

export class TFolder extends TAbstractFile {
  constructor(vault, path) {
    super(vault, path);
    this.children = [];
    this.isRoot = () => this.path === '/' || this.path === '';
  }
}

// original nu(): a path is hidden when any of its segments starts with "."
// Hidden paths never enter the vault tree — the explorer, search and graph
// never see them. (.obsidian config is read directly through the adapter.)
export function isHiddenPath(path) {
  for (let p = path; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
    const seg = p.split('/').pop();
    if (seg && seg.startsWith('.')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Node fs adapter (async API used by the vault)
// ---------------------------------------------------------------------------
export class FileSystemAdapter {
  constructor(basePath) {
    this.basePath = basePath;
    this.watcher = null;
  }
  getName() { return nodePath.basename(this.basePath); }
  getBasePath() { return this.basePath; }
  toAbs(p) {
    if (!p || p === '/') return this.basePath;
    return nodePath.join(this.basePath, p);
  }
  toRel(abs) {
    let rel = nodePath.relative(this.basePath, abs);
    return rel.split(nodePath.sep).join('/');
  }
  async exists(p) { try { await fs.promises.access(this.toAbs(p)); return true; } catch (e) { return false; } }
  existsSync(p) { return fs.existsSync(this.toAbs(p)); }
  async stat(p) {
    const s = await fs.promises.stat(this.toAbs(p));
    return { type: s.isDirectory() ? 'folder' : 'file', ctime: Math.round(s.birthtimeMs), mtime: Math.round(s.mtimeMs), size: s.size };
  }
  async list(p) {
    const dir = this.toAbs(p);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    const folders = [];
    for (const e of entries) {
      const childPath = (p === '/' || p === '' ? '' : p + '/') + e.name;
      if (e.isDirectory()) folders.push(childPath);
      else files.push(childPath);
    }
    return { files, folders };
  }
  async read(p) { return fs.promises.readFile(this.toAbs(p), 'utf8'); }
  async readBinary(p) { return fs.promises.readFile(this.toAbs(p)); }
  async write(p, data) { await fs.promises.mkdir(nodePath.dirname(this.toAbs(p)), { recursive: true }); await fs.promises.writeFile(this.toAbs(p), data, 'utf8'); }
  async writeBinary(p, data) { await fs.promises.mkdir(nodePath.dirname(this.toAbs(p)), { recursive: true }); await fs.promises.writeFile(this.toAbs(p), data); }
  async append(p, data) { await fs.promises.appendFile(this.toAbs(p), data, 'utf8'); }
  async mkdir(p) { await fs.promises.mkdir(this.toAbs(p), { recursive: true }); }
  async remove(p) { await fs.promises.unlink(this.toAbs(p)); }
  async rmdir(p, recursive) {
    if (recursive) await fs.promises.rm(this.toAbs(p), { recursive: true, force: true });
    else await fs.promises.rmdir(this.toAbs(p));
  }
  async rename(from, to) {
    await fs.promises.mkdir(nodePath.dirname(this.toAbs(to)), { recursive: true });
    await fs.promises.rename(this.toAbs(from), this.toAbs(to));
  }
  async copy(from, to) {
    await fs.promises.mkdir(nodePath.dirname(this.toAbs(to)), { recursive: true });
    await fs.promises.copyFile(this.toAbs(from), this.toAbs(to));
  }
  getResourcePath(p) { return `app://` + (globalThis.__fileToken || 'file') + '/' + this.toAbs(p).replace(/^\//, ''); }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------
export class Vault extends Events {
  constructor(adapter) {
    super();
    this.adapter = adapter;
    this.root = new TFolder(this, '/');
    this.root.path = '/';
    this.root.name = adapter.getName();
    this.all = new Map();      // path -> TAbstractFile
    this.all.set('/', this.root);
    this.fileMap = new Map();  // path -> TFile
    this._initialized = false;
  }

  get configDir() { return '.obsidian'; }

  async initialize() {
    await this.recurseLoad(this.root);
    this._initialized = true;
    this.trigger('resolved');
    if (this._initialized) this.trigger('initialized');
  }

  async recurseLoad(folder) {
    const listing = await this.adapter.list(folder.path).catch(() => ({ files: [], folders: [] }));
    for (const f of listing.folders) {
      if (isHiddenPath(f)) continue;
      const sub = new TFolder(this, f);
      this.all.set(f, sub);
      folder.children.push(sub);
      await this.recurseLoad(sub);
    }
    for (const f of listing.files) {
      if (isHiddenPath(f)) continue;
      const file = new TFile(this, f);
      try {
        const st = await this.adapter.stat(f);
        file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size };
      } catch (e) {}
      this.all.set(f, file);
      this.fileMap.set(f, file);
      folder.children.push(file);
    }
    this.sortFolder(folder);
  }

  sortFolder(folder) {
    folder.children.sort((a, b) => {
      const aFolder = a instanceof TFolder;
      const bFolder = b instanceof TFolder;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  getRoot() { return this.root; }
  getName() { return this.adapter.getName(); }
  getBasePath() { return this.adapter.getBasePath(); }

  getAbstractFileByPath(path) {
    if (path === '/' || path === '') return this.root;
    return this.all.get(normalizePath(path)) || null;
  }

  getFileByPath(path) {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  getFolderByPath(path) {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }

  getMarkdownFiles() {
    const out = [];
    for (const f of this.fileMap.values()) if (f.extension === 'md') out.push(f);
    return out;
  }

  getFiles() { return Array.from(this.fileMap.values()); }

  async read(file) { return this.adapter.read(file.path); }
  async cachedRead(file) { return this.read(file); }
  async readBinary(file) { return this.adapter.readBinary(file.path); }

  async create(path, data, options = {}) {
    path = normalizePath(path);
    if (this.all.has(path)) throw new Error('File already exists.');
    await this.adapter.write(path, data);
    const file = new TFile(this, path);
    const st = await this.adapter.stat(path).catch(() => null);
    if (st) file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size };
    this.all.set(path, file);
    this.fileMap.set(path, file);
    const parent = this.getFolderByPath(parentPathOf(path));
    if (parent) { parent.children.push(file); this.sortFolder(parent); }
    this.trigger('create', file);
    return file;
  }

  async createBinary(path, data) {
    path = normalizePath(path);
    if (this.all.has(path)) throw new Error('File already exists.');
    await this.adapter.writeBinary(path, data);
    const file = new TFile(this, path);
    this.all.set(path, file);
    this.fileMap.set(path, file);
    const parent = this.getFolderByPath(parentPathOf(path));
    if (parent) { parent.children.push(file); this.sortFolder(parent); }
    this.trigger('create', file);
    return file;
  }

  async createFolder(path) {
    path = normalizePath(path);
    if (this.all.has(path)) throw new Error('Folder already exists.');
    await this.adapter.mkdir(path);
    const folder = new TFolder(this, path);
    this.all.set(path, folder);
    const parent = this.getFolderByPath(parentPathOf(path));
    if (parent) { parent.children.push(folder); this.sortFolder(parent); }
    this.trigger('create', folder);
    return folder;
  }

  async modify(file, data) {
    await this.adapter.write(file.path, data);
    try { const st = await this.adapter.stat(file.path); file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size }; } catch (e) {}
    this.trigger('modify', file);
    return file;
  }

  async modifyBinary(file, data) {
    await this.adapter.writeBinary(file.path, data);
    this.trigger('modify', file);
    return file;
  }

  async append(file, data) {
    await this.adapter.append(file.path, data);
    this.trigger('modify', file);
  }

  async delete(file, permanent = false) {
    if (file instanceof TFolder && !file.isRoot()) {
      await this.adapter.rmdir(file.path, true);
    } else {
      if (permanent) await this.adapter.remove(file.path);
      else {
        const ok = globalThis.__electronTrash ? await globalThis.__electronTrash(this.adapter.toAbs(file.path)) : false;
        if (!ok) await this.adapter.remove(file.path);
      }
    }
    this.removeFromMaps(file);
    this.trigger('delete', file);
  }

  removeFromMaps(file) {
    if (file instanceof TFolder) {
      for (const child of [...file.children]) this.removeFromMaps(child);
    }
    this.all.delete(file.path);
    if (file instanceof TFile) this.fileMap.delete(file.path);
    const parent = this.getFolderByPath(parentPathOf(file.path));
    if (parent) {
      const i = parent.children.indexOf(file);
      if (i >= 0) parent.children.splice(i, 1);
    }
  }

  async rename(file, newPath) {
    newPath = normalizePath(newPath);
    const oldPath = file.path;
    if (this.all.has(newPath)) throw new Error('Destination file already exists.');
    await this.adapter.rename(oldPath, newPath);

    const update = (f, p) => {
      this.all.delete(f.path);
      if (f instanceof TFile) this.fileMap.delete(f.path);
      f.path = p;
      f.name = p.split('/').pop();
      this.all.set(p, f);
      if (f instanceof TFile) {
        const dot = f.name.lastIndexOf('.');
        if (dot > 0) { f.extension = f.name.slice(dot + 1); f.basename = f.name.slice(0, dot); }
        else { f.extension = ''; f.basename = f.name; }
        this.fileMap.set(p, f);
      }
    };
    const renameTree = (f, prefix, newPrefix) => {
      const children = f instanceof TFolder ? [...f.children] : [];
      update(f, newPrefix + f.path.slice(prefix.length));
      for (const c of children) renameTree(c, prefix, newPrefix);
    };
    renameTree(file, oldPath, newPath);
    for (const c of (file instanceof TFolder ? file.children : [])) void c;
    this.trigger('rename', file, oldPath);
  }

  async copy(file, newPath) {
    newPath = normalizePath(newPath);
    if (file instanceof TFolder) {
      await this.createFolder(newPath);
      for (const child of file.children) {
        await this.copy(child, newPath + '/' + child.name);
      }
    } else {
      const data = await this.readBinary(file);
      if (file.extension === 'md') await this.create(newPath, await this.read(file));
      else await this.createBinary(newPath, data);
    }
  }

  // 首次事件与扫描模型对账；ready 只有在初始队列完成后才返回。
  watch() {
    if (this.watcher) return this._watchReady;
    this._watchCancel?.();
    const generation = this._watchGeneration = (this._watchGeneration || 0) + 1;
    const watcher = this.watcher = chokidar.watch(this.adapter.getBasePath(), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignored: p => isHiddenPath(this.adapter.toRel(p)) || nodePath.basename(p) === 'node_modules',
    });
    const current = () => this.watcher === watcher && this._watchGeneration === generation;
    const visible = rel => rel && rel !== '/' && !rel.startsWith('../') && rel !== '..' && !isHiddenPath(rel);
    const remove = rel => { const file = this.all.get(rel); if (file) { this.removeFromMaps(file); this.trigger('delete', file); } };
    const update = async (event, rel) => {
      if (!current() || !visible(rel)) return null;
      if (event === 'unlink' || event === 'unlinkDir') { remove(rel); return null; }
      let stat;
      try { stat = await this.adapter.stat(rel); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') { if (current()) remove(rel); return null; } throw error; }
      if (!current()) return null;
      let existing = this.all.get(rel);
      const folder = stat.type === 'folder';
      if (existing && folder !== (existing instanceof TFolder)) { remove(rel); existing = null; }
      if (!existing) {
        // 初始事件通常父目录在先；运行期缺父目录时先补齐真实父目录。
        const parentPath = parentPathOf(rel);
        if (parentPath !== '/' && !this.getFolderByPath(parentPath)) await update('addDir', parentPath);
        if (!current()) return null;
        existing = this.all.get(rel);
        if (!existing) {
          existing = folder ? new TFolder(this, rel) : new TFile(this, rel);
          if (!folder) existing.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
          this.all.set(rel, existing); if (!folder) this.fileMap.set(rel, existing);
          const parent = this.getFolderByPath(parentPath);
          if (parent && !parent.children.includes(existing)) { parent.children.push(existing); this.sortFolder(parent); }
          this.trigger('create', existing); return existing;
        }
      }
      if (existing instanceof TFile) {
        const changed = stat.mtime !== existing.stat.mtime || stat.size !== existing.stat.size || stat.ctime !== existing.stat.ctime;
        existing.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
        if (event === 'change' || changed) this.trigger('modify', existing);
      }
      return existing;
    };
    let queue = Promise.resolve(), settled = false;
    let resolveReady, rejectReady;
    const ready = this._watchReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // 保留返回给调用方的拒绝，同时避免旧调用方未等待时产生未捕获 Promise。
    ready.catch(() => {});
    this._watchCancel = () => { if (!settled) { settled = true; resolveReady(false); } };
    const fail = error => {
      if (!current()) return;
      if (!settled) { settled = true; rejectReady(error); }
      else this.trigger('watch-error', error);
    };
    const enqueue = action => { queue = queue.then(() => current() ? action() : null).catch(fail); return queue; };
    watcher.on('all', (event, absolute) => enqueue(() => update(event, this.adapter.toRel(absolute))));
    watcher.on('error', fail);
    watcher.once('ready', () => enqueue(async () => {
      const seen = new Set(['/']);
      const scan = async folder => {
        if (!current()) return;
        let listing;
        try { listing = await this.adapter.list(folder); }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return; throw error; }
        for (const path of listing.folders) {
          if (!visible(path) || nodePath.basename(path) === 'node_modules') continue;
          if (await update('addDir', path)) { seen.add(path); await scan(path); }
        }
        for (const path of listing.files) if (visible(path) && await update('add', path)) seen.add(path);
      };
      await scan('/');
      if (!current()) return;
      for (const path of [...this.all.keys()]) if (visible(path) && !path.split('/').includes('node_modules') && !seen.has(path)) remove(path);
      if (!settled) { settled = true; resolveReady(true); }
    }));
    return ready;
  }

  stopWatch() {
    const watcher = this.watcher;
    this._watchGeneration = (this._watchGeneration || 0) + 1;
    this.watcher = null; this._watchCancel?.(); this._watchCancel = null; this._watchReady = null;
    return watcher ? Promise.resolve(watcher.close()) : Promise.resolve();
  }

}

export function normalizePath(path) {
  if (!path) return '/';
  path = String(path).replace(/\\/g, '/');
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

export function parentPathOf(path) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
}

export function isDotPath(path) {
  return path.split('/').some((p) => p.startsWith('.'));
}
