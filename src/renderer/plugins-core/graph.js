/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/vault.js 的 TFile；依赖 ../core/icons.js 的 setIcon；依赖 ../core/setting.js 的 Setting/TextComponent/ColorPickerComponent；依赖 ../core/events.js 的 debounce；依赖 ../core/settings.js 的 readJson/writeJsonMerged（.obsidian/graph.json）；依赖 ../views/graph-view.js 的 GraphView/LocalGraphView
 * [OUTPUT]: 导出 nameKey、create(app)（注册 'graph'/'localgraph' 视图与 graph:open、graph:open-local、graph:animate 命令）；导出选项默认值与读写、GraphQuery、buildGraphData/filterLocalGraph/removeOrphans、ForceSim、GraphEngine（数据引擎与控制面板）与共享工具（has/clamp/COLOR_CLASSES/parseColor/hslToHex/displayName/isModEvent）
 * [POS]: plugins-core/ 的关系图谱插件，原版 gJ + MJ（数据引擎 + 控制面板）的 1:1 移植。画布渲染与视图壳在 views/graph-view.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: graph — data engine, query filter, force simulation, controls. */
import { t } from '../core/i18n.js';
import { TFile } from '../core/vault.js';
import { setIcon } from '../core/icons.js';
import { Setting, TextComponent, ColorPickerComponent } from '../core/setting.js';
import { debounce } from '../core/events.js';
import { GraphView, LocalGraphView } from '../views/graph-view.js';

export const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ---------------------------------------------------------------------------
// 选项：默认值与滑块 ⇄ 力学强度的互逆映射
// ---------------------------------------------------------------------------
/* 原版 yQ */
export const FILTER_DEFAULTS = {
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  showTags: false,
  localFile: null,
  localJumps: 1,
  localInterlinks: false,
  localForelinks: true,
  localBacklinks: true,
};
/* 原版 DJ */
export const DISPLAY_DEFAULTS = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};
/* 原版 CJ/EJ：滑块值∈[0,1] 与力学强度之间的映射，min 为强度下限（原版传 0.01） */
export function strengthFromSlider(slider, min) {
  return (Math.pow(min, 1 - slider) - min) / (1 - min);
}
export function inverseStrength(strength, min) {
  return 1 - Math.log(strength * (1 - min) + min) / Math.log(min);
}
/* 原版 PJ：默认值同样以滑块单位存储 */
export const FORCE_DEFAULTS = {
  centerStrength: inverseStrength(0.1, 0.01),
  repelStrength: 10,
  linkStrength: inverseStrength(1, 0.01),
  linkDistance: 250,
};

const GRAPH_OPTIONS_FILE = 'graph.json';
/* 原版 loadData/saveData：内部插件数据落在 <vault>/.obsidian/graph.json */
export function readGraphOptions(app) {
  const data = app.settings.readJson(GRAPH_OPTIONS_FILE);
  return data && typeof data === 'object' ? data : {};
}
export function writeGraphOptions(app, options) {
  app.settings.writeJsonMerged(GRAPH_OPTIONS_FILE, options);
}

// ---------------------------------------------------------------------------
// 节点与扩展名判定
// ---------------------------------------------------------------------------
/* 原版 bQ：图谱节点记录。type ∈ ''|'attachment'|'tag'|'unresolved'|'focused' */
export function createNode(type = '') {
  return { type, links: {} };
}
/* 原版 wQ：局部图谱用的浅拷贝（保留颜色，链接表重建） */
export function cloneNode(node) {
  if (!node) return createNode();
  const out = createNode(node.type);
  if (node.color) out.color = node.color;
  return out;
}
const TAG_TYPE = { tag: true };
/* 原版 ou：取小写扩展名，无扩展名返回空串 */
export function getExtension(path) {
  const i = path.lastIndexOf('.');
  return i < 0 || i === path.length - 1 || i === 0 ? '' : path.slice(i + 1).toLowerCase();
}
const NOTE_EXTENSIONS = ['md', 'canvas', 'base']; // 原版 Wy：这些不是附件
/* 原版 Ky：不是笔记/画布/数据库的文件按附件节点处理 */
export function isAttachmentPath(path) {
  return !NOTE_EXTENSIONS.includes(getExtension(path));
}

// ---------------------------------------------------------------------------
// 检索式：原版 NH 的简化版。支持 -取反、file:/path:/tag:/content: 前缀与引号
// 文本匹配为大小写不敏感的子串匹配（原版对特殊字符做转义，同样不是通配符）。
// ---------------------------------------------------------------------------
const QUERY_TERM_RE = /(-)?(?:(file|path|tag|content):)?("([^"]*)"|\S+)/g;

function parseTerms(query) {
  const terms = [];
  QUERY_TERM_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_TERM_RE.exec(query))) {
    const value = m[4] !== undefined ? m[4] : m[3];
    if (!value) continue;
    terms.push({ negated: !!m[1], type: m[2] || '', value });
  }
  return terms;
}

function textMatches(text, needle) {
  if (!text) return false;
  return text.toLowerCase().includes(needle.toLowerCase());
}

function tagMatches(tag, needle) {
  const full = needle.startsWith('#') ? needle : '#' + needle;
  const lower = tag.toLowerCase();
  const target = full.toLowerCase();
  return lower === target || lower.startsWith(target + '/');
}

/* 单条检索式对某个字段集的匹配；字段不存在（如附件没有 content）视为不匹配 */
function termMatches(term, fields) {
  switch (term.type) {
    case 'tag':
      return fields.tag !== undefined && tagMatches(fields.tag, term.value);
    case 'file':
      return fields.filename !== undefined && textMatches(fields.filename, term.value);
    case 'path':
      return fields.filepath !== undefined && textMatches(fields.filepath, term.value);
    case 'content':
      return fields.content !== undefined && textMatches(fields.content, term.value);
    default:
      // 原版：无前缀的文本在文档可用字段（md 为 filename + content）中任一命中即可
      return (fields.filename !== undefined && textMatches(fields.filename, term.value))
        || (fields.content !== undefined && textMatches(fields.content, term.value));
  }
}

