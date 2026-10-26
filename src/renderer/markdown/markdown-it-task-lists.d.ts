/**
 * [INPUT]: markdown-it 的插件调用协议。
 * [OUTPUT]: 声明 task-lists 的 enabled、label 和 labelAfter 选项。
 * [POS]: 第三方插件类型适配；选项来自已安装包的公开实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';
  interface TaskListOptions { enabled?: boolean; label?: boolean; labelAfter?: boolean; }
  const taskLists: PluginWithOptions<TaskListOptions>;
  export default taskLists;
}
