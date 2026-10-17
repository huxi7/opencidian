/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/setting.js 的 Setting/SettingGroup/SettingTab；依赖 ../core/notices.js 的 Notice；依赖 ../core/modals.js 的 Modal；依赖 ../core/ipc.js 的 Desktop；依赖 ../core/keymap.js 的 hotkeyToString/eventToHotkey；依赖 ../core/commands.js 的命令注册表
 * [OUTPUT]: 导出 HotkeysTab、CorePluginsTab、CommunityPluginsTab
 * [POS]: views/ 的插件相关设置页签。快捷键页对齐原版 w0（搜索/筛选/冲突提示/录制弹窗，写 hotkeys.json）；核心插件页对齐 dte（搜索 + 名称/描述 + 齿轮 + 开关，驱动 PluginManager.enable/disableInternalPlugin）；第三方插件页对齐 tte 的安全模式语义（restrictedMode 存于 PluginManager，市场不接入）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Plugin-related settings tabs: Hotkeys / Core plugins / Community plugins. */
import { tt } from '../core/i18n.js';
import { Setting, SettingGroup, SettingTab } from '../core/setting.js';
import { Notice } from '../core/notices.js';
import { Modal } from '../core/modals.js';
import { Desktop } from '../core/ipc.js';
import { hotkeyToString, eventToHotkey } from '../core/keymap.js';

/* ----------------------------------------------------------------- Hotkeys */

export class HotkeysTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.hotkeys.name', '快捷键');
    this.id = 'hotkeys';
    this.icon = 'command';
  }

  display() {
    const app = this.app;
    this.containerEl.empty();
    let query = '';
    let filterMode = this._filterMode || 'all';

    const group = new SettingGroup(this.containerEl);
    let countEl = null;
    group.addSearch((s) => {
      s.setName('');
      s.addSearch((search) => search
        .setPlaceholder(tt('setting.hotkeys.prompt-filter', '搜索…'))
        .onChange((v) => { query = v.toLowerCase(); render(); }));
      s.addDropdown((d) => {
        d.addOption('all', tt('setting.hotkeys.label-show-all', '全部'));
        d.addOption('unassigned', tt('setting.hotkeys.label-show-unassigned', '未分配'));
        d.addOption('assigned', tt('setting.hotkeys.label-show-assigned', '已分配'));
        d.addOption('user', tt('setting.hotkeys.label-show-user-assigned', '由我分配'));
        d.setValue(filterMode);
        d.onChange((v) => { filterMode = v; this._filterMode = v; render(); });
      });
      countEl = s.descEl;
    });

    const rowsEl = group.listEl;
    const render = () => {
      rowsEl.empty();
      const commands = app.commands.listCommands().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
      const conflictMap = new Map();
      for (const cmd of commands) {
        for (const hk of app.hotkeyManager.getHotkeys(cmd.id)) {
          const text = hotkeyToString(hk);
          if (!conflictMap.has(text)) conflictMap.set(text, []);
          conflictMap.get(text).push(cmd.id);
        }
      }
      let shown = 0;
      let conflicts = 0;
      for (const cmd of commands) {
        const hotkeys = app.hotkeyManager.getHotkeys(cmd.id);
        const isUser = Object.prototype.hasOwnProperty.call(app.settings.hotkeys || {}, cmd.id);
        if (query && !cmd.name.toLowerCase().includes(query) && !cmd.id.toLowerCase().includes(query)) continue;
        if (filterMode === 'unassigned' && hotkeys.length) continue;
        if (filterMode === 'assigned' && !hotkeys.length) continue;
        if (filterMode === 'user' && !isUser) continue;
        shown++;
        const s = new Setting(rowsEl);
        s.setName(cmd.name);
        for (const hk of hotkeys) {
          const text = hotkeyToString(hk);
          const chip = s.controlEl.createDiv('setting-hotkey');
          chip.setText(text);
          const conflicting = (conflictMap.get(text) || []).filter((id) => id !== cmd.id);
          if (conflicting.length === 1) {
            chip.addClass('mod-error');
            chip.setAttr('aria-label', tt('setting.hotkeys.tooltip-hotkey-single-conflict', '该快捷键与 “{{command}}” 冲突', { command: (app.commands.findCommand(conflicting[0]) || {}).name || conflicting[0] }));
            conflicts++;
          } else if (conflicting.length > 1) {
            chip.addClass('mod-error');
            chip.setAttr('aria-label', tt('setting.hotkeys.tooltip-hotkey-multiple-conflicts', '该快捷键与其他 {{count}} 个快捷键冲突', { count: conflicting.length }));
            conflicts++;
          }
          const del = chip.createDiv('clickable-icon setting-hotkey-delete');
          del.setAttr('aria-label', tt('setting.hotkeys.tooltip-delete-hotkey', '删除快捷键'));
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const next = app.hotkeyManager.getHotkeys(cmd.id).filter((x) => hotkeyToString(x) !== text);
            app.settings.setHotkey(cmd.id, next);
            app.hotkeyManager.buildCustomKeys();
            render();
          });
        }
        s.addExtraButton((b) => b
          .setIcon('lucide-plus')
          .setTooltip(tt('setting.hotkeys.tooltip-customize-command', '自定义快捷键'))
          .onClick(() => new HotkeyRecorderModal(app, cmd, () => render()).open()));
        if (isUser) {
          s.addExtraButton((b) => b
            .setIcon('lucide-rotate-ccw')
            .setTooltip(tt('setting.hotkeys.tooltip-restore-default', '恢复默认'))
            .onClick(() => {
              app.settings.setHotkey(cmd.id, null);
              app.hotkeyManager.buildCustomKeys();
              render();
            }));
        }
      }
      if (countEl) {
        countEl.setText(tt('setting.hotkeys.option-search-desc', '显示 {{count}} 个快捷键。', { count: shown })
          + (conflicts ? ' ' + tt('setting.hotkeys.option-search-conflict', '有 {{count}} 个冲突命令。', { count: conflicts }) : ''));
      }
    };
    render();
  }
}

