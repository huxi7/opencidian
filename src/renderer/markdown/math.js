/**
 * [INPUT]: 依赖 DOM 与 /assets/mathjax/ 的官方 3.2.2 构建。
 * [OUTPUT]: 导出异步 renderMath、renderMathBlocks。
 * [POS]: markdown/ 的公共数学适配器。阅读器与编辑器共用。
 * 每个文档只初始化一次；公式串行转换，失败仅回退当前节点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const VERSION = '3.2.2';
const ASSET_PATH = '/assets/mathjax/';
const LOAD_TIMEOUT_MS = 15000;
const SOURCE_SELECTOR = '.math[data-math]';
// 全构建已内嵌这些扩展；未知包不应再发起脚本请求。
const REQUIRE_ALLOW = Object.fromEntries([
  'action', 'ams', 'amscd', 'bbox', 'boldsymbol', 'braket', 'bussproofs',
  'cancel', 'cases', 'centernot', 'color', 'colorv2', 'colortbl', 'empheq',
  'enclose', 'extpfeil', 'gensymb', 'html', 'mathtools', 'mhchem', 'newcommand',
  'noerrors', 'noundefined', 'physics', 'upgreek', 'unicode', 'verb',
  'textcomp', 'textmacros',
].map((name) => [name, true]));
const documents = new WeakMap();
const renders = new WeakMap();

// ---- 离线初始化 -----------------------------------------------------------

function getRuntime(document) {
  let state = documents.get(document);
  if (state) return state;
  state = { queue: Promise.resolve(), stylesheet: null, mathjax: null };
  documents.set(document, state);
  state.ready = initialize(document).then((mathjax) => {
    state.mathjax = mathjax;
    return mathjax;
  });
  return state;
}

function initialize(document) {
  return new Promise((resolve, reject) => {
    const win = document.defaultView;
    if (!win || !document.head) {
      reject(new Error('MathJax requires a window and document head'));
      return;
    }
    if (win.MathJax?.version) {
      reject(new Error('MathJax was initialized outside the shared adapter'));
      return;
    }
    const base = new URL(ASSET_PATH, document.baseURI).href;
    const script = document.createElement('script');
    let settled = false;
    let timer;
    const finish = (error, mathjax) => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) reject(error);
      else resolve(mathjax);
    };

    // ui/safe 在原版与主构建拼接；这里由官方 loader 加载原文件。
    win.MathJax = {
      loader: {
        paths: { mathjax: base.replace(/\/$/, '') },
        load: ['ui/safe'],
        failed: (error) => finish(error),
      },
      tex: {
        inlineMath: [],
        displayMath: [],
        processEscapes: false,
        processEnvironments: false,
        processRefs: false,
        require: { defaultAllow: false, allow: REQUIRE_ALLOW },
      },
      chtml: { fontURL: `${base}output/chtml/fonts/woff-v2` },
      startup: { typeset: false },
      options: {
        enableMenu: false,
        menuOptions: { settings: { renderer: 'CHTML' } },
        renderActions: { assistiveMml: [] },
        safeOptions: {
          safeProtocols: {
            http: true, https: true, file: true, javascript: false, data: false,
          },
        },
      },
    };
    // 只移除本引擎的旧菜单偏好，避免激活未携带的输出器。
    try { win.localStorage.removeItem('MathJax-Menu-Settings'); } catch { /* 存储可禁用。 */ }

    script.id = 'obsidian-mathjax-script';
    script.async = true;
    script.src = `${base}tex-chtml-full.js`;
    script.onerror = () => finish(new Error('MathJax offline script failed to load'));
    script.onload = () => {
      const mathjax = win.MathJax;
      if (!mathjax?.startup?.promise) {
        finish(new Error('MathJax startup is unavailable'));
        return;
      }
      mathjax.startup.promise.then(() => {
        if (mathjax.version !== VERSION || !mathjax.startup.document?.safe ||
            typeof mathjax.tex2chtml !== 'function' ||
            typeof mathjax.chtmlStylesheet !== 'function') {
          finish(new Error('MathJax version or safe renderer does not match'));
          return;
        }
        finish(null, mathjax);
      }, (error) => finish(error));
    };
    timer = win.setTimeout(() => finish(new Error('MathJax startup timed out')), LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
}

// ---- 公共样式 -------------------------------------------------------------

function updateStylesheet(document, state) {
  // 3.2 的 adaptiveCSS 会累计字形规则。保留同一节点和既有公式规则。
  const stylesheet = state.mathjax.chtmlStylesheet();
  if (!stylesheet) throw new Error('MathJax CHTML stylesheet is unavailable');
  if (state.stylesheet && state.stylesheet !== stylesheet) state.stylesheet.remove();
  if (stylesheet.parentNode !== document.head) document.head.appendChild(stylesheet);
  state.stylesheet = stylesheet;
  stylesheet.dataset.change = stylesheet.dataset.change === '1' ? '2' : '1';
}

// ---- 公式转换 -------------------------------------------------------------

/**
 * 渲染不带 $ 分隔符的 TeX。成功返回 true；失败或被新请求替代返回 false。
 * 允许节点尚未挂载。调用方移除节点后，异步结果不会重新挂载该节点。
 */
export async function renderMath(element, tex, display = false) {
  if (!element?.ownerDocument || element.nodeType !== 1) return false;
  const source = String(tex ?? '');
  const block = Boolean(display);
  const previous = renders.get(element);
  if (previous?.source === source && previous.block === block &&
      (previous.pending || (previous.node && previous.node.parentNode === element))) {
    return previous.promise;
  }

  const job = { source, block, pending: true, node: null, promise: null };
  renders.set(element, job);
  element.dataset.math = source;
  element.classList.add('math');
  element.classList.toggle('math-block', block);
  element.classList.toggle('math-inline', !block);
  element.classList.remove('math-error');
  element.textContent = source;

  const document = element.ownerDocument;
  const state = getRuntime(document);
  job.promise = state.ready.then(() => {
    const conversion = state.queue.then(() => {
      if (renders.get(element) !== job) return false;
      const node = state.mathjax.tex2chtml(source, { display: block });
      if (!node || node.querySelector('mjx-merror, [data-mjx-error]')) {
        throw new Error('MathJax could not render this formula');
      }
      updateStylesheet(document, state);
      element.replaceChildren(node);
      job.node = node;
      return true;
    });
    // 一个公式的异常不能使后续队列一直拒绝。
    state.queue = conversion.catch(() => {});
    return conversion;
  }).catch(() => {
    if (renders.get(element) === job) {
      element.textContent = source;
      element.classList.add('math-error');
    }
    return false;
  }).finally(() => { job.pending = false; });
  return job.promise;
}

/**
 * 转换 root 自身及后代的 .math[data-math] 占位节点。
 * math-block 表示块公式；其余为行内公式。返回各节点的成功标记。
 */
export async function renderMathBlocks(root) {
  if (!root?.querySelectorAll) return [];
  const elements = [...root.querySelectorAll(SOURCE_SELECTOR)];
  if (root.matches?.(SOURCE_SELECTOR)) elements.unshift(root);
  return Promise.all(elements.map((element) =>
    renderMath(element, element.dataset.math, element.classList.contains('math-block'))));
}
