/**
 * [INPUT]: Mermaid 惰性模块、阅读容器和可选 AbortSignal。
 * [OUTPUT]: renderMermaidBlocks、cancelMermaidBlocks；取消后不向旧宿主提交 SVG。
 * [POS]: 阅读与实时预览共用的图表适配器。共享引擎初始化，异步任务只持宿主弱引用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { RENDER_ABORTED, waitForRender } from './render-cancel.js';
let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
let nextId = 0;
interface MermaidJob { target: WeakRef<Element> | null; }
const pending = new WeakMap<Element, MermaidJob>();
function loadMermaid() {
  if (!mermaidReady) mermaidReady = import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: document.body.hasClass('theme-dark') ? 'dark' : 'default', securityLevel: 'loose' });
    return mermaid;
  });
  return mermaidReady;
}
export function cancelMermaidBlocks(root: HTMLElement) {
  const elements = [...root.querySelectorAll('.mermaid-source')];
  if (root.matches?.('.mermaid-source')) elements.push(root);
  for (const element of elements) {
    const job = pending.get(element);
    if (!job) continue;
    job.target = null;
    pending.delete(element);
  }
}
export async function renderMermaidBlocks(root: HTMLElement | null, options: { signal?: AbortSignal } = {}) {
  if (!root) return;
  const jobs = Array.from(root.querySelectorAll('.mermaid-source'), element => {
    const old = pending.get(element); if (old) old.target = null;
    const job: MermaidJob = { target: new WeakRef(element) }; pending.set(element, job); return job;
  });
  root = null;
  if (!jobs.length) return;
  try {
    const mermaid = await waitForRender(loadMermaid(), options.signal);
    if (mermaid === RENDER_ABORTED) return;
    for (const job of jobs) {
      let target: Element | null | undefined = job.target?.deref();
      if (!target || options.signal?.aborted || pending.get(target) !== job) continue;
      const code = target.getAttr('data-source') || '';
      target = null;
      try {
        const result = await waitForRender(mermaid.render('mermaid-' + Date.now() + '-' + (++nextId), code), options.signal);
        const element = job.target?.deref();
        if (result === RENDER_ABORTED || !element || options.signal?.aborted || pending.get(element) !== job) continue;
        element.innerHTML = result.svg;
        element.addClass('mermaid'); element.removeClass('mermaid-source');
        pending.delete(element);
      } catch (error) {
        const element = job.target?.deref();
        if (element && !options.signal?.aborted && pending.get(element) === job) { element.addClass('mermaid-error'); pending.delete(element); }
      }
    }
  } catch (error) { if (!options.signal?.aborted) console.error('mermaid load failed', error); }
  finally {
    for (const job of jobs) { const element = job.target?.deref(); if (element && pending.get(element) === job) pending.delete(element); job.target = null; }
  }
}
