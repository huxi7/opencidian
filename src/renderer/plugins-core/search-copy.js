/**
 * [INPUT]: 搜索结果视图的 getFiles()、Modal/Setting/Notice 与剪贴板。
 * [OUTPUT]: CopySearchResultsModal；复制结果弹窗与路径/链接/列表前缀三项设置。
 * [POS]: global-search 的复制结果子界面。只读取结果文件列表，不触发搜索或改写搜索状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { t, tt } from '../core/i18n.js';
import { Modal } from '../core/modals.js';
import { Setting } from '../core/setting.js';
import { Notice } from '../core/notices.js';

async function copyText(value) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {}
  try {
    const area = createEl('textarea');
    area.value = value;
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.detach();
    return copied;
  } catch (error) {
    return false;
  }
}

export class CopySearchResultsModal extends Modal {
  constructor(app, view) {
    super(app);
    this.view = view;
    this.showPath = false;
    this.linkStyle = 'none';
    this.listStyle = 'none';
    this.setTitle(t('plugins.search.label-copy-search-results'));

    const body = this.contentEl.createDiv('copy-search-result-container');
    this.textareaEl = body.createEl('textarea', { cls: 'copy-search-result-textarea' });
    new Setting(body)
      .setName(t('plugins.search.option-show-path'))
      .setDesc(t('plugins.search.option-show-path-description'))
      .setClass('mod-toggle')
      .addToggle((toggle) => {
        toggle.setValue(false).onChange((value) => { this.showPath = value; this.update(); });
      });
    new Setting(body)
      .setName(t('plugins.search.option-link-style'))
      .setDesc(t('plugins.search.option-link-style-description'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('none', t('plugins.search.option-choice-link-style-none'))
          .addOption('wikilink', t('plugins.search.option-choice-link-style-wikilink'))
          .addOption('markdown', t('plugins.search.option-choice-link-style-markdown-link'))
          .setValue('none')
          .onChange((value) => { this.linkStyle = value; this.update(); });
      });
    new Setting(body)
      .setName(t('plugins.search.option-list-prefix'))
      .setDesc(t('plugins.search.option-list-prefix-description'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('none', t('plugins.search.option-choice-list-style-none'))
          .addOption('-', t('plugins.search.option-choice-list-style-dash'))
          .addOption('*', t('plugins.search.option-choice-list-style-asterisk'))
          .addOption('num', t('plugins.search.option-choice-list-style-numbered'))
          .setValue('none')
          .onChange((value) => { this.listStyle = value; this.update(); });
      });
    this.buttonContainerEl.createEl('button', {
      cls: 'mod-cta',
      text: t('plugins.search.button-copy-results'),
    }).onclick = async () => {
      const copied = await copyText(this.textareaEl.value);
      if (copied) new Notice(t('plugins.search.msg-successfully-copied'));
    };
    this.buttonContainerEl.createEl('button', {
      text: tt('dialogue.button-done', 'Done'),
    }).onclick = () => this.close();
    this.update();
  }

  update() {
    const files = this.view.getFiles();
    this.textareaEl.value = files.map((file, index) => {
      let name = this.showPath ? file.path : file.path.replace(/\.md$/, '');
      if (this.linkStyle === 'wikilink') name = '[[' + name + ']]';
      else if (this.linkStyle === 'markdown') name = '[' + file.basename + '](' + name + ')';
      if (this.listStyle === '-') name = '- ' + name;
      else if (this.listStyle === '*') name = '* ' + name;
      else if (this.listStyle === 'num') name = (index + 1) + '. ' + name;
      return name;
    }).join('\n');
    this.textareaEl.select();
  }
}
