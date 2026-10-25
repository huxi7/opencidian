/**
 * [INPUT]: 已对齐的命令名称与平台修饰键。
 * [OUTPUT]: 导出 DEFAULT_HOTKEYS 默认快捷键表。
 * [POS]: 快捷键配置的数据基线，用户覆盖由 HotkeyManager 合并。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Default hotkeys — extracted from the original app's command definitions. */
export const DEFAULT_HOTKEYS = {
  'app:go-back': [{ modifiers: ['Mod', 'Alt'], key: 'ArrowLeft' }],
  'app:go-forward': [{ modifiers: ['Mod', 'Alt'], key: 'ArrowRight' }],
  'app:open-help': [{ modifiers: [], key: 'F1' }],
  'app:open-settings': [{ modifiers: ['Mod'], key: ',' }],
  'command-palette:open': [{ modifiers: ['Mod'], key: 'P' }],
  'editor:delete-paragraph': [{ modifiers: ['Mod'], key: 'D' }],
  'editor:follow-link': [{ modifiers: ['Alt'], key: 'Enter' }],
  'editor:insert-link': [{ modifiers: ['Mod'], key: 'K' }],
  'editor:open-link-in-new-leaf': [{ modifiers: ['Mod'], key: 'Enter' }],
  'editor:open-link-in-new-split': [{ modifiers: ['Mod', 'Alt'], key: 'Enter' }],
  'editor:open-link-in-new-window': [{ modifiers: ['Mod', 'Alt', 'Shift'], key: 'Enter' }],
  'editor:open-search': [{ modifiers: ['Mod'], key: 'F' }],
  'editor:save-file': [{ modifiers: ['Mod'], key: 'S' }],
  'editor:toggle-bold': [{ modifiers: ['Mod'], key: 'B' }],
  'editor:toggle-checklist-status': [{ modifiers: ['Mod'], key: 'l' }],
  'editor:toggle-comments': [{ modifiers: ['Mod'], key: '/' }],
  'editor:toggle-italics': [{ modifiers: ['Mod'], key: 'I' }],
  'file-explorer:new-file': [{ modifiers: ['Mod'], key: 'N' }],
  'file-explorer:new-file-in-new-pane': [{ modifiers: ['Mod', 'Shift'], key: 'N' }],
  'global-search:open': [{ modifiers: ['Mod', 'Shift'], key: 'F' }],
  'graph:open': [{ modifiers: ['Mod'], key: 'G' }],
  'markdown:add-metadata-property': [{ modifiers: ['Mod'], key: ';' }],
  'markdown:toggle-preview': [{ modifiers: ['Mod'], key: 'E' }],
  'switcher:open': [{ modifiers: ['Mod'], key: 'O' }],
  'workspace:close': [{ modifiers: ['Mod'], key: 'W' }],
  'workspace:close-window': [{ modifiers: ['Mod', 'Shift'], key: 'W' }],
  'workspace:edit-file-title': [{ modifiers: [], key: 'F2' }],
  'workspace:goto-last-tab': [{ modifiers: ['Mod'], key: '9' }],
  'workspace:new-tab': [{ modifiers: ['Mod'], key: 'T' }],
  'workspace:undo-close-pane': [{ modifiers: ['Mod', 'Shift'], key: 'T' }],
};
