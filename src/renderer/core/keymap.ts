/**
 * [INPUT]: 浏览器键盘事件、命令入口与默认快捷键表。
 * [OUTPUT]: 导出 Keymap、HotkeyManager 与按键转换函数。
 * [POS]: 键盘路由边界，统一平台修饰键和作用域优先级。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Keymap & hotkey manager. */
import type { HotkeyBinding } from './settings-types.js';
import { Events } from './events.js';
import { DEFAULT_HOTKEYS } from './default-hotkeys.js';

const IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

const KEY_DISPLAY: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Enter: '↵', Escape: 'Esc', ' ': 'Space', Backspace: '⌫', Delete: '⌦',
  Tab: 'Tab', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End',
};
const MOD_DISPLAY_MAC: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };

export function hotkeyToString(hotkey: HotkeyBinding | null | undefined) {
  if (!hotkey || !hotkey.key) return '';
  const parts = [];
  const mods = hotkey.modifiers || [];
  for (const mod of mods) {
    if (IS_MAC) parts.push(MOD_DISPLAY_MAC[mod] || mod);
    else parts.push(mod === 'Mod' ? 'Ctrl' : mod);
  }
  let key = hotkey.key;
  if (KEY_DISPLAY[key]) key = KEY_DISPLAY[key];
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return IS_MAC ? parts.join('') : parts.join('+');
}

export function eventToHotkey(ev: KeyboardEvent): HotkeyBinding | null {
  const modifiers = [];
  if (ev.metaKey) modifiers.push(IS_MAC ? 'Mod' : 'Meta');
  if (ev.ctrlKey) modifiers.push(IS_MAC ? 'Ctrl' : 'Mod');
  if (ev.altKey) modifiers.push('Alt');
  if (ev.shiftKey) modifiers.push('Shift');
  let key = ev.key;
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null;
  if (key.length === 1 && ev.shiftKey) {
    // Shift is represented in modifiers; keep the key as produced
  }
  if (!modifiers.includes('Shift')) {
    // ok
  }
  return { modifiers, key };
}

export function hotkeysEqual(a: HotkeyBinding | null | undefined, b: HotkeyBinding | null | undefined) {
  if (!a || !b) return false;
  if ((a.key || '').toLowerCase() !== (b.key || '').toLowerCase()) return false;
  const ma = new Set(a.modifiers || []);
  const mb = new Set(b.modifiers || []);
  if (ma.size !== mb.size) return false;
  for (const m of ma) if (!mb.has(m)) return false;
  return true;
}

export interface KeymapHandler { modifiers: string[]; key: string | RegExp; func(event: KeyboardEvent): unknown; shiftStrict?: boolean; }
export interface KeymapScope { parent: KeymapScope | null; handlers: KeymapHandler[]; }

export class Keymap {
  declare app: App;
  declare scopes: KeymapScope[];
  declare globalScope: KeymapScope;

  constructor(app: App) {
    this.app = app;
    this.scopes = [];
    this.globalScope = { parent: null, handlers: [] };
    this.scopes.push(this.globalScope);
  }
  pushScope(scope: KeymapScope) { this.scopes.push(scope); }
  popScope(scope: KeymapScope) {
    const i = this.scopes.lastIndexOf(scope);
    if (i >= 0) this.scopes.splice(i, 1);
  }
  createScope(parent?: KeymapScope) {
    const scope: KeymapScope = { parent: parent || (this.scopes.length ? this.scopes[this.scopes.length - 1] : this.globalScope), handlers: [] };
    return scope;
  }
  register(scope: KeymapScope, modifiers: string[], key: string | RegExp, func: (event: KeyboardEvent) => unknown) {
    const handler = { modifiers, key, func };
    scope.handlers.push(handler);
    return handler;
  }
  handleKey(ev: KeyboardEvent) {
    // walk scopes from most recent to oldest
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (this._handleScope(scope, ev)) return true;
    }
    if (this._handleScope(this.globalScope, ev)) return true;
    return false;
  }
  _handleScope(scope: KeymapScope, ev: KeyboardEvent) {
    let s: KeymapScope | null = scope;
    while (s) {
      for (const handler of [...s.handlers].reverse()) {
        if (this._matches(handler, ev)) {
          const result = handler.func(ev);
          if (result !== false) {
            ev.preventDefault();
            ev.stopPropagation();
            return true;
          }
        }
      }
      s = s.parent;
    }
    return false;
  }
  _matches(handler: KeymapHandler, ev: KeyboardEvent) {
    let key = handler.key;
    if (typeof key === 'string') {
      if (key.toLowerCase() !== (ev.key || '').toLowerCase()) return false;
    } else if (key instanceof RegExp) {
      if (!key.test(ev.key)) return false;
    }
    const mods = handler.modifiers || [];
    if (mods.includes('Mod') ? !(IS_MAC ? ev.metaKey : ev.ctrlKey) : false) return false;
    const expected: Record<string, boolean> = {
      Mod: IS_MAC ? ev.metaKey : ev.ctrlKey,
      Shift: ev.shiftKey,
      Alt: ev.altKey,
      Ctrl: IS_MAC ? ev.ctrlKey : false,
      Meta: IS_MAC ? false : ev.metaKey,
    };
    for (const m of mods) {
      if (!expected[m]) return false;
      expected[m] = expected[m];
    }
    // ensure no extra modifiers beyond those declared (except shift handled through key case for letters)
    if (!mods.includes('Shift') && ev.shiftKey && handler.shiftStrict !== false) {
      // allow shifted letters matching plain hotkey? Obsidian is strict
      const keyIsLetter = typeof handler.key === 'string' && /^[a-zA-Z]$/.test(handler.key);
      if (!keyIsLetter || ev.key === ev.key.toUpperCase()) return false;
    }
    if (!mods.includes('Alt') && ev.altKey) return false;
    if (!mods.includes('Mod') && !mods.includes('Meta') && !mods.includes('Ctrl')) {
      if (IS_MAC ? ev.metaKey : ev.ctrlKey) return false;
    }
    if (mods.includes('Mod') && !mods.includes('Meta') && !IS_MAC && ev.metaKey) return false;
    return true;
  }
}

