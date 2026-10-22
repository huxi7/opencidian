/**
 * [INPUT]: 页面 Document 与已有主题 CSS 变量。
 * [OUTPUT]: 导出 installBasesStyles，按文档安装一次数据库样式。
 * [POS]: Bases 的局部样式。文件视图和笔记嵌入共用类名与主题变量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function installBasesStyles(doc) {
  if (doc.getElementById('opensidian-bases-style')) return;
  const style = doc.createElement('style'); style.id = 'opensidian-bases-style';
  style.textContent = `
.bases-embed { min-width:0; overflow:auto; color:var(--text-normal); }
.bases-header { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:8px; border-bottom:1px solid var(--background-modifier-border); }
.bases-view-name { font-weight:var(--font-semibold,600); margin-right:auto; }
.bases-limit { display:flex; align-items:center; gap:6px; font-size:var(--font-ui-small); color:var(--text-muted); }
.bases-limit input { width:70px; }
.bases-table-container { overflow:auto; width:100%; }
.bases-table { width:100%; border-collapse:collapse; font-size:var(--font-ui-small); }
.bases-table .bases-td { min-width:110px; border:1px solid var(--background-modifier-border); padding:0; text-align:left; vertical-align:top; }
.bases-table .bases-thead { background:var(--background-secondary); }
.bases-table-header { width:100%; border:0!important; border-radius:0; box-shadow:none!important; text-align:left; justify-content:flex-start; background:transparent!important; padding:8px!important; }
.bases-rendered-value { display:block; padding:7px 8px; min-height:30px; white-space:pre-wrap; overflow-wrap:anywhere; }
.bases-warning { color:var(--text-warning); font-size:var(--font-ui-small); padding:8px; }
.bases-empty,.bases-results-count { padding:8px; color:var(--text-muted); font-size:var(--font-ui-small); }
.bases-filter-editor { display:flex; flex-direction:column; gap:8px; padding:12px; border-bottom:1px solid var(--background-modifier-border); }
.bases-filter-editor textarea { min-height:100px; font-family:var(--font-monospace); resize:vertical; }
.bases-filter-error { color:var(--text-error); }
.markdown-preview-view .bases-embed,.cm-content .bases-embed { border:1px solid var(--background-modifier-border); border-radius:var(--radius-s); margin:12px 0; }
`;
  doc.head.appendChild(style);
}
