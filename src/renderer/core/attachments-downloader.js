/**
 * [INPUT]: 依赖 ./dom.js 的 createDiv；依赖 ./metadata.js 的 parseFrontmatterText；依赖 ./modals.js 的 Modal；依赖 ./notices.js 的 Notice；依赖 ./i18n.js 的 t；依赖 ./ipc.js 的 Desktop；依赖 ../editor/attachments.js 的 saveAttachment。
 * [OUTPUT]: 导出 downloadAttachmentsForNote(app, file)。扫描（scanExternalAttachments）与画廊模态（promptForImageDownload）是内部阶段。
 * [POS]: core/ 的"下载外部附件"流程。fileManager.downloadAttachmentsForNote 是唯一调用方。扫描只读源文本，不依赖 metadataCache 的嵌入位置；改写嵌入按 offset 降序拼接，frontmatter 走 processFrontMatter。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Download external attachments — mirrors the original fileManager.downloadAttachmentsForNote. */
import { createDiv } from './dom.js';
import { parseFrontmatterText } from './metadata.js';
import { Modal } from './modals.js';
import { Notice } from './notices.js';
import { t } from './i18n.js';
import { Desktop } from './ipc.js';
import { saveAttachment } from '../editor/attachments.js';

/** 原版图片扩展名表：frontmatter 值只有命中它才算外部附件。 */
const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];
/** 原版 content-type → 扩展名表（audio/video/pdf 项在本流程不可达，故不收录）。 */
const CONTENT_TYPE_EXTENSIONS = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/pict': 'pict',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
};

// ---------------------------------------------------------------------------
// 纯函数层：解析与扫描
// ---------------------------------------------------------------------------

/** 原版 Yc：http/https URL。data: 不在此列（frontmatter 只用 http(s) 值）。 */
function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

/** 原版 ou：扩展名（小写、不含点）；无扩展名返回空串。 */
function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 || dot === name.length - 1 || dot === 0 ? '' : name.substring(dot + 1).toLowerCase();
}

/** 原版 iu：去掉扩展名的文件名。 */
function nameWithoutExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 || dot === name.length - 1 || dot === 0 ? name : name.substring(0, dot);
}

/** 原版 pu：content-type → 扩展名，未知返回空串。 */
function extensionFromContentType(contentType) {
  const key = String(contentType || '').trim().toLowerCase();
  return Object.hasOwn(CONTENT_TYPE_EXTENSIONS, key) ? CONTENT_TYPE_EXTENSIONS[key] : '';
}

/** 原版 ry：data URL → { contentType, properties, isBase64, data }；非 data URL 返回 null。 */
function parseDataUrl(url) {
  const match = /^data:([^,]*),([\s\S]*)$/.exec(String(url).trim());
  if (!match) return null;
  const params = (match[1] || 'text/plain;charset=us-ascii').split(';').map((part) => part.toLowerCase());
  const properties = {};
  for (const param of params.slice(1)) {
    const eq = param.indexOf('=');
    if (eq > 0 && param !== 'base64') properties[param.slice(0, eq)] = param.slice(eq + 1);
  }
  return { contentType: params[0] || 'text/plain', properties, isBase64: params.includes('base64'), data: match[2] || '' };
}

