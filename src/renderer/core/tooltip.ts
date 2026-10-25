/**
 * [INPUT]: Element.prototype 的 createDiv/addClasses/detach/isConnected 原语(dom.js)。
 * [OUTPUT]: 无默认导出。导入即安装 body 级 tooltip 委托，并补 Element.prototype.setTooltip/setTooltipGenerator。
 * [POS]: 全局悬浮提示单例。只响应鼠标；文案取 aria-label，其次取被暂存的 title。
 *        无依赖、无文案，故在 main.js 最先导入，早于任何界面模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Global tooltip layer — mirrors the original app.js tooltip delegation. */

const GAP = 8; // 原版 iv：tooltip 与目标的间距
const ARROW_GAP = 5; // 原版 rv：箭头半宽，用于 top 位置的纵向修正
const DEFAULT_DELAY = 1000; // 原版 av：data-tooltip-delay 缺省
const REUSE_WINDOW = 100; // 原版 sv：隐藏后 100ms 内换目标直接显示，不重新计时
const NATURAL_MAX_WIDTH = 300; // 原版 .tooltip max-width
const WIDE_MAX_WIDTH = 450; // 原版 .tooltip.mod-wide 的 max-width

// 元素 → (el) => string：原版 setTooltipGenerator 的 WeakMap
const generators = new WeakMap();
// 元素 → 暂存的 title 原值：pointerover 移除，pointerout 还原
const stashedTitles = new WeakMap();

let tooltipEl = null;
let arrowEl = null;
let currentTarget = null;
let showTimer = null;
let lastHideAt = 0;

// ---------------------------------------------------------------------------
// 目标解析
// ---------------------------------------------------------------------------

/** 元素是否声明 --no-tooltip(原版 dv)。 */
function suppressesTooltip(el) {
  const value = getComputedStyle(el).getPropertyValue('--no-tooltip').trim();
  return value === 'true';
}

/** pointerover 代理目标：自身或最近带 aria-label / title 的祖先。 */
function tooltipCandidate(el) {
  if (!el || !el.closest) return null;
  return el.closest('[aria-label]') || el.closest('[title]');
}

/** 文案：aria-label 优先，其次生成器，最后暂存的 title。 */
function resolveTooltipText(el) {
  const label = el.getAttribute('aria-label') || '';
  if (label) return label;
  if (generators.has(el)) return generators.get(el)(el) || '';
  return stashedTitles.get(el) || '';
}

/** 抑制原生提示：暂存 title 并移除(原版的 aria-label 化，此处兼容 title 源)。 */
function stashTitle(el) {
  const title = el.getAttribute('title');
  if (!title || stashedTitles.has(el)) return;
  stashedTitles.set(el, title);
  el.setAttribute('data-tooltip-text', title);
  el.removeAttribute('title');
}

function restoreTitle(el) {
  const original = stashedTitles.get(el);
  if (original === undefined) return;
  stashedTitles.delete(el);
  el.removeAttribute('data-tooltip-text');
  if (el.isConnected) el.setAttribute('title', original);
}

// ---------------------------------------------------------------------------
// 显示 / 隐藏
// ---------------------------------------------------------------------------

