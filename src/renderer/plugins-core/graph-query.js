/**
 * [INPUT]: 依赖文件名、路径、正文与标签字段，不访问文件系统。
 * [OUTPUT]: 导出 GraphQuery；支持取反、引号及 file/path/tag/content 条件。
 * [POS]: 图谱筛选与颜色组共用的字段匹配器；由引擎提供元数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const QUERY_TERM_RE = /(-)?(?:(file|path|tag|content):)?("([^"]*)"|\S+)/g;

function parseTerms(query) {
  const terms = [];
  QUERY_TERM_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_TERM_RE.exec(query))) {
    const value = m[4] !== undefined ? m[4] : m[3];
    if (!value) continue;
    terms.push({ negated: !!m[1], type: m[2] || '', value });
  }
  return terms;
}

function textMatches(text, needle) {
  if (!text) return false;
  return text.toLowerCase().includes(needle.toLowerCase());
}

function tagMatches(tag, needle) {
  const full = needle.startsWith('#') ? needle : '#' + needle;
  const lower = tag.toLowerCase();
  const target = full.toLowerCase();
  return lower === target || lower.startsWith(target + '/');
}

/* 单条检索式对某个字段集的匹配；字段不存在（如附件没有 content）视为不匹配 */
function termMatches(term, fields) {
  switch (term.type) {
    case 'tag':
      return (fields.tags || []).some((tag) => tagMatches(tag, term.value));
    case 'file':
      return fields.filename !== undefined && textMatches(fields.filename, term.value);
    case 'path':
      return fields.filepath !== undefined && textMatches(fields.filepath, term.value);
    case 'content':
      return fields.content !== undefined && textMatches(fields.content, term.value);
    default:
      // 原版：无前缀的文本在文档可用字段（md 为 filename + content）中任一命中即可
      return (fields.filename !== undefined && textMatches(fields.filename, term.value))
        || (fields.content !== undefined && textMatches(fields.content, term.value));
  }
}

export class GraphQuery {
  constructor(query) {
    this.query = query;
    this.terms = parseTerms(query);
    /* 原版：解析不出匹配式时 matcher 为 null，该检索式不参与过滤 */
    this.matcher = this.terms.length ? this : null;
  }
  /* 原版 NH.match(file, content)：非 md 只有文件名可匹配 */
  match(file, content, tags = []) {
    const fields = {
      filename: file.name,
      filepath: file.path,
      content: file.extension === 'md' ? (content || '') : undefined,
      tags,
    };
    return this._every((term) => termMatches(term, fields));
  }
  matchTag(tag) {
    return this._every((term) => termMatches(term, { tags: [tag] }));
  }
  matchFilepath(path) {
    const base = path.split('/').pop();
    return this._every((term) => termMatches(term, { filename: base, filepath: path }));
  }
  _every(fn) {
    for (const term of this.terms) {
      const hit = fn(term);
      if (term.negated ? hit : !hit) return false;
    }
    return true;
  }
}