export class HotkeyManager extends Events<{ changed: [] }> {
  declare app: App;
  declare customKeys: Record<string, string>;

  constructor(app: App) {
    super();
    this.app = app;
    this.customKeys = {}; // hotkeyString -> commandId
    this.buildCustomKeys();
  }

  buildCustomKeys() {
    this.customKeys = {};
    const settings = this.app.settings;
    // custom overrides first
    for (const [commandId, hotkeys] of Object.entries(settings.hotkeys || {})) {
      if (!Array.isArray(hotkeys)) continue;
      for (const hk of hotkeys) {
        this.customKeys[canonical(hk)] = commandId;
      }
    }
    // defaults not overridden
    for (const [commandId, hotkeys] of Object.entries(DEFAULT_HOTKEYS)) {
      if (settings.hotkeys && commandId in settings.hotkeys) continue;
      for (const hk of hotkeys) {
        const canon = canonical(hk);
        if (!this.customKeys[canon]) this.customKeys[canon] = commandId;
      }
    }
    this.trigger('changed');
  }

  getHotkeys(commandId: string): HotkeyBinding[] {
    const settings = this.app.settings;
    if (settings.hotkeys && commandId in settings.hotkeys) {
      const hks = settings.hotkeys[commandId];
      return Array.isArray(hks) ? hks : [];
    }
    return DEFAULT_HOTKEYS[commandId] || [];
  }

  // called from a global keydown handler
  handleKeydown(ev: KeyboardEvent) {
    // skip when a modal input handles keys? Commands still work (Obsidian runs global)
    const hk = eventToHotkey(ev);
    if (!hk) return false;
    const canon = canonical(hk);
    const commandId = this.customKeys[canon];
    if (!commandId) return false;
    // editor-level commands shouldn't fire when focus is outside editor? Obsidian fires them anyway
    if (commandId.startsWith('editor:') && !isInEditor()) {
      // still allow save-file etc.
      if (commandId !== 'editor:save-file') return false;
    }
    if (commandId === 'editor:open-search' && !isInEditor()) {
      // in preview mode, fallthrough to browser find? Obsidian opens its own search
    }
    const command = this.app.commands.findCommand(commandId);
    if (!command) return false;
    const handled = this.app.commands.executeCommandById(commandId, ev);
    return !!handled;
  }

  printHotkeyForCommand(commandId: string) {
    const hks = this.getHotkeys(commandId);
    if (!hks.length) return '';
    return hotkeyToString(hks[0]);
  }
}

function isInEditor() {
  const el = document.activeElement;
  return !!(el && (el.closest('.cm-editor') || el.closest('.markdown-source-view') || el.closest('input, textarea')));
}

function canonical(hk: HotkeyBinding) {
  const mods = new Set((hk.modifiers || []).map((m) => m === 'Ctrl' && IS_MAC ? 'Ctrl' : m));
  const order = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
  const sorted = order.filter((m) => mods.has(m));
  return sorted.join('+') + ':' + (hk.key || '').toLowerCase();
}

export { IS_MAC };
