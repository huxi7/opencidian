# scripts/acceptance/
> L2 | 父级: /scripts/CLAUDE.md

场景由 OBS_ACT 在真实 Electron 渲染进程执行。
运行器只允许带标记的临时库。日志错误使运行失败。

成员清单
RESULTS.md: 本轮结果、证据目录与复跑方式。
run.mjs: 创建独立库、启动 Electron 与严格日志判定。--no-screenshot 跳过截图。
core-ribbon.js: 插件入口启停、普通/Mod 点击、键盘、设置开关与重启同步。
core-views.js: 出链面板(已解析/未解析/副文本/空态/折叠/点击打开)与属性插件(全部属性计数与四种排序、点击开搜索、文件属性跟随、状态栏计数、关闭释放、禁停恢复、设置页开关)。
sidebar-shell.js: 固定侧栏、底部设置与切库、旧布局恢复和窄栏验收；标签列表/固定标签/状态栏双段/拖拽幽灵/空标签。
page-preview.js: 悬停预览：阅读模式 popover、未解析空态、Escape 关闭、编辑模式 Mod 门控。
settings-ui.js: 设置页 UI：拼写词典/语言行、默认编辑模式同步、路径建议、忽略文件弹窗、重建缓存按钮、启动时间弹窗。
settings-plugins.js: 快捷键页状态筛选芯片、按快捷键捕获筛选与 Esc、冲突芯片跳筛选；核心插件页齿轮/快捷键入口显隐与跳转；社区插件卸载确认与目录删除。
appearance.js: 外观页：主题 (Legacy)、字体管理弹窗（指示/图标/拖拽/持久化）、主题色恢复默认。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放、重开，撤销/重做（键盘+按钮+落盘）与文本卡片转换为文件（校验、几何继承、边改指、撤销恢复）；图片导出（命令可用性、面板菜单文案、renderCanvasImage 的 dataURL/maxSize 上限/非背景像素、空画布拒绝提示）；拖动对齐参考线（吸附对齐值、出现 svg.canvas-snaps 参考线与圆点、松手清除、snapToObjects 关闭时不吸附）。
community.js: 社区插件安全模式：信任模态、受限/启用双布局、CTA 启用、安全模式守卫、setEnable 装卸与配置保留、重启自动加载。
dialogs.js: 弹窗复开、确认结果与选择器布局。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor.js: 模式、折叠、高亮和滚动。
editor-layout.js: 行宽布局：sizer/contentContainer 结构、700px 居中、行内标题同列、设置联动、阅读视图居中、折叠全关后开行号 gutter 正常挂载。
folding-disabled.js: 禁止语法回退绕过折叠开关。
graph.js: 72 项图谱交互与销毁。含颜色组拖拽排序（顺序即优先色）、节点悬停 hover-link 预览、力参数滑块落盘与重开保留。
graph-perf.js: 生成库性能基线（100/1000/5000 节点）：打开耗时、单 tick 耗时、沉降帧率、关闭释放、关闭后可响应。
graph-persist-read.js: 重启核对图谱偏好。
graph-persist-write.js: 写入图谱偏好。
math.js: 离线 CHTML、字体、错误隔离与两种视图。
notes.js: 五个笔记插件的创建、编辑与重启。
notes-settings.js: 笔记插件设置控件截图。
recovery.js: 快照、恢复、工作区与幻灯片的分阶段验收。覆盖旧 intervalSeconds→分钟迁移、设置页签文本输入即时生效、弹窗复制/差异开关、Canvas 快照与打开视图重载。
settings-restart.js: 重启核对四类设置。
settings-write.js: 写入四类用户设置。
sidebar.js: 反链、大纲、精确跳转与监听释放。
vault-hidden.js: 文件监听排除隐藏路径。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
