/**
 * [INPUT]: 结果行、测高回调与富值释放接口。
 * [OUTPUT]: 导出 mountBaseVirtualRows/mountBaseVirtualGrid；返回刷新、滚动与销毁接口。
 * [POS]: 四类布局窗口化。同范围和重叠网格行复用 DOM，仅离窗宿主释放异步资源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { disposeBaseRichValues } from './bases-rich-lifecycle.js';
export interface BaseVirtualOptions {
  rowHeight?: number; overscan?: number; columns?: number; viewport?: HTMLElement; fallbackHeight?: number;
  gap?: number; estimatedHeight?: number; cardWidth?: number; forceVirtual?: boolean; onRemove?: (nodes: HTMLElement[]) => void;
}
export const BASE_VIRTUAL_THRESHOLD = 200;
export const BASE_VIRTUAL_ROW_HEIGHT = 30;
export function mountBaseVirtualRows<T>(parent: HTMLElement, rows: T[], renderRow: (row: T, index: number) => HTMLElement, options: BaseVirtualOptions = {}) {
  const rowHeight = options.rowHeight || BASE_VIRTUAL_ROW_HEIGHT;
  const overscan = options.overscan ?? 8;
  const columns = options.columns || 1;
  const table = parent.tagName === 'TBODY';
  const viewport = options.viewport || parent.closest('.bases-table-container') || parent.closest('.bases-embed') || parent;
  const doc = parent.ownerDocument, win = doc.defaultView || window;
  let frame = 0, destroyed = false, first = -1, last = -1;
  let observer: ResizeObserver | null = null;
  const spacer = (height: string|number) => {
    const node = doc.createElement(table ? 'tr' : 'div'); node.className = 'bases-virtual-spacer'; node.setAttribute('aria-hidden', 'true');
    const target = table ? node.appendChild(doc.createElement('td')) : node;
    if (table) { target.setAttribute('colspan', String(columns)); target.style.border = '0'; target.style.padding = '0'; }
    target.style.height = height + 'px'; return node;
  };
  function paint(force = false) {
    if (destroyed) return;
    const height = viewport.clientHeight || options.fallbackHeight || 560;
    const bodyOffset = parent === viewport ? 0 : Math.max(0, parent.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop);
    const top = Math.max(0, viewport.scrollTop - bodyOffset);
    const start = rows.length <= BASE_VIRTUAL_THRESHOLD ? 0 : Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = rows.length <= BASE_VIRTUAL_THRESHOLD ? rows.length : Math.min(rows.length, start + Math.ceil(height / rowHeight) + 2 * overscan);
    if (first === start && last === end) return;
    first = start; last = end; const fragment = doc.createDocumentFragment();
    if (start) fragment.appendChild(spacer(start * rowHeight));
    for (let index = start; index < end; index++) {
      const node = renderRow(rows[index], index); node.dataset.virtualIndex = String(index);
      if (rows.length > BASE_VIRTUAL_THRESHOLD) { node.style.height = rowHeight + 'px'; node.style.maxHeight = rowHeight + 'px'; }
      fragment.appendChild(node);
    }
    if (end < rows.length) fragment.appendChild(spacer((rows.length - end) * rowHeight));
    disposeBaseRichValues(parent);
    parent.replaceChildren(fragment); parent.dataset.virtualStart = String(start); parent.dataset.virtualEnd = String(end);
    parent.dataset.virtualTotal = String(rows.length);
  }
  const schedule = () => { if (!frame && !destroyed) frame = win.requestAnimationFrame(() => { frame = 0; paint(); }); };
  viewport.addEventListener('scroll', schedule, { passive: true });
  if (win.ResizeObserver) { observer = new win.ResizeObserver(schedule); observer.observe(viewport); }
  paint(true);
  const api = {
    refresh: () => paint(true), get destroyed() { return destroyed; },
    scrollTo(index: number) { viewport.scrollTop = Math.max(0, index * rowHeight); paint(true); },
    get range() { return [first, last]; },
    destroy() { destroyed = true; if (frame) win.cancelAnimationFrame(frame); frame = 0; observer?.disconnect(); viewport.removeEventListener('scroll', schedule); disposeBaseRichValues(parent); },
  };
  return api;
}

/** 可变高度卡片按网格行缓存高度；测高和同范围刷新保留富值宿主。 */
export function mountBaseVirtualGrid<T>(parent: HTMLElement, rows: T[], renderItem: (row: T, index: number) => HTMLElement, options: BaseVirtualOptions = {}) {
  const doc = parent.ownerDocument, win = doc.defaultView || window, viewport = options.viewport || parent;
  const gap = options.gap ?? 12, estimate = options.estimatedHeight || 180, overscan = options.overscan ?? 3;
  const minimumWidth = options.cardWidth || 200;
  let columns = 1, renderedColumns = 0, offsets: number[] = [], heights = new Map<number, number>(), first = -1, last = -1, frame = 0, destroyed = false;
  let followEnd = false, measured: ResizeObserver | null = null, resize: ResizeObserver | null = null, topSpacer: { style: { height: string; }; }|null = null, bottomSpacer: { style: { height: string; }; }|null = null;
  const nodes = new Map<number, HTMLDivElement>(), bands = () => Math.ceil(rows.length / columns);
  const rebuild = () => { offsets = [0]; for (let index = 0; index < bands(); index++) offsets.push(offsets[index] + (heights.get(index) || estimate) + gap); };
  const locate = (value: number) => {
    let low = 0, high = offsets.length - 1;
    while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (offsets[mid] <= value) low = mid; else high = mid - 1; }
    return Math.min(low, Math.max(0, bands() - 1));
  };
  const updateSpacers = () => {
    if (topSpacer) topSpacer.style.height = Math.max(0, offsets[first]) + 'px';
    if (bottomSpacer) bottomSpacer.style.height = Math.max(0, (offsets[offsets.length - 1] || 0) - offsets[last]) + 'px';
    if (followEnd) viewport.scrollTop = viewport.scrollHeight;
  };
  function measure() {
    if (destroyed) return;
    let changed = false;
    for (const [index, band] of nodes) {
      const height = band.getBoundingClientRect().height;
      if (height > 0 && Math.abs((heights.get(index) || estimate) - height) > .5) { heights.set(index, height); changed = true; }
    }
    if (changed) { rebuild(); updateSpacers(); schedule(); }
  }
  function paint() {
    if (destroyed) return;
    const style = win.getComputedStyle(parent), width = parent.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    const nextColumns = options.columns || Math.max(1, Math.floor((width + gap) / (minimumWidth + gap)));
    if (nextColumns !== columns || !offsets.length) { columns = nextColumns; heights = new Map<number, number>(); rebuild(); }
    const bodyOffset = parent === viewport ? 0 : Math.max(0, parent.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop);
    const scrollTop = followEnd ? Math.max(0, (offsets[offsets.length - 1] || 0) - (viewport.clientHeight || 560)) : Math.max(0, viewport.scrollTop - bodyOffset);
    const full = !options.forceVirtual && rows.length <= BASE_VIRTUAL_THRESHOLD;
    const start = full ? 0 : Math.max(0, locate(scrollTop) - overscan);
    const end = full ? bands() : Math.min(bands(), locate(scrollTop + (viewport.clientHeight || 560)) + overscan + 1);
    if (start === first && end === last && renderedColumns === columns) { updateSpacers(); return; }
    const removed = [...nodes].filter(([index]) => renderedColumns !== columns || index < start || index >= end);
    options.onRemove?.(removed.map(([, band]) => band));
    for (const [index, band] of removed) { measured?.unobserve(band); disposeBaseRichValues(band); nodes.delete(index); }
    first = start; last = end; renderedColumns = columns;
    const fragment = doc.createDocumentFragment();
    const spacer = () => { const node = doc.createElement('div'); node.className = 'bases-virtual-spacer'; node.setAttribute('aria-hidden', 'true'); fragment.appendChild(node); return node; };
    topSpacer = start ? spacer() : null;
    for (let bandIndex = start; bandIndex < end; bandIndex++) {
      let band = nodes.get(bandIndex);
      if (!band) {
        band = doc.createElement('div'); band.className = 'bases-virtual-band'; band.dataset.band = String(bandIndex);
        band.style.display = 'grid'; band.style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`; band.style.gap = gap + 'px'; band.style.marginBottom = gap + 'px';
        for (let index = bandIndex * columns; index < Math.min(rows.length, (bandIndex + 1) * columns); index++) {
          const item = renderItem(rows[index], index); item.dataset.virtualIndex = String(index); band.appendChild(item);
        }
        nodes.set(bandIndex, band); measured?.observe(band);
      }
      fragment.appendChild(band);
    }
    bottomSpacer = end < bands() ? spacer() : null;
    parent.replaceChildren(fragment); parent.style.display = 'block'; updateSpacers();
    parent.dataset.virtualTotal = String(rows.length); parent.dataset.virtualStart = String(start * columns); parent.dataset.virtualEnd = String(Math.min(rows.length, end * columns)); measure();
  }
  function schedule(event?: { type: string; }|undefined) {
    if (event?.type === 'scroll') followEnd = viewport.scrollTop > 0 && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
    if (!frame && !destroyed) frame = win.requestAnimationFrame(() => { frame = 0; paint(); });
  }
  viewport.addEventListener('scroll', schedule, { passive: true });
  if (win.ResizeObserver) { measured = new win.ResizeObserver(measure); resize = new win.ResizeObserver(() => schedule()); resize.observe(viewport); }
  paint();
  return {
    refresh: paint, get destroyed() { return destroyed; }, get range() { return [first * columns, Math.min(rows.length, last * columns)]; },
    scrollTo(index: number) { viewport.scrollTop = offsets[Math.floor(index / columns)] || 0; paint(); },
    destroy() { destroyed = true; if (frame) win.cancelAnimationFrame(frame); frame = 0; measured?.disconnect(); resize?.disconnect(); viewport.removeEventListener('scroll', schedule); disposeBaseRichValues(parent); nodes.clear(); },
  };
}
