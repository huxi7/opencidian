/**
 * [INPUT]: CodeMirror 6、Bases 编译器、现有语义高亮与属性及公式函数清单。
 * [OUTPUT]: 导出 mountBasesFormulaEditor 与 basesFormulaCompletions，含补全、撤销、语法状态和销毁。
 * [POS]: 筛选公式的编辑边界。编辑文本由调用者保存，不执行任意 JavaScript。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { EditorState, StateField } from '@codemirror/state';
import { EditorView, keymap, placeholder, showTooltip } from '@codemirror/view';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { codeHighlighter } from '../markdown/highlight.js';
import { compileExpression } from './bases-expression.js';
import { baseFormulaDocs } from './bases-ui-functions.js';
const GLOBALS = ['now', 'today', 'date', 'if', 'min', 'max', 'random', 'list', 'link', 'number', 'duration', 'image', 'icon', 'file', 'html', 'escapeHTML', 'markdown'];
const METHODS = ['toString', 'isTruthy', 'isType', 'isEmpty', 'startsWith', 'endsWith', 'trim', 'title', 'replace', 'lower', 'upper', 'reverse', 'split', 'contains', 'containsAny', 'containsAll', 'slice', 'repeat', 'abs', 'floor', 'ceil', 'round', 'toFixed', 'earliest', 'latest', 'median', 'mean', 'min', 'max', 'sum', 'stddev', 'join', 'flat', 'unique', 'sort', 'keys', 'values', 'matches', 'format', 'date', 'time', 'relative', 'asLink', 'hasLink', 'inFolder', 'hasTag', 'hasProperty', 'asFile', 'linksTo', 'map', 'filter', 'reduce'];
const FILE_PROPERTIES = ['name', 'basename', 'fullname', 'path', 'folder', 'ext', 'size', 'ctime', 'mtime', 'tags', 'links', 'backlinks', 'properties'];
const formulaLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:\\.|[^"\\])*"/) || stream.match(/^'(?:\\.|[^'\\])*'/)) return 'string';
    if (stream.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false|null)\b/i)) return 'keyword';
    if (stream.match(/^[\p{L}_$][\p{L}\p{N}_$]*(?=\s*\()/u)) return 'variableName.function';
    if (stream.match(/^[\p{L}_$][\p{L}\p{N}_$]*/u)) return 'propertyName';
    if (stream.match(/^[=!<>+*/%&|^-]+/)) return 'operator';
    stream.next(); return 'punctuation';
  },
});
function docElement(doc, entries) {
  const root = doc.createElement('div'); root.className = 'bases-formula-function-info';
  for (const entry of entries) { const signature = doc.createElement('code'); signature.textContent = entry.signature; root.appendChild(signature); const description = doc.createElement('div'); description.textContent = entry.description; root.appendChild(description); }
  return root;
}
function callable(label) {
  const docs = baseFormulaDocs(label);
  return { label, type: 'function', detail: docs[0]?.signature || label + '()', info: docs.length ? () => docElement(globalThis.document, docs) : undefined, apply(view, completion, from, to) {
    const insert = completion.label + '()'; view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - 1 } });
  } };
}
export function basesFormulaCompletions(properties = []) {
  return context => {
    const word = context.matchBefore(/[\p{L}\p{N}_$.[\]]*/u);
    if (!word || !context.explicit && !word.text) return null;
    const token = word.text, dot = token.lastIndexOf('.');
    if (dot >= 0) {
      const prefix = token.slice(0, dot), from = word.from + dot + 1;
      const props = prefix === 'file' ? FILE_PROPERTIES : properties.filter(key => key.startsWith(prefix + '.')).map(key => key.slice(prefix.length + 1));
      return { from, options: [...props.map(label => ({ label, type: 'property' })), ...METHODS.map(callable)], validFor: /^[\p{L}\p{N}_$]*$/u };
    }
    return { from: word.from, options: [
      ...GLOBALS.map(callable), ...['true', 'false', 'null'].map(label => ({ label, type: 'keyword' })),
      ...['file', 'note', 'formula', 'this'].map(label => ({ label, type: 'namespace' })),
      ...properties.map(label => ({ label, type: 'property' })),
    ], validFor: /^[\p{L}\p{N}_$]*$/u };
  };
}
function functionTooltips(state) {
  const cursor = state.selection.main.head, source = state.doc.sliceString(0, cursor);
  const stack = []; let quoted = '', escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === quoted) quoted = ''; continue; }
    if (character === '"' || character === "'") { quoted = character; continue; }
    if (character === '(') { const call = source.slice(0, index).match(/([\w.]+)\s*$/); stack.push(call ? { name: call[1], pos: index } : null); }
    else if (character === ')') stack.pop();
  }
  const current = [...stack].reverse().find(Boolean); if (!current) return [];
  const parts = current.name.split('.'), name = parts.at(-1), type = parts.length === 1 ? 'global' : parts[0] === 'file' && parts.length === 2 ? 'file' : '';
  const docs = baseFormulaDocs(name, type); if (!docs.length) return [];
  let active = 0, depth = 0, quote = '', escape = false;
  for (const character of source.slice(current.pos + 1)) {
    if (quote) { if (escape) escape = false; else if (character === '\\') escape = true; else if (character === quote) quote = ''; continue; }
    if (['"', "'"].includes(character)) { quote = character; continue; }
    if ('([{'.includes(character)) depth++; else if (')]}'.includes(character)) depth--;
    else if (character === ',' && depth === 0) active++;
  }
  const entry = docs[0], params = entry.params || [];
  if (active >= params.length && params.at(-1)?.variadic) active = params.length - 1;
  return [{ pos: current.pos - name.length, above: true, strictSide: true, arrow: true, create(view) {
    const doc = view.dom.ownerDocument, dom = doc.createElement('div'); dom.className = 'cm-tooltip-docstring bases-formula-function-signature';
    dom.appendChild(doc.createTextNode(name + '('));
    params.forEach((parameter, index) => {
      if (index) dom.appendChild(doc.createTextNode(', ')); const span = doc.createElement('span'); span.classList.toggle('active', index === active);
      span.textContent = parameter.name + ': ' + parameter.types.join(' | ') + (parameter.optional ? '?' : '') + (parameter.variadic ? '...' : ''); dom.appendChild(span);
    }); dom.appendChild(doc.createTextNode(')')); return { dom };
  } }];
}
const signatureField = StateField.define({ create: functionTooltips, update: (value, transaction) => transaction.docChanged || transaction.selection ? functionTooltips(transaction.state) : value,
  provide: field => showTooltip.computeN([field], state => state.field(field)),
});
export function mountBasesFormulaEditor(parent, value, options: Record<string, any> = {}) {
  const root = parent.ownerDocument.createElement('div'); root.className = 'formula-editor'; parent.appendChild(root);
  const status = parent.ownerDocument.createElement('div'); status.className = 'formula-editor-status'; status.setAttribute('role', 'status'); parent.appendChild(status);
  const validate = source => { try { compileExpression(source); status.textContent = '✓ 公式有效'; status.classList.remove('mod-error'); } catch (error) { status.textContent = error.message; status.classList.add('mod-error'); } };
  const source = basesFormulaCompletions(options.properties);
  const editor = new EditorView({ parent: root, state: EditorState.create({ doc: String(value), extensions: [
    history(), closeBrackets(), signatureField, formulaLanguage, syntaxHighlighting(codeHighlighter), placeholder('例如：file.inFolder("项目") && score >= 4'),
    autocompletion({ override: [source], activateOnTyping: true, icons: true, defaultKeymap: false }),
    keymap.of([{ key: 'Mod-Space', run: startCompletion }, ...completionKeymap, ...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': '筛选公式' }),
    EditorView.updateListener.of(update => { if (update.docChanged) { const next = update.state.doc.toString(); validate(next); options.onChange?.(next); } }),
    EditorView.theme({ '&': { fontSize: 'var(--font-ui-small)' }, '.cm-scroller': { fontFamily: 'var(--font-monospace)', overflow: 'auto' }, '.cm-content': { padding: '5px 6px', minHeight: '28px' }, '&.cm-focused': { outline: 'none' } }),
  ] }) });
  const api = {
    view: editor, setValue(next) { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: String(next) } }); },
    getValue: () => editor.state.doc.toString(), focus: () => editor.focus(), destroy: () => { editor.destroy(); delete root.basesFormulaEditor; },
    complete: () => startCompletion(editor),
  };
  root.basesFormulaEditor = api; validate(String(value)); return api;
}
