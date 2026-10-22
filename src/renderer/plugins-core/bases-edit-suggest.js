/**
 * [INPUT]: 库内同名属性值、标签、文件与文件夹；单元格输入框和属性类型。
 * [OUTPUT]: 导出候选查询、值替换与候选浮层；支持方向键、Enter、Tab、Escape 和指针选择。
 * [POS]: Bases 属性候选边界。沿用 mod-property-value 结构，只建议真实库数据，选择后交给编辑器落盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ownKey } from './bases-values.js';
const multiple = info => ['multitext', 'tags', 'aliases'].includes(info.type);
function listInput(text) {
  try { const value = JSON.parse(text); if (Array.isArray(value)) return value; } catch {}
  return null;
}
function queryInfo(info, text) {
  const list = multiple(info) ? listInput(text) : null;
  const query = list ? '' : text.trim();
  return { query, existing: list || [], link: query.startsWith('[['), tags: info.type === 'tags' };
}
const score = (text, query) => {
  text = text.toLocaleLowerCase(); query = query.toLocaleLowerCase();
  if (!query) return 0;
  if (text.startsWith(query)) return 100 - (text.length - query.length) / 1000;
  const index = text.indexOf(query);
  if (index >= 0) return 50 - index;
  let position = 0;
  for (const letter of query) { position = text.indexOf(letter, position); if (position < 0) return -Infinity; position++; }
  return 1;
};
export function collectBaseSuggestions(app, info, text) {
  if (!info.folder && !['text', 'multitext', 'aliases', 'tags'].includes(info.type)) return [];
  const state = queryInfo(info, text), values = new Map();
  const add = (value, kind = 'text', note = '') => {
    if (typeof value !== 'string' || !value.trim()) return;
    const identity = info.type === 'tags' ? value.replace(/^#/, '') : value;
    if (state.existing.some(item => String(item).replace(info.type === 'tags' ? /^#/ : /^$/, '') === identity)) return;
    if (!values.has(identity)) values.set(identity, { value: identity, title: info.type === 'tags' ? '#' + identity : identity, kind, note });
  };
  if (info.folder) {
    const root = app.vault.getRoot?.();
    const visit = folder => { if (!folder || !Array.isArray(folder.children)) return; add(folder.path || '/', 'folder'); for (const child of folder.children) if (Array.isArray(child.children)) visit(child); };
    visit(root);
  } else if (state.link && state.query.includes('#')) {
    const target = state.query.slice(2).replace(/\]\]$/, '').split('|')[0], hash = target.indexOf('#'), linktext = target.slice(0, hash);
    const resolved = linktext ? app.metadataCache.getFirstLinkpathDest?.(linktext, info.sourcePath || '') : app.vault.getFileByPath?.(info.sourcePath || '');
    const file = typeof resolved === 'string' ? app.vault.getFileByPath?.(resolved) : resolved;
    if (file) {
      const cache = app.metadataCache.getFileCache(file) || {};
      const path = linktext ? file.path.replace(/\.md$/i, '') : '';
      if (target.slice(hash + 1).startsWith('^')) for (const id of Object.keys(cache.blocks || {})) add('[[' + path + '#^' + id + ']]', 'block', file.path);
      else for (const heading of cache.headings || []) add('[[' + path + '#' + heading.heading + ']]', 'heading', file.path);
    }
  } else if (state.link) {
    for (const file of app.vault.getFiles?.() || app.vault.getMarkdownFiles()) {
      const link = file.extension === 'md' ? file.path.replace(/\.md$/i, '') : file.path;
      add('[[' + link + ']]', 'file', file.path);
      const fm = app.metadataCache.getFileCache(file)?.frontmatter || {}, aliases = fm[ownKey(fm, 'aliases')];
      for (const alias of Array.isArray(aliases) ? aliases : typeof aliases === 'string' ? [aliases] : []) if (typeof alias === 'string') add('[[' + link + '|' + alias + ']]', 'file', file.path);
    }
  } else {
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter || {}, value = fm[ownKey(fm, info.name)];
      for (const entry of Array.isArray(value) ? value : [value]) add(entry, state.tags ? 'tag' : 'text');
    }
    if (state.tags) for (const tag of Object.keys(app.metadataCache.getTags?.() || {})) add(tag, 'tag');
  }
  const query = state.link ? state.query.slice(2).replace(/\]\]$/, '') : state.tags ? state.query.replace(/^#/, '') : state.query;
  return [...values.values()].map(candidate => ({ ...candidate, score: score(state.link ? (query.includes('#') ? candidate.value.slice(candidate.value.indexOf('#') + 1, -2) : candidate.value.slice(2, -2)) : candidate.title.replace(state.tags ? /^#/ : /^$/, ''), state.link && query.includes('#') ? query.slice(query.indexOf('#') + 1) : query) }))
    .filter(candidate => Number.isFinite(candidate.score)).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, undefined, { numeric: true })).slice(0, 100);
}
export function applyBaseSuggestion(info, text, candidate) {
  if (!multiple(info)) return candidate.value;
  const existing = listInput(text) || [];
  return JSON.stringify([...existing, candidate.value]);
}
let nextId = 0;
export function attachBaseSuggestions(controller, input, info, onAccept) {
  const doc = input.ownerDocument, win = doc.defaultView;
  const abort = new AbortController(), options = { signal: abort.signal };
  let panel = null, candidates = [], index = -1, lastQuery = null, dismissed = false;
  const close = () => { panel?.remove(); panel = null; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); input.removeAttribute('aria-controls'); };
  const api = { close, destroy() { abort.abort(); close(); controller.editCleanups?.delete(api.destroy); }, get candidates() { return candidates; }, get selected() { return index; }, handleKey };
  (controller.editCleanups ||= new Set()).add(api.destroy);
  input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  function position() {
    if (!panel || !input.isConnected) { close(); return; }
    const rect = input.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 240), win.innerWidth - 16);
    panel.style.cssText = `position:fixed;z-index:1000;width:${width}px;left:${Math.max(8, Math.min(rect.left, win.innerWidth - width - 8))}px;top:${Math.min(rect.bottom + 4, win.innerHeight - Math.min(panel.scrollHeight, 260) - 8)}px;max-height:260px;overflow:auto;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:var(--radius-m);box-shadow:var(--shadow-s);padding:4px`;
  }
  function select(selected) {
    index = selected;
    panel?.querySelectorAll('.suggestion-item').forEach((row, position) => { row.classList.toggle('is-selected', position === index); row.setAttribute('aria-selected', String(position === index)); if (position === index) input.setAttribute('aria-activedescendant', row.id); });
    if (index < 0) input.removeAttribute('aria-activedescendant');
    panel?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }
  function accept(selected) {
    const candidate = candidates[selected]; if (!candidate) return false;
    const next = applyBaseSuggestion(info, input.value, candidate); close(); input.value = next; onAccept(next, candidate); return true;
  }
  function update() {
    if (dismissed || input.disabled) return;
    candidates = collectBaseSuggestions(controller.app, info, input.value); lastQuery = input.value;
    close(); index = -1;
    if (!candidates.length) return;
    panel = doc.createElement('div'); panel.className = 'suggestion-container mod-property-value bases-cell-suggestions'; panel.dataset.propertyKey = (info.name || info.property).toLowerCase(); panel.id = 'bases-property-suggest-' + (++nextId); panel.setAttribute('role', 'listbox');
    const list = doc.createElement('div'); list.className = 'suggestion'; panel.appendChild(list);
    for (const [position, candidate] of candidates.entries()) {
      const row = doc.createElement('div'); row.className = 'suggestion-item ' + (['file', 'heading', 'block'].includes(candidate.kind) ? 'mod-complex' : 'mod-nowrap'); row.id = panel.id + '-' + position; row.setAttribute('role', 'option'); row.dataset.value = candidate.value;
      const content = doc.createElement('div'); content.className = 'suggestion-content'; row.appendChild(content);
      const title = doc.createElement('div'); title.className = 'suggestion-title'; title.textContent = candidate.title; content.appendChild(title);
      if (candidate.note) { const note = doc.createElement('div'); note.className = 'suggestion-note'; note.textContent = candidate.note; content.appendChild(note); }
      row.addEventListener('pointerdown', event => { event.preventDefault(); accept(position); }, options);
      row.addEventListener('mousemove', () => select(position), options); list.appendChild(row);
    }
    const instructions = doc.createElement('div'); instructions.className = 'prompt-instructions'; instructions.textContent = '↑↓ 选择　Tab / Enter 确认　Esc 关闭'; panel.appendChild(instructions);
    doc.body.appendChild(panel); input.setAttribute('aria-controls', panel.id); input.setAttribute('aria-expanded', 'true'); position();
    if (input.value && !input.value.startsWith('[[') && !input.value.startsWith('#') && !listInput(input.value)) select(0);
  }
  function handleKey(event) {
    if (event.isComposing) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!panel) { dismissed = false; update(); }
      if (!panel) return false;
      event.preventDefault(); event.stopImmediatePropagation(); select(index < 0 ? (event.key === 'ArrowDown' ? 0 : candidates.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length); return true;
    }
    if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopImmediatePropagation(); dismissed = true; close(); return true; }
    if (!event.shiftKey && (event.key === 'Enter' || event.key === 'Tab') && panel && index >= 0 && input.value === lastQuery) { event.preventDefault(); event.stopImmediatePropagation(); return accept(index); }
    return false;
  }
  input.addEventListener('input', () => { dismissed = false; update(); }, options);
  input.addEventListener('focus', () => { dismissed = false; update(); }, options);
  input.addEventListener('blur', close, options);
  doc.addEventListener('pointerdown', event => { if (event.target !== input && !panel?.contains(event.target)) close(); }, options);
  win.addEventListener('resize', position, options); win.addEventListener('scroll', position, { capture: true, ...options });
  return api;
}
