/**
 * [INPUT]: bases-view 提供嵌入控制器。
 * [OUTPUT]: 转出 mountBaseEmbed，供阅读和实时预览调用。
 * [POS]: Markdown 只依赖此入口，不依赖数据库文件视图的生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export { mountBaseEmbed } from './bases-view.js';
