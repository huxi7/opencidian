/**
 * [INPUT]: 依赖 ../core/suggest.js 的 SuggestModal/renderHighlightedText；依赖 ../core/i18n.js 的 t；
 *          依赖 ../core/keymap.js 的 IS_MAC；依赖 ../core/icons.js 的 setIcon；依赖 ../core/tooltip.js 的 setTooltip；
 *          依赖 ../core/setting.js 的 SettingGroup；宿主提供 vault/workspace/metadataCache/fileManager；忽略规则由 MetadataCache 共用。
 * [OUTPUT]: 导出 nameKey、QuickSwitcherModal、create(app)；实例暴露 openSwitcher/getOptions；模块导出 settingTab。
 * [POS]: 快速切换核心插件，逐字对齐 Obsidian 1.14.4 `switcher` 插件：
 *         最近 10 项、文件/别名/未解析链接/书签四类建议、basename 优先匹配与忽略降权、
 *         20 项上限、创建项、六条指令栏、单实例模态；设置页三项开关写 `.obsidian/switcher.json`。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: switcher — Obsidian 1.14.4 quick switcher (Mod+O). */
import { SuggestModal, renderHighlightedText } from '../core/suggest.js';
import { t } from '../core/i18n.js';
import { IS_MAC } from '../core/keymap.js';
import { setIcon } from '../core/icons.js';
import { setTooltip } from '../core/tooltip.js';
import { SettingGroup } from '../core/setting.js';
import { TFile, VaultEntry } from '../core/vault.js';
import type { BookmarkItem, create as createBookmarks } from './bookmarks.js';
import { CachedMetadata } from '../core/metadata-types.js';

export const nameKey = 'plugins.quick-switcher';

type SwitcherQuery = ReturnType<typeof parseQuery>;
interface SwitcherMatch { score: number; matches: number[][]; }
interface SwitcherOptions { showExistingOnly: boolean; showAttachments: boolean; showAllFileTypes: boolean; }
type SwitcherItem = { match: SwitcherMatch | null; downranked?: boolean } & (
  { type: 'file'; file: TFile } | { type: 'alias'; file: TFile; alias: string }
  | { type: 'unresolved'; linktext: string }
  | { type: 'bookmark'; item: BookmarkItem; bookmarkPath: string }
);
const DATA_FILE = 'switcher.json';
export const DEFAULT_OPTIONS = Object.freeze({
  showExistingOnly: false,
  showAttachments: true,
  showAllFileTypes: false,
});

const IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];
const RECENT_LIMIT = 10;   // 原版 workspace.getRecentFiles 默认 maxCount
const RESULT_LIMIT = 20;   // 原版 D5 limit

/* --------------------------------------------------------------------------
 * 原版 lx/hx/ux/cx/UB/px：分词 → 子序列匹配 → 计分 → basename 优先
 * ------------------------------------------------------------------------ */
const PUNCT_RE = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~]/;
const SPACE_RE = /\s/;
const CJK_RE = /[\u0F00-\u0FFF\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

export function parseQuery(query: string) {
  const lower = query.toLowerCase();
  const tokens = [];
  let start = 0;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charAt(i);
    if (SPACE_RE.test(ch)) {
      if (start !== i) tokens.push(lower.slice(start, i));
      start = i + 1;
    } else if (PUNCT_RE.test(ch) || CJK_RE.test(ch)) {
      if (start !== i) tokens.push(lower.slice(start, i));
      tokens.push(ch);
      start = i + 1;
    }
  }
  if (start !== lower.length) tokens.push(lower.slice(start));
  return { query, tokens, fuzzy: lower.split('').filter((ch) => ch !== ' ') };
}

function scoreRanges(ranges: number[][], queryLength: number, textLength: number, penalties: number) {
  if (!ranges.length) return 0;
  let score = 0;
  score -= Math.max(0, ranges.length - 1);
  score -= penalties / 10;
  const first = ranges[0][0];
  score -= (ranges[ranges.length - 1][1] - first + 1 - queryLength) / 100;
  score -= first / 1000;
  score -= textLength / 10000;
  return score;
}

