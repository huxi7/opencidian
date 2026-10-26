/**
 * [INPUT]: 依赖 i18n/Notice/SettingGroup/Setting 控件/Modal 的界面能力；依赖 ../views/diff-view.js 的 renderDiffView；依赖 Vault 的文件与索引写入；Node fs/path；moment；Electron clipboard
 * [OUTPUT]: 导出 nameKey、DATA_FILE、SNAPSHOT_DIR、DEFAULT_OPTIONS、SNAPSHOT_EXTENSIONS、loadOptions、formatBytes、create、settingTab；实例暴露快照查询、restoreSnapshot、saveOptions 与弹窗入口
 * [POS]: plugins-core/ 的文件恢复插件。快照范围为 md/canvas/base；间隔单位分钟（默认 5，0 表示每次变更即存），旧 intervalSeconds 配置按 60 秒=1 分钟在读取时迁移。快照仍按天原子替换 .obsidian/.file-recovery/*.json，旧快照保持可读。恢复先保存编辑器，保存失败则拒绝覆盖。成功后经 Vault 写入并同步视图；canvas 视图经 vault modify 事件自行重载。清空或卸载使在途读取失效。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: file-recovery — snapshot md/canvas/base files and restore them. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { SettingGroup, ToggleComponent, ButtonComponent } from '../core/setting.js';
import { Modal, confirmDialog } from '../core/modals.js';
import { renderDiffView } from '../views/diff-view.js';
import { TFile, type VaultEntry } from '../core/vault.js';
import { MarkdownView } from '../views/markdown-view.js';
import { isJsonRecord, type JsonRecord } from '../core/settings-types.js';
import type { EventRef } from '../core/events.js';

const fs: typeof import('node:fs') = require('fs');
const nodePath: typeof import('node:path') = require('path');
import moment from 'moment';
const { clipboard }: typeof import('electron') = require('electron');

interface Snapshot { ts: number; data: string; }
function isSnapshot(value: unknown): value is Snapshot {
  return isJsonRecord(value) && typeof value.ts === 'number' && Number.isFinite(value.ts) && typeof value.data === 'string';
}

export const nameKey = 'plugins.file-recovery';
export const DATA_FILE = 'file-recovery.json';
export const SNAPSHOT_DIR = '.file-recovery';
export const DEFAULT_OPTIONS = { intervalMinutes: 5, keepDays: 7 };
export const SNAPSHOT_EXTENSIONS = ['md', 'canvas', 'base'];

/** 读取插件选项；旧版 intervalSeconds（秒）按 60 秒=1 分钟迁移为 intervalMinutes。 */
export function loadOptions(app: App) {
  const raw = app.settings.loadPluginData(DATA_FILE, {});
  const options = { ...DEFAULT_OPTIONS };
  if (!raw || typeof raw !== 'object') return options;
  if (raw.intervalMinutes !== undefined) {
    const minutes = parseFloat(String(raw.intervalMinutes));
    if (Number.isFinite(minutes) && minutes >= 0) options.intervalMinutes = minutes;
  }
  else if (raw.intervalSeconds !== undefined) {
    const seconds = parseFloat(String(raw.intervalSeconds));
    options.intervalMinutes = Number.isFinite(seconds) && seconds >= 0 ? seconds / 60 : DEFAULT_OPTIONS.intervalMinutes;
  }
  if (raw.keepDays !== undefined) {
    const days = parseFloat(String(raw.keepDays));
    if (Number.isFinite(days) && days >= 1) options.keepDays = days;
  }
  return options;
}

