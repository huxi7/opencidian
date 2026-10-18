/**
 * [INPUT]: 依赖 ./vault.js 的 TFile/TFolder/normalizePath/parentPathOf；依赖 ./i18n.js 的 t/tt；依赖 ./vault-utils.js 的 getUniquePath；依赖 ./notices.js 的 Notice；依赖 ./modals.js 的 Modal/confirmDialog
 * [OUTPUT]: 导出 FileManager 类（新建/重命名/删除/移动/附件路径解析/内部链接更新/processFrontMatter）
 * [POS]: core/ 的文件操作中枢，被 file-explorer、编辑器与命令层调用。重命名流程：先统计受影响链接数（links/files）→ 改磁盘名 → 按 alwaysUpdateLinks 静默更新或弹窗（总是更新/仅此一次/不做更新）→ 最后修 metadataCache；顺序不可颠倒。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* File manager — create/rename/delete/move with automatic link updates. */
import { TFile, TFolder, normalizePath, parentPathOf } from './vault.js';
import { t, tt } from './i18n.js';
import { getUniquePath } from './vault-utils.js';
import { Notice } from './notices.js';
import { Modal, confirmDialog } from './modals.js';

export class FileManager {
  constructor(app) {
    this.app = app;
  }

  getNewFileParent(sourcePath) {
    const settings = this.app.settings.appSettings;
    const loc = settings.newFileLocation;
    if (loc === 'root') return this.app.vault.getRoot();
    if (loc === 'folder') {
      const folder = this.app.vault.getFolderByPath(settings.newFileFolderPath);
      return folder || this.app.vault.getRoot();
    }
    // current
    if (sourcePath) {
      const folder = this.app.vault.getFolderByPath(parentPathOf(sourcePath));
      if (folder) return folder;
    }
    return this.app.vault.getRoot();
  }

  async getAvailablePathForAttachment(filename, sourcePath) {
    const settings = this.app.settings.appSettings;
    let folderPath = settings.attachmentFolderPath || '/';
    if (folderPath === './' || folderPath === '.') {
      // 当前文件所在的文件夹
      folderPath = sourcePath ? parentPathOf(sourcePath) : '/';
    } else if (folderPath.startsWith('./')) {
      // 当前文件夹下指定的子文件夹
      const parent = sourcePath ? parentPathOf(sourcePath) : '/';
      folderPath = normalizePath((parent === '/' ? '' : parent) + '/' + folderPath.slice(2));
    } else if (!folderPath.startsWith('/')) {
      // 相对仓库根目录的指定文件夹
      folderPath = '/' + folderPath;
    }
    const base = folderPath === '/' ? '' : folderPath + '/';
    return getUniquePath(this.app, normalizePath(base + filename));
  }

  async createNewMarkdownFile(folder, filename, content = '') {
    return this.createNewFile(folder, filename, content);
  }

  async createNewFile(folder, filename, content = '') {
    if (!folder) folder = this.app.vault.getRoot();
    let path = filename;
    if (!path.toLowerCase().endsWith('.md') && !path.includes('.')) path += '.md';
    let full = normalizePath((folder.path === '/' ? '' : folder.path + '/') + path);
    full = await this.getUniquePath(full);
    const file = await this.app.vault.create(full, content);
    return file;
  }

