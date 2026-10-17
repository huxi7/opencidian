/**
 * [INPUT]: 无外部依赖。纯函数：矩形几何、贝塞尔路径、JSON Canvas 配色解析、元素矩形测量。
 * [OUTPUT]: 导出 genId、bboxOf、unionBBox、expandBBox、boxesIntersect、containsBox、sidePoint、offsetPoint、bezierFor、bezierPoint、nearestSide、SIDE_ROTATION、parseCanvasColor、applyCanvasColor、clamp、rectOf、rectFromPos、distanceToBox、MultiMap。
 * [POS]: views/ 画布四件套（canvas-viewport / canvas-interactions / canvas-node / canvas-edge）的共享几何与配色层。公式逐字复刻原版 B5/V5/z5/R5/N3：边从节点边中点出发，控制点沿边法线偏移 clamp(距离/2, 70, 150)。不持有状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas geometry + color helpers — mirrors the original B5/V5/z5/R5/N3. */

/** 生成节点/边 id（原版 sc(16)：16 位十六进制）。 */
export function genId() {
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

/** Node rect -> bbox. */
export function bboxOf(node) {
  return { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
}

export function unionBBox(boxes) {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

export function expandBBox(box, d) {
  return { minX: box.minX - d, minY: box.minY - d, maxX: box.maxX + d, maxY: box.maxY + d };
}

export function boxesIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** 原版 g3：box 是否完整包含 inner。 */
export function containsBox(box, inner) {
  return box.minX <= inner.minX && box.minY <= inner.minY && box.maxX >= inner.maxX && box.maxY >= inner.maxY;
}

export function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

/** B5: 边在节点 bbox 指定侧的中点。side 非法时返回 null。 */
export function sidePoint(box, side) {
  switch (side) {
    case 'top': return { x: (box.minX + box.maxX) / 2, y: box.minY };
    case 'right': return { x: box.maxX, y: (box.minY + box.maxY) / 2 };
    case 'bottom': return { x: (box.minX + box.maxX) / 2, y: box.maxY };
    case 'left': return { x: box.minX, y: (box.minY + box.maxY) / 2 };
    default: return null;
  }
}

/** V5: 沿 side 法线把点外移 dist。 */
export function offsetPoint(point, side, dist) {
  const p = { x: point.x, y: point.y };
  switch (side) {
    case 'top': p.y -= dist; break;
    case 'bottom': p.y += dist; break;
    case 'left': p.x -= dist; break;
    case 'right': p.x += dist; break;
  }
  return p;
}

/** z5: 三次贝塞尔，返回 {from,to,cp1,cp2,path}。 */
export function bezierFor(from, fromSide, to, toSide) {
  const dist = Math.hypot(from.x - to.x, from.y - to.y);
  const offset = Math.min(Math.max(dist / 2, 70), 150);
  const cp1 = offsetPoint(from, fromSide, offset);
  const cp2 = offsetPoint(to, toSide, offset);
  const path = `M${from.x},${from.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${to.x},${to.y}`;
  return { from, to, cp1, cp2, path };
}

/** 贝塞尔参数点（边标签定位用 t=0.5）。 */
export function bezierPoint(t, bezier) {
  const { from, to, cp1, cp2 } = bezier;
  const a = 1 - t;
  const c0 = a * a * a;
  const c1 = 3 * t * a * a;
  const c2 = 3 * t * t * a;
  const c3 = t * t * t;
  return {
    x: c0 * from.x + c1 * cp1.x + c2 * cp2.x + c3 * to.x,
    y: c0 * from.y + c1 * cp1.y + c2 * cp2.y + c3 * to.y,
  };
}

/** R5: fromBox 朝向 toBox 的一侧。 */
export function nearestSide(fromBox, toBox) {
  const fc = { x: (fromBox.minX + fromBox.maxX) / 2, y: (fromBox.minY + fromBox.maxY) / 2 };
  const tc = { x: (toBox.minX + toBox.maxX) / 2, y: (toBox.minY + toBox.maxY) / 2 };
  const angle = Math.atan2(tc.y - fc.y, tc.x - fc.x);
  const width = fromBox.maxX - fromBox.minX;
  const height = fromBox.maxY - fromBox.minY;
  const diag = Math.atan2(height, width);
  if (angle > -diag && angle <= diag) return 'right';
  if (angle > diag && angle <= Math.PI - diag) return 'bottom';
  if (angle > Math.PI - diag || angle <= -(Math.PI - diag)) return 'left';
  return 'top';
}

/** 箭头旋转角（原版 q5）。 */
export const SIDE_ROTATION = { top: '180', bottom: '0', left: '90', right: '270' };

/** 解析 "r,g,b" 或 "#rrggbb"/"#rgb" 为 {r,g,b}；失败返回 null。 */
export function parseCanvasColor(color) {
  const s = String(color || '').trim();
  if (!s) return null;
  let m = s.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

/** N3: 把 JSON Canvas 颜色写到元素上（mod-canvas-color-1..6 / 自定义 RGB）。 */
export function applyCanvasColor(el, color) {
  const value = String(color || '').trim();
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('mod-canvas-color')) el.classList.remove(cls);
  }
  el.style.removeProperty('--canvas-color');
  el.classList.toggle('is-themed', !!value);
  if (!value) return;
  if (/^[1-6]$/.test(value)) {
    el.classList.add('mod-canvas-color-' + value);
    return;
  }
  const rgb = parseCanvasColor(value);
  if (rgb) {
    el.classList.add('mod-canvas-color-custom');
    el.style.setProperty('--canvas-color', `${rgb.r},${rgb.g},${rgb.b}`);
  }
}

/* ------------------------------------------------------------ 元素与尺寸 */

/** 元素可视矩形（含 clientLeft/Top 修正），额外给出中心与相对中心的边界。 */
export function rectOf(el) {
  const rect = el.getBoundingClientRect();
  const left = rect.left + el.clientLeft;
  const top = rect.top + el.clientTop;
  const width = el.clientWidth;
  const height = el.clientHeight;
  return {
    left, top, width, height,
    cx: left + width / 2, cy: top + height / 2,
    minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2,
  };
}

/** 原版 w3：把锚点 + 尺寸 + 方位折成矩形。 */
export function rectFromPos(pos, size, position) {
  let x = pos.x;
  let y = pos.y;
  if (position === 'center') { x -= size.width / 2; y -= size.height / 2; }
  else if (position === 'left') { y -= size.height / 2; }
  else if (position === 'top') { x -= size.width / 2; }
  else if (position === 'right') { x -= size.width; y -= size.height / 2; }
  else if (position === 'bottom') { x -= size.width / 2; y -= size.height; }
  return { x, y, width: size.width, height: size.height };
}

/** 点到矩形的最近距离（点在矩形内时为 0）。 */
export function distanceToBox(point, box) {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  return Math.hypot(dx, dy);
}

/** 原版 cc：按节点索引边的多值映射。 */
export class MultiMap {
  constructor() { this.map = new Map(); }
  add(key, value) {
    let set = this.map.get(key);
    if (!set) { set = new Set(); this.map.set(key, set); }
    set.add(value);
  }
  delete(key, value) { const set = this.map.get(key); if (set) set.delete(value); }
  getArray(key) { const set = this.map.get(key); return set ? Array.from(set) : []; }
}