/** data URL 载荷 → 字节（base64 或百分号编码）。 */
function dataUrlBytes(parsed) {
  if (!parsed.isBase64) return new TextEncoder().encode(decodeURIComponent(parsed.data));
  const binary = atob(parsed.data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 原版 promptForImageDownload 的远程文件名规则：取 URL 路径最后一段；
 * 含非法文件名字符、无扩展名或扩展名非字母数字时返回空串（该项改由响应头命名）。
 */
function fileNameFromUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch (err) {
    return '';
  }
  const segments = pathname.split('/').filter(Boolean);
  const name = segments[segments.length - 1] || '';
  if (!name || /[<>:"|?*\\]/.test(name)) return '';
  const dot = name.lastIndexOf('.');
  if (dot === -1 || !/^[a-z0-9]+$/i.test(name.substring(dot + 1))) return '';
  return name;
}

/** 原版 dy：响应头大小写不敏感查找。 */
function getHeader(headers, name) {
  if (!headers) return '';
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === wanted) return headers[key];
  return '';
}

/** 掩掉围栏代码块：同长度空白替换，保留换行与全部 offset。 */
function maskFencedCode(text) {
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence === null) {
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (open) { fence = open[1][0]; lines[i] = ' '.repeat(line.length); }
      continue;
    }
    const close = fence === '`' ? /^\s{0,3}`{3,}\s*$/ : /^\s{0,3}~{3,}\s*$/;
    lines[i] = ' '.repeat(line.length);
    if (close.test(line)) fence = null;
  }
  return lines.join('\n');
}

/** 匹配位置是否落在同行未闭合的行内代码里。 */
function isInsideInlineCode(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const ticks = text.slice(lineStart, offset).split('`').length - 1;
  return ticks % 2 === 1;
}

/**
 * 扫描笔记源文本，收集外部图片附件。
 * frontmatter：字符串值 + http(s) + 图片扩展名 → { key, value }。
 * 正文：`![alt](url)` 且 url 以 http(s):// 或 data: 开头（排除围栏代码与行内代码）→ { url, alt, position }。
 * urls：两处 URL 合并去重（保持 frontmatter 在前的顺序）。
 */
function scanExternalAttachments(text) {
  const source = String(text == null ? '' : text);
  const parsed = parseFrontmatterText(source);
  const frontmatterValues = [];
  for (const key of Object.keys(parsed.frontmatter || {})) {
    const value = parsed.frontmatter[key];
    if (typeof value !== 'string' || !isHttpUrl(value)) continue;
    if (!IMAGE_EXTENSIONS.includes(extensionOf(value))) continue;
    frontmatterValues.push({ key, value });
  }
  // frontmatter 合法时正文从闭合 --- 行之后开始；解析失败按无 frontmatter 处理。
  const lines = source.split('\n');
  const bodyStart = parsed.startLine === 0 && !parsed.error && parsed.endLine >= 0
    ? lines.slice(0, parsed.endLine + 1).join('\n').length + 1 : 0;
  const scanText = maskFencedCode(source);
  const embeds = [];
  const embedRe = /!\[([^\]\n]*)\]\((?:<([^>\s]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  let match;
  while ((match = embedRe.exec(scanText))) {
    if (match.index < bodyStart) continue;
    const url = (match[2] || match[3] || '').trim();
    if (!/^(https?:\/\/|data:)/i.test(url)) continue;
    if (isInsideInlineCode(scanText, match.index)) continue;
    embeds.push({
      url,
      alt: match[1] || '',
      position: { start: { offset: match.index }, end: { offset: match.index + match[0].length } },
    });
  }
  const urls = [];
  for (const entry of frontmatterValues) urls.push(entry.value);
  for (const embed of embeds) urls.push(embed.url);
  return { frontmatterValues, embeds, urls: [...new Set(urls)] };
}

/** 原版 metadataCache.fileToLinktext(file, '', false) 的等效：全库同名唯一时取文件名，否则取完整路径。 */
function uniqueAttachmentLinktext(app, file) {
  const sameName = app.vault.getFiles().filter((candidate) => candidate.name === file.name);
  return sameName.length <= 1 ? file.name : file.path;
}

/** 取请求函数：优先 app.requestUrl（验收可替换），否则走 Desktop IPC。 */
function requestUrl(app, url) {
  const fetcher = (app && app.requestUrl) || Desktop.requestUrl;
  return fetcher({ url });
}

/** 响应体 → 字节。 */
function toBytes(body) {
  if (!body) return new Uint8Array(0);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new TextEncoder().encode(String(body));
}

// ---------------------------------------------------------------------------
// 画廊项与模态
// ---------------------------------------------------------------------------

/** 原版 wI：复选框默认勾选、点整块切换、缩略图直接用源 URL。 */
class DownloadAttachmentItem {
  constructor(url) {
    this.name = '';
    this.url = url;
    this.checked = false;
    this.el = createDiv('download-attachment-item');
    this.el.addEventListener('click', (ev) => {
      if (ev.button !== 0 || ev.defaultPrevented) return;
      this.setChecked(!this.checked);
    });
    this.checkboxEl = this.el.createEl('input', { type: 'checkbox' });
    this.checkboxEl.addEventListener('change', () => this.setChecked(this.checkboxEl.checked));
    this.setChecked(true);
    const tooltip = url.length <= 100 ? url : url.slice(0, 99).trim() + '…';
    if (typeof this.el.setTooltipGenerator === 'function') {
      this.el.setTooltipGenerator(() => (this.name ? this.name + '\n' + tooltip : tooltip));
    }
    this.el.createEl('img', { attr: { src: url } });
    // 原版 1.14.4 只在 tooltip 显示文件名；本实现补一个可见标签。
    this.nameEl = this.el.createDiv({ cls: 'download-attachment-name', text: tooltip });
  }

  setName(name) {
    this.name = name;
    if (this.nameEl) this.nameEl.setText(name);
    return this;
  }

  setChecked(value) {
    if (this.checked === value) return;
    this.checked = value;
    this.checkboxEl.checked = value;
    this.el.toggleClass('is-selected', value);
  }
}

/** 确认按钮先结算结果再关窗；Esc / 背景 / 关闭钮走 onClose 结算 false。 */
function openModalPrompt(modal) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    modal.onClose = () => finish(false);
    const cta = modal.buttonContainerEl.createEl('button', { cls: 'mod-cta', text: t('dialogue.button-download') });
    cta.onclick = () => { finish(true); modal.close(); };
    modal.open();
    setTimeout(() => { try { cta.focus({ preventScroll: true }); } catch (err) { /* 焦点失败不阻塞 */ } }, 10);
  });
}

