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
stacked-tabs.js: 堆叠标签页：命令开关当前标签组、头叶交替结构、滑动布局、切换/关闭/固定、layout JSON 的 stacked 键与装载保持、分组隔离与侧栏拒绝、标签列表菜单入口。
page-preview.js: 悬停预览：阅读模式 popover、未解析空态、Escape 关闭、编辑模式 Mod 门控。
settings-ui.js: 设置页 UI：拼写词典/语言行、默认编辑模式同步、路径建议、忽略文件弹窗、重建缓存按钮、启动时间弹窗。
settings-plugins.js: 快捷键页状态筛选芯片、按快捷键捕获筛选与 Esc、冲突芯片跳筛选；核心插件页齿轮/快捷键入口显隐与跳转。
settings-window.js: 设置独立窗口（17 步/49 项）：标题 `设置 - 库名 - 应用版本`、900×700、多库隔离、窗口内切换「在窗口中打开设置」的注销不死锁、主窗缓存同步、浅/深截图。
modal-ui.js: 通用模态基座（21 项）：mod-dim 遮罩与 0.85 覆盖色、大阴影、视口居中、背景点击关闭、拖选保护、ESC、重开复位、确认弹窗标题/双按钮。
appearance.js: 外观页：主题 (Legacy)、字体管理弹窗（指示/图标/拖拽/持久化）、主题色恢复默认。
audio-recorder.js: 录音机插件验收。假 navigator.mediaDevices.getUserMedia 与 window.MediaRecorder 驱动：命令门、功能区切换 is-active、webm/m4a 扩展名与同秒重名序号、"Recording <时间戳>" 命名与嵌入链接、权限与设备错误映射（未连接麦克风/访问被拒绝/授权提示）、卸载释放与丢弃未完成录音、设置页开关与 core-plugins.json 持久化、重启读回。不接触真实麦克风。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放、重开，撤销/重做（键盘+按钮+落盘）与文本卡片转换为文件（校验、几何继承、边改指、撤销恢复）；图片导出（命令可用性、面板菜单文案、导出弹窗四项设置与取消不落盘、确认后按倍率落盘并遵守 4096 上限、renderCanvasImage 的 dataURL/maxSize 上限/倍率/视口范围/水印/隐私模式）；拖动对齐参考线（吸附到对齐值、出现 svg.canvas-snaps 参考线与圆点、松手清除、snapToObjects 关闭时不吸附）。
canvas-edit.js: 画布文本卡片的内嵌 CM6 实时预览编辑器：挂载即 .cm-editor（无 textarea/预览层）、句柄写正文 → 节点数据与画布 JSON 落盘、实时预览装饰（标题/加粗）与卡片内布局（--file-margins 归零、无行宽上限）、Escape 与 Mod+Enter 退出、单击已聚焦卡片进编辑（原版 hg）、未聚焦（blocker 路径）与聚焦未编辑（正文内）两条拖拽路径、只读画布不可写且切只读立刻退出编辑、缩放断点卸载/重建编辑器、正文编辑进撤销栈、空卡片本地化占位、关闭视图释放编辑器实例与 DOM；活动编辑器（卡片聚焦即登记、editor:toggle-bold 包裹卡片选区、退出编辑回落中心笔记、笔记内 Mod+B 仍作用于笔记）。
canvas-selection.js: 画布多选与批量操作。多选状态（单击单选只置聚焦、Shift+点击增删选、单选↔多选切换清理聚焦态、普通点击替换）、空白拖动框选（矩形挂 .canvas-selection、外扩 10px 定位、分组需完整包含、松手清除、Shift 异或）、多选包围盒（.mod-group-selection + 8 个 data-resize 手柄、并集外扩 10px）、拖动任一选中卡片整体位移并保持相对位置、Delete 删除与 Mod+Z 撤销/重做落盘、拖动即置顶、数据层按 z 升序写出节点、浮动工具条按钮与排布子菜单 13 项（真实点击驱动：对齐 6 向坐标断言、分布 2 向首尾不动、水平拉伸、网格排列）、从选中集合建组（几何外扩 20px）、拖组带动内部节点、分组恒为负 z、分组菜单提供编辑文字且无「取消分组」（原版无该命令，删组保留子节点）、Alt(mac)/Ctrl 拖动克隆整组、Mod+框选收尾弹建卡菜单并在关闭后收起矩形、只读画布隐藏非恒显按钮。
canvas-ui.js: 画布视觉/样式层断言（107 项、浅深两套）：外壳与点阵、控件四组图标顺序与快捷键后缀、快速设置三态、分组负 z、标签 always/hover/never、md 卡正文 padding 与弹性留白、图片宽高比回写、损坏图/缺文件占位、着色卡 rgba(...,0.07)、边（双 path、箭头顶点、描边宽度、标签字号）、悬停手柄门控与连接点嵌位、只读、缩放断点、帮助弹窗 14 条、空态三行。
view-header.js: 视图头 1.14.4（61 项、浅/深）：左导航钮/面包屑分隔与 aria、居中标题、mod-fade 三态、聚焦底色与 mod-active 同步、←→ 可用性。
dialogs.js: 弹窗复开、确认结果与选择器布局；命令面板复杂项（标题进内容列、热键同行靠右，原版 mod-complex）。
quick-switcher.js: 快速切换 1.14.4 全锁（130 项、浅/深）：prompt 几何/圆角/阴影/边框、六条指令栏、最近 10 项 MRU、文件/别名/未解析/附件/书签行结构、创建项与 Enter/Shift+Enter/Cmd+Enter、键盘全键位与 Tab 补全、附件/仅已创建/所有类型三开关。
download-attachments.js: 外部附件下载。命令门控（md 可用 / txt 与图片等非 md 不可用）、画廊模态结构与命名、取消不落盘、部分勾选只下载勾选项、字节完整性、嵌入与 frontmatter 改写、Notice 计数与无附件提示。stub app.requestUrl，不访问真实网络。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor-race.js: 切文件竞态与撤销栈边界：挂起 cachedRead 确定性复现“迟到回声”，断言迟到内容不打进新文件、A 改动回写 A、B 磁盘不被污染（撤守卫必失败，变异测试已验证）；打开后一次 undo 不清空文档、不把空文件落盘、用户编辑撤销仍可用、切文件 undo 不带回旧文本（20 项）。
editor.js: 模式、折叠、高亮、滚动与 LP 记号（列表圆点、有序记号、任务复选框与已勾划线、标题记号、折叠指示器默认隐身）。
file-explorer-multi.js: 文件树多选：Alt 切换/Shift 范围/空白清空、↑↓ 焦点、Delete 删除（逐项确认）、多选拖动载荷 items、多选右键菜单（新建文件夹含选中项/移动/删除）。
editor-block-button.js: 块 widget（代码/数学/Mermaid）的 edit-block-button：默认隐藏、悬停显形、点击把光标放回源码。
sidebar-chrome.js: 侧栏折叠/展开：折叠侧分隔条不穿入红绿灯区、toggle 迁移归属与 140ms FLIP 动画、幽灵清理；66 项计算样式锁——ribbon 收起底色（background-primary）、::before 解析色=titlebar-background、焦点联动变量链、mod-top 链、44px 内边距、标签 fillet 几何、展开还原；顶栏「+」「⌄」几何（外层 24×39、内层 span.clickable-icon 24×24、末标签盒距 8/字形距 12）与文件列表头（.nav-header 8px、五按钮图标顺序、gap 2px）。
editor-layout.js: 行宽布局：sizer/contentContainer 结构、700px 居中、行内标题同列、设置联动、阅读视图居中、折叠全关后开行号 gutter 正常挂载。
editor-paste.js: 剪贴板图片粘贴（截图 File / HTML data URL）落盘与嵌入、文本粘贴不误伤、文件树根目录外部文件拖入。
reading-menus.js: 阅读视图右键菜单：内部链接（新标签页/新标签组/重命名）、外链（复制链接/浏览器打开）、图片复制、笔记/音视频/PDF 嵌块菜单、未解析链接创建文件。
reading-ui.js: 阅读视图正文排版计算样式锁（212 项，期望值注 app.css 行号）：H1–H6 阶梯与间距、段落、列表（.list-bullet 圆点/嵌套缩进/任务 checkbox mask 与完成态）、引用、14 类 callout 色彩映射、行内/块代码与 pre 规格、表格（对齐/padding/行高/交替底色）、hr、脚注、三种链接（外链角标/未解析衰减）、标签、嵌入对象（音视频/PDF/笔记嵌块/附件/progress）；失败回执带 debug 栈。
image-size.js: 图片尺寸语法与图片右键：`|300`（读视图与实时预览的 img width、高度按原始比例）、`|300x200`、无尺寸保持原始宽度、`![alt|300](url)` 生效而 `![300](url)` 不生效、未解析与非图片嵌入不受影响；图片菜单的"重置大小"改写源文本并保留撤销（undo/redo）与自动保存链路，无尺寸图片不出现该项。
editor-menu.js: 编辑器右键菜单（剪切/粘贴/全选、文本格式/段落/插入/复制路径子菜单、editor-menu 事件、加粗动作；分节与格式三级子菜单对齐 1.14.4）与外部文件拖入（落盘附件、字节完整、带扩展名嵌入链接、链接可解析）及标题/清除格式命令。
menu-family.js: 菜单家族 1.14.4 对照（52 项）：编辑器/文件树/标签页/标签栏/属性行/反链出链的项序、图标、禁用态、分节与子菜单。
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
table-interaction.js: 实时预览表格交互：手柄拖拽重排（真实 PointerEvent、.table-drag-target 落点线、Esc 取消）、单元格矩形选区与选区菜单（剪贴板/对齐/清空/删除）、Tab 换格（末格加行、首格上方插行）、单元格原位编辑（blur 提交/Enter 下移/Esc 取消/IME 挂起）；无选区单元格菜单（剪贴板/文本格式/Row/Column/Sort 的排列与子菜单动作、复制粘贴往返）、删首/末行的块间空行（紧贴补、已隔空行不叠加）、原位编辑菜单追加表格子菜单、触屏手柄常显的 CSS 门控与桌面 hover 规则。
table-widget.js: 实时预览表格部件：加行/加列按钮、行列拖拽手柄右键菜单、对齐写回、排序、点击单元格进入源码；菜单标题断言同时接受中英文案。
theme-tokens.js: 主题设计变量逐条对齐（340 项、浅/深各一遍、期望值带 app.css 行号）：断言语义解析值（颜色 sRGB、h1-h6 px、calc 折叠）、令牌消费实证（safe-area → padding）、派生色（accent 系）、原版缺口一致性（深色 --shadow-edges 失效）；附色块对照面板渲染。1.14.4 的 --icon-m 16px / --icon-m-stroke-width 2px 期望已同步。
vault-hidden.js: 文件监听排除隐藏路径。
zoom-lock.js: 触摸板缩放锁。默认捏合/Ctrl+滚轮不改字号且默认行为被吞（preventDefault）、开关开启后 ±1 与 10/30 上下限、非 ctrl 滚轮无感、webFrame zoomFactor 与 visualViewport.scale 恒 1（整页视觉缩放不存在）。
probe-topbar.js / probe-canvas.js / probe-reading.js / probe-ui.js: 截图诊断探针（非断言锁，用于 UI 巡检与前后对比取证，结果 PNG 路径见场景 JSON）：
- probe-topbar：`--screen "collapsed+focused+dark"` 等九态令牌（OBS_SIDEBAR_VIEW）；`aligned` 顶栏几何与 `empty` 空态令牌。
- probe-canvas：`PROBE_SCENE=board|dark|empty|states|menus`。
- probe-reading：`--screen "light|dark[:scrollTop]"`。
- probe-ui：`--screen settings|palette|menu|graph|search`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
