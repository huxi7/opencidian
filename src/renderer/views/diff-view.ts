/**
 * [INPUT]: 无外部依赖；使用 core/dom.js 安装的元素助手与原生 DOM。
 * [OUTPUT]: 导出 renderDiffView(prevText, nextText)，返回 .diff-view 元素。
 * [POS]: views/ 的纯渲染模块，供文件恢复弹窗的"显示差异"使用（对齐原版 FX）。
 *        行级 LCS 对齐；删除行与插入行按块配对，行内差异用前后缀裁剪标 diff-changed；
 *        相等行按原版折叠规则收拢（首尾 5 行、中间 10 行阈值，保留 3 行上下文，点击展开）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Side-by-side line diff view — ported behaviour of the original FX renderer. */

const MAX_DP_CELLS = 4_000_000;

/** 按行切分；末尾无换行时补一行，空文本视为单个空行。 */
function splitLines(text: string | null) {
  const normalized = text == null ? '' : String(text);
  const padded = normalized.endsWith('\n') ? normalized : normalized + '\n';
  const lines = padded.split('\n');
  lines.pop();
  return lines;
}

/** 行级 LCS，输出 ['equal'|'delete'|'insert', line] 序列；超大输入降级为整块替换。 */
function lineOps(a: string[], b: string[]): Array<['equal' | 'delete' | 'insert', string]> {
  const ops: Array<['equal' | 'delete' | 'insert', string]> = [];
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_DP_CELLS) {
    for (const line of a) ops.push(['delete', line]);
    for (const line of b) ops.push(['insert', line]);
    return ops;
  }
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['equal', a[i]]); i += 1; j += 1; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { ops.push(['delete', a[i]]); i += 1; }
    else { ops.push(['insert', b[j]]); j += 1; }
  }
  while (i < n) { ops.push(['delete', a[i]]); i += 1; }
  while (j < m) { ops.push(['insert', b[j]]); j += 1; }
  return ops;
}

function tokenize(line: string) {
  return line.match(/\s+|\S+/g) || [];
}

/**
 * 一对改动行的行内差异：前后缀裁剪后，中间段标 diff-changed。
 * 差异过大（超过较长一行的字符数一半）返回 null，交由调用方整行标记。
 */
