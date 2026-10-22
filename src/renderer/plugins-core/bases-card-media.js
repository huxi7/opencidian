/**
 * [INPUT]: 当前行图片属性、原版 image/imageFit/imageAspectRatio 配置与富值渲染器。
 * [OUTPUT]: 导出 renderBaseCover，解析库内图片、链接、远程图片与颜色封面。
 * [POS]: 卡片与看板共用封面适配器。资源和失败提示复用富值 DOM，不自行加载宿主文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { propertyValue } from './bases-model.js';
import { BaseDisplay, BaseLink, baseValueType } from './bases-values.js';
import { renderBaseRichValue } from './bases-values-render.js';

function resolveCoverFile(app, target, sourcePath) {
  const path = target.split('#')[0], sourceFolder = sourcePath.split('/').slice(0, -1).join('/');
  const resolved = app.vault.getFileByPath(path) || app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (resolved) return typeof resolved === 'string' ? app.vault.getFileByPath(resolved) : resolved;
  const relative = require('path').posix.join(sourceFolder, path);
  const nearby = app.vault.getFileByPath(relative);
  if (nearby) return nearby;
  // 元数据短名索引只登记笔记。图片短名从同一 Vault 文件表解析。
  const basename = path.split('/').pop().toLowerCase();
  return app.vault.getFiles().filter(file => file.name.toLowerCase() === basename).sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0] || null;
}
export function renderBaseCover(controller, card, row, kanban = false) {
  const view = controller.view, property = Object.hasOwn(view, 'image') ? view.image : view.imageProperty;
  if (!property) return;
  const cover = card.ownerDocument.createElement('div'); cover.className = 'bases-cards-cover';
  const ratio = typeof view.imageAspectRatio === 'number' && view.imageAspectRatio > 0 ? view.imageAspectRatio : kanban ? .5 : 1;
  cover.style.aspectRatio = String(1 / ratio); cover.dataset.imageProperty = property; card.appendChild(cover);
  try {
    let value = propertyValue(row.context, property), depth = 0;
    while (Array.isArray(value) && depth++ < 20) value = value[0];
    if (value == null || value === '') return;
    let image;
    if (value instanceof BaseDisplay && value.kind === 'image') image = value;
    else {
      let path;
      if (value instanceof BaseLink) path = value.kind === 'url' ? value.path : value.resolve()?.path || value.path;
      else if (baseValueType(value) === 'file') path = value.path;
      else if (typeof value === 'string') path = value;
      else throw new Error('封面属性需要图片路径或链接');
      if (/^#[a-f\d]{6}$/i.test(path)) { cover.style.backgroundColor = path; return; }
      if (!/^(?:https?:|data:image\/)/i.test(path)) {
        if (/^[a-z][\w+.-]*:/i.test(path)) throw new Error('不支持的图片协议：' + path.split(':')[0]);
        const file = resolveCoverFile(controller.app, path, row.file.path);
        if (!file) throw new Error('图片文件不存在：' + path);
        path = typeof file === 'string' ? file : file.path;
      }
      image = new BaseDisplay('image', path);
    }
    renderBaseRichValue(controller, cover, image, row.file.path);
    const img = cover.querySelector('img');
    if (img) {
      img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = '100%'; img.style.height = '100%';
      img.style.objectFit = view.imageFit === 'contain' ? 'contain' : 'cover'; img.draggable = false;
    }
  } catch (error) {
    const message = cover.ownerDocument.createElement('div'); message.className = 'bases-warning'; message.textContent = error.message; cover.appendChild(message);
  }
}
