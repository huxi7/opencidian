/**
 * [INPUT]: 依赖 core/vault.js 的 normalizePath 与 vault.createFolder/createBinary。
 * [OUTPUT]: 导出 saveAttachment(app, name, ext, data, sourcePath)。
 * [POS]: editor/ 的附件落盘层。拖入、插入附件命令共用；附件目录遵循设置 attachmentFolderPath（'/' 根目录、'./' 当前文件夹、'./name' 子文件夹、'name' 指定文件夹），重名自动追加序号。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Attachment storage — mirrors the original app.saveAttachment folder rules. */
import { normalizePath } from '../core/vault.js';

/** 解析附件存放目录（返回库内相对路径，根目录为空串）。 */
export function resolveAttachmentFolder(app: App, sourcePath) {
  const setting = (app.settings && app.settings.appSettings.attachmentFolderPath) || '/';
  const sourceFolder = (sourcePath || '').split('/').slice(0, -1).join('/');
  if (setting === '/') return '';
  if (setting === './') return sourceFolder;
  if (setting.startsWith('./')) {
    return normalizePath((sourceFolder ? sourceFolder + '/' : '') + setting.slice(2));
  }
  return normalizePath(setting);
}

/** 原版 app.getAvailablePathForAttachment：重名追加 " 1"、" 2"…。 */
export function getAvailableAttachmentPath(app: App, folder, name, ext) {
  const build = (suffix) => normalizePath((folder ? folder + '/' : '') + name + suffix + (ext ? '.' + ext : ''));
  if (!app.vault.getAbstractFileByPath(build(''))) return build('');
  for (let i = 1; i < 1000; i += 1) {
    const candidate = build(' ' + i);
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
  return build(' ' + Date.now());
}

/** 原版命名：'Pasted image <YYYYMMDDHHmmss>'（saveAttachment 时再拼扩展名）。 */
export function pastedImageBaseName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'Pasted image ' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/**
 * 写入附件并返回 TFile。
 * @param {any} app
 * @param {string} name 无扩展名
 * @param {string} ext 扩展名（可空）
 * @param {ArrayBuffer|Uint8Array|string} data
 * @param {string} sourcePath 当前笔记路径（决定 './' 相对目录）
 */
export async function saveAttachment(app: App, name, ext, data, sourcePath) {
  const folder = resolveAttachmentFolder(app, sourcePath);
  if (folder && !app.vault.getFolderByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (e) { /* 目录已存在 */ }
  }
  const path = getAvailableAttachmentPath(app, folder, name, ext);
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
    : (ArrayBuffer.isView(data) ? data : new TextEncoder().encode(String(data)));
  return app.vault.createBinary(path, bytes);
}