function matchTokens(tokens: string[], query: string, text: string, fuzzy: boolean) {
  if (!tokens.length) return { score: 0, matches: [] };
  const lower = text.toLowerCase();
  const ranges = [];
  let previousEnd = 0;
  let penalties = 0;
  for (const token of tokens) {
    const at = lower.indexOf(token, previousEnd);
    if (at === -1) return null;
    const ch = text.charAt(at);
    if (at > 0 && !PUNCT_RE.test(ch) && !CJK_RE.test(ch)) {
      const before = text.charAt(at - 1);
      const camel = ch.toLowerCase() !== ch && before.toLowerCase() !== before;
      const wordBreak = ch.toUpperCase() !== ch && !PUNCT_RE.test(before) && !SPACE_RE.test(before) && !CJK_RE.test(before);
      if ((camel || wordBreak) && !(fuzzy && at === previousEnd)) penalties += 1;
    }
    const last = ranges[ranges.length - 1];
    if (!last || last[1] < at) ranges.push([at, at + token.length]);
    else last[1] = at + token.length;
    previousEnd = at + token.length;
  }
  return { matches: ranges, score: scoreRanges(ranges, query.length, text.length, penalties) };
}

export function matchText(parsed: SwitcherQuery, text: string) {
  if (!parsed.query) return { score: 0, matches: [] };
  return matchTokens(parsed.tokens, parsed.query, text, false)
    || matchTokens(parsed.fuzzy, parsed.query, text, true);
}

export function basenameOf(path: unknown) {
  return String(path).split('/').pop() || '';
}

/** 原版 UB：先按文件名匹配（命中则整体不降分），再按完整显示路径匹配并 -1。 */
export function matchFile(parsed: { query: string; tokens: string[]; fuzzy: string[]; }, displayPath: string) {
  const name = basenameOf(displayPath);
  let found = matchText(parsed, name);
  if (found) {
    const offset = displayPath.length - name.length;
    for (const range of found.matches) { range[0] += offset; range[1] += offset; }
    return found;
  }
  found = matchText(parsed, displayPath);
  if (found) found.score -= 1;
  return found;
}

export function sortSuggestions<T extends { match: SwitcherMatch | null }>(items: T[]): T[] {
  return items.sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
}

/* --------------------------------------------------------------------------
 * 显示与路径
 * ------------------------------------------------------------------------ */
/** 原版 x5：md 去掉 .md；其他文件显示完整路径（含扩展名）。 */
export function displayPath(file: TFile) {
  return file.extension === 'md' ? file.path.replace(/\.md$/i, '') : file.path;
}

/** 原版 Vl：Tab 补全用；md 去掉扩展名，其余保留。 */
function linkPath(file: { extension: string; path: string; }) {
  return file.extension === 'md' ? file.path.replace(/\.md$/i, '') : file.path;
}

/** 原版 ym：frontmatter aliases（键名大小写不敏感），trim 后去空。 */
function aliasesOf(cache: CachedMetadata|null) {
  if (!cache) return [];
  const frontmatter = cache.frontmatter || {};
  const key = Object.keys(frontmatter).find((k) => k.toLowerCase() === 'aliases');
  let value = key ? frontmatter[key] : cache.aliases;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) value = [value];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
}

/** 原版 wx：Tab 补全到匹配末尾之后的第一个 "/"（含）。 */
function completionText(text: string, matches: number[][] | null) {
  if (matches && matches.length) {
    const end = matches[matches.length - 1][1];
    const slash = text.indexOf('/', end);
    if (slash !== -1) return text.slice(0, slash + 1);
  }
  return text;
}

/** 原版 mS.isModEvent：中键/Mod → tab，Mod+Alt → split，Mod+Alt+Shift → window。 */
function modEventMode(ev: MouseEvent|KeyboardEvent) {
  if (!ev) return false;
  if ('button' in ev && ev.button === 1) return 'tab';
  const mod = IS_MAC ? ev.metaKey : ev.ctrlKey;
  if (!mod) return false;
  if (ev.altKey) return ev.shiftKey ? 'window' : 'split';
  return 'tab';
}

