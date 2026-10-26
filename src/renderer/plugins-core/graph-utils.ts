/**
 * [INPUT]: 依赖浏览器 Canvas 解析 CSS 颜色。
 * [OUTPUT]: 导出 has、clamp、颜色探针、颜色转换、显示名与修饰键判定。
 * [POS]: 图谱的共享叶子模块；不依赖插件入口、引擎或视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const has = (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key);
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/* 原版 CQ：渲染器颜色探针的类名表（testCSS 从 .graph-view.color-* 读取计算值） */
export const COLOR_CLASSES = {
  fill: 'color-fill', fillFocused: 'color-fill-focused', fillTag: 'color-fill-tag',
  fillUnresolved: 'color-fill-unresolved', fillAttachment: 'color-fill-attachment',
  arrow: 'color-arrow', circle: 'color-circle', line: 'color-line', text: 'color-text',
  fillHighlight: 'color-fill-highlight', lineHighlight: 'color-line-highlight',
};
let colorProbeCtx: CanvasRenderingContext2D|null = null;
/* 把 CSS 颜色（rgb()/rgba()/#rrggbb 或浏览器规范化的其它写法）解析为 {r,g,b,a} */
export function parseColor(value: string) {
  if (!value) return null;
  const parse = (str: string) => {
    const fn = /^rgba?\(([^)]+)\)$/.exec(str.trim());
    if (fn) {
      const parts = fn[1].split(/[,\s/]+/).filter((s) => s !== '').map(parseFloat);
      if (parts.length >= 3 && !parts.some((n) => Number.isNaN(n))) {
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      }
    }
    const hex = /^#([0-9a-f]{6})$/i.exec(str.trim());
    if (!hex) return null;
    const v = parseInt(hex[1], 16);
    return { r: v >> 16 & 255, g: v >> 8 & 255, b: v & 255, a: 1 };
  };
  const direct = parse(value);
  if (direct) return direct;
  if (!colorProbeCtx) colorProbeCtx = document.createElement('canvas').getContext('2d');
  if (!colorProbeCtx) return null;
  colorProbeCtx.fillStyle = '#000';
  colorProbeCtx.fillStyle = value;
  return typeof colorProbeCtx.fillStyle === 'string' ? parse(colorProbeCtx.fillStyle) : null;
}
/* 原版 Ak({h,s,l})：颜色组默认色的 HSL → hex */
export function hslToHex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
/* 原版 cu/iu：节点显示名，md 去掉扩展名 */
export function displayName(id: string) {
  const base = id.split('/').pop() || '';
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
}
/* 原版 Ng.isModEvent：Mod 键（macOS 为 Cmd） */
export const isModEvent = (ev: { metaKey?: boolean; ctrlKey?: boolean } | null | undefined) => !!(ev && (ev.metaKey || ev.ctrlKey));
