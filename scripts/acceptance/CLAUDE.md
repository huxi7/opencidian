# scripts/acceptance/
> L2 | 父级: /scripts/CLAUDE.md

场景由 OBS_ACT 在真实 Electron 渲染进程执行。
运行器只允许带标记的临时库。日志错误使运行失败。

成员清单
RESULTS.md: 本轮结果、证据目录与复跑方式。
run.mjs: 创建独立库、启动 Electron、收集截图与严格判定。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放与重开。
dialogs.js: 弹窗复开、确认结果与选择器布局。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor.js: 模式、折叠、高亮和滚动。
folding-disabled.js: 禁止语法回退绕过折叠开关。
graph.js: 40 项图谱交互与销毁。
graph-persist-read.js: 重启核对图谱偏好。
graph-persist-write.js: 写入图谱偏好。
math.js: 离线 CHTML、字体、错误隔离与两种视图。
notes.js: 五个笔记插件的创建、编辑与重启。
notes-settings.js: 笔记插件设置控件截图。
recovery.js: 快照、恢复、工作区与幻灯片的分阶段验收。
settings-restart.js: 重启核对四类设置。
settings-write.js: 写入四类用户设置。
sidebar.js: 反链、大纲、精确跳转与监听释放。
vault-hidden.js: 文件监听排除隐藏路径。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
