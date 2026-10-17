/**
 * [INPUT]: 依赖 ../../../assets/icons.json（1874 个 Lucide 图标，数字元组格式）；依赖 ../../../assets/icons-obsidian.json（36 个 Obsidian 自有图标，原始 SVG 标记）；依赖 ../../../assets/icon-aliases.json（152 条别名映射）
 * [OUTPUT]: 导出 resolveIcon、createIcon、setIcon、getIconData、iconExists、getIconIds、addIcon、removeIcon
 * [POS]: core/ 的图标渲染器，全局唯一。解析顺序逐字复刻原版 Zm()：lucide- 前缀 → 运行时图标 → 自有图标 → 别名映射 → Lucide 表。每个 svg 带 "svg-icon <解析键>" 双类，setIcon 检测首子元素类名避免重复渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/*
 * Icon rendering — mirrors the original resolver chain exactly:
 *   1. "lucide-<name>" prefix   → lucide table
 *   2. runtime icons (addIcon)  → raw svg markup, viewBox 0 0 100 100
 *   3. built-in obsidian icons  → raw svg markup (assets/icons-obsidian.json)
 *   4. alias map                → lucide table (assets/icon-aliases.json)
 * Every svg gets classes "svg-icon <key>". setIcon skips re-render when the
 * first child already carries the requested icon name as a class.
 */
import iconTable from '../../../assets/icons.json';
import obsidianIcons from '../../../assets/icons-obsidian.json';
import iconAliases from '../../../assets/icon-aliases.json';

const SVG_NS = 'http://www.w3.org/2000/svg';

// default svg attrs — original `jm`
const SVG_ATTRS = {
  xmlns: SVG_NS, width: '24', height: '24', viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round',
};
// runtime-added icons use the 100x100 viewBox — original `Qm`
const RUNTIME_ATTRS = { viewBox: '0 0 100 100' };

// Tag ids used by the icon table:
// 0 = line, 1 = circle, 2 = polyline, 3 = polygon, 4 = ellipse, 5 = rect, 6 = path
function buildNode(tag, args) {
  let el;
  switch (tag) {
    case 0: el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', args[0]); el.setAttribute('y1', args[1]);
      el.setAttribute('x2', args[2]); el.setAttribute('y2', args[3]);
      break;
    case 1: el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', args[0]); el.setAttribute('cy', args[1]); el.setAttribute('r', args[2]);
      break;
    case 2: el = document.createElementNS(SVG_NS, 'polyline'); el.setAttribute('points', args[0]); break;
    case 3: el = document.createElementNS(SVG_NS, 'polygon'); el.setAttribute('points', args[0]); break;
    case 4: el = document.createElementNS(SVG_NS, 'ellipse');
      el.setAttribute('cx', args[0]); el.setAttribute('cy', args[1]);
      el.setAttribute('rx', args[2]); el.setAttribute('ry', args[3]);
      break;
    case 5: el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', args[0]); el.setAttribute('y', args[1]);
      el.setAttribute('width', args[2]); el.setAttribute('height', args[3]);
      if (args[4] !== undefined) el.setAttribute('rx', args[4]);
      if (args[5] !== undefined) el.setAttribute('ry', args[5]);
      break;
    case 6: el = document.createElementNS(SVG_NS, 'path'); el.setAttribute('d', args[0]); break;
    default: return null;
  }
  return el;
}

// Ym — icons added at runtime through addIcon()
const runtimeIcons = {};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Resolve an icon name to its source — mirrors the original Zm().
 * Returns { key, nodes } for lucide icons, { key, raw, runtime } for raw markup,
 * or null when the name is unknown.
 */
export function resolveIcon(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.startsWith('lucide-')) {
    const bare = name.slice(7);
    return hasOwn(iconTable, bare) ? { key: name, nodes: iconTable[bare] } : null;
  }
  if (hasOwn(runtimeIcons, name)) return { key: name, raw: runtimeIcons[name], runtime: true };
  if (hasOwn(obsidianIcons, name)) return { key: name, raw: obsidianIcons[name] };
  const alias = hasOwn(iconAliases, name) ? iconAliases[name] : name;
  return hasOwn(iconTable, alias) ? { key: 'lucide-' + alias, nodes: iconTable[alias] } : null;
}

/** Build an svg element for an icon name. Returns an empty svg when unknown. */
export function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const resolved = resolveIcon(name);
  const attrs = resolved && resolved.runtime ? { ...SVG_ATTRS, ...RUNTIME_ATTRS } : SVG_ATTRS;
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.classList.add('svg-icon');
  if (!resolved) return svg;
  svg.classList.add(resolved.key);
  if (resolved.raw) {
    svg.innerHTML = resolved.raw;
  } else {
    for (const entry of resolved.nodes) {
      const node = buildNode(entry[0], entry.slice(1));
      if (node) svg.appendChild(node);
    }
  }
  return svg;
}

/**
 * Replace the element's first child with the requested icon.
 * Skips re-render when the first child is an svg carrying the requested name.
 */
export function setIcon(el, iconName) {
  if (!el) return null;
  const first = el.firstChild;
  if (first && first.nodeType === 1 && first.tagName.toLowerCase() === 'svg'
    && first.classList && first.classList.contains(iconName)) {
    return first;
  }
  if (first) el.removeChild(first);
  if (typeof iconName !== 'string' || !resolveIcon(iconName)) return null;
  const svg = createIcon(iconName);
  el.appendChild(svg);
  return svg;
}

/** Lucide node data for a name, or null. Kept for plugin-API compatibility. */
export function getIconData(name) {
  const resolved = resolveIcon(name);
  return resolved && resolved.nodes ? resolved.nodes : null;
}

export function iconExists(name) {
  return !!resolveIcon(name);
}

/** All known icon names — original nv(). */
export function getIconIds() {
  return Object.keys(iconTable).map((n) => 'lucide-' + n)
    .concat(Object.keys(runtimeIcons))
    .concat(Object.keys(obsidianIcons));
}

/** Register a custom icon from raw svg markup — original ev(). */
export function addIcon(name, svgMarkup) {
  runtimeIcons[name] = svgMarkup;
}

/** Remove a runtime icon — original tv(). */
export function removeIcon(name) {
  delete runtimeIcons[name];
}

export { iconTable };
