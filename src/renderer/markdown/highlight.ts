/**
 * [INPUT]: 依赖 CM6 已安装语言目录与 Lezer 标签、语法树高亮。
 * [OUTPUT]: 导出 codeHighlighter、codeLanguageName、highlightCodeElement、highlightCodeBlocks、cancelCodeHighlight。
 * [POS]: markdown/ 的代码高亮入口。阅读与实时预览共用解析器缓存和 token 类。
 *        普通变量名不产出 token，对齐原版 Prism JS（`const a` 的 a 保持正文色）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { LanguageDescription, type Language } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';

// ---- Lezer 语义映射到原版 token 类；颜色由 CSS 变量决定 ----------------------
export const codeHighlighter = tagHighlighter([
  { tag: [tags.comment, tags.meta], class: 'token comment' },
  { tag: tags.keyword, class: 'token keyword' },
  { tag: tags.string, class: 'token string' },
  { tag: tags.regexp, class: 'token regex' },
  { tag: tags.escape, class: 'token important' },
  { tag: tags.number, class: 'token number' },
  { tag: tags.bool, class: 'token boolean' },
  { tag: tags.atom, class: 'token constant' },
  { tag: tags.propertyName, class: 'token property' },
  { tag: tags.attributeName, class: 'token attr-name' },
  { tag: tags.attributeValue, class: 'token attr-value' },
  { tag: tags.tagName, class: 'token tag' },
  { tag: [tags.className, tags.typeName], class: 'token class-name' },
  { tag: tags.namespace, class: 'token namespace' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'token function' },
  { tag: [tags.standard(tags.variableName), tags.standard(tags.typeName)], class: 'token builtin' },
  { tag: tags.operator, class: 'token operator' },
  { tag: tags.punctuation, class: 'token punctuation' },
  { tag: tags.invalid, class: 'token important' },
]);

const pendingLanguages = new WeakMap<LanguageDescription, Promise<Language | null>>();
const pendingElements = new WeakMap<HTMLElement, object>();
const plainLanguages = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'none', 'mermaid']);

export function codeLanguageName(info = '') {
  const name = String(info).trim().split(/\s+/)[0].toLowerCase();
  return /^[\w.+#-]+$/.test(name) ? name : '';
}

async function loadLanguage(name: string) {
  if (plainLanguages.has(name)) return null;
  const description = LanguageDescription.matchLanguageName(languages, name, false) ||
    LanguageDescription.matchFilename(languages, 'code.' + name);
  if (!description) return null;
  if (!pendingLanguages.has(description)) {
    pendingLanguages.set(description, description.load().then(support => support.language).catch(() => null));
  }
  return pendingLanguages.get(description);
}

export function cancelCodeHighlight(element: HTMLElement | null) {
  if (element) pendingElements.delete(element);
}

export async function highlightCodeElement(element: HTMLElement, info = element.dataset.lang || '') {
  const source = element.textContent || '';
  const request = {};
  pendingElements.set(element, request);
  const name = codeLanguageName(info);
  const language = await loadLanguage(name);
  if (pendingElements.get(element) !== request || element.textContent !== source) return false;
  try {
    if (language) {
      const fragment = element.ownerDocument.createDocumentFragment();
      let position = 0;
      highlightTree(language.parser.parse(source), codeHighlighter, (from, to, classes) => {
        if (from > position) fragment.append(source.slice(position, from));
        const span = element.ownerDocument.createElement('span');
        span.className = classes;
        span.textContent = source.slice(from, to);
        fragment.append(span);
        position = to;
      });
      if (position < source.length) fragment.append(source.slice(position));
      element.replaceChildren(fragment);
    }
    element.classList.add('is-loaded');
    element.dataset.highlighted = language ? 'true' : 'false';
    return !!language;
  } catch {
    element.textContent = source;
    element.classList.add('is-loaded');
    element.dataset.highlighted = 'false';
    return false;
  } finally {
    if (pendingElements.get(element) === request) pendingElements.delete(element);
  }
}

export function highlightCodeBlocks(container: HTMLElement) {
  return Promise.all(Array.from(container.querySelectorAll<HTMLElement>('pre > code:not(.is-loaded)'), element => {
    const language = element.dataset.lang || Array.from(element.classList).find(name => name.startsWith('language-'))?.slice(9) || '';
    return highlightCodeElement(element, language);
  }));
}
