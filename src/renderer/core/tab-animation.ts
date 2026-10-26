/**
 * [INPUT]: 仅依赖 DOM 元素与 Web Animations API；不依赖 workspace 模型。
 * [OUTPUT]: 导出 animateTabIn、animateTabOut。
 * [POS]: core/workspace 的标签开合动画层。原版 updateTabDisplay（app.js 1563710）在标签增删时
 *        以 200ms ease-in-out 对宽度与透明度做补间：新头 0→宽 / 0→1，旧头克隆后 宽→0 / 1→0。
 *        只负责视觉，不改变模型顺序与元素归属；workspace-renderer 在同步头 DOM 时调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const DURATION = 200;
const EASING = 'ease-in-out';

/** 新标签头展开：自然宽测量后从 0 宽、透明长到自然宽。 */
export function animateTabIn(header: HTMLElement) {
  if (!header || !header.isConnected) return;
  const width = header.getBoundingClientRect().width;
  if (!width) return;
  header.style.flex = '0 0 auto';
  header.style.overflow = 'hidden';
  const anim = header.animate(
    [{ width: '0px', opacity: 0 }, { width: width + 'px', opacity: 1 }],
    { duration: DURATION, easing: EASING },
  );
  anim.onfinish = () => {
    header.style.flex = '';
    header.style.overflow = '';
  };
}

/** 关闭标签：在原位置留一个同宽克隆，200ms 收窄并淡出后摘除；原头由调用方立刻卸下。 */
export function animateTabOut(header: HTMLElement, container: HTMLElement) {
  if (!header || !container || !header.isConnected) return;
  const width = header.getBoundingClientRect().width;
  if (!width) return;
  const clone = header.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.removeClass('is-active');
  clone.style.flex = '0 0 auto';
  clone.style.overflow = 'hidden';
  clone.style.width = width + 'px';
  container.insertBefore(clone, header);
  const anim = clone.animate(
    [{ width: width + 'px', opacity: 1 }, { width: '0px', opacity: 0 }],
    { duration: DURATION, easing: EASING },
  );
  anim.onfinish = () => clone.remove();
}
