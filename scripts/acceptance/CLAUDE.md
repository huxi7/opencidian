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
audio-recorder.js: 录音机插件验收。假 navigator.mediaDevices.getUserMedia 与 window.MediaRecorder 驱动：命令门、功能区切换 is-active、webm/m4a 扩展名与同秒重名序号、"Recording <时间戳>" 命名与嵌入链接、权限与设备错误映射（未连接麦克风/访问被拒绝/授权提示）、卸载释放与丢弃未完成录音、设置页开关与 core-plugins.json 持久化、重启读回。不接触真实麦克风。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放、重开，撤销/重做（键盘+按钮+落盘）与文本卡片转换为文件（校验、几何继承、边改指、撤销恢复）；图片导出（命令可用性、面板菜单文案、renderCanvasImage 的 dataURL/maxSize 上限/非背景像素、空画布拒绝提示）；拖动对齐参考线（吸附对齐值、出现 svg.canvas-snaps 参考线与圆点、松手清除、snapToObjects 关闭时不吸附）。
canvas-edit.js: 画布文本卡片的内嵌 CM6 实时预览编辑器：挂载即 .cm-editor（无 textarea/预览层）、句柄写正文 → 节点数据与画布 JSON 落盘、实时预览装饰（标题/加粗）与卡片内布局（--file-margins 归零、无行宽上限）、Escape 与 Mod+Enter 退出、单击已聚焦卡片进编辑（原版 hg）、未聚焦（blocker 路径）与聚焦未编辑（正文内）两条拖拽路径、只读画布不可写且切只读立刻退出编辑、缩放断点卸载/重建编辑器、正文编辑进撤销栈、空卡片本地化占位、关闭视图释放编辑器实例与 DOM。
community.js: 社区插件安全模式：信任模态、受限/启用双布局、CTA 启用、安全模式守卫、setEnable 装卸与配置保留、重启自动加载。
dialogs.js: 弹窗复开、确认结果与选择器布局。
download-attachments.js: 外部附件下载。命令门控（md 可用 / txt 与图片等非 md 不可用）、画廊模态结构与命名、取消不落盘、部分勾选只下载勾选项、字节完整性、嵌入与 frontmatter 改写、Notice 计数与无附件提示。stub app.requestUrl，不访问真实网络。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor-race.js: 切文件竞态：挂起 cachedRead 确定性复现“迟到回声”，断言迟到内容不打进新文件、A 改动回写 A、B 磁盘不被污染（撤守卫必失败，变异测试已验证）。
editor.js: 模式、折叠、高亮和滚动。
editor-block-button.js: 块 widget（代码/数学/Mermaid）的 edit-block-button：默认隐藏、悬停显形、点击把光标放回源码。
editor-layout.js: 行宽布局：sizer/contentContainer 结构、700px 居中、行内标题同列、设置联动、阅读视图居中、折叠全关后开行号 gutter 正常挂载。
editor-paste.js: 剪贴板图片粘贴（截图 File / HTML data URL）落盘与嵌入、文本粘贴不误伤、文件树根目录外部文件拖入。
reading-menus.js: 阅读视图右键菜单：内部链接（新标签页/新标签组/重命名）、外链（复制链接/浏览器打开）、图片复制、笔记/音视频/PDF 嵌块菜单、未解析链接创建文件。
editor-menu.js: 编辑器右键菜单（剪切/粘贴/全选、文本格式/段落/插入/复制路径子菜单、editor-menu 事件、加粗动作）与外部文件拖入（落盘附件、字节完整、带扩展名嵌入链接、链接可解析）及标题/清除格式命令。
folding-disabled.js: 禁止语法回退绕过折叠开关。
graph.js: 72 项图谱交互与销毁。含颜色组拖拽排序（顺序即优先色）、节点悬停 hover-link 预览、力参数滑块落盘与重开保留。
graph-worker.js: 图谱力学 worker 化。后端三级回退（app:// 直载 → fetch+Blob → 本地）、位置发布与主线程零物理（localTicks=0）、钉住/解钉、力参数唤醒与再沉降、空图停摆与唤醒、关闭终止 worker、消息载荷与原版 sim.js 逐字段对齐（stub Worker 截获）、本地回退后端回归。
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
table-interaction.js: 实时预览表格交互：手柄拖拽重排（真实 PointerEvent、.table-drag-target 落点线、Esc 取消）、单元格矩形选区与选区菜单（剪贴板/对齐/清空/删除）、Tab 换格（末格加行、首格上方插行）、单元格原位编辑（blur 提交/Enter 下移/Esc 取消/IME 挂起）。
table-widget.js: 实时预览表格部件：加行/加列按钮、行列拖拽手柄右键菜单、对齐写回、排序、点击单元格进入源码；菜单标题断言同时接受中英文案。
vault-hidden.js: 文件监听排除隐藏路径。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
