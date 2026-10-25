/**
 * [INPUT]: 页面 Document、主题 CSS 变量与原版工具栏/菜单静态样式。
 * [OUTPUT]: 导出 installBasesStyles，按文档安装一次数据库样式。
 * [POS]: Bases 四种布局、窗口化行与原版工具栏样式；文件视图和嵌入共用主题变量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function installBasesStyles(doc) {
  if (doc.getElementById('opensidian-bases-style')) return;
  const style = doc.createElement('style'); style.id = 'opensidian-bases-style';
  style.textContent = `
.bases-embed { min-width:0; overflow:auto; color:var(--text-normal); position:relative; }
.view-content.bases-embed > .bases-header,.bases-embed > .bases-header { flex:0 0 40px; min-height:40px; max-height:40px; }
.view-content.bases-embed > .bases-search-row,.view-content.bases-embed > .bases-warning,.view-content.bases-embed > .bases-config-menu { flex:0 0 auto; min-height:initial; }
.bases-header { container-type:inline-size; container-name:bases-header; display:flex; align-items:center; padding:0 2px; height:40px; min-height:40px; border-bottom:1px solid var(--background-modifier-border); flex-shrink:0; }
.bases-view-name { font-weight:var(--font-semibold,600); margin-right:auto; }
.bases-view-switcher { max-width:240px; }
.bases-limit { display:flex; align-items:center; gap:6px; font-size:var(--font-ui-small); color:var(--text-muted); }
.bases-limit input { width:70px; }
.bases-table-container { overflow:auto; width:100%; max-height:var(--bases-table-viewport-height,calc(100vh - 210px)); scrollbar-gutter:stable; }
.bases-table-container .bases-thead { position:sticky; top:0; z-index:2; }
.bases-list-group-list[data-virtual-total] { overflow:auto; max-height:var(--bases-table-viewport-height,calc(100vh - 210px)); }
.bases-cards-group[data-virtual-total],.bases-kanban-column-content[data-virtual-total] { overflow:auto; max-height:var(--bases-table-viewport-height,calc(100vh - 210px)); scrollbar-gutter:stable; }
.bases-virtual-band { min-width:0; }
.bases-virtual-spacer { pointer-events:none; border:0!important; }
.bases-table-container .bases-table-cell { display:flex; align-items:center; width:100%; height:var(--bases-table-current-row-height,30px); max-height:var(--bases-table-current-row-height,30px); overflow:hidden; }
.bases-table-container.mod-multiline .bases-table-cell { align-items:flex-start; }
.bases-table-container:not(.mod-multiline) .bases-td { white-space:nowrap; }
.bases-table-cell > .bases-rendered-value { max-height:100%; min-height:0; box-sizing:border-box; overflow:hidden; text-overflow:ellipsis; }
.bases-table-container:not(.mod-multiline) .bases-table-cell > .bases-rendered-value { white-space:nowrap; }
.bases-table-container.mod-multiline .bases-table-cell > .bases-rendered-value { white-space:normal; }
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
.bases-config-menu { position:absolute; z-index:20; top:44px; right:8px; width:min(300px,calc(100% - 16px)); max-height:min(580px,calc(100vh - 140px)); overflow:auto; padding:4px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,8px); background:var(--background-primary); box-shadow:var(--shadow-l); }
.bases-config-title { font-weight:var(--font-semibold,600); display:flex; justify-content:space-between; align-items:center; }
.bases-config-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:8px 4px; font-size:var(--font-ui-small); }
.bases-config-row input,.bases-config-row select { width:150px; min-width:0; }
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
.bases-toolbar { display:flex; align-items:center; position:relative; column-gap:4px; width:100%; min-width:0; }
.bases-toolbar .bases-toolbar-item { margin:0 -2px; display:flex; min-width:0; }
.bases-toolbar .text-icon-button { margin:2px; min-width:0; height:28px; display:flex; align-items:center; gap:4px; padding:4px 6px; color:var(--text-muted); background:transparent; border:0; box-shadow:none; font-size:var(--font-ui-small); border-radius:var(--radius-s,4px); cursor:var(--cursor,default); }
.bases-toolbar .text-icon-button:hover,.bases-toolbar .text-icon-button.has-active-menu { background:var(--background-modifier-hover); color:var(--text-normal); }
.bases-toolbar .text-icon-button.is-active { color:var(--icon-color-active,var(--interactive-accent)); }
.bases-toolbar .bases-toolbar-views-menu { overflow:hidden; flex-shrink:1; }
.bases-toolbar .bases-toolbar-views-menu .text-icon-button { color:var(--text-normal); }
.bases-toolbar .text-button-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bases-toolbar .text-button-icon { display:flex; align-items:center; flex-shrink:0; --icon-size:16px; }
.bases-toolbar .text-button-icon.mod-aux { margin-inline-start:auto; --icon-size:14px; }
.bases-toolbar .bases-toolbar-result-count { color:var(--text-muted); user-select:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-inline-end:auto; flex-shrink:0; }
.bases-toolbar .bases-toolbar-result-count .text-button-icon { display:none; }
.bases-toolbar .bases-toolbar-result-count .text-button-label { font-size:var(--font-ui-smaller); }
@container bases-header (width < 590px) { .bases-toolbar .bases-toolbar-item:not(.bases-toolbar-views-menu,.bases-toolbar-result-count) .text-button-label { display:none; } }
.bases-config-menu .text-icon-button { display:flex; align-items:center; gap:6px; text-align:start; background:transparent; border:0; box-shadow:none; padding:6px 8px; border-radius:var(--radius-s,4px); font-size:var(--font-ui-small); }
.bases-config-menu .text-icon-button:hover { background:var(--background-modifier-hover); }
.bases-config-menu .text-icon-button.mod-cta { background:var(--interactive-accent); color:var(--text-on-accent); }
.bases-config-menu .text-button-icon { display:inline-flex; flex-shrink:0; --icon-size:16px; }
.bases-toolbar-menu { --input-height:28px; min-width:220px; max-width:calc(100% - 8px); font-size:var(--font-ui-small); }
.bases-toolbar-menu-container-header { display:flex; align-items:center; padding:4px; gap:4px; }
.bases-toolbar-menu-container-header .menu-title { flex:1; font-weight:var(--font-medium,500); padding:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bases-toolbar-menu-container-header .close-icon .text-button-label { display:none; }
.bases-toolbar-menu .menu-scroll { overflow-y:auto; padding:0; }
.bases-toolbar-menu .bases-menu-search { width:calc(100% - 8px); margin:4px; }
.bases-toolbar-items { display:flex; flex-direction:column; min-height:0; padding:4px; gap:2px; }
.bases-toolbar-menu-item { display:flex; align-items:center; gap:4px; border-radius:var(--radius-s,4px); padding:2px; min-width:0; }
.bases-toolbar-menu-item:hover { background:var(--background-modifier-hover); }
.bases-toolbar-menu-item > .text-icon-button:first-child { flex:1; }
.bases-toolbar-menu-item .bases-view-settings { padding:4px; color:var(--text-muted); }
.bases-toolbar-menu-item .bases-view-settings .text-button-label { display:none; }
.bases-toolbar-menu-item[hidden] { display:none; }
.bases-toolbar-menu-item .bases-toolbar-menu-item-name { flex:1; }
.bases-toolbar-menu-item svg { width:16px; height:16px; }
.bases-toolbar-menu-item [aria-pressed="true"] { color:var(--text-accent); }
.bases-toolbar-section { padding:2px; border-bottom:1px solid var(--background-modifier-border); }
.bases-toolbar-section:last-child { border-bottom:0; }
.bases-toolbar-section-header { display:flex; align-items:center; padding:8px 12px; color:var(--text-normal); font-weight:var(--font-medium,500); gap:4px; cursor:var(--cursor,default); }
summary.bases-toolbar-section-header { display:list-item; margin-inline-start:12px; }
.bases-toolbar-section-content { padding:0 4px 8px; }
.bases-toolbar-filter-menu.bases-config-menu { width:min(520px,calc(100% - 8px)); }
.bases-filter-builder { display:flex; flex-direction:column; gap:6px; font-weight:normal; }
.bases-filter-group { border-inline-start:2px solid var(--background-modifier-border); padding-inline-start:8px; margin:4px 0; }
.bases-filter-group-header,.bases-filter-actions,.bases-filter-row { display:flex; align-items:center; gap:4px; min-width:0; margin:4px 0; }
.bases-filter-group-header > select { flex:1; }
.bases-filter-group-children { padding:2px 0; }
.bases-filter-row input { min-width:0; width:70px; flex:1; }
.bases-filter-row select { max-width:130px; min-width:0; }
.bases-filter-formula { min-width:0; flex:1; }
.bases-filter-row .formula-editor { border:1px solid var(--background-modifier-border); border-radius:var(--radius-s,4px); background:var(--background-modifier-form-field); min-width:0; }
.bases-filter-row .formula-editor:focus-within { border-color:var(--background-modifier-border-focus); }
.formula-editor-status { font-size:var(--font-ui-smaller); color:var(--text-success); margin-top:3px; }
.formula-editor-status.mod-error { color:var(--text-error); }
.bases-filter-row .text-button-label { display:none; }
.bases-filter-actions { flex-wrap:wrap; }
.bases-filter-actions .text-icon-button { color:var(--text-muted); padding:4px; font-size:var(--font-ui-smaller); }
.bases-filter-apply { align-self:flex-end; }
.base-toolbar-sort-item { display:flex; align-items:center; gap:4px; min-width:0; padding:4px 0; }
.base-toolbar-sort-item select { min-width:0; max-width:140px; flex:1; }
.base-toolbar-sort-item .text-button-label { display:none; }
.bases-search-row { padding:6px 8px; border-bottom:1px solid var(--background-modifier-border); flex-shrink:0; }
.bases-search-row[hidden] { display:none; }
.bases-search-row input { width:100%; }
.bases-new-item-popover > .menu-scroll > input { margin:8px; width:calc(100% - 16px); }
.bases-config-menu.view-config-menu { padding:4px 8px 8px; }
.bases-config-menu.view-config-menu > .bases-config-title { margin:0 -4px 4px; }
.bases-config-filter { margin-top:8px; border-block:1px solid var(--background-modifier-border); }
.bases-config-filter > .bases-filter-builder { padding:0 4px 8px; }
.popover.hover-popover.bases-new-item-popover { box-sizing:border-box; width:min(420px,calc(100vw - 16px)); height:360px; max-height:calc(100vh - 80px); display:flex; flex-direction:column; padding:12px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m,8px); background:var(--background-primary); box-shadow:var(--shadow-l); }
.popover.hover-popover.bases-new-item-popover > * { width:100%; }
.bases-new-item-header { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.bases-new-item-header .inline-title { flex:1; min-width:0; border:0; box-shadow:none; font-size:var(--h2-size); font-weight:var(--h2-weight); background:transparent; }
.bases-new-item-popover .markdown-source-view { flex:1; min-height:0; overflow:auto; margin-top:8px; }
.bases-new-item-popover .cm-editor { height:100%; }
.bases-new-item-popover .cm-content { padding:8px; }
.bases-filter-query-message { padding:8px; color:var(--text-muted); font-size:var(--font-ui-smaller); }
.bases-formula-function-info { max-width:340px; padding:8px 10px; font-size:var(--font-ui-small); line-height:1.4; }
.bases-formula-function-info code { display:block; font-weight:var(--font-semibold,600); color:var(--text-normal); margin-bottom:4px; white-space:normal; }
.bases-formula-function-info > div { color:var(--text-muted); margin-bottom:6px; }
.bases-group-new-item { margin-inline-start:4px; padding:2px; --icon-size:14px; }
.view-content.bases-embed > .bases-group-actions { flex:0 0 auto; }
.bases-groups-virtual { overflow:auto; max-height:calc(100vh - 180px); scrollbar-gutter:stable; }
.bases-groups-virtual > .bases-virtual-band { margin:0 0 10px; }
.bases-kanban-container.view-content.bases-embed > .bases-group-actions { flex:0 0 auto; }
.bases-groups-virtual { min-height:300px; overflow-x:auto; }
.bases-group-heading { cursor:var(--cursor,default); }
.bases-group-heading .bases-group-new-item { margin-inline-start:4px; }
.cm-tooltip.cm-tooltip-docstring.bases-formula-function-signature { border-radius:var(--radius-s); padding:4px 8px; background:var(--background-modifier-message); box-shadow:0 2px 8px var(--background-modifier-box-shadow); font-size:11px; font-weight:var(--font-medium); line-height:var(--line-height-tight); color:#fafafa; font-family:var(--font-monospace); border:0; }
.cm-tooltip-docstring.bases-formula-function-signature .active { font-weight:var(--font-semibold); }
.cm-tooltip-docstring.bases-formula-function-signature .cm-tooltip-arrow:before,.cm-tooltip-docstring.bases-formula-function-signature .cm-tooltip-arrow:after { border-top:7px solid var(--background-modifier-message); }
`;
  doc.head.appendChild(style);
}
