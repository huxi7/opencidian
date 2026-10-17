/**
 * [INPUT]: 依赖 i18n/Notice/SettingGroup/Modal 的界面能力；依赖 Vault 的文件与索引写入；Node fs/path；moment
 * [OUTPUT]: 导出 nameKey、DATA_FILE、SNAPSHOT_DIR、DEFAULT_OPTIONS、formatBytes、create、settingTab；实例暴露快照查询、restoreSnapshot 与弹窗入口
 * [POS]: plugins-core/ 的文件恢复插件。按路径串行采集与恢复，按天原子替换 .obsidian/.file-recovery/*.json。恢复先保存编辑器，再经 Vault 写入并同步视图。清空或卸载使在途读取失效。间隔仍用秒，沿用现有选项格式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: file-recovery — snapshot markdown files and restore them. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup } from '../core/setting.js';
import { Modal, confirmDialog } from '../core/modals.js';

const fs = require('fs');
const nodePath = require('path');
const moment = require('moment');

export const nameKey = 'plugins.file-recovery';
export const DATA_FILE = 'file-recovery.json';
export const SNAPSHOT_DIR = '.file-recovery';
export const DEFAULT_OPTIONS = { intervalSeconds: 60, keepDays: 7 };

/** 人类可读的文件大小（B/KB/MB/GB）。 */
export function formatBytes(size) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  const text = i === 0 ? String(Math.round(n)) : n.toFixed(n >= 10 ? 0 : 1);
  return text + ' ' + units[i];
}

/* --------------------------------------------------------------------------
 * FileRecovery — 插件实例
 * ------------------------------------------------------------------------ */
