/**
 * [INPUT]: DOMPurify、阅读渲染管线、Markdown 交互、受控外链 IPC 与行所属笔记路径。
 * [OUTPUT]: renderBaseHtml、renderBaseMarkdown 与富值销毁 hooks；节点提供 ready Promise 和取消信号。
 * [POS]: Bases 富文本安全边界。HTML 先净化再入 DOM；生成的 Markdown 及嵌入共用阅读器，并在每次 HTML 提交前净化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import createDOMPurify from 'dompurify';
import { renderMarkdown, attachMarkdownInteractions } from '../markdown/reading.js';
import { Desktop } from '../core/ipc.js';
import { registerBaseRichValue } from './bases-rich-lifecycle.js';
import { RENDER_ABORTED, waitForRender } from '../markdown/render-cancel.js';
export { disposeBaseRichValues, disposeBaseRichController } from './bases-rich-lifecycle.js';

const options = {
  RETURN_DOM_FRAGMENT: true,
  FORBID_TAGS: ['style', 'script', 'object', 'embed', 'base', 'meta', 'link', 'form'],
  FORBID_ATTR: ['srcdoc', 'autofocus', 'formaction', 'data-background-iframe'],
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['frameborder', 'allowfullscreen', 'sandbox', 'data-tooltip-position'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|app):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};
// 独立实例避免 Mermaid 等使用方的 hook/config 进入此安全边界。
const DOMPurify = createDOMPurify(window);
const protectedMounts = new WeakSet();
const external = value => /^(?:https?:|mailto:|tel:)/i.test(value);
const decode = value => { try { return decodeURI(value); } catch { return value; } };
function resolveRichFile(app, target, sourcePath) {
  const clean = decode(target).split('#')[0];
  const found = app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
  if (found) return app.vault.getFileByPath(found.path || found);
  const path = require('path').posix;
  const relative = path.normalize(path.join(path.dirname(sourcePath || ''), clean));
  const direct = app.vault.getFileByPath(relative);
  if (direct) return direct;
  return app.vault.getFiles().filter(file => file.name === clean || file.path === clean).sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0] || null;
}
function sanitize(source, doc, diagram = false) {
  const config = diagram ? { ...options, FORBID_TAGS: options.FORBID_TAGS.filter(tag => tag !== 'style'), ADD_TAGS: [...options.ADD_TAGS, 'style', 'foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true } } : options;
  // 模板内容保持惰性；编码阅读器的数据载荷，避免 XML 防护把 Mermaid 的 --> 或公式误删。
  const template = doc.createElement('template');
  template.innerHTML = source;
  for (const element of template.content.querySelectorAll('[data-source],[data-math]')) {
    for (const name of ['source', 'math']) if (element.hasAttribute('data-' + name)) {
      element.setAttribute('data-bases-preserved-' + name, encodeURIComponent(element.getAttribute('data-' + name)));
      element.removeAttribute('data-' + name);
    }
  }
  const fragment = doc.importNode(DOMPurify.sanitize(template.innerHTML, config), true);
  for (const element of fragment.querySelectorAll('[data-bases-preserved-source],[data-bases-preserved-math]')) {
    for (const name of ['source', 'math']) if (element.hasAttribute('data-bases-preserved-' + name)) {
      element.setAttribute('data-' + name, decodeURIComponent(element.getAttribute('data-bases-preserved-' + name)));
      element.removeAttribute('data-bases-preserved-' + name);
    }
  }
  if (diagram) for (const style of fragment.querySelectorAll('style')) {
    const id = style.closest('svg')?.id;
    if (!id) { style.remove(); continue; }
    // Mermaid 的 SVG 样式只允许命中它自身的 id；拒绝全局 selector 与外部样式规则。
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    const prefix = '#' + CSS.escape(id);
    style.textContent = [...sheet.cssRules].filter(rule => rule.type === CSSRule.STYLE_RULE && rule.selectorText.split(',').every(selector => {
      const value = selector.trim();
      return !/[+~]/.test(value) && (value === prefix || value.startsWith(prefix + ' ') || value.startsWith(prefix + ':'));
    })).map(rule => rule.cssText).join('\n');
  }
  for (const frame of fragment.querySelectorAll('iframe')) {
    // 原版允许 iframe；此边界禁止脚本、表单与弹窗，也不允许 srcdoc 注入。
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
  }
  for (const anchor of fragment.querySelectorAll('a')) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return fragment;
}
function protectMarkdownMount(node, signal) {
  if (protectedMounts.has(node)) return;
  protectedMounts.add(node);
  const native = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(node, 'innerHTML', {
    configurable: true,
    get() { return native.get.call(this); },
    set(source) {
      if (signal.aborted) return;
      this.replaceChildren(sanitize(source, this.ownerDocument, this.classList.contains('mermaid-source')));
      // 阅读器递归写入笔记嵌块；Mermaid 后处理也必须先净化 SVG，不能旁路此边界。
      for (const child of this.querySelectorAll('[data-embed-mount],.mermaid-source')) protectMarkdownMount(child, signal);
    },
  });
}
function mount(controller, parent, kind) {
  const node = parent.ownerDocument.createElement('div');
  node.className = 'bases-rendered-value bases-rich-' + kind + (kind === 'markdown' ? ' markdown-rendered' : '');
  node.style.contain = 'layout paint';
  node.style.maxWidth = '100%';
  parent.appendChild(node);
  const signal = registerBaseRichValue(controller, node);
  node.addEventListener('submit', event => event.preventDefault(), { signal });
  // 公式是派生内容，任务控件不能按公式 offset 改写笔记正文。
  node.addEventListener('click', event => {
    if (event.target.closest?.('input.task-list-item-checkbox')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, signal });
  return node;
}
function wireLinks(controller, node, sourcePath) {
  node.addEventListener('click', event => {
    const anchor = event.target.closest?.('a');
    if (!anchor || !node.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || '';
    if (external(href)) {
      if (/^https?:/i.test(href)) Desktop.openExternal(href); else Desktop.openUrl(href);
    } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      if (href.startsWith('#')) { node.querySelector('[id="' + CSS.escape(href.slice(1)) + '"]')?.scrollIntoView(); return; }
      controller.app.workspace.openLinkText(decode(href), sourcePath, event.metaKey || event.ctrlKey ? 'tab' : false);
    }
  }, { signal: node.richRenderSignal });
}
export function renderBaseHtml(controller, parent, source, sourcePath) {
  const node = mount(controller, parent, 'html');
  if (node.richRenderSignal.aborted) { node.ready = Promise.resolve(node); return node; }
  node.appendChild(sanitize(source, node.ownerDocument));
  for (const image of node.querySelectorAll('img,audio,video,source')) {
    const src = image.getAttribute('src') || '';
    if (/^(?:https?:|data:|app:)/i.test(src)) continue;
    const target = resolveRichFile(controller.app, src, sourcePath);
    if (target) image.setAttribute('src', controller.app.vault.adapter.getResourcePath(target.path));
  }
  wireLinks(controller, node, sourcePath);
  node.ready = Promise.resolve(node);
  return node;
}
function safeMarkdownApp(app, signal) {
  const facade = Object.create(app);
  facade._basesRichDepth = (app._basesRichDepth || 0) + 1;
  facade.vault = Object.create(app.vault);
  facade.vault.cachedRead = file => signal.aborted ? Promise.resolve('') : waitForRender(app.vault.cachedRead(file), signal).then(value => value === RENDER_ABORTED ? '' : value);
  facade.metadataCache = Object.create(app.metadataCache);
  facade.metadataCache.getFirstLinkpathDest = (target, sourcePath) => {
    const found = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    return found || resolveRichFile(app, target, sourcePath)?.path || null;
  };
  if (facade._basesRichDepth > 5) {
    facade.plugins = Object.create(app.plugins);
    facade.plugins.getInternalPlugin = id => id === 'bases' ? { enabled: false } : app.plugins.getInternalPlugin(id);
  }
  return facade;
}
export function renderBaseMarkdown(controller, parent, source, sourcePath) {
  const node = mount(controller, parent, 'markdown');
  protectMarkdownMount(node, node.richRenderSignal);
  const app = safeMarkdownApp(controller.app, node.richRenderSignal);
  attachMarkdownInteractions(app, node, () => sourcePath, { signal: node.richRenderSignal });
  node.ready = renderMarkdown(app, source, node, sourcePath, { signal: node.richRenderSignal }).then(() => {
    if (node.richRenderSignal.aborted) return node;
    for (const input of node.querySelectorAll('input.task-list-item-checkbox')) input.disabled = true;
    return node;
  }).catch(error => {
    if (node.richRenderSignal.aborted) return node;
    for (const embedded of node.querySelectorAll('[data-base-embed]')) embedded._baseEmbedCleanup?.();
    node.replaceChildren();
    const message = node.ownerDocument.createElement('span');
    message.className = 'bases-warning'; message.textContent = 'Markdown 无法渲染：' + error.message;
    node.appendChild(message); return node;
  });
  return node;
}
