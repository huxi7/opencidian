/**
 * [INPUT]: 无依赖。
 * [OUTPUT]: 导出 QuadNode、buildQuadtree(nodes, xOf, yOf)、visitAfter。
 * [POS]: 图谱力学的空间索引（对齐原版 d3-quadtree 的访问语义，供 graph-force.js 的 Barnes-Hut 斥力与半径裁剪碰撞使用）。
 *        包围盒随节点携带；重合点存为叶子上的 next 链（d3 语义），超过 40 层仍未分离时并入链，杜绝退化坐标导致的无限细分。
 *        受力遍历在 graph-force.js 内联为复用栈；本模块只提供建树与聚合遍历。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Minimal quadtree for graph force simulation (d3-quadtree-compatible traversal). */

const EPSILON = 1e-6;
const MAX_DEPTH = 40;

export class QuadNode {
  declare x0: any;
  declare y0: any;
  declare x1: any;
  declare y1: any;
  declare data: any;
  declare dataX: number;
  declare dataY: number;
  declare next: any;
  declare children: any;
  declare value: number;
  declare massX: number;
  declare massY: number;
  declare r: number;

  constructor(x0, y0, x1, y1) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.data = null;
    this.dataX = 0;
    this.dataY = 0;
    this.next = null;     // 重合点链
    this.children = null;
    this.value = 0;       // Barnes-Hut 聚合强度
    this.massX = 0;       // 聚合质心
    this.massY = 0;
    this.r = 0;           // 碰撞裁剪用最大半径
  }
}

function quadrantIndex(node, x, y) {
  const midX = (node.x0 + node.x1) / 2;
  const midY = (node.y0 + node.y1) / 2;
  return (y >= midY ? 2 : 0) + (x >= midX ? 1 : 0);
}

function createChildren(node) {
  const midX = (node.x0 + node.x1) / 2;
  const midY = (node.y0 + node.y1) / 2;
  return [
    new QuadNode(node.x0, node.y0, midX, midY),
    new QuadNode(midX, node.y0, node.x1, midY),
    new QuadNode(node.x0, midY, midX, node.y1),
    new QuadNode(midX, midY, node.x1, node.y1),
  ];
}

function toBucket(node) {
  return { data: node.data, dataX: node.dataX, dataY: node.dataY, next: node.next };
}

function placeBucket(node, bucket, depth) {
  let current = node;
  let level = depth;
  for (;;) {
    if (!current.children) {
      if (current.data === null) {
        current.data = bucket.data;
        current.dataX = bucket.dataX;
        current.dataY = bucket.dataY;
        current.next = bucket.next;
        return;
      }
      if ((current.dataX === bucket.dataX && current.dataY === bucket.dataY) || level >= MAX_DEPTH) {
        // 重合（或退化坐标无法继续细分）：并入链
        bucket.next = current.next;
        current.next = bucket;
        return;
      }
      const existing = toBucket(current);
      current.data = null;
      current.next = null;
      current.children = createChildren(current);
      placeBucket(current, existing, level + 1);
      level += 1;
      continue;
    }
    current = current.children[quadrantIndex(current, bucket.dataX, bucket.dataY)];
  }
}

/** 构建四叉树；空输入返回 null。边界取点集包围盒（退化轴以 EPSILON 加宽）。 */
export function buildQuadtree(nodes, xOf = (n) => n.x, yOf = (n) => n.y) {
  if (!nodes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const node of nodes) {
    const x = xOf(node);
    const y = yOf(node);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x0 === x1) { x0 -= EPSILON; x1 += EPSILON; }
  if (y0 === y1) { y0 -= EPSILON; y1 += EPSILON; }
  const root = new QuadNode(x0, y0, x1, y1);
  for (const node of nodes) {
    placeBucket(root, { data: node, dataX: xOf(node), dataY: yOf(node), next: null }, 0);
  }
  return root;
}

/** 后序遍历（先子后父），供聚合计算使用。 */
export function visitAfter(node, callback) {
  if (!node) return;
  const stack = [node];
  const order = [];
  while (stack.length) {
    const quad = stack.pop();
    order.push(quad);
    if (quad.children) for (const child of quad.children) stack.push(child);
  }
  for (let i = order.length - 1; i >= 0; i -= 1) callback(order[i]);
}