  async getUniquePath(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const dir = parentPathOf(path);
    const name = path.split('/').pop();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 1000; i++) {
      const candidate = normalizePath((dir === '/' ? '' : dir + '/') + `${base} ${i}${ext}`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
    return path;
  }

  getUniqueFilename(folder, base, ext) {
    const prefix = folder.path === '/' ? '' : folder.path + '/';
    if (!this.app.vault.getAbstractFileByPath(prefix + base + ext)) return base;
    for (let i = 1; i < 1000; i++) {
      if (!this.app.vault.getAbstractFileByPath(prefix + `${base} ${i}${ext}`)) return `${base} ${i}`;
    }
    return base;
  }

  generateMarkdownLink(file, sourcePath, subpath, alias, linkStyle) {
    const settings = this.app.settings.appSettings;
    let linktext;
    // linkStyle: 'wiki' | 'markdown' 强制链接格式（更新既有链接时保持原格式）；缺省跟随设置
    const useMarkdown = linkStyle ? linkStyle === 'markdown' : settings.useMarkdownLinks;
    const format = settings.newLinkFormat;
    // 原版语义：只有 Markdown 笔记省略 .md；附件（png/pdf/…）链接必须保留扩展名
    const isMd = file.extension === 'md';
    const displayName = isMd ? file.basename : file.name;
    let path = file.path;
    if (format !== 'absolute' && sourcePath) {
      const sourceDir = sourcePath.split('/').slice(0, -1).join('/');
      // prefer shortest: if basename unique, use basename
      const key = file.basename.toLowerCase();
      const candidates = this.app.metadataCache._basenameIndex ? this.app.metadataCache._basenameIndex.get(key) : null;
      const unique = !candidates || candidates.length <= 1;
      if (format === 'shortest' && unique) {
        linktext = isMd ? file.basename : file.name;
      } else if (format === 'relative' || (format === 'shortest' && !unique)) {
        let rel = relativePath(sourceDir, path);
        rel = rel.replace(/\.md$/i, '');
        linktext = rel;
      } else {
        linktext = path.replace(/\.md$/i, '');
      }
    } else {
      linktext = path.replace(/\.md$/i, '');
    }
    let sub = subpath ? (subpath.startsWith('^') ? '#' + subpath : (subpath.startsWith('#') ? subpath : '#' + subpath)) : '';
    if (useMarkdown && !alias) sub = sub; // markdown uses # section too
    if (useMarkdown) {
      const urlText = isMd && !linktext.endsWith('.md') ? linktext + '.md' : linktext;
      let url = encodeURI(urlText);
      if (sub) url += sub;
      url = url.replace(/ /g, '%20');
      return alias ? `[${alias}](${url})` : `[${displayName}](${url})`;
    }
    let inner = linktext + (sub ? '#' + sub.replace(/^#/, '') : '');
    if (alias) inner += '|' + alias;
    return `[[${inner}]]`;
  }

  async renameFile(file, newPath) {
    newPath = normalizePath(newPath);
    if (newPath === file.path) return true;
    if (!newPath) return false;
    // ensure extension
    if (file instanceof TFile && file.extension && !newPath.split('/').pop().includes('.')) newPath += '.' + file.extension;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice('File already exists: ' + newPath, 4000);
      return false;
    }
    const oldPath = file.path;
    // 链接更新必须在 metadataCache.onFileRename 之前完成：onFileRename 会迁移 resolvedLinks 的键，
    // 迁移后 updateLinks 按旧路径查找将一无所获。
    const affected = file instanceof TFile ? this._countAffectedLinks(oldPath) : { links: 0, files: 0 };
    try {
      await this.app.vault.rename(file, newPath);
    } catch (e) {
      console.error('Rename failed', e);
      return false;
    }
    if (file instanceof TFile && affected.links) await this._confirmLinkUpdate(oldPath, file, affected);
    this.app.metadataCache.onFileRename(file, oldPath);
    this.app.workspace.trigger('file-rename', file, oldPath);
    return true;
  }

  /**
   * 更新指向 oldPath 的链接文本。
   * affected 是 renameFile 在重命名前采集的快照（sources: 源文件 → 命中链接目标集合）：
   * 弹窗等待期间 metadataCache 会重解析并清掉旧键，只有快照才能精确定位受影响的链接。
   */
  async updateLinks(oldPath, file, affected) {
    const resolved = this.app.metadataCache.resolvedLinks;
    const useSnapshot = !!(affected && affected.sources);
    const sources = useSnapshot ? Object.keys(affected.sources) : Object.keys(resolved);
    for (const source of sources) {
      const links = resolved[source];
      if (!useSnapshot && !(links && links[oldPath])) continue;
      const snapshot = useSnapshot && affected.sources[source] && affected.sources[source].size
        ? affected.sources[source] : null;
      const isHit = (target, dest) => {
        if (snapshot) {
          if (snapshot.has(target)) return true;
          try { return snapshot.has(decodeURIComponent(target)); } catch (e) { return false; }
        }
        // 重命名后 basename 索引已指向新路径，故 oldPath 与新路径均视为命中
        return dest === oldPath || dest === file.path;
      };
      const sourceFile = this.app.vault.getFileByPath(source);
      if (!sourceFile) continue;
      try {
        let text = await this.app.vault.read(sourceFile);
        let changed = false;
        // wiki links
        text = text.replace(/(!?)\[\[([^\[\]]+?)\]\]/g, (full, bang, inner) => {
          const parts = inner.split('|');
          const linktext = parts[0];
          let target = linktext, sub = '';
          const hashIdx = linktext.indexOf('#');
          if (hashIdx >= 0) { target = linktext.slice(0, hashIdx); sub = linktext.slice(hashIdx); }
          const dest = this.app.metadataCache.getFirstLinkpathDest(target, source);
          if (isHit(target, dest)) {
            changed = true;
            const newTarget = this.generateMarkdownLink(file, source, sub.replace(/^#/, ''), undefined, 'wiki');
            // preserve alias
            if (parts.length > 1) {
              const alias = parts.slice(1).join('|');
              const link = newTarget.replace(/^(!?)\[\[([^\]]+?)\]\]$/, (m, b, inner2) => {
                const t2 = inner2.split('|')[0];
                return `${b}[[${t2}|${alias}]]`;
              });
              return bang + link.replace(/^!?/, '');
            }
            return bang + newTarget;
          }
          return full;
        });
        // markdown links
        text = text.replace(/(!?)\[([^\]]*)\]\(([^()\s]+(?:\s+"[^"]*")?)\)/g, (full, bang, label, url) => {
          if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return full;
          const [pathPart, ...rest] = url.split('#');
          const dest = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(pathPart), source);
          if (isHit(pathPart, dest)) {
            changed = true;
            // 保持 markdown 链接格式与显示文本（标签优先）
            return bang + this.generateMarkdownLink(file, source, rest.join('#'), label || undefined, 'markdown');
          }
          return full;
        });
        if (changed) {
          await this.app.vault.modify(sourceFile, text);
        }
      } catch (e) {
        console.error('Failed to update links in', source, e);
      }
    }
  }

  /** 统计指向 oldPath 的链接数与来源文件数，并快照每个源文件中命中的链接目标（对齐原版 labelLinkAffected）。 */
  _countAffectedLinks(oldPath) {
    const resolved = this.app.metadataCache.resolvedLinks || {};
    let links = 0, files = 0;
    const sources = {};
    for (const source of Object.keys(resolved)) {
      const n = resolved[source] && resolved[source][oldPath];
      if (!n) continue;
      files++;
      links += n;
      const targets = new Set();
      const cache = this.app.metadataCache.getCache(source);
      if (cache) {
        for (const entry of [...(cache.links || []), ...(cache.embeds || [])]) {
          if (!entry || entry.isExternal || !entry.link) continue;
          const base = entry.link.split('#')[0];
          const dest = this.app.metadataCache.getFirstLinkpathDest(base, source);
          if (dest !== oldPath) continue;
          targets.add(entry.link);
          targets.add(base);
          try { targets.add(decodeURIComponent(base)); } catch (e) {}
        }
      }
      sources[source] = targets;
    }
    return { links, files, sources };
  }

  /**
   * 重命名后的链接更新（对齐原版语义）：
   * alwaysUpdateLinks=true → 静默更新并提示；否则弹窗（总是更新 / 仅此一次 / 不做更新）。
   */
  async _confirmLinkUpdate(oldPath, file, affected) {
    const info = affected && affected.sources ? affected : this._countAffectedLinks(oldPath);
    const { links, files } = info;
    if (!links) return;
    const doUpdate = async () => {
      await this.updateLinks(oldPath, file, info);
      new Notice(tt('dialogue.msg-updated-links', `更新 ${files} 个文件中的 ${links} 处链接。`, { files, links }), 4000);
    };
    if (this.app.settings.appSettings.alwaysUpdateLinks) {
      await doUpdate();
      return;
    }
    await new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(tt('dialogue.label-update-links', '更新链接'));
      modal.contentEl.createEl('p', { text: tt('dialogue.label-confirm-update-link-to-file', '你是否需要更新与此文件相关联的内部链接？') });
      modal.contentEl.createEl('p', { text: tt('dialogue.label-link-affected', `这将影响 ${files} 个文件中的 ${links} 处链接。`, { files, links }) });
      const finish = async (update, always) => {
        modal.close();
        if (always) this.app.settings.updateAppSettings({ alwaysUpdateLinks: true });
        if (update) await doUpdate();
        resolve();
      };
      modal.buttonContainerEl.createEl('button', { text: tt('dialogue.button-always-update', '总是更新') }).onclick = () => finish(true, true);
      modal.buttonContainerEl.createEl('button', { text: tt('dialogue.button-just-once', '仅此一次') }).onclick = () => finish(true, false);
      modal.buttonContainerEl.createEl('button', { text: tt('dialogue.button-do-not-update', '不做更新') }).onclick = () => finish(false, false);
      modal.onClose = () => resolve();
      modal.open();
    });
  }