function cancelShow() {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

/** 立即收起并摘除 tooltip(原版 wv)。 */
function hideTooltip() {
  cancelShow();
  if (currentTarget) {
    restoreTitle(currentTarget);
    currentTarget = null;
  }
  if (tooltipEl) {
    lastHideAt = Date.now();
    tooltipEl.detach();
    tooltipEl = null;
    arrowEl = null;
  }
}

/** 延迟入口：tooltip 已显示或刚隐藏则立刻显示，否则按 delay 计时(原版 bv 头部)。 */
function scheduleShow(el, options) {
  const delay = options.delay || 0;
  if (delay > 0 && (tooltipEl || Date.now() > lastHideAt + REUSE_WINDOW)) {
    cancelShow();
    showTimer = setTimeout(() => {
      showTimer = null;
      show(el, { ...options, delay: 0 });
    }, delay);
    return;
  }
  show(el, options);
}

/** 复用条件：tooltip 已挂载且目标未变；否则重建以重放弹出的位移动画。 */
function ensureTooltipElement(el, text, wide) {
  if (tooltipEl && currentTarget === el) {
    tooltipEl.setText(text);
    return;
  }
  if (tooltipEl) tooltipEl.detach();
  tooltipEl = createDiv({ cls: 'tooltip', text });
  arrowEl = tooltipEl.createDiv('tooltip-arrow');
  tooltipEl.style.maxWidth = (wide ? WIDE_MAX_WIDTH : NATURAL_MAX_WIDTH) + 'px';
  document.body.appendChild(tooltipEl);
}

/**
 * 定位：默认目标下方居中；下方放不下翻到上方(mod-top)；显式 position 不翻转。
 * 横向按视口夹取，并让箭头保持在目标中心(原版 bv 尾部)。
 */
function place(el, placement) {
  const rect = el.getBoundingClientRect();
  const body = document.body;
  const viewportHeight = body.clientHeight;
  const viewportWidth = body.clientWidth;

  let top;
  let left;
  if (placement === 'right') {
    top = rect.top + rect.height / 2;
    left = rect.left + rect.width + GAP;
  } else if (placement === 'left') {
    top = rect.top + rect.height / 2;
    left = rect.left - GAP;
  } else if (placement === 'top') {
    top = rect.top - GAP - ARROW_GAP;
    left = rect.left + rect.width / 2;
  } else {
    top = rect.top + rect.height + GAP;
    left = rect.left + rect.width / 2;
  }

  // 先归零再量尺寸，去掉上一轮的内联宽高干扰
  tooltipEl.style.top = '0px';
  tooltipEl.style.left = '0px';
  tooltipEl.style.width = '';
  tooltipEl.style.height = '';
  const box = tooltipEl.getBoundingClientRect();
  const alongX = placement === 'bottom' || placement === 'top';
  const halfWidth = alongX ? box.width / 2 : box.width;
  const halfHeight = placement === 'right' || placement === 'left' ? box.height / 2 : box.height;

  if (placement === 'left') left -= halfWidth;
  if (placement === 'top') top -= halfHeight;

  let arrowLeft = '';
  let arrowRight = '';
  if (alongX) {
    if (left + halfWidth > viewportWidth) {
      const overflow = left + halfWidth + GAP - viewportWidth;
      left -= overflow;
      arrowLeft = 'initial';
      arrowRight = halfWidth - overflow - GAP / 2 + 'px';
    } else if (left - GAP - halfWidth < 0) {
      const overflow = -(left - GAP - halfWidth);
      left += overflow;
      arrowRight = 'initial';
      arrowLeft = halfWidth - overflow - GAP / 2 + 'px';
    }
    left = Math.max(left, GAP);
  }
  if (top + halfHeight > viewportHeight) top = viewportHeight - halfHeight - GAP;
  if (top < 0) top = GAP;

  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
  if (arrowEl) {
    arrowEl.style.left = arrowLeft;
    arrowEl.style.right = arrowRight;
  }
}

function show(el, options) {
  if (!el || !el.isConnected) return;
  const text = options.text;
  if (!text) return;

  const classes = options.classes || [];
  const requested = options.placement || 'bottom';
  ensureTooltipElement(el, text, classes.includes('mod-wide'));
  currentTarget = el;

  // 下方放不下则翻到上方(原版 popper 的 flip)；显式 top 保持在上方
  let placement = requested;
  if (requested === 'bottom') {
    const rect = el.getBoundingClientRect();
    const natural = tooltipEl.getBoundingClientRect();
    if (rect.top + rect.height + GAP + natural.height > document.body.clientHeight) placement = 'top';
  }

  tooltipEl.removeClass('mod-right', 'mod-left', 'mod-top');
  tooltipEl.addClasses(classes);
  if (placement === 'right') tooltipEl.addClass('mod-right');
  else if (placement === 'left') tooltipEl.addClass('mod-left');
  else if (placement === 'top') tooltipEl.addClass('mod-top');
  place(el, placement);
}

// ---------------------------------------------------------------------------
// 参数读取(原版 gv)
// ---------------------------------------------------------------------------

function readOptions(el, text) {
  let placement = 'bottom';
  if (el.hasAttribute('data-tooltip-position')) placement = el.getAttribute('data-tooltip-position');
  const classes = [];
  if (el.hasAttribute('data-tooltip-classes')) {
    for (const cls of (el.getAttribute('data-tooltip-classes') || '').split(' ')) if (cls) classes.push(cls);
  }
  let delay = DEFAULT_DELAY;
  if (el.hasAttribute('data-tooltip-delay')) {
    delay = parseInt(el.getAttribute('data-tooltip-delay') || '', 10);
    if (isNaN(delay)) delay = DEFAULT_DELAY;
  }
  return { text, placement, classes, delay };
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------

function onPointerOver(ev) {
  if (ev.pointerType !== 'mouse') return;
  const el = tooltipCandidate(ev.target);
  if (!el || suppressesTooltip(el)) return;
  // 在同一条链内部移动时不重开(原版 Ac)
  if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
  stashTitle(el);
  const text = resolveTooltipText(el);
  if (!text) return;
  scheduleShow(el, readOptions(el, text));
}

function onPointerOut(ev) {
  if (ev.pointerType !== 'mouse') return;
  if (!currentTarget && showTimer === null) return;
  // 目标链内部的切换由下一个 pointerover 接管，此处不收起
  if (ev.relatedTarget && ev.relatedTarget instanceof Node && currentTarget &&
      currentTarget.contains(ev.relatedTarget)) return;
  hideTooltip();
}

document.body.addEventListener('pointerover', onPointerOver);
document.body.addEventListener('pointerout', onPointerOut);
window.addEventListener('pointerdown', hideTooltip, true);
window.addEventListener('scroll', hideTooltip, true);
window.addEventListener('blur', hideTooltip);
window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideTooltip(); });

// ---------------------------------------------------------------------------
// 元素级 API(原版 Cv / Ev / kv)
// ---------------------------------------------------------------------------

function applyOptions(el, options) {
  const opts = options || {};
  if (opts.placement && opts.placement !== 'bottom') el.setAttribute('data-tooltip-position', opts.placement);
  if (opts.classes && opts.classes.length) el.setAttribute('data-tooltip-classes', opts.classes.join(' '));
  if (opts.delay) el.setAttribute('data-tooltip-delay', String(opts.delay));
}

function showFor(el, text, options) {
  const opts = options || {};
  show(el, {
    text,
    placement: opts.placement || 'bottom',
    classes: opts.classes || [],
    delay: 0,
  });
}

export function setTooltip(el, text, options?) {
  el.setAttribute('aria-label', text);
  applyOptions(el, options);
  if (currentTarget === el) showFor(el, text, options);
}

export function setTooltipGenerator(el, generator, options) {
  el.setAttribute('aria-label', '');
  generators.set(el, generator);
  applyOptions(el, options);
  if (currentTarget === el) showFor(el, generator(el), options);
}

if (!Element.prototype.hasOwnProperty('setTooltip')) {
  Object.defineProperties(Element.prototype, {
    setTooltip: { value(text, options) { setTooltip(this, text, options); return this; } },
    setTooltipGenerator: { value(generator, options) { setTooltipGenerator(this, generator, options); return this; } },
  });
}
