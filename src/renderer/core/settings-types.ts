/**
 * [INPUT]: 库配置文件中的偏好、快捷键和插件开关。
 * [OUTPUT]: 导出已知偏好与动态 JSON 扩展字段的类型。
 * [POS]: 配置持久化边界。已知键提供具体类型，未知键只按原值保留。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface HotkeyBinding { modifiers: string[]; key: string; }
export type JsonRecord = Record<string, unknown>;
export interface AppSettings extends JsonRecord {
  alwaysUpdateLinks: boolean; spellcheck: boolean; spellcheckLanguages: string[] | null;
  readableLineLength: boolean; strictLineBreaks: boolean; propertiesInDocument: string;
  showInlineTitle: boolean; useMarkdownLinks: boolean; showUnsupportedFiles: boolean;
  autoPairBrackets: boolean; autoPairMarkdown: boolean; smartIndentList: boolean;
  foldHeading: boolean; foldIndent: boolean; showLineNumber: boolean; showIndentGuide: boolean;
  useTab: boolean; tabSize: number; rightToLeft: boolean; autoConvertHtml: boolean;
  vimMode: boolean; livePreview: boolean; attachmentFolderPath: string;
  newFileLocation: string; newFileFolderPath: string; newLinkFormat: string;
  userIgnoreFilters: string[] | null; focusNewTab: boolean; defaultViewMode: string;
  promptDelete: boolean; trashOption: string; deleteUnlinkedAttachments: string;
  openBehavior: string; pdfExportSettings: { pageSize: string; landscape: boolean; margin: string; downscalePercent: number };
  uriCallbacks: boolean; settingsPopoutWindow: boolean; showViewHeader: boolean; showRibbon: boolean;
  nativeMenus: boolean | null; showStatusBar: boolean; folderNoteLocation: string;
  showTabs: boolean; newFileLocationMobile: string;
  checkUpdates?: boolean; updateFeed?: string; deleteConfirm?: boolean;
}
export interface AppearanceSettings extends JsonRecord {
  accentColor: string; theme: string; cssTheme: string; enabledCssSnippets: string[];
  showViewHeader: boolean; showRibbon: boolean; nativeMenus: boolean | null;
  translucency: boolean; customCss: boolean; textFontFamily: string;
  interfaceFontFamily: string; monospaceFontFamily: string; baseFontSize: number;
  baseFontSizeAction: boolean; slidingSidebar: boolean; floatingNavigation: boolean;
  autoFullScreen: boolean; zoomLevel: number; translucentWindow: boolean;
  browserZoom: number; textFontSize: number; monospaceFontSize: number; showStatusBar: boolean;
}
export function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
