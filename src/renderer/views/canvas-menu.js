/**
 * [INPUT]: 依赖 ../core/i18n.js 的 t；依赖 ../core/suggest.js 的 SuggestModal/fuzzyMatch；依赖 ../core/modals.js 的 PromptModal；依赖 ../core/notices.js 的 Notice
 * [OUTPUT]: 导出 showCreationMenu、showQuickSettingsMenu、FileSuggestModal、LinkSuggestModal、JumpToGroupModal
 * [POS]: canvas-view 的菜单与弹窗层。把「新建卡片/笔记/媒体/网页/分组」右键菜单、快速设置菜单、文件选择、网址输入、「跳跃至组」弹窗从主视图拆出；
 *        主视图只调用这些函数，菜单项文案全部走 plugins.canvas.* 词条。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas menus and pickers — split out of canvas-view to keep it under 800 lines. */
import { t } from '../core/i18n.js';
import { SuggestModal, fuzzyMatch } from '../core/suggest.js';
import { PromptModal } from '../core/modals.js';
import { Notice } from '../core/notices.js';

const NOTE_EXTENSIONS = ['md', 'canvas'];
const MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'mp4', 'webm', 'ogv', 'mov', 'mkv', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'pdf'];

/** 空白处右键 / 拖拽连线落空时的「新建」菜单。 */
export function showCreationMenu(canvas, menu, pos, size) {
  menu.addItem((item) => item.setSection('create').setTitle(t('plugins.canvas.action-add-card')).setIcon('lucide-sticky-note')
    .onClick(() => canvas.createTextNode({ pos, size })));
  menu.addItem((item) => item.setSection('create').setTitle(t('plugins.canvas.action-add-note')).setIcon('lucide-file-text')
    .onClick(() => canvas.promptAddFileNode({ pos, size })));
  menu.addItem((item) => item.setSection('create').setTitle(t('plugins.canvas.action-add-media')).setIcon('lucide-file-image')
    .onClick(() => canvas.promptAddFileNode({ pos, size, media: true })));
  menu.addItem((item) => item.setSection('create').setTitle(t('plugins.canvas.action-add-website')).setIcon('lucide-external-link')
    .onClick(() => canvas.promptAddLinkNode({ pos, size })));
  menu.addItem((item) => item.setSection('create').setTitle(t('plugins.canvas.action-create-group')).setIcon('create-group')
    .onClick(() => canvas.createGroupNode({ pos, size })));
}

/** 快速设置：对齐网格 / 对齐物体（原版选项逐项对应）。 */
export function showQuickSettingsMenu(canvas, menu) {
  menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.option-snap-to-grid')).setIcon('lucide-grid')
    .setChecked(!!canvas.options.snapToGrid)
    .onClick(() => { canvas.options.snapToGrid = !canvas.options.snapToGrid; canvas.saveOptions(); }));
  menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.option-snap-to-objects')).setIcon('snap-to-object')
    .setChecked(!!canvas.options.snapToObjects)
    .onClick(() => { canvas.options.snapToObjects = !canvas.options.snapToObjects; canvas.saveOptions(); }));
}

/** 文件选择弹窗：showAttachments=false 只列笔记，media=true 只列媒体。 */
export class FileSuggestModal extends SuggestModal {
  constructor(app, onChoose, options = {}) {
    super(app);
    this.onChoose = onChoose;
    this.media = !!options.media;
    this.allowCreateNewFile = options.allowCreateNewFile !== false;
    this.emptyStateText = options.emptyStateText || t('plugins.canvas.action-search-file');
    this.setPlaceholder(t('plugins.canvas.action-search-file'));
    this.setInstructions([{ command: '↑↓', purpose: t('plugins.canvas.instruction-jump-to-group') }]);
  }

  getFiles() {
    return this.app.vault.getFiles().filter((file) => {
      const ext = (file.extension || '').toLowerCase();
      return this.media ? MEDIA_EXTENSIONS.includes(ext) : NOTE_EXTENSIONS.includes(ext);
    });
  }

  getSuggestions(query) {
    const files = this.getFiles();
    if (!query) return files.slice(0, this.limit);
    const out = [];
    for (const file of files) {
      const m = fuzzyMatch(query, file.basename) || fuzzyMatch(query, file.path);
      if (m) out.push({ file, score: m.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((o) => o.file);
  }

  renderSuggestion(file, el) {
    el.createDiv({ cls: 'suggestion-title', text: file.basename });
    el.createDiv({ cls: 'suggestion-note', text: file.path });
  }

  onChooseSuggestion(file) {
    this.onChoose(file);
  }
}

/** 网址输入弹窗（原版 y5）：输入合法 URL 后建链接卡片。 */
export class LinkSuggestModal extends PromptModal {
  constructor(app, onChoose) {
    super(app, {
      title: t('plugins.canvas.label-enter-url'),
      placeholder: 'https://example.com',
      okText: t('plugins.canvas.action-add-website'),
      onSubmit: (value) => {
        const url = String(value || '').trim();
        if (!url) return;
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
          new Notice(t('plugins.canvas.label-enter-url'));
          return;
        }
        onChoose(url);
      },
    });
  }
}

/** 「跳跃至组」：列出所有分组，回车后缩放过去。 */
export class JumpToGroupModal extends SuggestModal {
  constructor(app, groups, onChoose) {
    super(app);
    this.groups = groups;
    this.onChoose = onChoose;
    this.emptyStateText = t('plugins.canvas.msg-no-groups-found');
    this.setPlaceholder(t('plugins.canvas.action-jump-to-group'));
    this.setInstructions([
      { command: '↑↓', purpose: t('plugins.canvas.instruction-jump-to-group') },
      { command: '↵', purpose: t('plugins.canvas.instruction-jump-to-group') },
      { command: 'esc', purpose: t('plugins.canvas.instruction-jump-to-group') },
    ]);
  }

  getSuggestions(query) {
    if (!query) return this.groups;
    const out = [];
    for (const group of this.groups) {
      const label = group.label || t('plugins.canvas.label-untitled-group');
      const m = fuzzyMatch(query, label);
      if (m) out.push({ group, score: m.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.map((o) => o.group);
  }

  renderSuggestion(group, el) {
    el.setText(group.label || t('plugins.canvas.label-untitled-group'));
  }

  onChooseSuggestion(group) {
    this.onChoose(group);
  }
}
