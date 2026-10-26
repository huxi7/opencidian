/**
 * [INPUT]: Vault 读盘、属性修改回调、YAML 与主进程比较写回通道。
 * [OUTPUT]: 提供 processFrontMatter，按文件排队并在冲突后重算。
 * [POS]: 属性与 Bases 共用写入边界。无效 YAML 拒写，保留正文与换行格式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Desktop } from './ipc.js';
import type { TFile, Vault } from './vault.js';
import { isJsonRecord } from './settings-types.js';
import type { FrontMatter } from './metadata-types.js';
interface FrontmatterHost { vault: Vault; }
export type FrontmatterChange = (frontmatter: FrontMatter) => void | Promise<void>;
const yaml: typeof import('js-yaml') = require('js-yaml');
const queues = new WeakMap<Vault, Map<string, Promise<void>>>();
export function processFrontMatter(app: FrontmatterHost, file: TFile, change: FrontmatterChange): Promise<void> {
  let files = queues.get(app.vault);
  if (!files) { files = new Map(); queues.set(app.vault, files); }
  const key = file.path;
  const operation = (files.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const source = await app.vault.read(file), newline = source.includes('\r\n') ? '\r\n' : '\n';
      const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
      const text = source.slice(bom.length);
      let frontmatter: FrontMatter = {}, body = text;
      if (/^---[ \t]*(?:\r?\n|$)/.test(text)) {
        const match = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
        if (!match) throw Error('属性 YAML 缺少结束标记，已取消保存');
        let parsed: unknown;
        try { parsed = yaml.load(match[1]) ?? {}; }
        catch { throw Error('属性 YAML 无效，已取消保存'); }
        if (!isJsonRecord(parsed)) throw Error('属性必须是 YAML 对象，已取消保存');
        frontmatter = parsed;
        body = text.slice(match[0].length);
      }
      await change(frontmatter);
      const attributes = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd().replace(/\n/g, newline);
      const next = bom + (Object.keys(frontmatter).length ? '---' + newline + attributes + newline + '---' + newline : '') + body;
      if (next === source) return;
      const result = await Desktop.compareAndSwapFile({ path: file.path, expected: source, text: next });
      if (result?.ok) {
        try { const stat = await app.vault.adapter.stat(file.path); file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size }; } catch {}
        app.vault.trigger('modify', file); return;
      }
      if (!result?.conflict) throw Error(result?.error || '无法保存属性');
    }
    throw Error('文件持续被其它窗口修改，已取消本次属性保存');
  });
  files.set(key, operation);
  return operation.finally(() => { if (files.get(key) === operation) files.delete(key); });
}
