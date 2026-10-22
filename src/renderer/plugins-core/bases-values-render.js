/**
 * [INPUT]: Bases 富值、宿主工作区导航、图标表与受控桌面 IPC。
 * [OUTPUT]: 导出 renderBaseRichValue(controller,parent,value,sourcePath?)，返回已挂载的值节点。
 * [POS]: Bases 富值 DOM 适配器。链接经现有导航；HTML 明确降级为源码，Markdown 禁用原始 HTML。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseLink, BaseTag, BaseDisplay, baseValueType, formatBaseValue } from './bases-values.js';
import { setIcon, iconExists } from '../core/icons.js';
import { Desktop } from '../core/ipc.js';
const MarkdownIt = require('markdown-it');
let inlineMarkdown;
const external = value => /^(?:https?:|mailto:|tel:)/i.test(value);
const openExternal = value => /^https?:/i.test(value) ? Desktop.openExternal(value) : Desktop.openUrl(value);
function append(parent, tag, cls, text) {
  const node = parent.ownerDocument.createElement(tag); node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node); return node;
}
function degraded(parent, message, source) {
  const node = append(parent, 'span', 'bases-rendered-value bases-value-degraded');
  node.dataset.basesDegraded = 'true'; node.title = message;
  append(node, 'span', 'bases-value-degraded-label', message + '：');
  append(node, 'code', '', source); return node;
}
function link(controller, parent, target, display, sourcePath, remote = false) {
  if (remote && !external(target)) return degraded(parent, '不支持此链接协议', target);
  const node = append(parent, 'a', (remote ? 'external-link' : 'internal-link') + ' bases-rendered-value', display);
  node.href = remote ? target : '#'; node.dataset.href = target;
  node.addEventListener('click', event => {
    event.preventDefault();
    if (remote) openExternal(target);
    else controller.app.workspace.openLinkText(target, sourcePath, event.metaKey || event.ctrlKey ? 'tab' : false);
  });
  if (!remote && !controller.app.metadataCache.getFirstLinkpathDest(target, sourcePath)) node.classList.add('is-unresolved');
  return node;
}
export function renderBaseRichValue(controller, parent, value, sourcePath = '') {
  if (value instanceof BaseLink) {
    const owner = value.owner(), display = value.display == null ? value.kind === 'url' ? value.path : value.path.split('/').pop()?.replace(/\.md$/, '') : formatBaseValue(value.display);
    return link(controller, parent, value.path, display, owner.sourcePath || sourcePath, value.kind === 'url');
  }
  if (baseValueType(value) === 'file') return link(controller, parent, value.path, value.owner().file.extension === 'md' ? value.owner().file.basename : value.owner().file.name, sourcePath);
  if (value instanceof BaseTag) {
    const searchable = () => controller.app.plugins.getInternalPlugin('global-search')?.enabled !== false;
    if (!searchable()) return degraded(parent, '搜索核心插件未启用', value.value);
    const node = append(parent, 'a', 'tag bases-rendered-value', value.value); node.href = '#';
    node.addEventListener('click', async event => {
      event.preventDefault();
      if (!searchable()) { node.replaceWith(degraded(parent, '搜索核心插件未启用', value.value)); return; }
      const query = 'tag:' + value.value;
      const leaf = await controller.app.workspace.ensureSideLeaf('search', 'left', { state: { query }, reveal: true });
      leaf.view.setQuery?.(query);
    }); return node;
  }
  if (Array.isArray(value)) {
    const list = append(parent, 'span', 'value-list-container bases-rendered-value');
    value.forEach((item, index) => {
      renderBaseRichValue(controller, append(list, 'span', 'value-list-element'), item, sourcePath);
      if (index < value.length - 1) append(list, 'span', 'value-list-gap', '\n');
    }); return list;
  }
  if (typeof value === 'boolean') { const node = append(parent, 'input', 'bases-rendered-value'); node.type = 'checkbox'; node.disabled = true; node.checked = value; return node; }
  if (value instanceof BaseDisplay) {
    if (value.kind === 'icon') {
      if (!iconExists(value.value)) return degraded(parent, '未识别图标', value.value);
      const node = append(parent, 'span', 'bases-rendered-value'); node.setAttribute('aria-label', value.value); setIcon(node, value.value); return node;
    }
    if (value.kind === 'image') {
      const remote = /^(?:https?:|data:image\/)/i.test(value.value), file = controller.app.vault.getFileByPath(value.value);
      if (!remote && !file) return degraded(parent, '图片文件不存在', value.value);
      if (!remote && !/^(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.extension)) return degraded(parent, '此文件不是支持的图片', value.value);
      const node = append(parent, 'img', 'bases-rendered-value'); node.alt = file?.name || value.value;
      node.style.maxWidth = '100%'; node.style.maxHeight = '180px';
      node.addEventListener('error', () => { if (node.parentNode) { const replacement = degraded(node.parentNode, '图片无法载入', value.value); node.replaceWith(replacement); } }, { once: true });
      node.src = remote ? value.value : controller.app.vault.adapter.getResourcePath(file.path); return node;
    }
    if (value.kind === 'html') return degraded(parent, 'HTML 以源码显示', value.value);
    if (value.kind === 'markdown') {
      const node = append(parent, 'span', 'bases-rendered-value markdown-rendered');
      node.dataset.basesDegraded = 'true'; node.title = 'Markdown 仅渲染标准行内语法；原始 HTML 与嵌入未启用';
      inlineMarkdown ||= new MarkdownIt({ html: false, linkify: false });
      node.innerHTML = inlineMarkdown.renderInline(value.value);
      for (const image of node.querySelectorAll('img')) image.replaceWith(parent.ownerDocument.createTextNode(image.alt || image.getAttribute('src')));
      for (const anchor of node.querySelectorAll('a')) {
        const href = anchor.getAttribute('href');
        if (!external(href)) { anchor.replaceWith(parent.ownerDocument.createTextNode(anchor.textContent)); continue; }
        anchor.addEventListener('click', event => { event.preventDefault(); openExternal(href); });
      }
      return node;
    }
  }
  return append(parent, 'span', 'bases-rendered-value', formatBaseValue(value));
}
