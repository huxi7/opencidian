/**
 * [INPUT]: 依赖 ./events.js 的 Events；Node fs/path 与 Chokidar；监听首次扫描与运行事件队列
 * 文件时间按原版 Ul 使用取整的 birthtimeMs/mtimeMs，ctime 不随属性编辑漂移。
 * [OUTPUT]: 导出严格文件树、VaultEvents 事件表及磁盘适配器；watch 返回就绪结果。
 * rename 使用排他目标；trash 保留可恢复文件；复制仅按文件格式读取一次。
 * [POS]: core/ 的磁盘真相源。移动同步父子树；监听补齐扫描空档。隐藏配置仅经适配器读取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Vault + file system adapter. Mirrors Obsidian's Vault/TFile/TFolder model. */
import { Events } from './events.js';
import type { FileStat } from '../../contracts.js';

const fs: typeof import('node:fs') = require('fs');
const nodePath: typeof import('node:path') = require('path');
const chokidar: typeof import('chokidar') = require('chokidar');
interface VaultRuntime {
  __fileToken?: string;
  __electronTrash?: (absolutePath: string) => Promise<boolean>;
}
const runtime: typeof globalThis & VaultRuntime = globalThis;
interface WriteOptions { flag?: string; }
type BinaryData = NodeJS.ArrayBufferView;
type WatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type VaultEntry = TFile | TFolder;
export interface VaultEvents {
  resolved: [];
  initialized: [];
  create: [file: VaultEntry];
  modify: [file: TFile];
  delete: [file: VaultEntry];
  rename: [file: VaultEntry, oldPath: string];
  'watch-error': [error: unknown];
}
function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
function destinationExists(): Error & { code: string } {
  return Object.assign(new Error('Destination file already exists.'), { code: 'EEXIST' });
}

export class TAbstractFile {
  vault: Vault;
  path: string;
  name: string;

  constructor(vault: Vault, path: string) {
    this.vault = vault;
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
  get parent(): TFolder {
    const parentPath = this.path.split('/').slice(0, -1).join('/');
    return this.vault.getFolderByPath(parentPath) || this.vault.getRoot();
  }
};

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat: FileStat;

