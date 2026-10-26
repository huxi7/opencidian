/**
 * [INPUT]: 依赖 CM6 折叠状态、Markdown 语法树与缩进列计算。
 * [OUTPUT]: 导出 markdownEditing、foldingExtensions、unfoldDisabledFolds、foldSelectionStep。
 * [POS]: editor/ 的折叠策略。设置约束所有折叠入口；选区按内到外折叠、外到内展开，一次一层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { countColumn, Prec, EditorState, type Text, type Line, type StateEffect, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import {
  foldService, foldNodeProp, foldGutter, foldKeymap, foldedRanges, unfoldEffect, foldEffect,
  syntaxTree, foldable,
} from '@codemirror/language';
import { markdown, markdownLanguage, pasteURLAsLink } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

// ---- 语言装配：去掉 Markdown 内置的无条件标题与块折叠 -----------------------
const support = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
  addKeymap: false,
  extensions: { props: [foldNodeProp.add(() => () => null)] },
});
export const markdownEditing = [support.language, pasteURLAsLink];

interface FoldRange { from: number; to: number; }
interface Heading { line: Line; level: number; }
interface Indent { line: Line; indent: number; }
interface FoldRanges { headings: Map<number, FoldRange>; indents: Map<number, FoldRange>; frontmatter: FoldRange | null; tabSize: number; }
const documentRanges = new WeakMap<Text, FoldRanges>();

function collectRanges(state: EditorState): FoldRanges {
  const cached = documentRanges.get(state.doc);
  if (cached && cached.tabSize === state.tabSize) return cached;
  const doc = state.doc;
  const headings = new Map<number, FoldRange>(), indents = new Map<number, FoldRange>();
  let frontmatter: FoldRange | null = null;
  if (doc.line(1).text.trim() === '---') {
    for (let n = 2; n <= doc.lines; n++) {
      if (/^(?:---|\.\.\.)\s*$/.test(doc.line(n).text)) {
        frontmatter = { from: doc.line(1).to, to: doc.line(n).to };
        break;
      }
    }
  }

  // CM6 可只解析视口；首次折叠仍须找到文档尾部的同级标题。
  const currentTree = syntaxTree(state);
  const tree = currentTree.length === doc.length ? currentTree : markdownLanguage.parser.parse(doc.toString());
  const headers: Heading[] = [];
  tree.iterate({
    enter(node) {
      if (/^(FencedCode|CodeBlock|HTMLBlock|Blockquote|ListItem)$/.test(node.name)) return false;
      const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match || (frontmatter && node.from <= frontmatter.to)) return;
      headers.push({ line: doc.lineAt(node.from), level: Number(match[1]) });
      return false;
    },
  });
  const openHeadings: Heading[] = [];
  const finishHeading = (header: Heading, to: number) => {
    if (to > header.line.to) headings.set(header.line.from, { from: header.line.to, to });
  };
  for (const header of headers) {
    while (openHeadings.length && openHeadings[openHeadings.length - 1].level >= header.level) {
      finishHeading(openHeadings.pop()!, doc.line(header.line.number - 1).to);
    }
    openHeadings.push(header);
  }
  for (const header of openHeadings) finishHeading(header, doc.length);

  // 空行不改变缩进层级；Tab 按当前 tabSize 展开为列。
  const parents: Indent[] = [];
  let lastContent: Line | null = null;
  const finishIndent = (parent: Indent) => {
    if (lastContent && lastContent.number > parent.line.number) {
      indents.set(parent.line.from, { from: parent.line.to, to: lastContent.to });
    }
  };
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n), first = line.text.search(/\S/);
    if (first < 0) continue;
    const indent = countColumn(line.text.slice(0, first), state.tabSize);
    while (parents.length && parents[parents.length - 1].indent >= indent) finishIndent(parents.pop()!);
    parents.push({ line, indent });
    lastContent = line;
  }
  while (parents.length) finishIndent(parents.pop()!);
  const result = { headings, indents, frontmatter, tabSize: state.tabSize };
  documentRanges.set(doc, result);
  return result;
}

function rangeFor(state: EditorState, start: number, heading: boolean, indent: boolean): FoldRange | null {
  if (!heading && !indent) return null;
  const ranges = collectRanges(state);
  return (heading && ranges.headings.get(start)) || (indent && ranges.indents.get(start)) ||
    (start === 0 && ranges.frontmatter) || null;
}

function foldMarker(open: boolean) {
  const marker = document.createElement('span');
  marker.className = 'collapse-indicator' + (open ? '' : ' is-collapsed');
  marker.textContent = open ? '⌄' : '›';
  marker.setAttribute('aria-label', open ? '折叠' : '展开');
  return marker;
}

export function foldingExtensions(heading: boolean, indent: boolean) {
  const extensions: Extension[] = [
    Prec.high(foldService.of((state, start) => rangeFor(state, start, heading, indent))),
    EditorState.transactionFilter.of(transaction => {
      const effects = transaction.effects.filter(effect => {
        if (!effect.is(foldEffect)) return true;
        const line = transaction.newDoc.lineAt(effect.value.from);
        const allowed = rangeFor(transaction.state, line.from, heading, indent);
        return allowed && allowed.from === effect.value.from && allowed.to === effect.value.to;
      });
      if (effects.length === transaction.effects.length) return transaction;
      return { changes: transaction.changes, selection: transaction.selection,
        effects, annotations: (transaction as typeof transaction & { annotations: readonly import('@codemirror/state').Annotation<unknown>[] }).annotations, scrollIntoView: transaction.scrollIntoView };
    }),
  ];
  if (heading || indent) {
    extensions.push(keymap.of(foldKeymap), foldGutter({ markerDOM: foldMarker }));
  }
  return extensions;
}

export function unfoldDisabledFolds(state: EditorState, heading: boolean, indent: boolean) {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const range = rangeFor(state, state.doc.lineAt(from).from, heading, indent);
    if (!range || range.from !== from || range.to !== to) effects.push(unfoldEffect.of({ from, to }));
  });
  return effects;
}

/** 原版foldMore/foldLess：每个选区只改变与其相交的一层，不触碰其他分支。 */
export function foldSelectionStep(view: EditorView, collapse: boolean) {
  const { state } = view;
  const ranges: FoldRange[] = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const range = foldable(state, line.from, line.to);
    if (range) ranges.push(range);
  }
  const folded = new Set<number>();
  foldedRanges(state).between(0, state.doc.length, from => { folded.add(from); });
  const changes = new Map<number, FoldRange>();
  for (const selection of state.selection.ranges) {
    const to = state.doc.lineAt(selection.to).to;
    const candidates = ranges.filter(range => selection.from <= range.to && to >= range.from);
    if (collapse) candidates.reverse();
    const range = candidates.find(item => folded.has(item.from) !== collapse);
    if (range) changes.set(range.from, range);
  }
  if (!changes.size) return false;
  const effect = collapse ? foldEffect : unfoldEffect;
  view.dispatch({ effects: [...changes.values()].map(range => effect.of(range)) });
  return true;
}