/* --------------------------------------------------------------------------
 * 快速切换模态（原版 oie）
 * ------------------------------------------------------------------------ */
export class QuickSwitcherModal extends SuggestModal<SwitcherItem> {
  declare options: SwitcherOptions;
  declare limit: number;
  declare emptyStateText: string;
  declare noRecentFilesText: string;
  declare allowCreateNewFile: boolean;
  declare shouldShowMarkdown: boolean;
  declare shouldShowUnresolved: boolean;
  declare shouldShowNonImageAttachments: boolean;
  declare shouldShowImages: boolean;
  declare shouldShowAllTypes: boolean;
  declare shouldShowNonFileBookmarks: boolean;
  declare context: string;

  constructor(app: App, options: SwitcherOptions = DEFAULT_OPTIONS) {
    super(app);
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.limit = RESULT_LIMIT;
    this.emptyStateText = t('plugins.quick-switcher.label-no-note-create-new');
    this.noRecentFilesText = t('setting.third-party-plugin.label-no-recent-files-found');
    this.allowCreateNewFile = true;
    this.shouldShowMarkdown = true;
    this.shouldShowUnresolved = !this.options.showExistingOnly;
    this.shouldShowNonImageAttachments = !!this.options.showAttachments;
    this.shouldShowImages = !!this.options.showAttachments;
    this.shouldShowAllTypes = !!this.options.showAllFileTypes;
    this.shouldShowNonFileBookmarks = true;
    this.context = 'view';
    this.setPlaceholder(t('plugins.quick-switcher.prompt-type-file-name'));
    this.setInstructions([
      { command: '↑↓', purpose: t('plugins.quick-switcher.instruction-navigate') },
      { command: '↵', purpose: t('plugins.quick-switcher.instruction-open') },
      { command: IS_MAC ? '⌘ ↵' : 'ctrl ↵', purpose: t('plugins.quick-switcher.instruction-open-in-new-tab') },
      { command: IS_MAC ? '⌘ ⌥ ↵' : 'ctrl alt ↵', purpose: t('plugins.quick-switcher.instruction-open-to-the-right') },
      { command: 'shift ↵', purpose: t('plugins.quick-switcher.instruction-create') },
      { command: 'esc', purpose: t('plugins.quick-switcher.instruction-dismiss') },
    ]);
    // 原版构造器在模态 scope 内注册创建键；输入框处理器已覆盖，但保留 scope 注册以兼容
    // 从 document 直接派发的键盘事件（两条路径互斥：输入框已 preventDefault）。
    if (this.scope) {
      this.app.keymap.register(this.scope, ['Shift'], 'Enter', (ev) => { this.selectSuggestion(null, ev); return false; });
      this.app.keymap.register(this.scope, ['Mod', 'Shift'], 'Enter', (ev) => { this.selectSuggestion(null, ev); return false; });
    }
  }

  /* ---------------------------------------------------------------- 过滤 */
  isIgnored(path: string|{ path: string; }|null|undefined) {
    return this.app.metadataCache.isUserIgnored(path);
  }

  _isExtensionRegistered(ext: string) {
    return !!this.app.viewRegistry.getTypeByExtension(ext);
  }

  /** 原版 h(file)：按插件选项决定某文件是否进入建议池。 */
  shouldShowFile(file: TFile) {
    const ext = (file.extension || '').toLowerCase();
    if (ext === 'md') return !!this.shouldShowMarkdown;
    if (ext === 'canvas' || ext === 'base') return !!this.shouldShowNonAttachments;
    if (IMAGE_EXTENSIONS.includes(ext)) return !!this.shouldShowImages;
    if (this.shouldShowAllTypes) return true;
    return !!this.shouldShowNonImageAttachments && this._isExtensionRegistered(ext);
  }

