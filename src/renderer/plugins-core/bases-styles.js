/**
 * [INPUT]: 页面 Document 与已有主题 CSS 变量。
 * [OUTPUT]: 导出 installBasesStyles，按文档安装一次数据库样式。
 * [POS]: Bases 四种布局与配置弹层样式。文件视图和嵌入共用主题变量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function installBasesStyles(doc) {
  if (doc.getElementById('opensidian-bases-style')) return;
  const style = doc.createElement('style'); style.id = 'opensidian-bases-style';
  style.textContent = `
.bases-embed { min-width:0; overflow:auto; color:var(--text-normal); position:relative; }
.bases-header { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:8px; border-bottom:1px solid var(--background-modifier-border); }
.bases-view-name { font-weight:var(--font-semibold,600); margin-right:auto; }
.bases-view-switcher { margin-right:auto; max-width:200px; }
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
.bases-group-heading { display:flex; gap:8px; align-items:center; width:100%; text-align:left; padding:10px; border:0; box-shadow:none; background:var(--background-secondary); border-radius:0; }
.bases-group-property,.bases-group-count { color:var(--text-muted); font-size:var(--font-ui-small); }
.bases-group-count { margin-left:auto; }
.bases-group-heading[aria-expanded="false"] .bases-group-value:before { content:'▸ '; }
.bases-group-heading[aria-expanded="true"] .bases-group-value:before { content:'▾ '; }
.bases-group-body[hidden] { display:none!important; }
.bases-list-group-list { padding:8px 12px; }
.bases-list-item-properties { display:flex; align-items:baseline; flex-wrap:wrap; }
.bases-list-item-properties.nested { padding-left:24px; display:block; }
.bases-list-property,.bases-list-property .bases-rendered-value { display:inline; min-height:0; padding:0; }
.bases-list-item { padding:5px 0; }
.bases-list-item .list-bullet,.bases-list-item .list-number { margin-right:8px; }
.bases-cards-group { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--bases-card-width,200px)),1fr)); gap:12px; padding:12px; }
.bases-cards-item { min-width:0; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,8px); background:var(--background-primary); padding:6px; }
.bases-cards-property.mod-title { font-weight:var(--font-semibold,600); }
.bases-cards-label { padding:4px 8px 0; color:var(--text-muted); font-size:var(--font-ui-smaller); }
.bases-kanban-container { display:flex; gap:12px; padding:12px; overflow:auto; align-items:flex-start; }
.bases-kanban-column { width:var(--bases-card-width,280px); flex:0 0 var(--bases-card-width,280px); border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,8px); overflow:hidden; }
.bases-kanban-column-content { display:flex; flex-direction:column; gap:8px; padding:8px; }
.bases-kanban-placeholder { padding:32px; text-align:center; }
.bases-kanban-placeholder-title { font-weight:var(--font-semibold,600); }
.bases-kanban-placeholder-text { padding:12px; color:var(--text-muted); }
.bases-summary { padding:8px; font-size:var(--font-ui-small); color:var(--text-muted); }
.bases-summary-value { padding:8px!important; }
.bases-config-menu { position:absolute; z-index:20; top:48px; right:8px; width:min(360px,calc(100% - 16px)); max-height:480px; overflow:auto; padding:12px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,8px); background:var(--background-primary); box-shadow:var(--shadow-l); }
.bases-config-title { font-weight:var(--font-semibold,600); display:flex; justify-content:space-between; align-items:center; }
.bases-config-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:10px 0; font-size:var(--font-ui-small); }
.bases-config-row input,.bases-config-row select { width:170px; min-width:0; }
.bases-config-section { font-weight:var(--font-semibold,600); padding-top:12px; margin-top:12px; border-top:1px solid var(--background-modifier-border); }
.bases-config-section input { width:130px; margin:8px 4px 8px 0; }
.bases-property-toggle { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:var(--font-ui-small); }
.bases-group-toggle { display:flex; align-items:center; gap:6px; padding:4px 0; font-weight:normal; font-size:var(--font-ui-small); }
.bases-group-toggle span { flex:1; }
.bases-group-toggle input { width:auto; margin:0; }
.bases-group-toggle button { padding:2px 6px; }
.bases-config-filter { display:flex; flex-direction:column; gap:6px; font-size:var(--font-ui-small); }
.bases-config-filter textarea { min-height:70px; font-family:var(--font-monospace); }
.bases-export-csv { display:flex; gap:6px; align-items:center; margin-top:8px; }
.bases-export-icon { display:flex; }
.bases-cards-cover { width:calc(100% + 12px); margin:-6px -6px 8px; overflow:hidden; background:var(--background-secondary); }
.bases-cards-cover img { display:block; }
.bases-cards-cover .bases-warning,.bases-cards-cover .bases-value-degraded { padding:8px; white-space:normal; overflow-wrap:anywhere; }
.bases-kanban-item[draggable="true"] { cursor:grab; }
.bases-kanban-item.is-being-dragged { opacity:.45; }
.bases-kanban-drop-target { outline:2px solid var(--interactive-accent); outline-offset:2px; }
.markdown-preview-view .bases-embed,.cm-content .bases-embed { border:1px solid var(--background-modifier-border); border-radius:var(--radius-s); margin:12px 0; }
`;
  doc.head.appendChild(style);
}
