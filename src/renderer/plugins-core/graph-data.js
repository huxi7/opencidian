/**
 * [INPUT]: 依赖 vault 文件清单和元数据的链接、标签索引。
 * [OUTPUT]: 导出节点工厂、扩展名判定、buildGraphData、filterLocalGraph、removeOrphans。
 * [POS]: 纯构图模块；先构建有向图，再按局部深度与方向裁剪。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { TFile } from '../core/vault.js';
import { has } from './graph-utils.js';

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
  // 本项目缓存只收录 Markdown；节点清单必须从 vault 取，才能包含附件和 Canvas。
  const paths = vault.getFiles().map((file) => file.path);
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
  if (!localFile) return { nodes: out, weights };
  weights[localFile] = 30;
  if (!has(nodes, localFile)) {
    out[localFile] = createNode();
    return { nodes: out, weights };
  }
  out[localFile] = cloneNode(nodes[localFile]);
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