  /** 原版 workspace.getRecentFiles：最近 10 项，按类型开关过滤。 */
  getRecentFiles() {
    const out = [];
    for (const path of this.app.workspace.lastOpenFiles || []) {
      const ext = (String(path).split('.').pop() || '').toLowerCase();
      let visible;
      if (ext === 'md') visible = !!this.shouldShowMarkdown;
      else if (ext === 'canvas' || ext === 'base') visible = !!this.shouldShowNonAttachments;
      else if (IMAGE_EXTENSIONS.includes(ext)) visible = !!this.shouldShowImages;
      else visible = !!this.shouldShowNonImageAttachments;
      if (visible) out.push(path);
      if (out.length >= RECENT_LIMIT) break;
    }
    return out;
  }

  getSuggestions(query: string) {
    const value = (query || '').trim();
    const app = this.app;
    const metadata = app.metadataCache;
    const out: SwitcherItem[] = [];

    if (!value) {
      for (const path of this.getRecentFiles()) {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        if (this.isIgnored(file.path) || !this.shouldShowFile(file)) continue;
        out.push({ type: 'file', file, match: null });
      }
      return out;
    }

    const parsed = parseQuery(value);
    for (const file of app.vault.getFiles()) {
      if (!this.shouldShowFile(file)) continue;
      const ignored = this.isIgnored(file.path);
      const matched = matchFile(parsed, displayPath(file));
      if (matched) {
        if (ignored) matched.score -= 10;
        out.push({ type: 'file', file, match: matched, downranked: ignored });
      }
      if (!this.shouldShowAlias) continue;
      for (const alias of aliasesOf(metadata.getFileCache(file))) {
        const aliasMatch = matchText(parsed, alias);
        if (!aliasMatch) continue;
        if (ignored) aliasMatch.score -= 10;
        out.push({ type: 'alias', alias, file, match: aliasMatch, downranked: ignored });
      }
    }

    if (this.shouldShowUnresolved) {
      const seen = new Set<string>();
      for (const links of Object.values(metadata.unresolvedLinks || {})) {
        for (const linktext of Object.keys(links || {})) seen.add(linktext);
      }
      for (const linktext of seen) {
        const matched = matchText(parsed, linktext);
        if (matched) out.push({ type: 'unresolved', linktext, match: matched });
      }
    }

    const bookmarks = app.plugins && app.plugins.getInternalPlugin('bookmarks');
    if (bookmarks && bookmarks.enabled && bookmarks.instance) {
      const plugin = bookmarks.instance;
      const walk = (items: BookmarkItem[], prefix: string): void => {
        for (const item of items || []) {
          if (item.type !== 'file' || item.subpath) {
            if (this.shouldShowNonFileBookmarks && item.type !== 'group') this.addBookmark(out, parsed, plugin, item, prefix);
          } else {
            const file = app.vault.getAbstractFileByPath(item.path);
            if (file instanceof TFile && this.shouldShowFile(file)) {
              this.addBookmark(out, parsed, plugin, item, prefix);
            }
          }
          if (item.type === 'group') walk(item.items, prefix + (item.title || '') + '/');
        }
      };
      walk(plugin.items, '');
    }

    return sortSuggestions(out);
  }

  addBookmark(out: SwitcherItem[], parsed: SwitcherQuery, plugin: ReturnType<typeof createBookmarks>, item: BookmarkItem, prefix: string) {
    const bookmarkPath = prefix + plugin.getItemTitle(item);
    const matched = matchText(parsed, bookmarkPath);
    if (matched) out.push({ type: 'bookmark', item, match: matched, bookmarkPath });
  }

