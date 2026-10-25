/**
 * [INPUT]: Vault 最新文本、主进程比较原子写回、BaseDocument 与视图名称。
 * [OUTPUT]: 导出按应用和文件串行写入、视图身份定位及最新文档事务。
 * [POS]: Bases 写入边界。多控制器共用队列；跨窗口 CAS 冲突重读重算，歧义或目标消失即拒绝。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BaseDocument } from './bases-model.js';
import { Desktop } from '../core/ipc.js';
const applicationQueues = new WeakMap();
export function enqueueBaseFile(app: App, file, action) {
  let queues = applicationQueues.get(app);
  if (!queues) { queues = new Map(); applicationQueues.set(app, queues); }
  const key = file.path;
  const operation = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(key, operation);
  operation.finally(() => { if (queues.get(key) === operation) queues.delete(key); }).catch(() => {});
  return operation;
}
export function resolveBaseView(document, identity) {
  const matches = (document.data.views || []).map((view, index) => ({ view, index })).filter(item => item.view.name === identity.name);
  if (matches.length !== 1) throw Error(matches.length ? '视图名称重复，请先为视图设置唯一名称。' : '视图已被重命名或删除，请重新打开配置。');
  return matches[0];
}
export function transactBaseDocument(app: App, file, action, onSaved = null) {
  return enqueueBaseFile(app, file, async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = new BaseDocument(await app.vault.read(file));
      const next = await action(current);
      if (next && next.source !== current.source) {
        if (app.vault.getBasePath) {
          const result = await Desktop.compareAndSwapFile({ path: file.path, expected: current.source, text: next.source });
          if (result?.conflict) continue;
          if (!result?.ok) throw Error(result?.error || '数据库保存失败。');
          try { const stat = await app.vault.adapter.stat(file.path); file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size }; } catch {}
          app.vault.trigger('modify', file);
        } else {
          // 无磁盘的确定性模型同样拒绝过时原文。
          if (await app.vault.read(file) !== current.source) throw Error('数据库已被外部修改，请重试；未覆盖磁盘内容。');
          await app.vault.modify(file, next.source);
        }
      }
      onSaved?.(next || current);
      return next || current;
    }
    throw Error('数据库持续被其它窗口修改，已取消本次保存。');
  });
}
