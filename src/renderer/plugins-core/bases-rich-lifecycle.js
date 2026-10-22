/**
 * [INPUT]: 富值宿主、控制器容器、可取消数学/高亮/图表与数据库嵌入释放句柄。
 * [OUTPUT]: registerBaseRichValue、disposeBaseRichValues、disposeBaseRichController。
 * [POS]: 富值资源所有权。控制器持有活动值集合；每文档一个弱引用观察器，移出 DOM 自动取消并断开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { cancelMath } from '../markdown/math.js';
import { cancelCodeHighlight } from '../markdown/highlight.js';
import { cancelMermaidBlocks } from '../markdown/mermaid.js';
const scopes = new WeakMap();
const documents = new WeakMap();
function releaseScope(scope) {
  const tracker = scope.tracker;
  if (tracker) {
    tracker.scopes.delete(scope.reference);
    if (!tracker.scopes.size) { tracker.observer.disconnect(); documents.delete(tracker.document); }
  }
  const owner = scope.owner.deref();
  if (owner && scopes.get(owner) === scope) scopes.delete(owner);
  scope.tracker = scope.reference = null;
}
function track(scope, doc) {
  let tracker = documents.get(doc);
  if (!tracker) {
    tracker = { document: doc, scopes: new Set(), observer: null };
    tracker.observer = new MutationObserver(() => {
      for (const ref of [...tracker.scopes]) {
        const current = ref.deref();
        if (!current) { tracker.scopes.delete(ref); continue; }
        const root = current.root.deref();
        if (root?.isConnected) { current.connected = true; const owner = current.owner.deref(); if (owner) owner.richRenderHadConnection = true; }
        for (const node of [...current.values]) if (!root || (current.connected && !root.isConnected) || !root.contains(node)) node._baseRichCleanup?.();
      }
      if (!tracker.scopes.size) { tracker.observer.disconnect(); documents.delete(doc); }
    });
    tracker.observer.observe(doc.body, { childList: true, subtree: true });
    documents.set(doc, tracker);
  }
  scope.tracker = tracker; scope.reference = new WeakRef(scope);
  tracker.scopes.add(scope.reference);
}
export function registerBaseRichValue(controller, node) {
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
    for (const element of node.querySelectorAll('.math')) cancelMath(element);
    for (const element of node.querySelectorAll('pre > code')) cancelCodeHighlight(element);
    cancelMermaidBlocks(node);
    for (const element of node.querySelectorAll('[data-base-embed]')) { element._baseEmbedCleanup?.(); delete element._baseEmbedCleanup; }
    for (const media of node.querySelectorAll('audio,video')) { media.pause(); media.removeAttribute('src'); media.load(); }
    node.replaceChildren();
    scope.values.delete(node);
    if (!scope.values.size) releaseScope(scope);
  };
  if (controller.closed || (scope.connected && !scope.root.deref()?.isConnected)) node._baseRichCleanup();
  return abort.signal;
}
export function disposeBaseRichValues(root) {
  root?._baseRichCleanup?.();
  for (const node of root?.querySelectorAll('.bases-rich-html,.bases-rich-markdown') || []) node._baseRichCleanup?.();
}
export function disposeBaseRichController(controller) {
  const scope = scopes.get(controller);
  if (!scope) return;
  for (const node of [...scope.values]) node._baseRichCleanup?.();
}