export class GraphQuery {
  constructor(query) {
    this.query = query;
    this.terms = parseTerms(query);
    /* 原版：解析不出匹配式时 matcher 为 null，该检索式不参与过滤 */
    this.matcher = this.terms.length ? this : null;
  }
  /* 原版 NH.match(file, content)：非 md 只有文件名可匹配 */
  match(file, content) {
    const fields = {
      filename: file.name,
      filepath: file.path,
      content: file.extension === 'md' ? (content || '') : undefined,
    };
    return this._every((term) => termMatches(term, fields));
  }
  matchTag(tag) {
    return this._every((term) => termMatches(term, { tag }));
  }
  matchFilepath(path) {
    const base = path.split('/').pop();
    return this._every((term) => termMatches(term, { filename: base, filepath: path }));
  }
  _every(fn) {
    for (const term of this.terms) {
      const hit = fn(term);
      if (term.negated ? hit : !hit) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// 图谱数据构建（原版 MJ.render 内的 c() 函数）
// ---------------------------------------------------------------------------
/* 原版 xT：文件缓存里的全部标签（项目解析器已把 frontmatter 标签并入 cache.tags） */
function getAllTags(cache) {
  if (!cache || !cache.tags) return null;
  return cache.tags.map((entry) => entry.tag);
}

/**
 * 构建全量图谱。
 * @param {object} metadataCache app.metadataCache
 * @param {object} vault app.vault
 * @param {object} options 筛选选项（FILTER_DEFAULTS 的形状）
 * @param {(path: string, type: string) => boolean|object} nodeFilter 返回 false 剔除，返回对象作为节点颜色
 * @param {number} progression 生长动画进度：0 表示完整图谱
 */
export function buildGraphData(metadataCache, vault, options, nodeFilter, progression) {
  const resolvedLinks = metadataCache.resolvedLinks;
  const unresolvedLinks = metadataCache.unresolvedLinks;
  const showAttachments = options.showAttachments;
  const hideUnresolved = options.hideUnresolved;
  const showTags = options.showTags;
  const tagLookup = {};
  if (showTags) {
    const tags = metadataCache.getTags();
    for (const key in tags) if (has(tags, key)) tagLookup[key.toLowerCase()] = key;
  }
  const nodes = {};
  let numLinks = 0;
  const paths = metadataCache.getCachedFiles().map((entry) => entry.file.path);
  if (progression) {
    /* 原版：生长动画按创建时间（ctime 与 mtime 的较小者）排序文件 */
    const times = {};
    for (const path of paths) {
      const file = vault.getAbstractFileByPath(path);
      times[path] = file instanceof TFile ? Math.min(file.stat.ctime, file.stat.mtime) : Infinity;
    }
    paths.sort((a, b) => times[a] - times[b]);
  }
  let lastNodeId = '';
  for (const path of paths) {
    const attachment = isAttachmentPath(path);
    if (!showAttachments && attachment) continue;
    const type = attachment ? 'attachment' : '';
    const keep = nodeFilter(path, type);
    if (!keep) continue;
    const node = nodes[path] = createNode(type);
    const links = node.links;
    if (options.showOrphans) {
      if (numLinks === progression) lastNodeId = path;
      numLinks++;
    }
    if (typeof keep !== 'boolean') node.color = keep;
    if (has(resolvedLinks, path)) {
      const resolved = resolvedLinks[path];
      for (const target in resolved) {
        if (!has(resolved, target)) continue;
        const targetAttachment = isAttachmentPath(target);
        if (!showAttachments && targetAttachment) continue;
        if (!nodeFilter(target, targetAttachment ? 'attachment' : '')) continue;
        if (!progression || numLinks < progression) links[target] = true;
        else if (numLinks === progression) lastNodeId = path;
        numLinks++;
      }
    }
    if (!hideUnresolved && has(unresolvedLinks, path)) {
      const unresolved = unresolvedLinks[path];
      for (const target in unresolved) {
        if (!has(unresolved, target)) continue;
        if (!nodeFilter(target, 'unresolved')) continue;
        if (!progression || numLinks < progression) {
          links[target] = true;
          if (!has(nodes, target)) nodes[target] = createNode('unresolved');
        } else if (numLinks === progression) lastNodeId = path;
        numLinks++;
      }
    }
    if (showTags) {
      const tags = getAllTags(metadataCache.getCache(path));
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          if (!nodeFilter(tag, 'tag')) continue;
          const id = tagLookup[tag.toLowerCase()] || tag;
          if (!progression || numLinks < progression) links[id] = true;
          else if (numLinks === progression) lastNodeId = path;
          numLinks++;
          if (!has(nodes, id)) nodes[id] = createNode('tag');
        }
      }
    }
  }
  if (progression && lastNodeId) {
    /* 原版：动画只保留进度内已出现的文件节点 */
    const idx = paths.indexOf(lastNodeId);
    if (idx !== -1) for (let i = idx + 1; i < paths.length; i++) delete nodes[paths[i]];
  }
  return { nodes, numLinks };
}

/* 原版 render 内联函数：剔除既无出链、也无人引用的孤立节点 */
export function removeOrphans(data) {
  const nodes = data.nodes;
  const referenced = {};
  for (const id in nodes) if (has(nodes, id)) {
    const links = nodes[id].links;
    for (const target in links) if (has(links, target) && id !== target) referenced[target] = true;
  }
  for (const id in nodes) if (has(nodes, id)) {
    const links = nodes[id].links;
    let linked = false;
    for (const target in links) {
      if (has(links, target) && has(nodes, target) && id !== target) { linked = true; break; }
    }
    if (!linked && !referenced[id]) delete nodes[id];
  }
}

/**
 * 局部图谱过滤（原版 DQ）。
 * 以 localFile 为起点按 localJumps 层扩散：正向链接与反向链接各由开关控制，
 * 每层权重 30 - (30/jumps)*(i+1)，localFile 权重 30（供节点大小使用）。
 */
export function filterLocalGraph(data, options) {
  const nodes = data.nodes;
  const out = {};
  const weights = {};
  const localFile = options.localFile;
  const jumps = options.localJumps;
  const interlinks = options.localInterlinks;
  const forelinks = options.localForelinks;
  const backlinks = options.localBacklinks;
  weights[localFile] = 30;
  if (!has(nodes, localFile)) {
    out[localFile] = createNode();
    return { nodes: out, weights };
  }
  out[localFile] = createNode(nodes[localFile].type);
  const expand = (weight) => {
    const added = {};
    for (const id in nodes) if (has(nodes, id)) {
      const node = nodes[id];
      if (node.type === 'tag') continue;
      const links = node.links;
      for (const target in links) if (has(links, target)) {
        const current = out[id];
        if (forelinks && has(out, id) && !has(out, target) && !has(TAG_TYPE, current.type)) {
          added[target] = added[target] || cloneNode(nodes[target]);
          current.links[target] = true;
        } else if (backlinks && has(out, target) && !has(out, id) && !has(TAG_TYPE, out[target].type)) {
          added[id] = added[id] || cloneNode(nodes[id]);
          added[id].links[target] = true;
        }
      }
    }
    for (const id in added) if (has(added, id)) { out[id] = added[id]; weights[id] = weight; }
  };
  const step = 30 / jumps;
  for (let i = 0; i < jumps; i++) expand(30 - step * (i + 1));
  if (interlinks) {
    for (const id in out) if (has(out, id) && has(nodes, id)) out[id] = nodes[id];
  }
  return { nodes: out, weights };
}

// ---------------------------------------------------------------------------
// 力导向力学：原版 sim.js（d3-force 的移植）的等价实现
// 力参数与积分方式逐项对齐：alpha 衰减、向心力、弹簧、斥力、碰撞、速度衰减 0.6。
// 与原版的差异：斥力用 O(n²) 直算替代 Barnes-Hut 四叉树（theta 因此不参与）。
// ---------------------------------------------------------------------------
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300); // 原版 B
const VELOCITY_DECAY = 0.6;                       // 原版 complete(..., 0.6)
const REPEL_DISTANCE_MIN = 30;                    // 原版 distanceMin(30)
const COLLIDE_RADIUS = 60;                        // 原版 radius(60)
const COLLIDE_STRENGTH = 0.5;                     // 原版 strength(.5)
const jiggle = () => 1e-6 * (Math.random() - 0.5);