  /* ---------------------------------------------------------------- 渲染 */
  renderSuggestion(item: SwitcherItem | null, el: HTMLDivElement, query: string) {
    el.addClass('mod-complex');
    const content = el.createDiv('suggestion-content');
    const aux = el.createDiv('suggestion-aux');

    if (item === null || item === undefined) {
      content.createDiv({ cls: 'suggestion-title', text: this.inputEl.value });
      aux.createSpan({ cls: 'suggestion-action', text: t('plugins.quick-switcher.label-enter-to-create') });
      return;
    }
    if (item.downranked) el.addClass('mod-downranked');

    if (item.type === 'file') {
      const title = content.createDiv('suggestion-title');
      renderHighlightedText(title, displayPath(item.file), item.match && item.match.matches);
      aux.createSpan({ cls: 'suggestion-flair' });
    } else if (item.type === 'alias') {
      const title = content.createDiv('suggestion-title');
      renderHighlightedText(title, item.alias, item.match && item.match.matches);
      content.createDiv({ cls: 'suggestion-note', text: displayPath(item.file) });
      const flair = aux.createSpan('suggestion-flair');
      setIcon(flair, 'lucide-forward');
      setTooltip(flair, t('interface.tooltip.alias'));
    } else if (item.type === 'unresolved') {
      const title = content.createDiv('suggestion-title');
      renderHighlightedText(title, item.linktext, item.match && item.match.matches);
      const flair = aux.createSpan('suggestion-flair');
      setIcon(flair, 'lucide-file-plus');
      setTooltip(flair, t('plugins.quick-switcher.tooltip-not-created-yet'));
    } else if (item.type === 'bookmark') {
      const title = content.createDiv('suggestion-title');
      renderHighlightedText(title, item.bookmarkPath, item.match && item.match.matches);
      const note = content.createDiv('suggestion-note');
      const flair = aux.createSpan('suggestion-flair');
      const bookmark = item.item;
      if (bookmark.type === 'file') {
        setIcon(flair, 'lucide-bookmark');
        const path = String(bookmark.path || '');
        note.setText((/\.md$/i.test(path) ? path.slice(0, -3) : path) + (bookmark.subpath || ''));
      } else if (bookmark.type === 'folder') {
        setIcon(flair, 'lucide-bookmark');
        note.setText(bookmark.path);
      } else if (bookmark.type === 'search') {
        setIcon(flair, 'lucide-search');
        note.setText(bookmark.query || '');
      } else if (bookmark.type === 'graph') {
        setIcon(flair, 'lucide-git-fork');
        note.detach();
      } else if (bookmark.type === 'url') {
        setIcon(flair, 'lucide-globe-2');
        note.setText(bookmark.url || '');
      }
    }
  }

  /* ---------------------------------------------------------------- 补全 */
  getCompletionText(item: SwitcherItem | null) {
    if (!item) return null;
    let text = null;
    if (item.type === 'file' || item.type === 'alias') text = linkPath(item.file);
    else if (item.type === 'unresolved') text = item.linktext;
    else if (item.type === 'bookmark') text = item.bookmarkPath;
    if (text === null) return null;
    return completionText(text, item.match && item.match.matches);
  }

  /* ---------------------------------------------------------------- 选择 */
  async onChooseSuggestion(item: SwitcherItem | null, ev: MouseEvent|KeyboardEvent) {
    const mode = modEventMode(ev);
    const active = this.app.workspace.getActiveFile();
    const sourcePath = active && active.extension === 'md' ? active.path : '';
    if (!item) {
      await this.createAndOpen(this.inputEl.value, sourcePath, mode);
      return;
    }
    if (item.type === 'file' || item.type === 'alias') {
      await this.openFile(item.file, mode);
      return;
    }
    if (item.type === 'unresolved') {
      await this.createAndOpen(item.linktext, sourcePath, mode);
      return;
    }
    if (item.type === 'bookmark') {
      await this.openBookmark(item.item, mode);
    }
  }

  openFile(file: TFile|null|undefined, mode: string|boolean) {
    if (mode === 'window') mode = 'split'; // 本应用无多窗口叶子，降级为新标签组
    return this.app.workspace.openFile(file, { newLeaf: mode || false });
  }

