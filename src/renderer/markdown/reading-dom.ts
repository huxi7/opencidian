/**
 * [INPUT]: 已生成的阅读 DOM、图标与本地化文案。
 * [OUTPUT]: 列表与任务装饰、代码复制按钮和标题锚点。
 * [POS]: 阅读后置 DOM 层，不解析 Markdown 或读写笔记。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setIcon } from '../core/icons.js';
import { tt } from '../core/i18n.js';
/**
 * 原版阅读 DOM 修正（app.css 12149-12191 / 12984-13003）：
 * 1. 无序列表挂 has-list-bullet，并在每个 li 首位插入 .list-bullet（0.3em 圆点由 CSS 绘制）；
 * 2. 任务项按原版写 data-task / is-checked 并去掉 disabled，复选框因此可点击改源文本。
 */
export function decorateReadingDom(el: HTMLElement) {
  for (const ul of el.querySelectorAll('ul')) {
    ul.addClass('has-list-bullet');
    for (const li of ul.children) {
      if (li.tagName !== 'LI') continue;
      if (li.querySelector(':scope > .list-bullet')) continue;
      li.insertBefore(createDiv('list-bullet'), li.firstChild);
    }
  }
  for (const li of el.querySelectorAll('li.task-list-item')) {
    const box = li.querySelector<HTMLInputElement>(':scope > .task-list-item-checkbox, :scope > p > .task-list-item-checkbox');
    if (!box) continue;
    const done = box.checked || box.hasAttribute('checked');
    box.removeAttribute('disabled');
    li.setAttr('data-task', done ? 'x' : ' ');
    li.toggleClass('is-checked', done);
  }
  // 脚注引用与回跳同挂 .footnote-link（app.css 11091）
  for (const a of el.querySelectorAll('.footnote-ref > a, a.footnote-backref')) a.addClass('footnote-link');
}

/** 原版 post-processor：为每个 pre > code 添加 .copy-code-button（悬停显示，点击复制）。 */
export function addCodeBlockCopyButtons(el: HTMLElement) {
  for (const code of el.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    if (!pre || pre.querySelector(':scope > .copy-code-button')) continue;
    const button = createEl('button', { cls: 'copy-code-button' });
    setIcon(button, 'lucide-copy');
    button.setAttr('aria-label', tt('interface.menu.copy', '复制'));
    button.onclick = (ev) => {
      ev.preventDefault();
      try { const p = navigator.clipboard.writeText(code.textContent || ''); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    };
    pre.appendChild(button);
  }
}

export function annotateHeadings(el: HTMLElement) {
  const used = new Set<string>();
  for (const h of el.findAll('h1, h2, h3, h4, h5, h6')) {
    const text = h.textContent || '';
    let slug = text.toLowerCase().trim().replace(/[^\w\u4e00-\u9fff- ]/g, '').replace(/\s+/g, '-');
    let candidate = slug, i = 1;
    while (used.has(candidate)) candidate = slug + '-' + i++;
    used.add(candidate);
    h.setAttr('data-heading', text);
    h.id = candidate;
    h.addClass('heading');
  }
}
