/**
 * [INPUT]: 真实文本 Range、正文样式与文本所属卡片的 DOM 层级。
 * [OUTPUT]: prepareCanvasPrivacy 返回 clear；drawPrivacyText 绘制同步预览的几何字形。
 * [POS]: 自绘隐私字形进入原卡片层级，由浏览器裁切并按原 z 顺序合成；不复制 Flow Circular 字体。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const MAX_CHARACTERS = 200000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const OWNER = '.canvas-node-container,.canvas-node-label,.canvas-group-label,.canvas-edge-label';
let nextClip = 0;
function shape(x: number, y: number, width: number, height: number) {
  const h = height * 0.38, w = Math.max(h * 0.25, width * 0.92);
  return { x, y: y + height * 0.34, width: w, height: h, radius: Math.min(w, h) / 2 };
}
function glyph(ctx: { beginPath: () => void; roundRect: (arg0: number,arg1: number,arg2: number,arg3: number,arg4: number) => void; fill: () => void; }, x: number, y: number, width: number, height: number) {
  if (width < 0.2 || height < 0.2) return;
  const box = shape(x, y, width, height);
  ctx.beginPath(); ctx.roundRect(box.x, box.y, box.width, box.height, box.radius); ctx.fill();
}
const number = (value: number) => Number(value.toFixed(3));
function glyphPath(rect: { width: number; height: number; left: number|undefined; top: number|undefined; right: number|undefined; bottom: number|undefined; }, matrix: DOMMatrixInit|undefined) {
  if (rect.width < 0.2 || rect.height < 0.2) return '';
  const a = new DOMPoint(rect.left, rect.top).matrixTransform(matrix);
  const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(matrix);
  const box = shape(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const x = number(box.x), y = number(box.y), r = number(box.radius), right = number(box.x + box.width), bottom = number(box.y + box.height);
  return `M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}
function textClip(text: Node, owner: Element) {
  let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity, opacity = 1;
  for (let node = text.parentElement; node && node !== owner; node = node.parentElement) {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    opacity *= Number(style.opacity);
    if (/hidden|clip|scroll|auto/.test(style.overflowX) || /paint|strict|content/.test(style.contain)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
    if (/hidden|clip|scroll|auto/.test(style.overflowY) || /paint|strict|content/.test(style.contain)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
  }
  return { left, top, right, bottom, opacity };
}
function createLayer(doc: Document, owner: HTMLElement) {
  const position = owner.style.getPropertyValue('position'), priority = owner.style.getPropertyPriority('position');
  const hadStyle = owner.hasAttribute('style');
  if (getComputedStyle(owner).position === 'static') owner.style.position = 'relative';
  const svg = doc.createElementNS(SVG_NS, 'svg'); svg.classList.add('canvas-privacy-glyphs');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;margin:0;overflow:visible;pointer-events:none;';
  const defs = doc.createElementNS(SVG_NS, 'defs'); svg.appendChild(defs); owner.appendChild(svg);
  return { svg, defs, clear() {
    svg.remove();
    if (position) owner.style.setProperty('position', position, priority); else owner.style.removeProperty('position');
    if (!hadStyle && !owner.style.length) owner.removeAttribute('style');
  } };
}
export function prepareCanvasPrivacy(wrapper: HTMLDivElement) {
  const doc = wrapper.ownerDocument, walker = doc.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  const texts: Array<{ text: Node; owner: HTMLElement; color: string }> = [], layers = new Map<HTMLElement, ReturnType<typeof createLayer>>();
  let text, count = 0;
  while ((text = walker.nextNode())) {
    const parent = text.parentElement;
    const owner = parent?.closest<HTMLElement>(OWNER);
    if (!owner || !parent || !(text.textContent || '').trim() || parent.closest('script,style,svg,canvas,.canvas-controls,.canvas-menu-container')) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    count += (text.textContent || '').length;
    if (count > MAX_CHARACTERS) throw Error('隐私导出文字超过 200000 字符；请缩小导出范围。');
    texts.push({ text, owner, color: style.color });
  }
  const clear = () => { for (const layer of layers.values()) layer.clear(); layers.clear(); texts.length = 0; };
  try {
    const range = doc.createRange();
    for (const { text, owner, color } of texts) {
      range.selectNodeContents(text);
      const bounds = range.getBoundingClientRect(), clip = textClip(text, owner);
      if (!bounds.width || !bounds.height || clip.opacity <= 0) continue;
      let layer = layers.get(owner);
      if (!layer) { layer = createLayer(doc, owner); layers.set(owner, layer); }
      const screen = layer.svg.getScreenCTM(); if (!screen || !screen.a || !screen.d) continue;
      const matrix = screen.inverse();
      const left = Math.max(bounds.left, clip.left), top = Math.max(bounds.top, clip.top), right = Math.min(bounds.right, clip.right), bottom = Math.min(bounds.bottom, clip.bottom);
      if (right <= left || bottom <= top) continue;
      const id = 'opensidian-private-' + (++nextClip), cp = doc.createElementNS(SVG_NS, 'clipPath'), rect = doc.createElementNS(SVG_NS, 'rect');
      const a = new DOMPoint(left, top).matrixTransform(matrix), b = new DOMPoint(right, bottom).matrixTransform(matrix);
      cp.id = id; cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
      rect.setAttribute('x', String(Math.min(a.x, b.x))); rect.setAttribute('y', String(Math.min(a.y, b.y)));
      rect.setAttribute('width', String(Math.abs(b.x - a.x))); rect.setAttribute('height', String(Math.abs(b.y - a.y))); cp.appendChild(rect); layer.defs.appendChild(cp);
      let pathData = '', index = 0;
      for (const character of text.textContent || '') {
        const start = index; index += character.length; if (/\s/.test(character)) continue;
        range.setStart(text, start); range.setEnd(text, index);
        for (const glyphRect of range.getClientRects()) pathData += glyphPath(glyphRect, matrix);
      }
      if (pathData) {
        const path = doc.createElementNS(SVG_NS, 'path'); path.setAttribute('d', pathData); path.setAttribute('clip-path', 'url(#' + id + ')');
        path.style.fill = color; path.style.stroke = 'none'; path.style.opacity = String(clip.opacity); layer.svg.appendChild(path);
      }
    }
    range.detach();
    return { clear };
  } catch (error) { clear(); throw error; }
}
export function drawPrivacyText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  let offset = 0, row = 0;
  for (const character of String(text || '')) {
    const width = ctx.measureText(character).width;
    if (character === '\n' || offset + width > maxWidth) { row++; offset = 0; }
    if (!/\s/.test(character)) glyph(ctx, x + offset, y + row * lineHeight, width, lineHeight);
    if (character !== '\n') offset += width;
  }
}