export class ForceSim {
  constructor() {
    this.nodes = [];              // {id,x,y,vx,vy,fx,fy}
    this.nodeById = new Map();
    this.links = [];              // {source,target}
    this.alpha = 1;
    this.alphaTarget = 0;
    this.centerStrength = 0.1;
    this.repelStrength = -1000;
    this.linkStrength = 1;
    this.linkDistance = 250;
    this.structureDirty = false;
  }

  /**
   * 原版 worker 的 setData 消息（{nodes:{id:[x,y]},links,alpha:.3,run:true}）。
   * nodeRefs 是渲染器算好初始位置的节点 [{id,x,y}]；已有节点保留自身坐标与速度。
   */
  setData(nodeRefs, links) {
    const next = [];
    for (const ref of nodeRefs) {
      let node = this.nodeById.get(ref.id);
      if (!node) {
        node = { id: ref.id, x: ref.x, y: ref.y, vx: 0, vy: 0, fx: null, fy: null };
        this.nodeById.set(ref.id, node);
      }
      next.push(node);
    }
    const alive = new Set(nodeRefs.map((ref) => ref.id));
    for (const id of Array.from(this.nodeById.keys())) if (!alive.has(id)) this.nodeById.delete(id);
    this.nodes = next;
    const byId = this.nodeById;
    this.links = links.map(([s, t2]) => ({ source: byId.get(s), target: byId.get(t2) }))
      .filter((link) => link.source && link.target);
    this.structureDirty = true;
    this.run();
  }

  /* 原版 forceNode 消息：拖拽时钉住节点；x/y 传 null 解除钉住，alphaTarget 传 0 停止加速 */
  setForceNode(id, x, y, alpha, alphaTarget) {
    const node = this.nodeById.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
    if (alpha !== undefined && this.alpha < alpha) this.alpha = alpha;
    if (alphaTarget !== undefined) this.alphaTarget = alphaTarget;
  }

  setForces(forces) {
    if (forces.centerStrength !== undefined) this.centerStrength = forces.centerStrength;
    if (forces.linkStrength !== undefined) this.linkStrength = forces.linkStrength;
    if (forces.linkDistance !== undefined) this.linkDistance = forces.linkDistance;
    if (forces.repelStrength !== undefined) {
      /* 原版：|repel| < 1 时钳到 -1，避免零斥力 */
      this.repelStrength = Math.abs(forces.repelStrength) < 1 ? -1 : -forces.repelStrength;
    }
    this.run();
  }

  /* 原版 run 消息：只抬高 alpha，不重置 */
  run() {
    if (this.alpha < 0.3) this.alpha = 0.3;
  }

  get finished() {
    return this.alpha <= 0.001 && this.alphaTarget === 0;
  }