/** 录制弹窗：按下组合键写入该命令。Escape 取消。 */
class HotkeyRecorderModal extends Modal {
  constructor(app, command, onDone) {
    super(app);
    this.app = app;
    this.command = command;
    this.onDone = onDone;
    this.setTitle(command.name);
  }

  onOpen() {
    this.contentEl.createDiv({
      cls: 'hotkey-recorder',
      text: tt('setting.hotkeys.label-waiting-for-hotkey-press', '按下快捷键…'),
    });
    this._keyHandler = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') { this.close(); return; }
      const hk = eventToHotkey(ev);
      if (!hk) return;
      const current = this.app.hotkeyManager.getHotkeys(this.command.id);
      this.app.settings.setHotkey(this.command.id, [...current, hk]);
      this.app.hotkeyManager.buildCustomKeys();
      this.close();
      this.onDone && this.onDone();
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  onClose() {
    window.removeEventListener('keydown', this._keyHandler, true);
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------ Core plugins */

export class CorePluginsTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.builtin-plugins', '核心插件');
    this.id = 'plugins';
    this.icon = 'toy-brick';
  }

  display() {
    const app = this.app;
    this.containerEl.empty();
    let query = '';
    const group = new SettingGroup(this.containerEl);
    group.addSearch((s) => {
      s.setName(tt('setting.core-plugin.plugin-list', '插件列表'));
      s.addSearch((search) => search
        .setPlaceholder(tt('setting.core-plugin.placeholder-search-plugin', '输入插件名称或描述…'))
        .onChange((v) => { query = v.toLowerCase(); render(); }));
      s.setDesc(tt('setting.core-plugin.option-search-plugin-description', '通过插件名称或描述来寻找插件。'));
    });

    const rowsEl = group.listEl;
    const render = () => {
      rowsEl.empty();
      const entries = Object.entries(app.plugins.internalPlugins)
        .sort((a, b) => String(a[1].manifest.name).localeCompare(String(b[1].manifest.name), 'zh'));
      for (const [id, entry] of entries) {
        const name = entry.manifest.name || id;
        const desc = entry.manifest.description || '';
        if (query && !name.toLowerCase().includes(query) && !desc.toLowerCase().includes(query)) continue;
        const s = new Setting(rowsEl);
        s.setName(name);
        s.setDesc(desc);
        if (entry.manifest.module && entry.manifest.module.settingTab) {
          s.addExtraButton((b) => b
            .setIcon('lucide-settings')
            .setTooltip(tt('setting.plugin-options', '插件选项'))
            .onClick(() => {
              this.setting.openPluginOptions(id);
            }));
        }
        s.addToggle((tog) => tog.setValue(!!entry.enabled).onChange(async (v) => {
          if (v) await app.plugins.enableInternalPlugin(id);
          else await app.plugins.disableInternalPlugin(id);
          render();
        }));
      }
    };
    render();
  }
}

/* ------------------------------------------------------- Community plugins */

export class CommunityPluginsTab extends SettingTab {
  constructor(app, setting) {
    super(app, setting);
    this.name = tt('setting.third-party-plugin.name', '第三方插件');
    this.id = 'community-plugins';
    this.icon = 'puzzle';
  }