function pairFragments(left: string, right: string) {
  if (left === right) return null;
  let prefix = 0;
  const prefixLimit = Math.min(left.length, right.length);
  while (prefix < prefixLimit && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  const suffixLimit = Math.min(left.length, right.length) - prefix;
  while (suffix < suffixLimit && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const changed = (left.length - prefix - suffix) + (right.length - prefix - suffix);
  if (changed >= Math.max(left.length, right.length) / 2) return null;

  const lt = tokenize(left);
  const rt = tokenize(right);
  let tp = 0;
  while (tp < lt.length && tp < rt.length && lt[tp] === rt[tp]) tp += 1;
  let ts = 0;
  while (ts < lt.length - tp && ts < rt.length - tp && lt[lt.length - 1 - ts] === rt[rt.length - 1 - ts]) ts += 1;

  const build = (tokens: string[]) => {
    const frag = document.createDocumentFragment();
    const plain = (text: string) => { if (text) frag.appendChild(document.createTextNode(text)); };
    const marked = (text: string|null) => {
      if (!text) return;
      const span = document.createElement('span');
      span.className = 'diff-changed';
      span.textContent = text;
      frag.appendChild(span);
    };
    plain(tokens.slice(0, tp).join(''));
    marked(tokens.slice(tp, tokens.length - ts).join(''));
    plain(tokens.slice(tokens.length - ts).join(''));
    return frag;
  };
  return [build(lt), build(rt)];
}

function createRow(content: string|DocumentFragment|null, side: string|null) {
  const row = document.createElement('div');
  row.className = 'diff-line' + (side ? ' mod-' + side : '');
  if (typeof content === 'string') row.textContent = content;
  else if (content) row.appendChild(content);
  row.appendChild(document.createElement('br'));
  return row;
}

/**
 * 渲染左右差异视图（对齐原版 FX：同一容器内先输出删除行块、再输出插入行块）。
 * @param {string} prevText 旧版本内容（可为空串）
 * @param {string} nextText 新版本内容
 */
export function renderDiffView(prevText: string, nextText: string) {
  const container = document.createElement('div');
  container.className = 'diff-view';
  const ops = lineOps(splitLines(prevText), splitLines(nextText));
  let context: HTMLDivElement[] = [];
  let leftRows: HTMLDivElement[] = [];
  let rightRows: HTMLDivElement[] = [];

  const flushPairs = () => {
    if (!leftRows.length && !rightRows.length) return;
    for (const row of leftRows) container.appendChild(row);
    for (const row of rightRows) container.appendChild(row);
    leftRows = [];
    rightRows = [];
  };

  const flushContext = (isTail: boolean) => {
    if (!context.length) return;
    const first = container.childNodes.length === 0;
    const threshold = first || isTail ? 5 : 10;
    if (context.length > threshold) {
      const folded: HTMLDivElement[] = [];
      const collapse = document.createElement('div');
      collapse.className = 'diff-collapsed';
      collapse.addEventListener('click', () => {
        const parent = collapse.parentNode;
        if (!parent) return;
        for (const el of folded) parent.insertBefore(el, collapse);
        collapse.remove();
      });
      let count = 0;
      if (first) {
        for (let i = 0; i < context.length - 3; i += 1) { folded.push(context[i]); count += 1; }
        container.appendChild(collapse);
        for (let i = context.length - 3; i < context.length; i += 1) container.appendChild(context[i]);
      } else if (isTail) {
        for (let i = 0; i < 3; i += 1) container.appendChild(context[i]);
        container.appendChild(collapse);
        for (let i = 3; i < context.length; i += 1) { folded.push(context[i]); count += 1; }
      } else {
        for (let i = 0; i < 3; i += 1) container.appendChild(context[i]);
        for (let i = 3; i < context.length - 3; i += 1) { folded.push(context[i]); count += 1; }
        container.appendChild(collapse);
        for (let i = context.length - 3; i < context.length; i += 1) container.appendChild(context[i]);
      }
      collapse.textContent = count + ' lines folded';
    } else {
      for (const row of context) container.appendChild(row);
    }
    context = [];
  };

  const pushEqual = (line: string|DocumentFragment|null) => {
    flushPairs();
    context.push(createRow(line, null));
  };

  const pushChanged = (left: string | null, right: string | null) => {
    flushContext(false);
    const pair = left != null && right != null ? pairFragments(left, right) : null;
    if (pair) {
      leftRows.push(createRow(pair[0], 'left'));
      rightRows.push(createRow(pair[1], 'right'));
    } else {
      leftRows.push(createRow(left == null ? null : left, 'left'));
      rightRows.push(createRow(right == null ? null : right, 'right'));
    }
  };

  for (let i = 0; i < ops.length; i += 1) {
    const [type, line] = ops[i];
    if (type === 'equal') {
      pushEqual(line);
      continue;
    }
    if (type === 'delete' && i + 1 < ops.length && ops[i + 1][0] === 'insert') {
      // 删除块与紧随其后的插入块按行配对，行内差异细标
      const deleted = [];
      const inserted = [];
      let j = i;
      while (j < ops.length && ops[j][0] === 'delete') { deleted.push(ops[j][1]); j += 1; }
      while (j < ops.length && ops[j][0] === 'insert') { inserted.push(ops[j][1]); j += 1; }
      const max = Math.max(deleted.length, inserted.length);
      for (let k = 0; k < max; k += 1) {
        pushChanged(k < deleted.length ? deleted[k] : null, k < inserted.length ? inserted[k] : null);
      }
      i = j - 1;
      continue;
    }
    if (type === 'delete') pushChanged(line, null);
    else pushChanged(null, line);
  }

  flushPairs();
  flushContext(true);
  return container;
}
