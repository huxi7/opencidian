/* Core plugin: global-search — full text search with query operators. */
import { View } from '../core/view.js';
import { t } from '../core/i18n.js';
import { setIcon } from '../core/icons.js';

export const nameKey = 'plugins.search';

// ---------------------------------------------------------------------------
// Search engine
// ---------------------------------------------------------------------------
function parseQuery(query) {
  const terms = [];
  const re = /(-)?(?:(file|path|tag|content|section|task|line):)?("([^"]*)"|\/((?:[^\\/]|\\.)+?)\/([gimsuy]*)|\S+)/g;
  let m;
  while ((m = re.exec(query))) {
    const negated = !!m[1];
    const type = m[2] || 'content';
    let value, regex = null;
    if (m[5] !== undefined) {
      try { regex = new RegExp(m[5], m[6] || 'g'); } catch (e) { regex = null; }
      value = m[5];
    } else if (m[4] !== undefined) {
      value = m[4];
    } else {
      value = m[3];
    }
    if (value === '') continue;
    terms.push({ negated, type, value, regex, exact: m[4] !== undefined });
  }
  return terms;
}

export function searchFile(text, file, terms, matchCase) {
  let matches = [];
  let fileOk = true;
  let score = 0;
  for (const term of terms) {
    const v = term.value;
    if (term.type === 'file') {
      const ok = matchText(file.basename, v, term, matchCase) || matchText(file.name, v, term, matchCase);
      if (term.negated ? ok : !ok) { fileOk = false; break; }
      score += 1;
      continue;
    }
    if (term.type === 'path') {
      const ok = matchText(file.path, v, term, matchCase);
      if (term.negated ? ok : !ok) { fileOk = false; break; }
      score += 1;
      continue;
    }
    if (term.type === 'tag') {
      const cache = file._cache;
      const needle = v.startsWith('#') ? v : '#' + v;
      const ok = cache && cache.tags && cache.tags.some((x) => x.tag === needle || x.tag.startsWith(needle + '/'));
      if (term.negated ? ok : !ok) { fileOk = false; break; }
      score += 1;
      continue;
    }
    // content terms
    const termMatches = findMatches(text, v, term, matchCase);
    if (term.negated) {
      if (termMatches.length) { fileOk = false; break; }
    } else {
      if (!termMatches.length) { fileOk = false; break; }
      matches.push(...termMatches);
      score += termMatches.length;
    }
  }
  if (!fileOk) return null;
  if (!terms.some((t2) => t2.type === 'content' && !t2.negated)) {
    // only file-level filters matched: show a single placeholder
    return { matches: [{ line: 0, text: '', start: 0, end: 0 }], score };
  }
  if (!matches.length) return null;
  // dedupe by position
  matches = matches.filter((m, i, arr) => i === arr.findIndex((x) => x.line === m.line && x.start === m.start));
  matches.sort((a, b) => a.line - b.line || a.start - b.start);
  return { matches, score };
}

function matchText(text, value, term, matchCase) {
  if (term.regex) {
    const re = new RegExp(term.regex.source, term.regex.flags.replace('g', ''));
    return re.test(text);
  }
  if (matchCase) return text.includes(value);
  return text.toLowerCase().includes(value.toLowerCase());
}

function findMatches(text, value, term, matchCase) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let idx = 0;
    while (idx <= line.length) {
      let found = -1, len = 0;
      if (term.regex) {
        const re = new RegExp(term.regex.source, term.regex.flags.includes('g') ? term.regex.flags : term.regex.flags + 'g');
        re.lastIndex = idx;
        const m = re.exec(line);
        if (m) { found = m.index; len = Math.max(1, m[0].length); }
      } else if (matchCase) {
        found = line.indexOf(value, idx);
        len = value.length;
      } else {
        found = line.toLowerCase().indexOf(value.toLowerCase(), idx);
        len = value.length;
      }
      if (found < 0) break;
      out.push({ line: i, text: line, start: found, end: found + len });
      idx = found + len;
      if (out.length > 500) return out;
    }
  }
  return out;
}