  async renameFolder(folder, newPath) {
    const oldPath = folder.path;
    try {
      await this.app.vault.rename(folder, newPath);
      this.app.workspace.trigger('file-rename', folder, oldPath);
      return true;
    } catch (e) {
      return false;
    }
  }

  async deleteFile(file, force = false) {
    const settings = this.app.settings.appSettings;
    const permanent = settings.trashOption === 'none' || settings.trashOption === 'permanent';
    const promptDelete = settings.promptDelete !== undefined ? settings.promptDelete !== false : settings.deleteConfirm !== false;
    if (promptDelete && !force) {
      const isFolder = file instanceof TFolder;
      let body = '';
      if (isFolder) body = t('dialogue.label-delete-folder-warning') || 'If you continue, all files inside this folder will be deleted.';
      else if (permanent) body = t('dialogue.label-permanent-delete') || 'The file will be permanently deleted.';
      else if (settings.trashOption === 'local') body = t('dialogue.label-move-to-vault-trash') || '';
      else body = t('dialogue.label-move-to-system-trash') || '';
      const title = isFolder ? (t('dialogue.label-delete-folder') || 'Delete folder') : (t('dialogue.label-delete-file') || 'Delete file');
      const ok = await confirmDialog(this.app, title, `${file.name}\n\n${body}`, { cta: t('dialogue.button-delete') || 'Delete', warning: true });
      if (!ok) return false;
    }
    const targetPath = force ? file.path : await this.getDeleteDestination(file);
    if (targetPath) {
      if (targetPath === file.path) {
        await this.app.vault.delete(file, permanent);
      } else {
        try {
          await this.app.vault.rename(file, targetPath);
          await this.app.vault.delete(this.app.vault.getAbstractFileByPath(targetPath), true);
        } catch (e) {
          await this.app.vault.delete(file, true);
        }
      }
    } else {
      await this.app.vault.delete(file, true);
    }
    this.app.metadataCache.onFileDelete(file);
    this.app.workspace.trigger('file-delete', file);
    return true;
  }