  constructor(vault: Vault, path: string) {
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
  children: VaultEntry[];
  isRoot: () => boolean;

  constructor(vault: Vault, path: string) {
    super(vault, path);
    this.children = [];
    this.isRoot = () => this.path === '/' || this.path === '';
  }
}

// original nu(): a path is hidden when any of its segments starts with "."
// Hidden paths never enter the vault tree — the explorer, search and graph
// never see them. (.obsidian config is read directly through the adapter.)
export function isHiddenPath(path: string) {
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
  basePath: string;
  watcher: import('chokidar').FSWatcher | null;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.watcher = null;
  }
  getName() { return nodePath.basename(this.basePath); }
  getBasePath() { return this.basePath; }
  toAbs(p: string) {
    if (!p || p === '/') return this.basePath;
    return nodePath.join(this.basePath, p);
  }
  toRel(abs: string) {
    let rel = nodePath.relative(this.basePath, abs);
    return rel.split(nodePath.sep).join('/');
  }
  async exists(p: string) { try { await fs.promises.access(this.toAbs(p)); return true; } catch (e) { return false; } }
  existsSync(p: string) { return fs.existsSync(this.toAbs(p)); }
  async stat(p: string) {
    const s = await fs.promises.stat(this.toAbs(p));
    return { type: s.isDirectory() ? 'folder' : 'file', ctime: Math.round(s.birthtimeMs), mtime: Math.round(s.mtimeMs), size: s.size };
  }
  async list(p: string) {
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
  async read(p: string) { return fs.promises.readFile(this.toAbs(p), 'utf8'); }
  async readBinary(p: string) { return fs.promises.readFile(this.toAbs(p)); }
  async write(p: string, data: string, options: WriteOptions = {}) { await fs.promises.mkdir(nodePath.dirname(this.toAbs(p)), { recursive: true }); await fs.promises.writeFile(this.toAbs(p), data, { encoding: 'utf8', flag: options.flag || 'w' }); }
  async writeBinary(p: string, data: BinaryData, options: WriteOptions = {}) { await fs.promises.mkdir(nodePath.dirname(this.toAbs(p)), { recursive: true }); await fs.promises.writeFile(this.toAbs(p), data, { flag: options.flag || 'w' }); }
  async append(p: string, data: string) { await fs.promises.appendFile(this.toAbs(p), data, 'utf8'); }
  async mkdir(p: string) { await fs.promises.mkdir(this.toAbs(p), { recursive: true }); }
  async remove(p: string) { await fs.promises.unlink(this.toAbs(p)); }
  async rmdir(p: string, recursive: boolean) {
    if (recursive) await fs.promises.rm(this.toAbs(p), { recursive: true, force: true });
    else await fs.promises.rmdir(this.toAbs(p));
  }
  async rename(from: string, to: string) {
    const source = this.toAbs(from), destination = this.toAbs(to);
    await fs.promises.mkdir(nodePath.dirname(destination), { recursive: true });
    // macOS 大小写重命名指向同一目录项；直接执行 rename 换大小写。
    if (source.toLowerCase() === destination.toLowerCase()) {
      await fs.promises.rename(source, destination);
      return;
    }
    const stat = await fs.promises.lstat(source);
    if (!stat.isDirectory()) {
      try {
        await fs.promises.link(source, destination);
        await fs.promises.unlink(source);
        return;
      } catch (err) {
        if (errorCode(err) === 'EEXIST') throw destinationExists();
        if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(errorCode(err) || '')) throw err;
      }
    }
    try {
      await fs.promises.lstat(destination);
      throw destinationExists();
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    await fs.promises.rename(source, destination);
  }
  async copy(from: string, to: string) {
    await fs.promises.mkdir(nodePath.dirname(this.toAbs(to)), { recursive: true });
    await fs.promises.copyFile(this.toAbs(from), this.toAbs(to));
  }
  getResourcePath(p: string) { return `app://` + (runtime.__fileToken || 'file') + '/' + this.toAbs(p).replace(/^\//, ''); }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------
export class Vault extends Events<VaultEvents> {
  adapter: FileSystemAdapter;
  root: TFolder;
  all: Map<string, VaultEntry>;
  fileMap: Map<string, TFile>;
  _initialized: boolean;
  _trashQueue: Promise<void> | null = null;
  _watchGeneration = 0;
  watcher: import('chokidar').FSWatcher | null = null;
  _watchReady: Promise<boolean> | null = null;
  _watchCancel: (() => void) | null = null;

  constructor(adapter: FileSystemAdapter) {
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

  async recurseLoad(folder: TFolder) {
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

  sortFolder(folder: TFolder) {
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

  getAbstractFileByPath(path: string) {
    if (path === '/' || path === '') return this.root;
    return this.all.get(normalizePath(path)) || null;
  }

  getFileByPath(path: string) {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  getFolderByPath(path: string) {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }

  getMarkdownFiles() {
    const out = [];
    for (const f of this.fileMap.values()) if (f.extension === 'md') out.push(f);
    return out;
  }

  getFiles() { return Array.from(this.fileMap.values()); }

  async read(file: TFile) { return this.adapter.read(file.path); }
  async cachedRead(file: TFile) { return this.read(file); }
  async readBinary(file: TFile) { return this.adapter.readBinary(file.path); }

  async create(path: string, data: string, options: WriteOptions = {}) {
    path = normalizePath(path);
    if (this.all.has(path)) throw new Error('File already exists.');
    // 内存索引晚于外部写入和其它窗口；排他创建由文件系统裁决。
    await this.adapter.write(path, data, { flag: 'wx' });
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

  async createBinary(path: string, data: BinaryData) {
    path = normalizePath(path);
    if (this.all.has(path)) throw new Error('File already exists.');
    await this.adapter.writeBinary(path, data, { flag: 'wx' });
    const file = new TFile(this, path);
    const stat = await this.adapter.stat(path).catch(() => null);
    if (stat) file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
    this.all.set(path, file);
    this.fileMap.set(path, file);
    const parent = this.getFolderByPath(parentPathOf(path));
    if (parent) { parent.children.push(file); this.sortFolder(parent); }
    this.trigger('create', file);
    return file;
  }

  async createFolder(path: string) {
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

  async modify(file: TFile, data: string) {
    await this.adapter.write(file.path, data);
    try { const st = await this.adapter.stat(file.path); file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size }; } catch (e) {}
    this.trigger('modify', file);
    return file;
  }

  async modifyBinary(file: TFile, data: BinaryData) {
    await this.adapter.writeBinary(file.path, data);
    this.trigger('modify', file);
    return file;
  }

  async append(file: TFile, data: string) {
    await this.adapter.append(file.path, data);
    this.trigger('modify', file);
  }

  async delete(file: VaultEntry, permanent = false) {
    if (!file || file === this.root) throw new Error('不能删除库根目录。');
    if (!permanent) return this.trash(file, true);
    if (file instanceof TFolder) await this.adapter.rmdir(file.path, true);
    else await this.adapter.remove(file.path);
    this.removeFromMaps(file);
    this.trigger('delete', file);
  }

  async trash(file: VaultEntry, system = true) {
    if (!file || file === this.root) throw new Error('不能回收库根目录。');
    // 同窗回收串行选择空闲名称；系统失败只降级本地回收，不永久删除。
    const operation = (this._trashQueue || Promise.resolve()).catch(() => {}).then(async () => {
      let recycled = false;
      if (system && runtime.__electronTrash) {
        try { recycled = await runtime.__electronTrash(this.adapter.toAbs(file.path)); } catch {}
      }
      if (!recycled) {
        await this.adapter.mkdir('.trash');
        const extension = file instanceof TFile && file.extension ? '.' + file.extension : '';
        const basename = extension ? file.name.slice(0, -extension.length) : file.name;
        let destination = '.trash/' + file.name, index = 1;
        while (await this.adapter.exists(destination)) destination = '.trash/' + basename + ' ' + (++index) + extension;
        await this.adapter.rename(file.path, destination);
      }
      this.removeFromMaps(file);
      this.trigger('delete', file);
    });
    this._trashQueue = operation;
    try { return await operation; } finally { if (this._trashQueue === operation) this._trashQueue = null; }
  }

  removeFromMaps(file: VaultEntry) {
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

  async rename(file: VaultEntry, newPath: string) {
    newPath = normalizePath(newPath);
    if (!file || file === this.root || !newPath) throw new Error('不能移动库根目录。');
    const oldPath = file.path;
    if (newPath === oldPath) return;
    if (file instanceof TFolder && newPath.startsWith(oldPath + '/')) throw new Error('不能将文件夹移入自身。');
    if (this.all.has(newPath)) throw new Error('Destination file already exists.');
    const oldParent = this.getFolderByPath(parentPathOf(oldPath));
    const newParent = this.getFolderByPath(parentPathOf(newPath));
    if (!newParent) throw new Error('目标文件夹不存在。');
    await this.adapter.rename(oldPath, newPath);

    const update = (f: VaultEntry, p: string) => {
      this.all.delete(f.path);
      if (f instanceof TFile) this.fileMap.delete(f.path);
      f.path = p;
      f.name = p.split('/').pop() || '';
      this.all.set(p, f);
      if (f instanceof TFile) {
        const dot = f.name.lastIndexOf('.');
        if (dot > 0) { f.extension = f.name.slice(dot + 1); f.basename = f.name.slice(0, dot); }
        else { f.extension = ''; f.basename = f.name; }
        this.fileMap.set(p, f);
      }
    };
    const renameTree = (f: VaultEntry, prefix: string, newPrefix: string): void => {
      const children = f instanceof TFolder ? [...f.children] : [];
      update(f, newPrefix + f.path.slice(prefix.length));
      for (const c of children) renameTree(c, prefix, newPrefix);
    };
    renameTree(file, oldPath, newPath);
    if (oldParent !== newParent) {
      const index = oldParent?.children.indexOf(file) ?? -1;
      if (oldParent && index >= 0) oldParent.children.splice(index, 1);
      if (!newParent.children.includes(file)) newParent.children.push(file);
    }
    if (oldParent) this.sortFolder(oldParent);
    this.sortFolder(newParent);
    this.trigger('rename', file, oldPath);
  }

  async copy(file: VaultEntry, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    if (file instanceof TFolder) {
      await this.createFolder(newPath);
      for (const child of file.children) {
        await this.copy(child, newPath + '/' + child.name);
      }
    } else {
      if (file.extension === 'md') await this.create(newPath, await this.read(file));
      else await this.createBinary(newPath, await this.readBinary(file));
    }
  }

  // 首次事件与扫描模型对账；ready 只有在初始队列完成后才返回。
  watch(): Promise<boolean> {
    if (this.watcher && this._watchReady) return this._watchReady;
    this._watchCancel?.();
    const generation = this._watchGeneration = (this._watchGeneration || 0) + 1;
    const watcher = this.watcher = chokidar.watch(this.adapter.getBasePath(), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      ignored: p => isHiddenPath(this.adapter.toRel(p)) || nodePath.basename(p) === 'node_modules',
    });
    const current = () => this.watcher === watcher && this._watchGeneration === generation;
    const visible = (rel: string) => rel && rel !== '/' && !rel.startsWith('../') && rel !== '..' && !isHiddenPath(rel);
    const remove = (rel: string) => { const file = this.all.get(rel); if (file) { this.removeFromMaps(file); this.trigger('delete', file); } };
    const update = async (event: WatchEvent, rel: string): Promise<VaultEntry | null> => {
      if (!current() || !visible(rel)) return null;
      if (event === 'unlink' || event === 'unlinkDir') { remove(rel); return null; }
      let stat;
      try { stat = await this.adapter.stat(rel); }
      catch (error) { if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') { if (current()) remove(rel); return null; } throw error; }
      if (!current()) return null;
      let existing = this.all.get(rel);
      const folder = stat.type === 'folder';
      if (existing && folder !== (existing instanceof TFolder)) { remove(rel); existing = undefined; }
      if (!existing) {
        // 初始事件通常父目录在先；运行期缺父目录时先补齐真实父目录。
        const parentPath = parentPathOf(rel);
        if (parentPath !== '/' && !this.getFolderByPath(parentPath)) await update('addDir', parentPath);
        if (!current()) return null;
        existing = this.all.get(rel);
        if (!existing) {
          existing = folder ? new TFolder(this, rel) : new TFile(this, rel);
          if (existing instanceof TFile) existing.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
          this.all.set(rel, existing); if (existing instanceof TFile) this.fileMap.set(rel, existing);
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
    let queue: Promise<unknown> = Promise.resolve();
    let settled = false;
    let resolveReady!: (ready: boolean) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = this._watchReady = new Promise<boolean>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // 保留返回给调用方的拒绝，同时避免旧调用方未等待时产生未捕获 Promise。
    ready.catch(() => {});
    this._watchCancel = () => { if (!settled) { settled = true; resolveReady(false); } };
    const fail = (error: unknown) => {
      if (!current()) return;
      if (!settled) { settled = true; rejectReady(error); }
      else this.trigger('watch-error', error);
    };
    const enqueue = (action: () => unknown | Promise<unknown>) => { queue = queue.then(() => current() ? action() : null).catch(fail); return queue; };
    watcher.on('all', (event, absolute) => enqueue(() => update(event, this.adapter.toRel(absolute))));
    watcher.on('error', fail);
    watcher.once('ready', () => enqueue(async () => {
      const seen = new Set(['/']);
      const scan = async (folder: string): Promise<void> => {
        if (!current()) return;
        let listing;
        try { listing = await this.adapter.list(folder); }
        catch (error) { if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return; throw error; }
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

export function normalizePath(path: string) {
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

export function parentPathOf(path: string) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
}

export function isDotPath(path: string) {
  return path.split('/').some((p) => p.startsWith('.'));
}
