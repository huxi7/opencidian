/**
 * [INPUT]: 富值宿主、控制器容器、可取消数学/高亮/图表与数据库嵌入释放句柄。
 * [OUTPUT]: registerBaseRichValue、disposeBaseRichValues、disposeBaseRichController。
 * [POS]: 富值资源所有权。控制器持有活动值集合；每文档一个弱引用观察器，移出 DOM 自动取消并断开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BasesController } from './bases-view.js';
import { cancelMath } from '../markdown/math.js';
import { cancelCodeHighlight } from '../markdown/highlight.js';
import { cancelMermaidBlocks } from '../markdown/mermaid.js';
interface RichScope { root: WeakRef<HTMLElement>; owner: WeakRef<BasesController>; values: Set<HTMLElement>; connected: boolean; tracker?: RichTracker | null; reference?: WeakRef<RichScope> | null; }
interface RichTracker { document: Document; scopes: Set<WeakRef<RichScope>>; observer: MutationObserver; }
const scopes = new WeakMap<BasesController, RichScope>();
const documents = new WeakMap<Document, RichTracker>();
function releaseScope(scope: RichScope) {
  const tracker = scope.tracker;
  if (tracker) {
    if (scope.reference) tracker.scopes.delete(scope.reference);
    if (!tracker.scopes.size) { tracker.observer.disconnect(); documents.delete(tracker.document); }
  }
  const owner = scope.owner.deref();
  if (owner && scopes.get(owner) === scope) scopes.delete(owner);
  scope.tracker = scope.reference = null;
}
function track(scope: RichScope, doc: Document) {
  let tracker = documents.get(doc);
  if (!tracker) {
    const created: RichTracker = { document: doc, scopes: new Set(), observer: new MutationObserver(() => {
      for (const ref of [...created.scopes]) {
        const current = ref.deref();
        if (!current) { created.scopes.delete(ref); continue; }
        const root = current.root.deref();
        if (root?.isConnected) { current.connected = true; const owner = current.owner.deref(); if (owner) owner.richRenderHadConnection = true; }
        for (const node of [...current.values]) if (!root || (current.connected && !root.isConnected) || !root.contains(node)) node._baseRichCleanup?.();
      }
      if (!created.scopes.size) { created.observer.disconnect(); documents.delete(doc); }
    }) };
    created.observer.observe(doc.body, { childList: true, subtree: true }); documents.set(doc, created); tracker = created;
  }
  scope.tracker = tracker; scope.reference = new WeakRef(scope); tracker.scopes.add(scope.reference);
}

export function registerBaseRichValue(controller: BasesController, node: HTMLElement) {
  let scope = scopes.get(controller);
  if (!scope) {
    const root = controller.container || node.parentElement;
    scope = { root: new WeakRef(root), owner: new WeakRef(controller), values: new Set(), connected: controller.richRenderHadConnection || root.isConnected };
    if (root.isConnected) controller.richRenderHadConnection = true;
    scopes.set(controller, scope); controller.richValues = scope.values;
    track(scope, node.ownerDocument);
  }
  const abort = new AbortController();
  node.richRenderSignal = abort.signal;
  scope.values.add(node);
  node._baseRichCleanup = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    for (const element of node.querySelectorAll<HTMLElement>('.math')) cancelMath(element);
    for (const element of node.querySelectorAll<HTMLElement>('pre > code')) cancelCodeHighlight(element);
    cancelMermaidBlocks(node);
    for (const element of node.querySelectorAll('[data-base-embed]')) { element._baseEmbedCleanup?.(); delete element._baseEmbedCleanup; }
    for (const media of node.querySelectorAll<HTMLMediaElement>('audio,video')) { media.pause(); media.removeAttribute('src'); media.load(); }
    node.replaceChildren();
    scope!.values.delete(node);
    if (!scope!.values.size) releaseScope(scope!);
  };
  if (controller.closed || (scope.connected && !scope.root.deref()?.isConnected)) node._baseRichCleanup();
  return abort.signal;
}
export function disposeBaseRichValues(root: Element | null | undefined) {
  root?._baseRichCleanup?.();
  for (const node of root?.querySelectorAll('.bases-rich-html,.bases-rich-markdown') || []) node._baseRichCleanup?.();
}
export function disposeBaseRichController(controller: BasesController) {
  const scope = scopes.get(controller);
  if (!scope) return;
  for (const node of [...scope.values]) node._baseRichCleanup?.();
}
