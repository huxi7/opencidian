/**
 * [INPUT]: 依赖 app.settings 的 JSON 读写接口。
 * [OUTPUT]: 导出筛选、显示、力学默认值与滑块换算；读写 graph.json。
 * [POS]: 图谱选项契约；全局视图持久化，局部视图由布局保存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* 原版 yQ */
export const FILTER_DEFAULTS = {
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  showTags: false,
  localFile: null,
  localJumps: 1,
  localInterlinks: false,
  localForelinks: true,
  localBacklinks: true,
};
/* 原版 DJ */
export const DISPLAY_DEFAULTS = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};
/* 原版 CJ/EJ：滑块值∈[0,1] 与力学强度之间的映射，min 为强度下限（原版传 0.01） */
export function strengthFromSlider(slider, min) {
  return (Math.pow(min, 1 - slider) - min) / (1 - min);
}
export function inverseStrength(strength, min) {
  return 1 - Math.log(strength * (1 - min) + min) / Math.log(min);
}
/* 原版 PJ：默认值同样以滑块单位存储 */
export const FORCE_DEFAULTS = {
  centerStrength: inverseStrength(0.1, 0.01),
  repelStrength: 10,
  linkStrength: inverseStrength(1, 0.01),
  linkDistance: 250,
};

const GRAPH_OPTIONS_FILE = 'graph.json';
/* 原版 loadData/saveData：内部插件数据落在 <vault>/.obsidian/graph.json */
export function readGraphOptions(app: App) {
  const data = app.settings.readJson(GRAPH_OPTIONS_FILE);
  return data && typeof data === 'object' ? data : {};
}
export function writeGraphOptions(app: App, options) {
  app.settings.writeJsonMerged(GRAPH_OPTIONS_FILE, options);
}