/** 下载单项。返回落盘 TFile；未勾选或该 URL 未命名成功时由调用方处理。 */
async function downloadOne(app, noteFile, item) {
  const url = item.url;
  if (url.startsWith('data:')) {
    const parsed = parseDataUrl(url);
    if (!parsed) return null;
    const base = nameWithoutExtension(item.name) || 'Image';
    const ext = extensionFromContentType(parsed.contentType) || 'jpg';
    return saveAttachment(app, base, ext, dataUrlBytes(parsed), noteFile.path);
  }
  const response = await requestUrl(app, url);
  if (response && response.error) throw new Error(String(response.error));
  let name = item.name;
  const disposition = String(getHeader(response && response.headers, 'Content-Disposition') || '');
  const parts = disposition.split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.includes('attachment')) {
    for (const part of parts) {
      if (!part.startsWith('filename=')) continue;
      name = part.substring(9).replace(/"/g, '');
      break;
    }
  }
  if (!name) {
    const contentType = String(getHeader(response && response.headers, 'Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('image/')) name = 'Image.' + (extensionFromContentType(contentType) || 'jpg');
  }
  if (!name) name = 'Image.jpg';
  return saveAttachment(app, nameWithoutExtension(name), extensionOf(name), toBytes(response && response.body), noteFile.path);
}

/**
 * 原版 promptForImageDownload：画廊模态 → 逐项下载。
 * 取消返回 null；确认返回 { 源URL: TFile }（仅含成功下载的项）。
 */
async function promptForImageDownload(app, noteFile, urls) {
  if (!urls.length) return null;
  const modal = new Modal(app);
  modal.setTitle(t('dialogue.label-download-attachments'));
  modal.modalEl.addClass('mod-scrollable-content');
  const items = [];
  const byUrl = {};
  for (const url of urls) {
    const item = new DownloadAttachmentItem(url);
    items.push(item);
    byUrl[url] = item;
    if (url.startsWith('data:')) {
      const parsed = parseDataUrl(url);
      if (parsed) item.setName('Image.' + (extensionFromContentType(parsed.contentType) || 'jpg'));
    } else {
      const name = fileNameFromUrl(url);
      if (name) item.setName(name);
    }
  }
  const gallery = modal.contentEl.createDiv('attachments-gallery');
  for (const item of items) gallery.appendChild(item.el);
  if (!(await openModalPrompt(modal))) return null;
  const saved = {};
  modal.contentEl.addClass('is-loading');
  try {
    for (const url of urls) {
      const item = byUrl[url];
      if (!item || !item.checked) continue;
      // 单条失败（网络/解码）只跳过该项，不中断整批。
      try {
        const file = await downloadOne(app, noteFile, item);
        if (file) saved[url] = file;
      } catch (err) { /* 跳过该 URL */ }
    }
  } finally {
    modal.contentEl.removeClass('is-loading');
  }
  modal.close();
  new Notice(t('dialogue.label-downloaded-attachments', { count: Object.keys(saved).length }));
  return saved;
}

// ---------------------------------------------------------------------------
// 流程入口
// ---------------------------------------------------------------------------

/** 原版 downloadAttachmentsForNote：无外部附件提示；确认后改写嵌入与 frontmatter 值。 */
export async function downloadAttachmentsForNote(app, file) {
  try {
    if (!file || file.extension !== 'md') return null;
    let text = await app.vault.read(file);
    let scan = scanExternalAttachments(text);
    if (!scan.urls.length) {
      new Notice(t('dialogue.label-no-attachments'));
      return null;
    }
    const saved = await promptForImageDownload(app, file, scan.urls);
    if (!saved || !Object.keys(saved).length) return null;
    // 模态期间文件可能被编辑：文本变了就按新文本重扫（对齐原版 i!==o && r(i)）。
    const current = await app.vault.read(file);
    if (current !== text) {
      text = current;
      scan = scanExternalAttachments(text);
    }
    const replacements = [];
    for (const embed of scan.embeds) {
      if (!Object.hasOwn(saved, embed.url)) continue;
      const alt = typeof embed.alt === 'string' && embed.alt ? embed.alt : '';
      const link = '!' + app.fileManager.generateMarkdownLink(saved[embed.url], file.path, '', alt);
      replacements.push({ from: embed.position.start.offset, to: embed.position.end.offset, text: link });
    }
    replacements.sort((a, b) => b.from - a.from);
    for (const replacement of replacements) {
      text = text.substring(0, replacement.from) + replacement.text + text.substring(replacement.to);
    }
    if (replacements.length) await app.vault.modify(file, text);
    const frontmatterHits = scan.frontmatterValues.filter((entry) => Object.hasOwn(saved, entry.value));
    if (frontmatterHits.length) {
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        for (const entry of frontmatterHits) {
          frontmatter[entry.key] = '[[' + uniqueAttachmentLinktext(app, saved[entry.value]) + ']]';
        }
      });
    }
    return saved;
  } catch (err) {
    new Notice(String((err && err.message) || err));
    return null;
  }
}
