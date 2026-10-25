/**
 * [INPUT]: 接收容器 DOM、subpath 字符串及选项。
 * [OUTPUT]: 导出 scrollToSubpath 与 annotateBlocks、cssEscape。
 * [POS]: markdown/ 的子路径导航与块标记层。解析标题与块引用（#Heading、#^block-id），管理滚动居中与高亮闪烁。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Subpath scrolling and block annotation for reading view. */

const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

export function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

/**
 * 为阅读 DOM 中的块元素（p, li, blockquote, pre）识别末尾的 ^block-id。
 * 标记 data-block-id 与 id，并将标记文本包裹为 .block-ref-id 便于样式或清理。
 */
export function annotateBlocks(el) {
  if (!el) return;
  const blocks = el.querySelectorAll('p, li, blockquote, pre');
  for (const block of blocks) {
    const text = block.textContent || '';
    const match = text.match(BLOCK_ID_RE);
    if (!match) continue;
    const blockId = match[1];
    block.setAttr('data-block-id', blockId);
    if (!block.id) block.id = blockId;
    // 隐藏末尾的 ^block-id，避免阅读视图展示冗余锚点字符
    for (let i = block.childNodes.length - 1; i >= 0; i--) {
      const node = block.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        const val = node.nodeValue || '';
        const nodeMatch = val.match(BLOCK_ID_RE);
        if (nodeMatch) {
          node.nodeValue = val.replace(BLOCK_ID_RE, '');
          break;
        }
      }
    }
  }
}

/**
 * 在阅读视图容器内按子路径（标题或块引用）滚动定位并高亮。
 * @param {HTMLElement} container - 渲染后的 markdown 容器
 * @param {string} subpath - 标题（如 #Title、Title）或块引用（如 #^block-id、^block-id）
 * @returns {boolean} 是否成功找到并滚动到目标
 */
export function scrollToSubpath(container: HTMLElement, subpath) {
  if (!subpath || !container) return false;
  const target = String(subpath).trim();

  // 1. 块引用：支持 ^id 或 #^id
  if (target.startsWith('#^') || target.startsWith('^')) {
    const id = target.replace(/^#?\^/, '');
    const escaped = cssEscape(id);
    const el = container.querySelector(`[data-block-id="${escaped}"]`) || container.querySelector(`[id="${escaped}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      if (el.addClass) el.addClass('is-flashing');
      else el.classList.add('is-flashing');
      setTimeout(() => {
        if (el.removeClass) el.removeClass('is-flashing');
        else el.classList.remove('is-flashing');
      }, 1500);
      return true;
    }
  }

  // 2. 标题：剥除前导 #，支持 Heading 或 Heading#Subheading
  const cleanTarget = target.replace(/^#+/, '').trim().toLowerCase();
  const parts = cleanTarget.split('#').map((p) => p.trim()).filter(Boolean);
  const leafTarget = parts[parts.length - 1] || cleanTarget;

  const headings = Array.from(container.querySelectorAll('[data-heading]'));
  const heading = headings.find((h) => (h.getAttr('data-heading') || '').toLowerCase() === leafTarget)
    || headings.find((h) => (h.getAttr('data-heading') || '').toLowerCase() === cleanTarget)
    || headings.find((h) => (h.getAttr('data-heading') || '').toLowerCase().includes(leafTarget));

  if (heading) {
    heading.scrollIntoView({ block: 'start' });
    if (heading.addClass) heading.addClass('is-flashing');
    else heading.classList.add('is-flashing');
    setTimeout(() => {
      if (heading.removeClass) heading.removeClass('is-flashing');
      else heading.classList.remove('is-flashing');
    }, 1500);
    return true;
  }
  return false;
}