/** 人类可读的文件大小（对齐原版 Df：B 为整数，其余两位小数并带千分位）。 */
export function formatBytes(size: number) {
  if (!size || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = units.length - 1;
  for (let i = 0; i < units.length; i += 1) {
    if (size < Math.pow(1024, i + 1)) { index = i; break; }
  }
  const value = size / Math.pow(1024, index);
  const decimals = index === 0 ? 0 : 2;
  const [intPart, fracPart] = value.toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (fracPart ? grouped + '.' + fracPart : grouped) + ' ' + units[index];
}

/** 显示用路径：仅 Markdown 去掉扩展名（对齐原版 uu）。 */
function displayPath(path: string) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (extensionOf(base) !== 'md') return path;
  const index = path.lastIndexOf('.');
  return index > 0 ? path.slice(0, index) : path;
}

/** 小写扩展名（对齐原版 ou）。 */
function extensionOf(path: string) {
  const index = path.lastIndexOf('.');
  if (index < 0 || index === path.length - 1 || index === 0) return '';
  return path.slice(index + 1).toLowerCase();
}

/* --------------------------------------------------------------------------
 * FileRecovery — 插件实例
 * ------------------------------------------------------------------------ */
class FileRecovery {
  declare app: App;
  declare options: typeof DEFAULT_OPTIONS;
  declare tsCache: Record<string, number>;
  declare pendingFiles: Set<string>;
  declare _intervals: number[];
  declare _refs: EventRef[];
  declare _commandIds: string[];
  declare _jobs: Map<string, Promise<unknown>>;
  declare _generation: number;
  declare _cleanupTimer: number | null;