export async function searchVault(app, query, options = {}) {
  const terms = parseQuery(query);
  if (!terms.length) return { results: [], total: 0, count: 0 };
  const files = app.vault.getMarkdownFiles();
  const results = [];
  let total = 0;
  for (const file of files) {
    let text;
    try { text = await app.vault.cachedRead(file); } catch (e) { continue; }
    const cache = app.metadataCache.getFileCache(file);
    file._cache = cache;
    const res = searchFile(text, file, terms, options.matchCase);
    if (res) {
      results.push({ file, matches: res.matches, score: res.score });
      total += res.matches.length;
    }
    if (results.length >= 500) break;
  }
  results.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return { results, total, count: results.length };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export class SearchView extends View {
  constructor(leaf) {
    super(leaf);
    this.icon = 'search';
    this.navigation = true;
    this._query = '';
    this._matchCase = false;
    this._refs = [];
    this._expanded = new Set();
  }
  getViewType() { return 'search'; }
  getDisplayText() { return t('plugins.search.name') || 'Search'; }
  getIcon() { return 'search'; }
  getState() { return { query: this._query }; }
  async setState(state) {
    if (state && state.query !== undefined && state.query !== this._query) {
      this._query = state.query;
      if (this.inputEl) {
        this.inputEl.value = this._query;
        this.runSearch();
      }
    }
  }
  setQuery(q) {
    this._query = q;
    if (this.inputEl) { this.inputEl.value = q; this.runSearch(); }
  }

  async onOpen() {
    this.contentEl.addClass('search-view');
    const container = this.contentEl.createDiv('search-view-container');
    const inputRow = container.createDiv('search-input-container');
    const iconEl = inputRow.createDiv('search-input-icon');
    setIcon(iconEl, 'search');
    this.inputEl = inputRow.createEl('input', { type: 'text', cls: 'search-input' });
    this.inputEl.placeholder = t('plugins.search.prompt-start-search') || 'Search...';
    this.inputEl.value = this._query;
    const clearBtn = inputRow.createDiv('search-input-clear-button');
    setIcon(clearBtn, 'x');
    clearBtn.onclick = () => { this.inputEl.value = ''; this._query = ''; this.runSearch(); };

    const optionsRow = container.createDiv('search-options-row');
    const caseBtn = optionsRow.createDiv('clickable-icon search-option-toggle');
    setIcon(caseBtn, 'a-large-small');
    caseBtn.setAttr('aria-label', t('plugins.search.label-match-case') || 'Match case');
    caseBtn.toggleClass('is-active', this._matchCase);
    caseBtn.onclick = () => { this._matchCase = !this._matchCase; caseBtn.toggleClass('is-active', this._matchCase); this.runSearch(); };
    this.countEl = optionsRow.createDiv('search-result-count');

    this.resultsEl = container.createDiv('search-results-container');

    let debounceTimer = null;
    this.inputEl.oninput = () => {
      this._query = this.inputEl.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.runSearch(), 200);
    };
    this.inputEl.onkeydown = (ev) => {
      if (ev.key === 'Escape') { this.inputEl.value = ''; this._query = ''; this.runSearch(); }
      ev.stopPropagation();
    };

    if (this._query) this.runSearch();
  }
  onClose() {
    for (const r of this._refs) r.unregister && r.unregister();
    this._refs = [];
  }
  focus() { this.inputEl && this.inputEl.focus(); }

  async runSearch() {
    if (!this.resultsEl) return;
    const query = this._query.trim();
    this.resultsEl.empty();
    if (!query) {
      if (this.countEl) this.countEl.setText('');
      return;
    }
    this.resultsEl.createDiv({ cls: 'search-loading', text: 'Searching...' });
    const { results, total } = await searchVault(this.app, query, { matchCase: this._matchCase });
    this.resultsEl.empty();
    if (this.countEl) {
      this.countEl.setText(total === 1 ? '1 result' : `${total} results`);
    }
    if (!results.length) {
      this.resultsEl.createDiv({ cls: 'search-empty', text: 'No matches found.' });
      return;
    }
    for (const result of results.slice(0, 100)) {
      this._renderResult(result, query);
    }
  }

  _renderResult(result, query) {
    const file = result.file;
    const container = this.resultsEl.createDiv('search-result');
    const title = container.createDiv('search-result-file-title');
    const iconEl = title.createDiv('search-result-file-title-icon');
    setIcon(iconEl, 'file-text');
    const nameEl = title.createDiv('search-result-file-title-inner');
    const folder = file.path.split('/').slice(0, -1).join('/');
    if (folder) nameEl.createSpan({ cls: 'search-result-file-folder', text: folder + '/' });
    nameEl.createSpan({ cls: 'search-result-file-name', text: file.basename });
    title.createDiv({ cls: 'search-result-file-flair', text: String(result.matches.length) });
    const matchesEl = container.createDiv('search-result-file-matches');

    const collapsed = !this._expanded.has(file.path);
    matchesEl.toggle(!collapsed);
    title.onclick = () => {
      if (this._expanded.has(file.path)) this._expanded.delete(file.path);
      else this._expanded.add(file.path);
      matchesEl.toggle(this._expanded.has(file.path));
    };

    const show = result.matches.slice(0, 5);
    for (const match of show) {
      if (!match.text) continue;
      const line = matchesEl.createDiv('search-result-file-match');
      const text = line.createDiv('search-result-file-match-content');
      text.setText(match.text.slice(0, 400));
      const mStart = Math.min(match.start, 400), mEnd = Math.min(match.end, 400);
      text.empty();
      text.appendText(match.text.slice(0, mStart));
      text.createSpan({ cls: 'search-result-file-matched-text', text: match.text.slice(mStart, mEnd) });
      text.appendText(match.text.slice(mEnd, 400));
      line.onclick = () => {
        this.app.workspace.openFile(file, { eState: { line: match.line, ch: match.start } });
      };
    }
    if (result.matches.length > 5) {
      const more = matchesEl.createDiv({ cls: 'search-result-more', text: `+ ${result.matches.length - 5} more` });
      more.onclick = () => {
        this._expanded.add(file.path);
        this.renderAllMatches(matchesEl, result);
        more.detach();
      };
    }
  }

  renderAllMatches(matchesEl, result) {
    // re-render all matches (used by "show more")
    matchesEl.empty();
    for (const match of result.matches) {
      if (!match.text) continue;
      const line = matchesEl.createDiv('search-result-file-match');
      line.setText(match.text.slice(0, 400));
      line.onclick = () => this.app.workspace.openFile(result.file, { eState: { line: match.line, ch: match.start } });
    }
  }
}

export function create(app) {
  return {
    onload() {
      app.viewRegistry.registerView('search', (leaf) => new SearchView(leaf));
      app.commands.addCommand({
        id: 'global-search:open',
        name: t('plugins.search.action-open-search') || 'Search in all files',
        icon: 'search',
        callback: () => {
          const leaf = app.workspace.getLeavesOfType('search')[0];
          const open = (l) => { app.workspace.revealLeaf(l); l.view.focus && l.view.focus(); };
          if (leaf) open(leaf);
          else app.workspace.ensureSideLeaf('search', 'left', { reveal: true }).then(open);
        },
      });
    },
    onunload() { app.viewRegistry.unregisterView('search'); },
    deregister(app) { app.viewRegistry.unregisterView('search'); },
  };
}