  async getDeleteDestination(file) {
    const settings = this.app.settings.appSettings;
    if (settings.trashOption === 'none' || settings.trashOption === 'permanent') return null;
    if (settings.trashOption === 'system') return null; // vault.delete handles via shell.trash
    // local .trash folder
    const trashFolder = '.trash';
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
    return normalizePath(`${trashFolder}/${stamp} ${file.name}`);
  }

  async trashFile(file) {
    return this.deleteFile(file, false);
  }

  async processFrontMatter(file, fn) {
    const text = await this.app.vault.read(file);
    const yamlMod = require('js-yaml');
    const lines = text.split('\n');
    let frontmatter = {};
    let bodyStart = 0;
    if (lines[0] !== undefined && lines[0].trim() === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
          try { frontmatter = yamlMod.load(lines.slice(1, i).join('\n')) || {}; } catch (e) { frontmatter = {}; }
          bodyStart = i + 1;
          break;
        }
      }
    }
    await fn(frontmatter);
    const fmText = yamlMod.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
    const body = lines.slice(bodyStart).join('\n');
    let out;
    if (Object.keys(frontmatter).length === 0) {
      out = body;
    } else {
      out = '---\n' + fmText + '\n---\n' + body;
    }
    await this.app.vault.modify(file, out);
  }

  async promptForDeletion(file) {
    return this.deleteFile(file, false);
  }

  async moveFile(file, folder) {
    const newPath = normalizePath((folder.path === '/' ? '' : folder.path + '/') + file.name);
    return this.renameFile(file, newPath);
  }

  async copyFile(file, folder) {
    let newPath = normalizePath((folder.path === '/' ? '' : folder.path + '/') + file.name);
    newPath = await this.getUniquePath(newPath);
    await this.app.vault.copy(file, newPath);
    return this.app.vault.getAbstractFileByPath(newPath);
  }
}

function relativePath(fromDir, toPath) {
  const fromParts = fromDir ? fromDir.split('/') : [];
  const toParts = toPath.split('/');
  const toFile = toParts.pop();
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const parts = [...Array(ups).fill('..'), ...downs, toFile];
  return parts.join('/');
}