class FileRecovery {
  constructor(app) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS };
    this.tsCache = Object.create(null); // path -> 最近一次快照时间戳
    this.pendingFiles = new Set(); // 未达间隔的待保存路径
    this._intervals = [];
    this._refs = [];
    this._commandIds = [];
    this._jobs = new Map();
    this._generation = 0;
    this._cleanupTimer = null;
  }

  /* ------------------------------------------------------------ 存储层 */
  dir() { return nodePath.join(this.app.settings.dir, SNAPSHOT_DIR); }

  ensureDir() {
    fs.mkdirSync(this.dir(), { recursive: true });
  }

  dayFile(dateStr) { return nodePath.join(this.dir(), dateStr + '.json'); }

  readDay(dateStr) {
    try {
      const data = JSON.parse(fs.readFileSync(this.dayFile(dateStr), 'utf8'));
      return data && !Array.isArray(data) && typeof data === 'object' ? data : {};
    } catch (e) { return {}; }
  }

  writeDay(dateStr, obj) {
    const target = this.dayFile(dateStr);
    const temporary = target + '.tmp';
    try {
      this.ensureDir();
      fs.writeFileSync(temporary, JSON.stringify(obj));
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  listDayFiles() {
    try {
      return fs.readdirSync(this.dir())
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => name.slice(0, 10))
        .sort();
    } catch (e) { return []; }
  }

  /** 某文件全部快照，ts 降序。 */
  getSnapshots(path) {
    const out = [];
    for (const date of this.listDayFiles()) {
      const list = this.readDay(date)[path];
      if (Array.isArray(list)) out.push(...list.filter((snap) =>
        snap && Number.isFinite(snap.ts) && typeof snap.data === 'string'));
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  /** 最新一条快照（从新到旧扫日文件，避免全量读盘）。 */
  latestSnapshot(path) {
    const dates = this.listDayFiles().reverse();
    for (const date of dates) {
      const list = this.readDay(date)[path];
      if (Array.isArray(list)) {
        const valid = list.filter((snap) => snap && Number.isFinite(snap.ts) && typeof snap.data === 'string');
        if (valid.length) return valid.reduce((latest, snap) => snap.ts >= latest.ts ? snap : latest);
      }
    }
    return null;
  }

  /** 全部有快照的文件路径（排序、去重）。 */
  getPaths() {
    const set = new Set();
    for (const date of this.listDayFiles()) {
      const day = this.readDay(date);
      for (const p of Object.keys(day)) if (Array.isArray(day[p]) && day[p].length) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  appendSnapshot(path, ts, data) {
    const latest = this.latestSnapshot(path);
    if (latest) ts = Math.max(ts, latest.ts + 1);
    const date = moment(ts).format('YYYY-MM-DD');
    const day = this.readDay(date);
    if (!Array.isArray(day[path])) day[path] = [];
    day[path].push({ ts, data });
    this.writeDay(date, day);
    this.tsCache[path] = ts;
  }

  /** 恢复后强制补一条快照（原版 forceAdd）。 */
  forceAdd(path, data) { this.appendSnapshot(path, Date.now(), data); }

  /** 同一路径的读写按事件顺序完成，旧读取不能覆盖恢复结果。 */
  enqueue(path, action) {
    const job = (this._jobs.get(path) || Promise.resolve()).then(action);
    const settled = job.catch(() => {});
    this._jobs.set(path, settled);
    settled.then(() => { if (this._jobs.get(path) === settled) this._jobs.delete(path); });
    return job;
  }

  /* ------------------------------------------------------------ 采集层 */
  onFileChanged(file) {
    if (!file || file.extension !== 'md') return; // 任务约定：仅 md（原版含 canvas/base）
    const path = file.path;
    const generation = this._generation;
    return this.enqueue(path, () => this.capture(file, path, generation));
  }

  async capture(file, path, generation) {
    if (generation !== this._generation || file.path !== path) return;
    let last = this.tsCache[path];
    if (last === undefined) {
      const latest = this.latestSnapshot(path);
      last = latest ? latest.ts : 0;
      this.tsCache[path] = last;
    }
    const now = Date.now();
    const interval = Number(this.options.intervalSeconds);
    const seconds = !Number.isFinite(interval) || interval < 0 ? 60 : interval;
    if (now - last < seconds * 1000) { this.pendingFiles.add(path); return; }
    let data;
    try { data = await this.app.vault.cachedRead(file); } catch (e) { return; }
    if (generation !== this._generation || file.path !== path) return;
    const latest = this.latestSnapshot(path);
    // 未产生快照时不延后限流窗口，否则打开未修改文件也会推迟下次备份。
    if (latest && latest.data === data) { this.pendingFiles.delete(path); return; }
    this.appendSnapshot(path, now, data);
    this.pendingFiles.delete(path);
  }

  /** 每 60 秒重试未达间隔的待保存文件（原版 resave）。 */
  async resave() {
    for (const path of [...this.pendingFiles]) {
      this.pendingFiles.delete(path);
      const file = this.app.vault.getFileByPath(path);
      if (file) await this.onFileChanged(file);
    }
  }

  /** 启动与每小时清理：删除早于保留天数的日文件。 */
  cleanup() {
    const keep = Number(this.options.keepDays);
    const days = !Number.isFinite(keep) || keep < 1 ? 7 : keep;
    const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');
    for (const date of this.listDayFiles()) {
      if (date < cutoff) {
        try { fs.unlinkSync(this.dayFile(date)); } catch (e) { /* ignore */ }
      }
    }
  }

  clearData() {
    this._generation += 1;
    for (const date of this.listDayFiles()) {
      try { fs.unlinkSync(this.dayFile(date)); } catch (e) { /* ignore */ }
    }
    this.tsCache = Object.create(null);
    this.pendingFiles.clear();
  }

  /** 恢复已有文件或重建已删除文件，返回时索引与打开的编辑器已同步。 */
  restoreSnapshot(path, snapshot) {
    if (!snapshot || typeof snapshot.data !== 'string') return Promise.reject(new Error('Invalid snapshot'));
    const data = snapshot.data;
    return this.enqueue(path, async () => {
      const views = this.app.workspace.getLeavesOfType('markdown')
        .filter((leaf) => leaf.view.file && leaf.view.file.path === path);
      for (const leaf of views) await leaf.view.save();
      let file = this.app.vault.getFileByPath(path);
      if (file) {
        const current = await this.app.vault.cachedRead(file);
        const latest = this.latestSnapshot(path);
        if (current !== data && (!latest || latest.data !== current)) this.forceAdd(path, current);
        await this.app.vault.modify(file, data);
      } else {
        // adapter.write 不会立即加入文件树；逐级重建父目录后调用 Vault.create。
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join('/');
          if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
        }
        file = await this.app.vault.create(path, data);
      }
      this.forceAdd(path, data);
      this.pendingFiles.delete(path);
      for (const leaf of views) {
        if (leaf.view._fileDeleted) {
          const state = leaf.view.getState();
          await leaf.setViewState({ type: 'empty' });
          await leaf.setViewState({ type: 'markdown', state });
          await leaf.view.setState(state);
        } else {
          await leaf.view._onExternalModify();
        }
      }
      return file;
    });
  }

  openModal(path) {
    const modal = new FileRecoveryModal(this.app, this);
    modal.open();
    if (path) modal.switchToPath(path);
    return modal;
  }

  /* ------------------------------------------------------------ 生命周期 */
  onload() {
    this.options = this.app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
    this.ensureDir();
    this.registerCommand();
    const vault = this.app.vault;
    const workspace = this.app.workspace;
    const onVaultFile = (file) => Promise.resolve(this.onFileChanged(file))
      .catch((error) => console.error('file-recovery: snapshot failed', error));
    const onOpenFile = onVaultFile;
    this._refs.push(vault.on('modify', onVaultFile));
    this._refs.push(vault.on('create', onVaultFile));
    this._refs.push(workspace.on('file-open', onOpenFile));
    this._intervals.push(window.setInterval(() => this.resave()
      .catch((error) => console.error('file-recovery: resave failed', error)), 60 * 1000));
    this._intervals.push(window.setInterval(() => this.cleanup(), 60 * 60 * 1000));
    // 启动时清理过期快照（等 vault 就绪后再扫盘）
    this._cleanupTimer = window.setTimeout(() => this.cleanup(), 1000);
  }

  onunload() {
    this._generation += 1;
    clearTimeout(this._cleanupTimer);
    this._cleanupTimer = null;
    for (const ref of this._refs) ref.unregister();
    this._refs = [];
    for (const id of this._intervals) clearInterval(id);
    this._intervals = [];
    this.deregisterCommands();
  }

  registerCommand() {
    this.app.commands.addCommand({
      id: 'file-recovery:open',
      name: tt('plugins.file-recovery.action-open', 'Open local history'),
      icon: 'lucide-rotate-ccw',
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        this.openModal(active && active.extension === 'md' ? active.path : '');
      },
    });
    this._commandIds.push('file-recovery:open');
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }
}

/* --------------------------------------------------------------------------
 * FileRecoveryModal — 左栏文件搜索 + 快照列表，右栏预览 + 恢复
 * ------------------------------------------------------------------------ */
class FileRecoveryModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.path = '';
    this.currentVersion = null;
    this._suggestions = [];
    this.setTitle(tt('plugins.file-recovery.name', 'File recovery'));
    this.modalEl.addClass('mod-sidebar-layout', 'mod-sync-history');

    // 左栏
    const sidebar = this.contentEl.createDiv('file-recovery-list-container');
    const list = sidebar.createDiv('file-recovery-list');
    const search = list.createDiv('search-input-container');
    this.searchInputEl = search.createEl('input', {
      type: 'text',
      cls: 'search-input',
      attr: { placeholder: tt('plugins.file-recovery.placeholder-choose-file', 'Choose a file...') },
    });
    this.suggestionsEl = list.createDiv('file-recovery-suggestions');
    this.suggestionsEl.style.cssText = 'display:none;overflow-y:auto;max-height:40%;';
    this.versionListEl = list.createDiv('file-recovery-list-item-container');
    this.searchInputEl.addEventListener('input', () => this.updateSuggestions());
    this.searchInputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && this._suggestions.length) this.switchToPath(this._suggestions[0]);
    });

    // 右栏
    const main = this.contentEl.createDiv('sync-history-content-container');
    main.addClass('mod-empty');
    this.emptyEl = main.createEl('p', {
      cls: 'sync-history-content-empty',
      text: tt('plugins.file-recovery.label-select-file', 'Please select a file on the left to view snapshots.'),
    });
    this.contentPaneEl = main.createDiv('sync-history-content');
    this.contentPaneEl.style.display = 'none';
    const titlebar = this.contentPaneEl.createDiv('modal-setting-titlebar');
    this.paneTitleEl = titlebar.createDiv('modal-setting-title');
    this.restoreBtn = titlebar.createEl('button', {
      cls: 'mod-cta',
      text: tt('plugins.sync.label-restore-this-version', 'Restore'),
    });
    this.restoreBtn.onclick = () => this.restore();
    this.textareaEl = this.contentPaneEl.createEl('textarea', {
      cls: 'file-recovery-text',
      attr: { spellcheck: 'false', readonly: 'true' },
    });
  }

  onOpen() {
    setTimeout(() => {
      this.searchInputEl.focus();
      if (!this.path) this.updateSuggestions();
    }, 10);
  }

  /** 输入即过滤有快照的文件；空查询列出全部。 */
  updateSuggestions() {
    const query = this.searchInputEl.value.trim().toLowerCase();
    const paths = this.plugin.getPaths();
    this._suggestions = (query ? paths.filter((p) => p.toLowerCase().includes(query)) : paths).slice(0, 100);
    this.suggestionsEl.empty();
    if (!this._suggestions.length) { this.suggestionsEl.style.display = 'none'; return; }
    for (const p of this._suggestions) {
      const item = this.suggestionsEl.createDiv('suggestion-item');
      item.style.cssText = 'cursor:pointer;padding:var(--size-4-1) var(--size-4-3);';
      item.setText(p);
      item.onclick = () => this.switchToPath(p);
    }
    this.suggestionsEl.style.display = 'block';
  }

  /** 切换到某个文件并列出其快照（原版 switchToPath）。 */
  switchToPath(path) {
    this.path = path;
    this.searchInputEl.value = path;
    this.suggestionsEl.style.display = 'none';
    this.suggestionsEl.empty();
    this._suggestions = [];
    this.currentVersion = null;
    this.versionListEl.empty();
    const snapshots = this.plugin.getSnapshots(path);
    if (!snapshots.length) {
      this.versionListEl.createDiv({
        cls: 'file-recovery-list-empty',
        text: tt('plugins.file-recovery.label-no-history-found', 'No snapshots found.'),
      });
      this._showEmpty();
      return;
    }
    snapshots.forEach((snap, i) => {
      const item = this.versionListEl.createDiv('file-recovery-list-item-header');
      item.createDiv({ cls: 'file-recovery-list-item-details', text: moment(snap.ts).format('llll') });
      item.createDiv({ cls: 'u-small u-muted', text: formatBytes(snap.data.length) });
      item.onclick = () => this.selectVersion(snap, item);
      if (i === 0) this.selectVersion(snap, item);
    });
  }

  selectVersion(snap, itemEl) {
    this.currentVersion = snap;
    for (const el of this.versionListEl.findAll('.file-recovery-list-item-header')) {
      el.removeClass('is-active');
    }
    itemEl.addClass('is-active');
    this.contentPaneEl.parentElement.removeClass('mod-empty');
    this.emptyEl.style.display = 'none';
    this.contentPaneEl.style.display = 'flex';
    this.paneTitleEl.setText(this.path);
    this.textareaEl.value = snap.data;
  }

  _showEmpty() {
    this.contentPaneEl.parentElement.addClass('mod-empty');
    this.emptyEl.style.display = '';
    this.contentPaneEl.style.display = 'none';
    this.textareaEl.value = '';
  }

  /** 把快照写回文件并补记一条新快照（原版 restore + forceAdd）。 */
  async restore() {
    const snap = this.currentVersion;
    const path = this.path;
    if (!snap || this.restoreBtn.disabled) return;
    this.restoreBtn.disabled = true;
    try {
      await this.plugin.restoreSnapshot(path, snap);
    } catch (e) {
      new Notice(String(e && e.message ? e.message : e));
      return;
    } finally {
      this.restoreBtn.disabled = false;
    }
    new Notice(tt('plugins.sync.msg-restored-version', 'Successfully restored version from {{time}}', {
      time: moment(snap.ts).fromNow(),
    }));
    if (this.path === path) this.switchToPath(path);
  }
}