  constructor(app: App) {
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

  dayFile(dateStr: string) { return nodePath.join(this.dir(), dateStr + '.json'); }

  readDay(dateStr: string) {
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.dayFile(dateStr), 'utf8'));
      return isJsonRecord(data) ? data : {};
    } catch (e) { return {}; }
  }

  writeDay(dateStr: string, obj: JsonRecord) {
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
        .filter((name: string) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => name.slice(0, 10))
        .sort();
    } catch (e) { return []; }
  }

  /** 某文件全部快照，ts 降序。 */
  getSnapshots(path: string|number) {
    const out: Snapshot[] = [];
    for (const date of this.listDayFiles()) {
      const list = this.readDay(date)[path];
      if (Array.isArray(list)) out.push(...list.filter(isSnapshot));
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  /** 最新一条快照（从新到旧扫日文件，避免全量读盘）。 */
  latestSnapshot(path: string|number) {
    const dates = this.listDayFiles().reverse();
    for (const date of dates) {
      const list = this.readDay(date)[path];
      if (Array.isArray(list)) {
        const valid = list.filter(isSnapshot);
        if (valid.length) return valid.reduce((latest, snap) => snap.ts >= latest.ts ? snap : latest);
      }
    }
    return null;
  }

  /** 全部有快照的文件路径（排序、去重）。 */
  getPaths() {
    const set = new Set<string>();
    for (const date of this.listDayFiles()) {
      const day = this.readDay(date);
      for (const p of Object.keys(day)) if (Array.isArray(day[p]) && day[p].length) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  appendSnapshot(path: string|number, ts: number, data: string) {
    const latest = this.latestSnapshot(path);
    if (latest) ts = Math.max(ts, latest.ts + 1);
    const date = moment(ts).format('YYYY-MM-DD');
    const day = this.readDay(date);
    const existing = day[path];
    const snapshots: unknown[] = Array.isArray(existing) ? existing : [];
    snapshots.push({ ts, data });
    day[path] = snapshots;
    this.writeDay(date, day);
    this.tsCache[path] = ts;
  }

  /** 恢复后强制补一条快照（原版 forceAdd）。 */
  forceAdd(path: string|number, data: string) { this.appendSnapshot(path, Date.now(), data); }

  /** 同一路径的读写按事件顺序完成，旧读取不能覆盖恢复结果。 */
  enqueue<T>(path: string, action: () => T | Promise<T>): Promise<T> {
    const job = (this._jobs.get(path) || Promise.resolve()).then(action);
    const settled = job.catch(() => {});
    this._jobs.set(path, settled);
    settled.then(() => { if (this._jobs.get(path) === settled) this._jobs.delete(path); });
    return job;
  }

  /* ------------------------------------------------------------ 采集层 */
  onFileChanged(file: VaultEntry | null) {
    if (!(file instanceof TFile) || !SNAPSHOT_EXTENSIONS.includes(file.extension)) return;
    const path = file.path;
    const generation = this._generation;
    return this.enqueue(path, () => this.capture(file, path, generation));
  }

  async capture(file: TFile, path: string, generation: number) {
    if (generation !== this._generation || file.path !== path) return;
    let last = this.tsCache[path];
    if (last === undefined) {
      const latest = this.latestSnapshot(path);
      last = latest ? latest.ts : 0;
      this.tsCache[path] = last;
    }
    const now = Date.now();
    const minutes = Number(this.options.intervalMinutes);
    const intervalMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 5;
    if (now - last < 60 * intervalMinutes * 1000) { this.pendingFiles.add(path); return; }
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
  restoreSnapshot(path: string, snapshot: Snapshot) {
    if (!snapshot || typeof snapshot.data !== 'string') return Promise.reject(new Error('Invalid snapshot'));
    const data = snapshot.data;
    return this.enqueue(path, async () => {
      const views = this.app.workspace.getLeavesOfType('markdown')
        .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === path);
      for (const leaf of views) {
        if (leaf.view instanceof MarkdownView && await leaf.view.save() === false) throw new Error('Document could not be saved before recovery.');
      }
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
        if (!(leaf.view instanceof MarkdownView)) continue;
        if (leaf.view._fileDeleted) {
          const state = leaf.view.getState();
          await leaf.setViewState({ type: 'empty' });
          await leaf.setViewState({ type: 'markdown', state });
          await leaf.view?.setState(state);
        } else {
          await leaf.view._onExternalModify();
        }
      }
      return file;
    });
  }

  openModal(path = '') {
    const modal = new FileRecoveryModal(this.app, this);
    modal.open();
    if (path) modal.switchToPath(path);
    return modal;
  }

  /* ------------------------------------------------------------ 生命周期 */
  onload() {
    this.options = loadOptions(this.app);
    this.ensureDir();
    this.registerCommand();
    const vault = this.app.vault;
    const workspace = this.app.workspace;
    const onVaultFile = (file: VaultEntry | null) => Promise.resolve(this.onFileChanged(file))
      .catch((error) => console.error('file-recovery: snapshot failed', error));
    const onOpenFile = onVaultFile;
    this._refs.push(vault.on('modify', onVaultFile));
    this._refs.push(vault.on('create', onVaultFile));
    this._refs.push(workspace.on('file-open', onOpenFile));
    this._intervals.push(window.setInterval(() => this.resave()
      .catch((error) => console.error('file-recovery: resave failed', error)), 60 * 1000));
    this._intervals.push(window.setInterval(() => this.cleanup(), 60 * 60 * 1000));
    // 启动后 60 秒清理过期快照（对齐原版 setTimeout(cleanup, 6e4)）
    this._cleanupTimer = window.setTimeout(() => this.cleanup(), 60 * 1000);
  }

  /** 持久化选项（设置页与实例共享同一对象，改动即时生效）。 */
  saveOptions() {
    this.app.settings.savePluginData(DATA_FILE, this.options);
  }

  onunload() {
    this._generation += 1;
    clearTimeout(this._cleanupTimer ?? undefined);
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
  declare plugin: FileRecovery;
  declare path: string;
  declare currentVersion: Snapshot | null;
  declare _suggestions: string[];
  declare searchInputEl: HTMLInputElement;
  declare suggestionsEl: HTMLDivElement;
  declare versionListEl: HTMLDivElement;
  declare emptyEl: HTMLParagraphElement;
  declare contentPaneEl: HTMLDivElement;
  declare paneTitleEl: HTMLDivElement;
  declare diffToggle: ToggleComponent;
  declare copyBtn: ButtonComponent;
  declare restoreBtn: ButtonComponent;
  declare textareaEl: HTMLTextAreaElement;
  declare diffEl: HTMLDivElement;
  declare _prevVersion: Snapshot | null;
  declare _diffRendered: boolean;

  constructor(app: App, plugin: FileRecovery) {
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
    this.searchInputEl.addEventListener('keydown', (ev: { key: string; }) => {
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
    const actions = titlebar.createDiv('modal-setting-titlebar-actions');
    const diffLabel = actions.createSpan({
      cls: 'modal-setting-titlebar-toggle',
      text: tt('plugins.sync.label-show-diff', 'Show changes'),
    });
    this.diffToggle = new ToggleComponent(diffLabel).setSmall().setValue(false);
    this.diffToggle.onChange((value) => this.updateDiffVisibility(value));
    this.copyBtn = new ButtonComponent(actions)
      .setButtonText(tt('interface.label-copy-short', 'Copy'))
      .onClick(() => {
        if (!this.currentVersion) return;
        clipboard.writeText(this.currentVersion.data);
        new Notice(tt('interface.copied_generic', 'Copied to clipboard'));
      });
    this.restoreBtn = new ButtonComponent(actions)
      .setButtonText(tt('plugins.sync.label-restore-this-version', 'Restore'))
      .onClick(() => this.restore());
    this.textareaEl = this.contentPaneEl.createEl('textarea', {
      cls: 'file-recovery-text',
      attr: { spellcheck: 'false' },
    });
    this.diffEl = this.contentPaneEl.createDiv('file-recovery-diff');
    this.diffEl.style.display = 'none';
    this._prevVersion = null;
    this._diffRendered = false;
  }

  onOpen() {
    setTimeout(() => {
      this.searchInputEl.focus();
      if (!this.path) this.updateSuggestions();
    }, 10);
  }

  /** 输入即过滤有快照的文件；空查询列出全部。条目显示与原版一致：Markdown 去掉 .md。 */
  updateSuggestions() {
    const query = this.searchInputEl.value.trim().toLowerCase();
    const paths = this.plugin.getPaths();
    this._suggestions = (query ? paths.filter((p: string) => p.toLowerCase().includes(query)) : paths).slice(0, 100);
    this.suggestionsEl.empty();
    if (!this._suggestions.length) { this.suggestionsEl.style.display = 'none'; return; }
    for (const p of this._suggestions) {
      const item = this.suggestionsEl.createDiv('suggestion-item');
      item.style.cssText = 'cursor:pointer;padding:var(--size-4-1) var(--size-4-3);';
      item.setText(displayPath(p));
      item.onclick = () => this.switchToPath(p);
    }
    this.suggestionsEl.style.display = 'block';
  }

  /** 切换到某个文件并列出其快照（原版 switchToPath）。 */
  switchToPath(path: string) {
    this.path = path;
    const display = displayPath(path);
    this.searchInputEl.value = display;
    this.searchInputEl.blur();
    this.paneTitleEl.setText(display);
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
    snapshots.forEach((snap, i: number) => {
      const item = this.versionListEl.createDiv('file-recovery-list-item-header');
      item.createDiv({ cls: 'file-recovery-list-item-details', text: moment(snap.ts).format('llll') });
      item.createDiv({ cls: 'u-small u-muted', text: formatBytes(snap.data.length) });
      item.onclick = () => this.selectVersion(snap, item);
      if (i === 0) this.selectVersion(snap, item);
    });
  }

  selectVersion(snap: Snapshot, itemEl: { addClass: (arg0: string) => void; }) {
    this.currentVersion = snap;
    for (const el of this.versionListEl.findAll('.file-recovery-list-item-header')) {
      el.removeClass('is-active');
    }
    itemEl.addClass('is-active');
    this.contentPaneEl.parentElement?.removeClass('mod-empty');
    this.emptyEl.style.display = 'none';
    this.contentPaneEl.style.display = 'flex';
    this.paneTitleEl.setText(displayPath(this.path));
    this.textareaEl.value = snap.data;
    this.textareaEl.setAttr('data-ext', extensionOf(this.path));
    // 差异基准：列表中下一条（更旧）快照（原版 openHistory 的第二个参数）
    const snapshots = this.plugin.getSnapshots(this.path);
    const index = snapshots.findIndex((s) => s.ts === snap.ts);
    this._prevVersion = index >= 0 && index + 1 < snapshots.length ? snapshots[index + 1] : null;
    this._diffRendered = false;
    this.diffEl.empty();
    this.updateDiffVisibility(this.diffToggle.getValue());
  }

  /** 对齐原版 openHistory：切换 textarea/diff 显隐；首次显示差异时按需渲染。 */
  updateDiffVisibility(show: boolean) {
    this.textareaEl.toggle(!show);
    this.diffEl.toggle(show);
    if (show && !this._diffRendered && this.currentVersion) {
      this._diffRendered = true;
      const prev = this._prevVersion ? this._prevVersion.data : '';
      this.diffEl.empty();
      this.diffEl.appendChild(renderDiffView(prev, this.currentVersion.data));
    }
  }

  _showEmpty() {
    this.contentPaneEl.parentElement?.addClass('mod-empty');
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
      new Notice(String(e instanceof Error ? e.message : e));
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
export function settingTab(app: App, containerEl: HTMLElement) {
  const instance = () => {
    const entry = app.plugins && app.plugins.getInternalPlugin('file-recovery');
    return entry && entry.instance ? entry.instance : null;
  };
  // 与运行中的插件共享同一 options 对象：改动即时生效（对齐原版设置页直接改 instance.options）
  const options = instance()?.options || loadOptions(app);
  const save = () => {
    const inst = instance();
    if (inst) inst.saveOptions();
    else app.settings.savePluginData(DATA_FILE, options);
  };
  const group = new SettingGroup(containerEl);
  group.setHeading(tt('plugins.file-recovery.name', 'File recovery'));
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-interval', 'Snapshot interval'))
      .setDesc(tt('plugins.file-recovery.option-interval-description', 'Minimal interval in minutes between two snapshots.'))
      .addText((txt) => txt.setValue(String(options.intervalMinutes)).onChange((value) => {
        const minutes = parseFloat(value);
        if (!Number.isNaN(minutes) && minutes >= 0) {
          options.intervalMinutes = minutes;
          save();
        }
      }));
  });
  group.addSetting((setting) => {
    setting
      .setName(tt('plugins.file-recovery.option-keep', 'History length'))
      .setDesc(tt('plugins.file-recovery.option-keep-description', 'Number of days the snapshots are kept for.'))
      .addText((txt) => txt.setValue(String(options.keepDays)).onChange((value) => {
        const days = parseFloat(value);
        if (!Number.isNaN(days) && days >= 1) {
          options.keepDays = days;
          save();
        }
      }));
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
export function create(app: App) {
  const plugin = new FileRecovery(app);
  return {
    onload() { plugin.onload(); },
    onunload() { plugin.onunload(); },
    deregisterCommands() { plugin.deregisterCommands(); },
    deregister() { plugin.onunload(); },
    // 运行中的选项对象（设置页签与验收直接读写）
    get options() { return plugin.options; },
    saveOptions: () => plugin.saveOptions(),
    // 供设置页签/其他插件调用
    openModal: (path?: string) => plugin.openModal(path),
    getSnapshots: (path: string|number) => plugin.getSnapshots(path),
    getPaths: () => plugin.getPaths(),
    restoreSnapshot: (path: string, snapshot: Snapshot) => plugin.restoreSnapshot(path, snapshot),
    clearData: () => plugin.clearData(),
  };
}