  /** 原版 openLinkText：已解析则跳转；未解析则按输入创建 Markdown 后打开。 */
  async createAndOpen(text: string, sourcePath: string, mode: string|boolean) {
    const value = String(text || '').trim();
    if (!value) return;
    const hash = value.indexOf('#');
    const rawLink = (hash >= 0 ? value.slice(0, hash) : value).split('|')[0].trim();
    if (!rawLink) return;
    const existing = this.app.metadataCache.getFirstLinkpathDest(rawLink, sourcePath);
    if (existing) {
      await this.app.workspace.openLinkText(value, sourcePath, mode || false);
      return;
    }
    const name = rawLink.replace(/\.md$/i, '');
    const folder = name.includes('/') ? this.app.vault.getRoot() : this.app.fileManager.getNewFileParent(sourcePath);
    const file = await this.app.fileManager.createNewMarkdownFile(folder, name + '.md', '');
    if (hash >= 0) await this.app.workspace.openLinkText(value, sourcePath, mode || false);
    else await this.openFile(file, mode);
  }

  async openBookmark(item: BookmarkItem, mode: string|boolean) {
    const bookmarks = this.app.plugins.getInternalPlugin('bookmarks');
    const plugin = bookmarks && bookmarks.instance;
    if (item.type === 'file') {
      const file = this.app.vault.getFileByPath(item.path);
      if (file) {
        await this.app.workspace.openFile(file, {
          newLeaf: mode === 'window' ? 'split' : (mode || false),
          eState: item.subpath ? { subpath: item.subpath } : undefined,
        });
        return;
      }
    }
    if (plugin) await plugin.openItem(item);
  }
}

/* --------------------------------------------------------------------------
 * 设置页（三项开关；showAllFileTypes 仅当全局「显示所有类型文件」开启时出现）
 * ------------------------------------------------------------------------ */
export function settingTab(app: App, containerEl: HTMLElement) {
  const options: SwitcherOptions = { ...app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS) };
  const save = () => app.settings.savePluginData(DATA_FILE, { ...options });
  const group = new SettingGroup(containerEl);
  group.setHeading(t('plugins.quick-switcher.name'));
  group.addSetting((setting) => setting
    .setName(t('plugins.quick-switcher.option-show-existing-only'))
    .setDesc(t('plugins.quick-switcher.option-show-existing-only-description'))
    .addToggle((toggle) => toggle.setValue(!!options.showExistingOnly).onChange((value) => {
      options.showExistingOnly = value;
      save();
    })));
  group.addSetting((setting) => setting
    .setName(t('plugins.quick-switcher.option-show-attachments'))
    .setDesc(t('plugins.quick-switcher.option-show-attachments-desc'))
    .addToggle((toggle) => toggle.setValue(!!options.showAttachments).onChange((value) => {
      options.showAttachments = value;
      save();
    })));
  if (app.settings.appSettings.showUnsupportedFiles) {
    group.addSetting((setting) => setting
      .setName(t('plugins.quick-switcher.option-show-all-file-types'))
      .setDesc(t('plugins.quick-switcher.option-show-all-file-types-desc'))
      .addToggle((toggle) => toggle.setValue(!!options.showAllFileTypes).onChange((value) => {
        options.showAllFileTypes = value;
        save();
      })));
  }
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app: App) {
  let ribbonEl: HTMLDivElement|null = null;
  let activeModal: QuickSwitcherModal|null = null;
  let options = { ...DEFAULT_OPTIONS };

  const openSwitcher = () => {
    if (activeModal) return;
    activeModal = new QuickSwitcherModal(app, options);
    activeModal.onClose = () => { activeModal = null; };
    activeModal.open();
  };

  return {
    onload() {
      if (ribbonEl) return;
      options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
      app.commands.addCommand({
        id: 'switcher:open',
        name: t('plugins.quick-switcher.action-open'),
        icon: 'lucide-navigation',
        callback: openSwitcher,
      });
      ribbonEl = app.workspace.addRibbonItem(
        'lucide-file-search',
        t('plugins.quick-switcher.action-open'),
        () => openSwitcher(),
      );
      ribbonEl.setAttr('data-command-id', 'switcher:open');
    },
    onunload() {
      if (activeModal) { activeModal.close(); activeModal = null; }
      ribbonEl?.detach();
      ribbonEl = null;
      this.deregisterCommands();
    },
    deregisterCommands() {
      app.commands.removeCommand('switcher:open');
    },
    openSwitcher,
    getOptions: () => options,
    settingTab,
  };
}
