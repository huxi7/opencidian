# scripts/acceptance/
> L2 | 父级: /scripts/CLAUDE.md

场景由 OBS_ACT 在真实 Electron 渲染进程执行。
运行器只允许带标记的临时库。日志错误使运行失败。

成员清单
RESULTS.md: 本轮结果、证据目录与复跑方式。
run.mjs: 创建独立库、启动 Electron 与严格日志判定。--no-screenshot 跳过截图。
core-ribbon.js: 插件入口启停、普通/Mod 点击、键盘、设置开关与重启同步。
sidebar-shell.js: 固定侧栏、底部设置与切库、旧布局恢复和窄栏验收。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放、重开，撤销/重做（键盘+按钮+落盘）与文本卡片转换为文件（校验、几何继承、边改指、撤销恢复）。
dialogs.js: 弹窗复开、确认结果与选择器布局。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor.js: 模式、折叠、高亮和滚动。
folding-disabled.js: 禁止语法回退绕过折叠开关。
graph.js: 40 项图谱交互与销毁。
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