  display() {
    const app = this.app;
    const plugins = app.plugins;
    const restricted = plugins.restrictedMode !== false;
    this.containerEl.empty();
    const group = new SettingGroup(this.containerEl);

    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.option-restricted-mode', '安全模式'))
      .setDesc(restricted
        ? tt('setting.third-party-plugin.label-restricted-mode-on', '安全模式已开启。第三方插件已被限制运行。')
        : tt('setting.third-party-plugin.option-restricted-mode-description', '安全模式已关闭。开启以限制第三方插件运行。'))
      .addButton((b) => b
        .setButtonText(restricted
          ? tt('setting.third-party-plugin.button-turn-on-community-plugins', '关闭安全模式')
          : tt('setting.third-party-plugin.button-turn-on', '开启'))
        .onClick(() => {
          plugins.restrictedMode = !restricted;
          location.reload();
        })));

    group.addSetting((s) => s
      .setName(tt('setting.third-party-plugin.option-browse-community-plugins', '社区插件市场'))
      .setDesc(tt('setting.third-party-plugin.option-browse-community-plugins-description', '浏览、安装社区成员制作的第三方插件。'))
      .addButton((b) => b.setCta().setButtonText(tt('setting.third-party-plugin.button-browse', '浏览')).onClick(() => {
        new Notice(tt('setting.third-party-plugin.msg-market-unavailable', '复刻版未接入社区插件市场。'));
      })));

    const installed = plugins.listInstalledManifests();
    const listGroup = new SettingGroup(this.containerEl).setHeading(tt('setting.third-party-plugin.label-installed-plugins', '已安装插件'));
    if (!installed.length) {
      listGroup.addSetting((s) => s
        .setName(tt('setting.third-party-plugin.label-installed-plugins', '已安装插件'))
        .setDesc(tt('setting.third-party-plugin.msg-no-installed', '尚未安装任何第三方插件。')));
    }
    for (const manifest of installed) {
      const id = manifest.id;
      listGroup.addSetting((s) => s
        .setName(manifest.name || id)
        .setDesc(manifest.description || '')
        .addToggle((tog) => tog.setValue(!!plugins.plugins[id]).onChange(async (v) => {
          if (v) {
            const ok = await plugins.enableCommunityPlugin(id).catch((e) => { console.error(e); return false; });
            if (!ok) new Notice(tt('setting.third-party-plugin.msg-failed-load-plugins', '无法加载社区插件'));
          } else {
            const ok = await plugins.disableCommunityPlugin(id).catch((e) => { console.error(e); return false; });
            if (!ok) new Notice(tt('setting.third-party-plugin.msg-failed-to-disable-plugin', '无法禁用插件 “{{id}}”', { id }));
          }
          this.display();
        })));
    }
    listGroup.addExtraButton((b) => b
      .setIcon('lucide-folder-open')
      .setTooltip(tt('setting.third-party-plugin.button-open-plugins-folder', '打开插件文件夹'))
      .onClick(() => {
        try { Desktop.openPath(plugins.pluginDir()); } catch (e) { console.error(e); }
      }));
    listGroup.addExtraButton((b) => b
      .setIcon('lucide-refresh-cw')
      .setTooltip(tt('setting.third-party-plugin.button-reload-plugins', '重新加载插件'))
      .onClick(() => location.reload()));
  }
}