  tick() {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const alpha = this.alpha;
    const nodes = this.nodes;
    for (const node of nodes) {
      /* 向心力（原版 forceX/forceY，strength = centerStrength，目标原点） */
      node.vx += (0 - node.x) * this.centerStrength * alpha;
      node.vy += (0 - node.y) * this.centerStrength * alpha;
    }
    for (const link of this.links) {
      /* 弹簧（原版 q：strength 默认 1/min(出度,入度)，带 bias 与 jiggle） */
      const source = link.source;
      const target = link.target;
      const countSource = this._linkCount(source);
      const countTarget = this._linkCount(target);
      const strength = this.linkStrength / Math.min(countSource, countTarget);
      let dx = target.x + target.vx - source.x - source.vx;
      let dy = target.y + target.vy - source.y - source.vy;
      let distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0) { dx = jiggle(); dy = jiggle(); distance = Math.sqrt(dx * dx + dy * dy); }
      const scale = ((distance - this.linkDistance) / distance) * alpha * strength;
      dx *= scale;
      dy *= scale;
      const bias = countSource / (countSource + countTarget);
      target.vx -= dx * bias;
      target.vy -= dy * bias;
      source.vx += dx * (1 - bias);
      source.vy += dy * (1 - bias);
    }
    const minDist2 = REPEL_DISTANCE_MIN * REPEL_DISTANCE_MIN;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 === 0) { dx = jiggle(); dy = jiggle(); dist2 = dx * dx + dy * dy; }
        if (dist2 < minDist2) dist2 = Math.sqrt(minDist2 * dist2);
        const force = this.repelStrength * alpha / dist2;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax = a.x + a.vx;
      const ay = a.y + a.vy;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bx = b.x + b.vx;
        const by = b.y + b.vy;
        let dx = ax - bx;
        let dy = ay - by;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = COLLIDE_RADIUS * 2;
        if (dist >= minDist) continue;
        if (dist === 0) { dx = jiggle(); dy = jiggle(); dist = Math.sqrt(dx * dx + dy * dy); }
        const scale = ((minDist - dist) / dist) * COLLIDE_STRENGTH;
        dx *= scale;
        dy *= scale;
        const weight = (COLLIDE_RADIUS * COLLIDE_RADIUS) / (COLLIDE_RADIUS * COLLIDE_RADIUS + COLLIDE_RADIUS * COLLIDE_RADIUS);
        a.vx += dx * weight;
        a.vy += dy * weight;
        b.vx -= dx * (1 - weight);
        b.vy -= dy * (1 - weight);
      }
    }
    for (const node of nodes) {
      /* 积分（原版 complete）：先速度衰减 0.6 再位移；fx/fy 钉住的节点直接落位 */
      if (node.fx === null) { node.vx *= VELOCITY_DECAY; node.x += node.vx; }
      else { node.x = node.fx; node.vx = 0; }
      if (node.fy === null) { node.vy *= VELOCITY_DECAY; node.y += node.vy; }
      else { node.y = node.fy; node.vy = 0; }
    }
    return this.alpha;
  }

  _linkCount(node) {
    let count = 0;
    for (const link of this.links) if (link.source === node || link.target === node) count++;
    return Math.max(1, count);
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 共享工具：颜色探针、显示名与事件判定（原版 CQ/Tk/cu/Ng）
// ---------------------------------------------------------------------------
/* 原版 CQ：渲染器颜色探针的类名表（testCSS 从 .graph-view.color-* 读取计算值） */
export const COLOR_CLASSES = {
  fill: 'color-fill', fillFocused: 'color-fill-focused', fillTag: 'color-fill-tag',
  fillUnresolved: 'color-fill-unresolved', fillAttachment: 'color-fill-attachment',
  arrow: 'color-arrow', circle: 'color-circle', line: 'color-line', text: 'color-text',
  fillHighlight: 'color-fill-highlight', lineHighlight: 'color-line-highlight',
};
let colorProbeCtx = null;
/* 把 CSS 颜色（rgb()/rgba()/#rrggbb 或浏览器规范化的其它写法）解析为 {r,g,b,a} */
export function parseColor(value) {
  if (!value) return null;
  const parse = (str) => {
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
  colorProbeCtx.fillStyle = '#000';
  colorProbeCtx.fillStyle = value;
  return parse(colorProbeCtx.fillStyle);
}
/* 原版 Ak({h,s,l})：颜色组默认色的 HSL → hex */
export function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
/* 原版 cu/iu：节点显示名，md 去掉扩展名 */
export function displayName(id) {
  const base = id.split('/').pop();
  return base.toLowerCase().endsWith('.md') ? base.slice(0, -3) : base;
}
/* 原版 Ng.isModEvent：Mod 键（macOS 为 Cmd） */
export const isModEvent = (ev) => !!(ev && (ev.metaKey || ev.ctrlKey));
/* 原版键盘表：方向键平移，+/- 缩放 */
const KEYBOARD_ACTIONS = { 38: 'up', 40: 'down', 37: 'left', 39: 'right', 187: 'zoomin', 189: 'zoomout' };

// ---------------------------------------------------------------------------
// 控制面板（原版 SJ + xJ/TJ/AJ/LJ）：可折叠区段与四个设置区
// ---------------------------------------------------------------------------
/* 原版 SJ：可折叠树项。optionListeners 同时承担 getOptions/setOptions 的读写 */
class GraphControlSection {
  constructor(engine, name, label) {
    this.engine = engine;
    this.optionListeners = {};
    this.collapsed = false;
    this.el = createDiv(`tree-item graph-control-section mod-${name}`);
    this.selfEl = this.el.createDiv('tree-item-self mod-collapsible');
    this.innerEl = this.selfEl.createDiv('tree-item-inner');
    this.childrenEl = this.el.createDiv('tree-item-children');
    this.innerEl.createEl('header', { cls: 'graph-control-section-header', text: label });
    this.collapseEl = this.selfEl.createDiv('tree-item-icon collapse-icon');
    setIcon(this.collapseEl, 'right-triangle');
    const toggle = () => this.setCollapsed(!this.collapsed);
    this.collapseEl.addEventListener('click', (ev) => { if (ev.button === 0) { ev.preventDefault(); toggle(); } });
    this.selfEl.addEventListener('click', (ev) => { if (ev.button === 0 && !ev.defaultPrevented) toggle(); });
    this.setCollapsed(true);
    this.optionListeners[`collapse-${name}`] = (value) => {
      if (typeof value === 'boolean') this.setCollapsed(value);
      return this.collapsed;
    };
  }
  setCollapsed(collapsed) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.el.toggleClass('is-collapsed', collapsed);
    this.collapseEl.toggleClass('is-collapsed', collapsed);
    this.engine.onOptionsChange();
  }
  /* 本项目组件 setValue 不回调（原版会回调），载入选项时显式 apply 一次 */
  _listen(key, component, apply) {
    this.optionListeners[key] = (value) => {
      if (value !== undefined) { component.setValue(value); apply(value); }
      return component.getValue();
    };
  }
  setOptions(options) {
    for (const key in options) if (has(this.optionListeners, key)) this.optionListeners[key](options[key]);
  }
  getOptions(target) {
    for (const key in this.optionListeners) {
      const value = this.optionListeners[key]();
      if (value !== undefined) target[key] = value;
    }
  }
}

/* 原版 xJ：筛选（搜索框 + 深度 + 链接方向 + 标签/附件/未解析/孤立） */
class FilterSection extends GraphControlSection {
  constructor(engine, isLocal) {
    super(engine, 'filter', t('plugins.graph-view.label-filters'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    this.searchSetting = new Setting(children).addSearch((component) => {
      component.setPlaceholder(t('plugins.graph-view.prompt-filter-nodes')).setValue('').onChange(() => engine.requestUpdateSearch());
      this.search = component;
      component.clearButtonEl.setAttr('aria-label', t('plugins.search.tooltip-clear-search'));
      this.optionListeners.search = (value) => {
        if (value !== undefined) { component.setValue(value); engine.requestUpdateSearch(); }
        return component.getValue();
      };
      component.inputEl.addEventListener('keydown', (ev) => {
        if (!ev.isComposing && ev.key === 'Enter') engine.updateSearch();
      });
    });
    this.searchSetting.settingEl.addClass('mod-search-setting');
    if (isLocal) {
      new Setting(children).setName(t('plugins.graph-view.option-depth')).setTooltip(t('plugins.graph-view.option-depth-description'))
        .setClass('mod-local-jumps').setClass('mod-slider').addSlider((slider) => {
          const apply = (value) => { engine.options.localJumps = value; engine.render(); };
          slider.setLimits(1, 5, 1).setValue(engine.options.localJumps).setDynamicTooltip().setInstant(true)
            .onChange((value) => { apply(value); engine.onOptionsChange(); });
          this._listen('localJumps', slider, apply);
        });
    }
    /* 原版构建顺序：反向链接 → 正向链接 → 其他节点间的链接 → 标签 → 附件 → 仅显示已创建的笔记 → 孤立文件 */
    const toggles = [
      ['localBacklinks', 'option-backlinks', 'option-backlinks-description', 'local'],
      ['localForelinks', 'option-forelinks', 'option-forelinks-description', 'local'],
      ['localInterlinks', 'option-neighbor-links', 'option-neighbor-links-description', 'local'],
      ['showTags', 'option-show-tags', 'option-show-tags-description', 'all'],
      ['showAttachments', 'option-show-attachments', 'option-show-attachments-description', 'all'],
      ['hideUnresolved', 'option-show-existing-files-only', 'option-show-existing-files-only-description', 'all'],
      ['showOrphans', 'option-show-orphans', 'option-show-orphans-description', 'global'],
    ];
    for (const [key, labelKey, descKey, scope] of toggles) {
      if (scope !== 'all' && (scope === 'local') !== isLocal) continue;
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setTooltip(t(`plugins.graph-view.${descKey}`))
        .setClass('mod-toggle').addToggle((toggle) => {
          const apply = (value) => { engine.options[key] = value; engine.render(); };
          toggle.setValue(engine.options[key]).onChange((value) => { apply(value); engine.onOptionsChange(); });
          this._listen(key, toggle, apply);
        });
    }
  }
  startSearch() { this.searchSetting.settingEl.addClass('is-loading'); }
  stopSearch() { this.searchSetting.settingEl.removeClass('is-loading'); }
  setDefaultOptions() { this.setOptions(FILTER_DEFAULTS); }
}

/* 原版 TJ：颜色组（检索式 + 颜色 + 删除 + 新建）。原版的拖拽排序未实现 */
class ColorGroupSection extends GraphControlSection {
  constructor(engine) {
    super(engine, 'color-groups', t('plugins.graph-view.label-groups'));
    engine.controlsEl.appendChild(this.el);
    this.groups = [];
    this.optionListeners.colorGroups = (value) => {
      if (Array.isArray(value)) { this.setColorQueries(value); engine.requestUpdateSearch(); }
      return this.getColoredQueries();
    };
    this.setColorQueries([]);
  }
  getColoredQueries() {
    return this.groups.map((group) => ({
      query: group.query.getValue(),
      color: { a: 1, rgb: group.color.getValueInt() },
    }));
  }
  setColorQueries(queries) {
    const children = this.childrenEl;
    children.empty();
    const groups = [];
    const container = children.createDiv('graph-color-groups-container');
    for (const entry of queries) {
      const groupEl = container.createDiv('graph-color-group');
      const query = new TextComponent(groupEl).setPlaceholder(t('plugins.graph-view.placeholder-enter-query'))
        .setValue(entry.query).onChange(() => this.engine.requestUpdateSearch());
      const rgb = entry.color ? entry.color.rgb : 0;
      const color = new ColorPickerComponent(groupEl).setValue(`#${rgb.toString(16).padStart(6, '0')}`)
        .onChange(() => this.engine.updateSearch());
      color.colorPickerEl.setAttr('aria-label', t('plugins.graph-view.tooltip-click-to-change-drag-to-reorder'));
      const record = { el: groupEl, query, color };
      groupEl.createDiv('clickable-icon', (el) => {
        setIcon(el, 'x');
        el.setAttr('aria-label', t('plugins.graph-view.tooltip-delete-graph'));
        el.addEventListener('click', () => {
          const index = groups.indexOf(record);
          if (index >= 0) groups.splice(index, 1);
          groupEl.detach();
          this.engine.updateSearch();
        });
      });
      groups.push(record);
    }
    this.groups = groups;
    children.createDiv('graph-color-button-container', (containerEl) => {
      containerEl.createEl('button', { cls: 'mod-cta', text: t('plugins.graph-view.button-new-group') }, (button) => {
        button.addEventListener('click', () => {
          const dark = document.body.hasClass('theme-dark');
          const hex = hslToHex(40 * groups.length, dark ? 70 : 60, 60);
          this.setColorQueries(this.getColoredQueries().concat([{ query: '', color: { a: 1, rgb: parseInt(hex.slice(1), 16) } }]));
          this.engine.updateSearch();
        });
      });
    });
  }
}

/* 原版 AJ：外观（箭头 / 文本透明度 / 节点大小 / 连线粗细 / 播放动画） */
class DisplaySection extends GraphControlSection {
  constructor(engine, isLocal) {
    super(engine, 'display', t('plugins.graph-view.label-display'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    new Setting(children).setName(t('plugins.graph-view.option-show-arrows')).setTooltip(t('plugins.graph-view.option-show-arrows-description'))
      .setClass('mod-toggle').addToggle((toggle) => {
        const apply = (value) => { engine.options.showArrow = value; engine.renderer.setRenderOptions({ showArrow: value }); };
        toggle.onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen('showArrow', toggle, apply);
      });
    const sliders = [
      ['textFadeMultiplier', 'option-text-fade', [-3, 3, 0.1]],
      ['nodeSizeMultiplier', 'option-node-size', [0.1, 5, 'any']],
      ['lineSizeMultiplier', 'option-link-thickness', [0.1, 5, 'any']],
    ];
    for (const [key, labelKey, limits] of sliders) {
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setClass('mod-slider').addSlider((slider) => {
        const apply = (value) => { engine.options[key] = value; engine.renderer.setRenderOptions({ [key]: value }); };
        slider.setLimits(limits[0], limits[1], limits[2]).setDynamicTooltip().setInstant(true)
          .onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen(key, slider, apply);
      });
    }
    if (!isLocal) {
      new Setting(children).addButton((button) => {
        button.setButtonText(t('plugins.graph-view.button-animate-timelapse')).setCta().onClick(() => engine.renderProgression());
      });
    }
  }
  setDefaultOptions() { this.setOptions(DISPLAY_DEFAULTS); }
}

/* 原版 LJ：力度（向心力 / 排斥力 / 吸引力 / 连线长度），滑块值 ⇄ 力学强度换算 */
class ForceSection extends GraphControlSection {
  constructor(engine) {
    super(engine, 'forces', t('plugins.graph-view.label-forces'));
    engine.controlsEl.appendChild(this.el);
    const children = this.childrenEl;
    const sliders = [
      ['centerStrength', 'option-center-force', [0, 1, 'any'], (value) => strengthFromSlider(value, 0.01)],
      ['repelStrength', 'option-repel-force', [0, 20, 'any'], (value) => value * value * value],
      ['linkStrength', 'option-link-force', [0, 1, 'any'], (value) => strengthFromSlider(value, 0.01)],
      ['linkDistance', 'option-link-distance', [30, 500, 1], (value) => value],
    ];
    for (const [key, labelKey, limits, transform] of sliders) {
      new Setting(children).setName(t(`plugins.graph-view.${labelKey}`)).setClass('mod-slider').addSlider((slider) => {
        const apply = (value) => { engine.options[key] = value; engine.renderer.setForces({ [key]: transform(value) }); };
        slider.setLimits(limits[0], limits[1], limits[2]).setDynamicTooltip().setInstant(true)
          .onChange((value) => { apply(value); engine.onOptionsChange(); });
        this._listen(key, slider, apply);
      });
    }
  }
  setDefaultOptions() { this.setOptions(FORCE_DEFAULTS); }
}

// 数据引擎（原版 MJ）：检索过滤、渲染编排、文件事件与动画
// ---------------------------------------------------------------------------
export class GraphEngine {
  constructor(app, view, renderer, isLocal) {
    this.app = app;
    this.view = view;
    this.renderer = renderer;
    this.isLocal = isLocal;
    this.options = { ...FILTER_DEFAULTS };
    this.searchQueries = null;
    this.fileFilter = {};
    this.hasFilter = false;
    this.queue = null;
    this.progression = 0;
    this.progressionSpeed = 20;
    this.currentFocusFile = '';
    this.onOptionsChange = debounce(() => this.view.onOptionsChange(), 100, true);
    this.requestUpdateSearch = debounce(() => this.updateSearch(), 250, true);
    renderer.onNodeClick = (ev, id, type) => this.onNodeClick(ev, id, type);
    renderer.onNodeRightClick = (ev, id, type) => this.onNodeRightClick(ev, id, type);
    const controlsEl = this.controlsEl = renderer.containerEl.createDiv('graph-controls');
    controlsEl.dataset.ignoreSwipe = 'true';
    controlsEl.createDiv('clickable-icon graph-controls-button mod-close', (el) => {
      setIcon(el, 'x');
      el.setAttr('aria-label', t('interface.menu.close'));
      el.addEventListener('click', () => { controlsEl.addClass('is-close'); this.onOptionsChange(); });
    });
    controlsEl.createDiv('clickable-icon graph-controls-button mod-open', (el) => {
      setIcon(el, 'settings');
      el.setAttr('aria-label', t('plugins.graph-view.tooltip-open-graph-settings'));
      el.addEventListener('click', () => { controlsEl.removeClass('is-close'); this.onOptionsChange(); });
    });
    if (!isLocal) {
      controlsEl.createDiv('clickable-icon graph-controls-button mod-animate', (el) => {
        setIcon(el, 'wand-2');
        el.setAttr('aria-label', t('plugins.graph-view.tooltip-start-timelapse-animation'));
        el.addEventListener('click', () => this.renderProgression());
      });
    }
    controlsEl.createDiv('clickable-icon graph-controls-button mod-reset', (el) => {
      setIcon(el, 'rotate-ccw');
      el.setAttr('aria-label', t('interface.tooltip-restore-default-settings'));
      el.addEventListener('click', () => {
        this.filterOptions.setDefaultOptions();
        this.colorGroupOptions.setColorQueries([]);
        this.displayOptions.setDefaultOptions();
        this.forceOptions.setDefaultOptions();
      });
    });
    this.filterOptions = new FilterSection(this, isLocal);
    this.colorGroupOptions = new ColorGroupSection(this);
    this.displayOptions = new DisplaySection(this, isLocal);
    this.forceOptions = new ForceSection(this);
    this.filterOptions.setDefaultOptions();
    this.colorGroupOptions.setColorQueries([]);
    this.displayOptions.setDefaultOptions();
    this.forceOptions.setDefaultOptions();
  }

  /* 原版 load：文件/元数据/外观/打开文件事件 + 缩放持久化定时器 + 键盘缩放平移 */
  load() {
    const app = this.app;
    const view = this.view;
    view.registerEvent(app.vault.on('create', (file) => this.onFileChanged(file)));
    view.registerEvent(app.vault.on('modify', (file) => this.onFileChanged(file)));
    view.registerEvent(app.vault.on('rename', () => this.recomputeFile()));
    view.registerEvent(app.metadataCache.on('resolved', () => this.recomputeFile()));
    view.registerEvent(app.workspace.on('settings-changed', () => this.onCssChange()));
    view.registerEvent(app.workspace.on('file-open', (file) => this.onFileOpen(file)));
    let lastScale = 0;
    view.registerInterval(window.setInterval(() => {
      if (this.renderer.targetScale !== lastScale) { lastScale = this.renderer.targetScale; this.onOptionsChange(); }
    }, 2000));
    const onKey = (ev) => {
      const renderer = this.renderer;
      renderer.keyboardActions.shift = ev.shiftKey;
      const down = ev.type === 'keydown';
      if (down) {
        if (ev.repeat || ev.defaultPrevented) return;
        if (app.workspace.activeLeaf !== view.leaf) return;
        if (document.activeElement !== document.body) return;
      }
      const code = ev.which || ev.keyCode;
      if (!has(KEYBOARD_ACTIONS, code)) return;
      renderer.keyboardActions[KEYBOARD_ACTIONS[code]] = down;
      renderer.changed();
    };
    view.registerDomEvent(window, 'keydown', onKey);
    view.registerDomEvent(window, 'keyup', onKey);
  }

  onCssChange() { this.renderer.testCSS(); }

  updateSearch() {
    const queries = [];
    const search = this.filterOptions.search.getValue();
    if (search) queries.push({ query: search, color: null });
    this.setQuery(queries.concat(this.colorGroupOptions.getColoredQueries()));
    this.onOptionsChange();
  }

  /* 原版 setQuery：丢弃空检索式；非颜色检索式决定 hasFilter；分块扫描文件后重绘 */
  setQuery(queries) {
    if (this.queue) { clearTimeout(this.queue.timer); this.queue = null; }
    this.hasFilter = false;
    let list = [];
    for (const entry of queries) {
      const query = new GraphQuery(entry.query);
      if (!query.matcher) continue;
      list.push({ query, color: entry.color });
      if (!entry.color) this.hasFilter = true;
    }
    if (list.length === 0) list = null;
    this.searchQueries = list;
    if (!list) { this.fileFilter = {}; this.render(); return; }
    const fileFilter = this.fileFilter = {};
    const files = this.app.vault.getFiles();
    const queue = this.queue = { timer: null };
    let index = 0;
    this.filterOptions.startSearch();
    const step = () => {
      if (this.queue !== queue) return;
      const started = performance.now();
      while (index < files.length && performance.now() - started < 12) {
        const file = files[index++];
        const text = file.extension === 'md' ? this.fileText(file) : '';
        let keep = true;
        let color = null;
        for (const entry of list) {
          const matched = entry.query.match(file, text);
          if (!matched && !entry.color) { keep = false; break; }
          if (matched && entry.color) { color = entry.color; break; }
        }
        fileFilter[file.path] = keep ? (color || true) : false;
      }
      if (index < files.length) { queue.timer = setTimeout(step, 0); return; }
      this.queue = null;
      this.filterOptions.stopSearch();
      this.render();
    };
    queue.timer = setTimeout(step, 0);
  }

  fileText(file) {
    const cache = this.app.metadataCache.getCache(file.path);
    return (cache && cache._rawText) || '';
  }

  /* 原版 render：构建数据 → 局部过滤 → 去孤立 → 焦点类型 → 交给渲染器 */
  render() {
    const app = this.app;
    const renderer = this.renderer;
    const options = this.options;
    const searchQueries = this.searchQueries;
    const fileFilter = this.fileFilter;
    if (!this.isLocal || options.localFile) {
      if (this.isLocal) this.progression = 0;
      const nodeFilter = (path, type) => {
        if (!searchQueries) return true;
        if (type === '') return path === options.localFile || (has(fileFilter, path) ? fileFilter[path] : !this.hasFilter);
        if (type === 'tag') return searchQueries.every((entry) => !!entry.color || !!entry.query.matchTag(path));
        if (type === 'attachment') return searchQueries.every((entry) => !!entry.color || !!entry.query.matchFilepath(path));
        return true;
      };
      let data = buildGraphData(app.metadataCache, app.vault, options, nodeFilter, this.progression);
      const numLinks = data.numLinks;
      if (options.localFile) data = filterLocalGraph(data, options);
      if (!options.showOrphans) removeOrphans(data);
      if (this.currentFocusFile) {
        const node = data.nodes[this.currentFocusFile];
        if (node) node.type = 'focused';
      }
      renderer.setData(data);
      return numLinks;
    }
    renderer.setData({ nodes: {} });
    return 0;
  }

  /* 原版 renderProgression：按链接总数决定生长速度，逐帧推进进度到总量后收尾 */
  async renderProgression() {
    this.progression = 1;
    const total = this.render() || 0;
    this.progressionSpeed = clamp(0.5 * Math.sqrt(total), 5, 100);
    const started = Date.now();
    while (this.progression > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const snapshot = this.progression;
      const next = 1 + Math.floor(this.progressionSpeed * (Date.now() - started) / 1000);
      if (snapshot !== this.progression) break;
      if (next === this.progression) continue;
      if (next > total) {
        this.progression = 0;
        this.render();
        break;
      }
      this.progression = next;
      this.render();
    }
  }

  onFileChanged(file) { if (file.extension !== 'md') this.recomputeFile(); }

  recomputeFile() { this.render(); }

  onFileOpen(file) {
    const path = file ? file.path : '';
    if (path === this.currentFocusFile) return;
    this.currentFocusFile = path;
    this.render();
  }

  onNodeClick(ev, id, type) {
    if (type !== 'tag') this.app.workspace.openLinkText(id, '', isModEvent(ev));
    else this.openTagSearch(id);
  }

  /* 原版右键菜单：标题（文件名）/ 在新标签页中打开 / 删除文件；file-menu 事件本项目无来源，省略 */
  onNodeRightClick(ev, id, type) {
    if (type === 'tag') { this.openTagSearch(id); return; }
    const app = this.app;
    const path = app.metadataCache.getFirstLinkpathDest(id, '');
    const file = path ? app.vault.getFileByPath(path) : null;
    if (!file || !(ev instanceof MouseEvent)) return;
    const menu = new Menu(app);
    menu.addItem((item) => item.setSection('title').setTitle(file.name).setIsLabel(true));
    menu.addItem((item) => item.setSection('open')
      .setTitle(t('interface.menu.open-in-new-tab')).setIcon('file-plus')
      .onClick(() => { app.workspace.getLeaf(true).openLinkText(id, ''); }));
    menu.addItem((item) => item.setSection('danger')
      .setTitle(t('interface.menu.delete-file')).setIcon('trash-2').setWarning(true)
      .onClick(() => { app.fileManager.promptForDeletion(file); }));
    menu.showAtMouseEvent(ev);
  }

  /* 原版 onNodeHover/onNodeUnhover 走 hover-link 事件（本项目无来源），保留空实现 */
  onNodeHover() {}

  onNodeUnhover() {}

  /* 标签节点点击：原版调用 global-search 插件的 openGlobalSearch("tag:xxx") */
  openTagSearch(tag) {
    const open = (leaf) => {
      const view = leaf && leaf.view;
      if (view && view.setQuery) view.setQuery('tag:' + tag);
      if (view && view.focus) view.focus();
    };
    const leaves = this.app.workspace.getLeavesOfType('search');
    if (leaves.length) { this.app.workspace.revealLeaf(leaves[0]); open(leaves[0]); return; }
    this.app.workspace.ensureSideLeaf('search', 'left', { reveal: true }).then(open);
  }

  getOptions() {
    const options = {};
    this.filterOptions.getOptions(options);
    this.colorGroupOptions.getOptions(options);
    this.displayOptions.getOptions(options);
    this.forceOptions.getOptions(options);
    options.scale = this.renderer.targetScale;
    options.close = this.controlsEl.hasClass('is-close');
    return options;
  }

  setOptions(options) {
    if (!options) return;
    this.filterOptions.setOptions(options);
    this.colorGroupOptions.setOptions(options);
    this.displayOptions.setOptions(options);
    this.forceOptions.setOptions(options);
    if (options.scale) this.renderer.zoomTo(options.scale);
    if (options.close) this.controlsEl.toggleClass('is-close', options.close);
    this.render();
  }
}


// ---------------------------------------------------------------------------
// 插件入口（原版 gJ）
// ---------------------------------------------------------------------------
export const nameKey = 'plugins.graph-view';

export function create(app) {
  return {
    async onload() {
      app.viewRegistry.registerView('graph', (leaf) => new GraphView(leaf));
      app.viewRegistry.registerView('localgraph', (leaf) => new LocalGraphView(leaf));
      app.commands.addCommand({
        id: 'graph:open',
        name: t('plugins.graph-view.action-open') || 'Open graph view',
        icon: 'git-fork',
        callback: (ev) => openGraphView(app, ev),
      });
      app.commands.addCommand({
        id: 'graph:open-local',
        name: t('plugins.graph-view.action-open-local') || 'Open local graph',
        icon: 'git-fork',
        checkCallback: (checking) => openLocalGraph(app, checking),
      });
      app.commands.addCommand({
        id: 'graph:animate',
        name: t('plugins.graph-view.action-timelapse') || 'Start graph timelapse animation',
        icon: 'wand',
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType('graph');
          if (!view) return false;
          if (!checking) view.dataEngine.renderProgression();
          return true;
        },
      });
    },
    onunload() {
      app.viewRegistry.unregisterView('graph');
      app.viewRegistry.unregisterView('localgraph');
      app.commands.removeCommand('graph:open');
      app.commands.removeCommand('graph:open-local');
      app.commands.removeCommand('graph:animate');
    },
    deregister(app2) {
      app2.viewRegistry.unregisterView('graph');
      app2.viewRegistry.unregisterView('localgraph');
      app2.commands.removeCommand('graph:open');
      app2.commands.removeCommand('graph:open-local');
      app2.commands.removeCommand('graph:animate');
    },
  };
}

/* 原版 openGraphView：Mod 键按下时新开标签页（对应 Ng.isModEvent） */
function openGraphView(app, ev) {
  const mod = !!(ev && (ev.metaKey || ev.ctrlKey));
  app.workspace.getLeaf(mod ? 'tab' : false).setViewState({ type: 'graph', state: {} });
}

/* 原版 openLocalGraph：当前文件存在时竖向分割并打开局部图谱 */
function openLocalGraph(app, checking) {
  const file = app.workspace.getActiveFile();
  if (!file) return false;
  if (!checking && app.workspace.activeLeaf) {
    const leaf = app.workspace.createLeafBySplit(app.workspace.activeLeaf, 'vertical');
    leaf.setViewState({ type: 'localgraph', state: { file: file.path } });
  }
  return true;
}
