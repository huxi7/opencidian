/**
 * [INPUT]: search-query-parse.js 的 parseQuery/queryInfo；search-query-match.js 的
 *          createSearchDocument/searchDocument/canvasNodeText/searchFile/searchVault。
 * [OUTPUT]: 统一出口：parseQuery、queryInfo、createSearchDocument、searchDocument、canvasNodeText、
 *           searchFile、searchVault。
 * [POS]: global-search 查询内核的门面。语法在 search-query-parse.js，匹配在 search-query-match.js；
 *        本文件只做再导出，调用方按需直接引用两半亦可。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export { parseQuery, queryInfo } from './search-query-parse.js';
export { createSearchDocument, searchDocument, canvasNodeText, searchFile, searchVault } from './search-query-match.js';