/* --------------------------------------------------------------------------
 * 设置页（设置宿主经 module.settingTab(app, containerEl) 调用）
 * ------------------------------------------------------------------------ */
export function settingTab(app, containerEl) {
  const options = app.settings.loadPluginData(DATA_FILE, DEFAULT_OPTIONS);
  const save = () => app.settings.savePluginData(DATA_FILE, options);
  const instance = () => {
    const entry = app.plugins && app.plugins.getInternalPlugin('file-recovery');
    return entry && entry.instance ? entry.instance : null;
  };
  const group = new SettingGroup(containerEl);
  group.setHeading(tt('plugins.file-recovery.name', 'File recovery'));
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-interval', 'Snapshot interval'))
      // 本实现的间隔单位为秒（原版为分钟），描述不使用 locale 的 minutes 文案
      .setDesc('Minimal interval in seconds between two snapshots.')
      .addSlider((slider) => {
        slider.setLimits(5, 300, 5).setValue(options.intervalSeconds).setDynamicTooltip()
          .onChange((value) => { options.intervalSeconds = value; save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-keep', 'History length'))
      .setDesc(tt('plugins.file-recovery.option-keep-description', 'Number of days the snapshots are kept for.'))
      .addSlider((slider) => {
        slider.setLimits(1, 30, 1).setValue(options.keepDays).setDynamicTooltip()
          .onChange((value) => { options.keepDays = value; save(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-open-history', 'Snapshots'))
      .setDesc(tt('plugins.file-recovery.option-open-history-description', 'View and restore saved snapshots.'))
      .addButton((button) => {
        button
          .setButtonText(tt('plugins.file-recovery.button-view-history', 'View'))
          .setCta()
          .onClick(() => { const inst = instance(); if (inst) inst.openModal(); });
      });
  });
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-clear', 'Clear history'))
      .setDesc(tt('plugins.file-recovery.option-clear-description', 'Delete all snapshots.'))
      .addButton((button) => {
        button
          .setButtonText(tt('plugins.file-recovery.button-clear-history', 'Clear'))
          .setWarning()
          .onClick(async () => {
            const ok = await confirmDialog(
              app,
              tt('plugins.file-recovery.option-clear', 'Clear history'),
              tt('plugins.file-recovery.label-clear-warning', 'Are you sure you want to delete all snapshots? Files inside your vault will not be affected.'),
              { warning: true, cta: tt('plugins.file-recovery.button-clear-history', 'Clear') },
            );
            if (!ok) return;
            const inst = instance();
            if (inst) inst.clearData();
            new Notice(tt('plugins.file-recovery.msg-clear-complete', 'Local history cleared.'));
          });
      });
  });
  return group;
}

/* --------------------------------------------------------------------------
 * 插件入口
 * ------------------------------------------------------------------------ */
export function create(app) {
  const plugin = new FileRecovery(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // 供设置页签/其他插件调用
    openModal: (path) => plugin.openModal(path),
    getSnapshots: (path) => plugin.getSnapshots(path),
    getPaths: () => plugin.getPaths(),
    restoreSnapshot: (path, snapshot) => plugin.restoreSnapshot(path, snapshot),
    clearData: () => plugin.clearData(),
  };
}
