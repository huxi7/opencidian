# scripts/acceptance/
> L2 | 父级: /scripts/CLAUDE.md

场景由 OBS_ACT 在真实 Electron 渲染进程执行。
运行器只允许带标记的临时库。日志错误使运行失败。
正式场景返回 {pass,count,checks}，count 为正且等于 checks.length。
全量入口固定 --no-screenshot，排除 probe-* 诊断脚本。
当前 88 个正式场景。旧轮回执见 RECEIPTS.json，本轮侧栏回执见 SIDEBAR-RECEIPTS.json。

成员清单
RESULTS.md: 本轮结果、证据目录与复跑方式。
RECEIPTS.json: 上轮核心收口的原始与有效回执。
TOOLBAR-RECEIPTS.json: 书签遗漏补修；旧样式真实失败、基线75、定向670与新包71逐条回执及哈希。
SIDEBAR-RECEIPTS.json: 本轮侧栏全量、焦点补修及原失败；独立Node/VM和包验证，逐条checks与来源哈希。
bases-entry.js: 数据库可见入口。功能区、空标签键盘、文件夹及根菜单创建真实文件，插件启停对称，重启读回。
properties-editing.js: 属性类型、侧栏编辑、剪贴板、首项与改名。54 条，verify 阶段重启读回 11 条。
frontmatter-write.js: 多窗口真实属性写回。CAS 冲突、坏 YAML 原文、失败恢复与 CRLF 正文保留。
document-window.js: 文档窗口加载、保存、双向同步、主布局隔离和关闭保存，含 Markdown/Bases/Canvas。
native-menus.js: 真实系统菜单树、分节与动作回传。E2E 不弹出系统菜单。
lifecycle-memory.js: 真实 V8 GC 后堆、DOM、事件与 Worker。30 轮开关设定增长预算。
run.mjs: 创建独立库与实时日志，异常快速失败；回执后必须真实退出，双窗缺回执明确失败；同名 .starter.js 驱动第二窗口，--seed-vaults 预置库，--vault/--phase 支持链式复跑，--no-screenshot 跳过截图。
core-ribbon.js: 插件入口启停、普通/Mod 点击、键盘、设置开关与重启同步。
core-views.js: 出链面板(已解析/未解析/副文本/空态/折叠/点击打开)与属性插件(全部属性计数与四种排序、点击开搜索、文件属性跟随、状态栏计数、关闭释放、禁停恢复、设置页开关)。
sidebar-shell.js: 固定侧栏、底部设置与切库、旧布局恢复和窄栏验收；标签列表/固定标签/状态栏双段/拖拽幽灵/空标签。
stacked-tabs.js: 堆叠标签页：命令开关当前标签组、头叶交替结构、滑动布局、切换/关闭/固定、layout JSON 的 stacked 键与装载保持、分组隔离与侧栏拒绝、标签列表菜单入口。
page-preview.js: 悬停预览（22 项）：阅读模式 popover、未解析空态、Escape 关闭、编辑模式 Mod 门控；原版 .markdown-embed 结构、inline-title 文件名、400px 限高内部滚动、32px 内容 padding、内部滚动不关闭。
settings-ui.js: 设置页 UI（220 项）：拼写词典/语言行、默认编辑模式同步、路径建议、忽略文件规则子页面与表单弹窗、重建缓存按钮、启动时间弹窗；侧栏全局搜索框（位置/结构/占位/跨页签分组与高亮/前 3 条折叠与「还有 N 个」/跳转闪烁/空态/清空）；设置项别名（原版 loe.search 的 name/desc/aliases 三路匹配与子串 AND 匹配器）：基础颜色/主题色/主题/字体大小/默认编辑模式的别名命中与负例，别名命中不高亮而名称命中高亮，别名不进结果文案。
search.js: 全局搜索（489 项）：字段/属性查询、引号/正则/否定/OR/括号、大小写与排序、结果分组/折叠/解释、键盘导航、复制结果弹窗与空态；建议弹层（算子 6 项、说明文案、组头与图标、历史存取与清除、键盘与插入语义、定位与宽度）；白板节点文本命中且不计入计数；真 Electron + 真实输入。
search-views.js: 搜索视图形态（69 项）：侧栏形态与独立标签形态的 DOM 与计算样式、输入聚焦与清空按钮、结果点击跳转（文件/行号/Mod 新标签）、计数千分位与清空后计数保留、复制弹窗、白板搜索、标签/目录上下文建议、结果悬停预览（出现/贴目标定位/移出收起/Mod 门控/悬停后按 Mod 补弹）。
canvas-settings.js: 白板设定页（83 项）：设置窗口内白板核心插件的齿轮入口与页签；新白板位置/文件夹、默认滚轮行为、默认 Mod 行为、卡片标签可见性、对齐网格/物体、缩放阈值滑杆（min/max/step 与 round(100*1.2^z)% 显示）；落盘 .obsidian/canvas.json 并即时灌回打开的视图。
canvas-embed.js: 笔记内嵌白板（81 项）：阅读视图与实时预览里 ![[Board.canvas]] 走原版画布嵌入（cte：.canvas-embed 容器 + inline-embed 形态的图标与文件名标题 + 缩略图 SVG），缩略图结构（圆角矩形数、贝塞尔路径、viewBox 外扩 5%）、限高 --embed-canvas-max-height 400px、点击打开白板、Mod+点击新标签、缺失白板落 .file-embed.mod-empty「未创建，点击以创建。」、空白板与坏 JSON 只留标题行、**右键不弹菜单**（原版渲染器只对链接/标签/图片派发右键）、计算样式锁。
canvas-dummy.js: 画布临时虚影与拖拽体检（75 项）：卡片菜单「添加卡片/笔记/媒体」、节点连线手柄、边端点改接三条路径在纯点击后画布内 .is-dummy 必须为 0（虚影与临时边一律在拖拽真正开始时才建）；虚影几何（目标尺寸、指针减半尺寸、按网格/物体吸附、落点同尺寸建真实节点）；真实 PointerEvent 拖拽后节点坐标确实变化且无残留；新建文本卡进编辑态可写并落盘 JSON；已聚焦 md 卡单击正文进卡片内编辑并写回真实文件；.canvas 卡渲染缩略图。
link-suggest.js: [[链接]] 单列浮窗（168 项）：无 .cm-completionInfo、.suggestion-container 结构/382.8×78.1 几何/31.5 行高/15-19.5 标题/12-15.6 路径、标题+灰色路径两行、选中态、上下/Page/Home/End/Ctrl+P/N/Enter/Tab/Shift+Enter/点击/Esc/失焦/滚动/缩放、# 标题、^ 块、| 显示文本、空态与重复路径。
settings-plugins.js: 快捷键页状态筛选芯片、按快捷键捕获筛选与 Esc、冲突芯片跳筛选；核心插件页齿轮/快捷键入口显隐与跳转；新增 locale 键逐条比对 zh+en 原版译文。
settings-window.js: 设置独立窗口（50 项真实断言）：标题 `设置 - 库名 - 应用版本`、900×700、多库隔离、窗口内切换「在窗口中打开设置」的注销不死锁、主窗缓存同步、浅/深截图；macOS 红绿灯按 popout 32px 落在 (10,8)。
vault-switcher.js: 仓库切换入口（13 项）：侧栏底部库名 →「管理仓库…」→ starter 窗口，注册表与菜单文案。
vault-switcher.starter.js: starter 第二窗口 1.14.4（129 项、浅/深）：800×650/titlebar 30、最近仓库列 280/行高 76.49、打开/新建两屏、行菜单（重命名/移动/复制 ID/访达/移除）、键盘 Enter/Esc、空名称提示与位置预览、移除只删注册表不删文件夹、空态快速开始、语言/帮助行。
modal-ui.js: 通用模态基座（21 项）：mod-dim 遮罩与 0.85 覆盖色、大阴影、视口居中、背景点击关闭、拖选保护、ESC、重开复位、确认弹窗标题/双按钮。
appearance.js: 外观页：主题 (Legacy)、主题管理弹窗（徽标/截图位/使用中）、字体三行子页面（当前字体列表/建议组/手输字体/缺失字体警示/立即落盘）、旧版主题真实生效（注入 themes/<x>.css 并带 data-css-theme）、主题色恢复默认。
audio-recorder.js: 录音机插件验收。假 navigator.mediaDevices.getUserMedia 与 window.MediaRecorder 驱动：命令门、功能区切换 is-active、webm/m4a 扩展名与同秒重名序号、"Recording <时间戳>" 命名与嵌入链接、权限与设备错误映射（未连接麦克风/访问被拒绝/授权提示）、卸载释放与丢弃未完成录音、设置页开关与 core-plugins.json 持久化、重启读回。不接触真实麦克风。
basic-plugins.js: 搜索、文件树、切换器、命令、标签、字数。
bookmarks.js: 分组、重命名、打开与保存。
canvas.js: 画布输入、连线、缩放、重开，撤销/重做（键盘+按钮+落盘）与文本卡片转换为文件（校验、几何继承、边改指、撤销恢复）；图片导出（命令可用性、面板菜单文案、导出弹窗四项设置与取消不落盘、确认后按倍率落盘并遵守 16284 长边与内存预算、renderCanvasImage 的 dataURL/maxSize 上限/倍率/视口范围/水印/隐私模式）；拖动对齐参考线（吸附到对齐值、出现 svg.canvas-snaps 参考线与圆点、松手清除、snapToObjects 关闭时不吸附）。
canvas-edit.js: 画布文本卡片的内嵌 CM6 实时预览编辑器：挂载即 .cm-editor（无 textarea/预览层）、句柄写正文 → 节点数据与画布 JSON 落盘、实时预览装饰（标题/加粗）与卡片内布局（--file-margins 归零、无行宽上限）、Escape 与 Mod+Enter 退出、单击已聚焦卡片进编辑（原版 hg）、未聚焦（blocker 路径）与聚焦未编辑（正文内）两条拖拽路径、只读画布不可写且切只读立刻退出编辑、缩放断点卸载/重建编辑器、正文编辑进撤销栈、空卡片本地化占位、关闭视图释放编辑器实例与 DOM；活动编辑器（卡片聚焦即登记、editor:toggle-bold 包裹卡片选区、退出编辑回落中心笔记、笔记内 Mod+B 仍作用于笔记）。
canvas-selection.js: 画布多选与批量操作。多选状态（单击单选只置聚焦、Shift+点击增删选、单选↔多选切换清理聚焦态、普通点击替换）、空白拖动框选（矩形挂 .canvas-selection、外扩 10px 定位、分组需完整包含、松手清除、Shift 异或）、多选包围盒（.mod-group-selection + 8 个 data-resize 手柄、并集外扩 10px）、拖动任一选中卡片整体位移并保持相对位置、Delete 删除与 Mod+Z 撤销/重做落盘、拖动即置顶、数据层按 z 升序写出节点、浮动工具条按钮与排布子菜单 13 项（真实点击驱动：对齐 6 向坐标断言、分布 2 向首尾不动、水平拉伸、网格排列）、从选中集合建组（几何外扩 20px）、拖组带动内部节点、分组恒为负 z、分组菜单提供编辑文字且无「取消分组」（原版无该命令，删组保留子节点）、Alt(mac)/Ctrl 拖动克隆整组、Mod+框选收尾弹建卡菜单并在关闭后收起矩形、只读画布隐藏非恒显按钮。
canvas-ui.js: 画布视觉/样式层断言（192 项、浅深两套）：外壳与点阵、控件四组图标顺序与快捷键后缀、快速设置三态、分组负 z、标签 always/hover/never、md 卡正文 padding 与弹性留白、图片宽高比回写、损坏图/缺文件占位、着色卡 rgba(...,0.07)、边（双 path、箭头顶点、描边宽度、标签字号）、悬停手柄门控与连接点嵌位、只读、缩放断点、帮助弹窗 14 条、空态三行；右键/中键 5px 平移、macOS 先 contextmenu 后移动的关闭、Windows pointerup 后 contextmenu 抑制；分组背景文件/文件夹重命名、移动、删除后的 bgPath/getData/contentEl/JSON 生命周期；.canvas 文件卡渲染缩略图而非原始 JSON。
view-header.js: 视图头 1.14.4（83 项、浅/深）：左导航钮/面包屑分隔与 aria、标题左对齐（桌面 --file-header-justify:start）、mod-fade 三态、聚焦底色与 mod-active 同步、←→ 可用性、头部模式钮真实指针命中与编辑/阅读双向切换；模式钮图标随模式更换（编辑视图 lucide-book-open / 阅读视图 lucide-edit-3）、aria-label 三行（状态句 + 动作句 + ⌘+单击在新标签页打开）、无 is-active、⌘+单击建立右侧叶子、目标反向模式且保留来源模式。
dialogs.js: 弹窗复开、确认结果与选择器布局（43 项）；命令面板复杂项（标题进内容列、热键同行靠右，原版 mod-complex）。
quick-switcher.js: 快速切换 1.14.4 全锁（130 项、浅/深）：prompt 几何/圆角/阴影/边框、六条指令栏、最近 10 项 MRU、文件/别名/未解析/附件/书签行结构、创建项与 Enter/Shift+Enter/Cmd+Enter、键盘全键位与 Tab 补全、附件/仅已创建/所有类型三开关。
download-attachments.js: 外部附件下载。命令门控（md 可用 / txt 与图片等非 md 不可用）、画廊模态结构与命名、取消不落盘、部分勾选只下载勾选项、字节完整性、嵌入与 frontmatter 改写、Notice 计数与无附件提示。stub app.requestUrl，不访问真实网络。
editor-switch.js: 切换文件先保存，已删除视图再次打开文件可编辑。
editor-race.js: 切文件竞态与撤销栈边界：挂起 cachedRead 确定性复现“迟到回声”，断言迟到内容不打进新文件、A 改动回写 A、B 磁盘不被污染（撤守卫必失败，变异测试已验证）；打开后一次 undo 不清空文档、不把空文件落盘、用户编辑撤销仍可用、切文件 undo 不带回旧文本（20 项）。
editor.js: 模式、折叠、高亮、滚动与 LP 记号（列表圆点、有序记号、任务复选框与已勾划线、标题记号、折叠指示器默认隐身）。
file-explorer-multi.js: 文件树多选：Alt 切换/Shift 范围/空白清空、↑↓ 焦点、Delete 删除（逐项确认）、多选拖动载荷 items（type=files）、多选右键菜单（新建文件夹含选中项/移动/删除）。
drag-drop.js: 文件树与标签拖拽（79 项、浅/深）：真实落盘的文件→文件夹/文件夹→文件夹/多选移动、同父 no-op、非法自嵌套拒绝、750ms 悬停展开、根容器移回仓库根；标签同组重排（模型+DOM+活动叶）、跨组搬叶子不重建、固定标签禁拖、workspace-drop-overlay 10px 落点（::before 内缩 3px/50% accent）、body.is-grabbing、ghost 清理、标签 200ms 开合补间、center/边缘 workspace-drop-overlay 几何与分割落点。
editor-block-button.js: 块 widget（代码/数学/Mermaid）的 edit-block-button：默认隐藏、悬停显形、点击把光标放回源码。
sidebar-toolbars.js: 五类导航面板在左右侧栏、明暗主题、260/420/640px真实拖宽与逐项收展后靠左；中心书签保留居中。
sidebar-chrome.js: 侧栏折叠/展开：折叠侧分隔条不穿入红绿灯区、toggle 迁移归属与 140ms FLIP 动画、幽灵清理；97 项计算样式与真实拖宽锁——ribbon 收起底色（background-primary）、::before 解析色=titlebar-background、焦点联动变量链、mod-top 链、44px 内边距、标签 fillet 几何、展开还原；顶栏「+」「⌄」几何（外层 24×39、内层 span.clickable-icon 24×24、末标签盒距 8/字形距 12）与文件列表头（.nav-header 8px、五按钮图标顺序、gap 2px）。
editor-layout.js: 行宽布局（26 项）：sizer/contentContainer 结构、700px 居中、行内标题与正文同左缘、H1 段前 16px/行高 1.2、设置联动、阅读视图居中、折叠全关后开行号 gutter 正常挂载且绝对定位不占正文宽。
editor-paste.js: 剪贴板图片粘贴（截图 File / HTML data URL）落盘与嵌入、文本粘贴不误伤、文件树根目录外部文件拖入。
reading-menus.js: 阅读视图右键菜单：内部链接（新标签页/新标签组/重命名）、外链（复制链接/浏览器打开）、图片复制、笔记/音视频/PDF 嵌块菜单、未解析链接创建文件。
reading-ui.js: 阅读视图正文排版计算样式锁（219 项，期望值注 app.css 行号）：H1–H6 阶梯与间距、段落、列表（.list-bullet 圆点/嵌套缩进/任务 checkbox mask 与完成态）、引用、14 类 callout 色彩映射、行内/块代码与 pre 规格、表格（对齐/padding/行高/交替底色）、hr、脚注、三种链接（外链角标/未解析衰减）、标签、嵌入对象（音视频/PDF/笔记嵌块/附件/progress）；失败回执带 debug 栈。
image-size.js: 图片尺寸语法与图片右键：`|300`（读视图与实时预览的 img width、高度按原始比例）、`|300x200`、无尺寸保持原始宽度、`![alt|300](url)` 生效而 `![300](url)` 不生效、未解析与非图片嵌入不受影响；图片菜单的"重置大小"改写源文本并保留撤销（undo/redo）与自动保存链路，无尺寸图片不出现该项。
editor-menu.js: 编辑器右键菜单（51 项）：剪切/复制/粘贴/全选、文本格式/段落/插入/复制路径子菜单、editor-menu 事件、加粗动作；分节与格式三级子菜单对齐 1.14.4。真实鼠标序列（mousedown→mouseup→click）锁定子菜单不误关父菜单；段落设置→1级标题、插入→表格均用真实点击验证；右键折叠选区后恢复；复制/剪切/粘贴走系统剪贴板。另含外部文件拖入（落盘附件、字节完整、带扩展名嵌入链接、链接可解析）及标题/清除格式命令。
menu-family.js: 菜单家族 1.14.4 对照（58 项）：编辑器/文件树/标签页/标签栏/属性行/反链出链的项序、图标、禁用态、分节与子菜单。
folding-disabled.js: 禁止语法回退绕过折叠开关。
layout-split.js: 分屏/工作区布局几何（78 项）：初始、左右分屏、上下分屏、保存-加载布局、关闭叶子后，root/中心列/叶子/内容容器全部落在视口内且不互相越界；两块叶子不重叠、加载前后几何一致。
layout-modals.js: 弹窗与新建视图的全屏几何（31 项）：设置弹窗遮罩铺满视口 + 两栏高度正常、布局管理弹窗、加载布局 SuggestModal、新建标签页只有一个 view-content（无占位残留）、新建画布铺满视图内容。
graph.js: 142 项图谱交互与销毁。含颜色组拖拽排序（顺序即优先色）与新建组按组序×40° 递增色相、节点悬停 hover-link 预览（载荷五项、无补弹）、力参数滑杆区间与换算、右键菜单分节表与 view.linked 子菜单、面板菜单恰好 1 条图谱项、键盘表（数字键不触发缩放）、命中半径（桌面 1×，移动端 5×）、graph.json 键集 20 项逐键锁定。
graph-worker.js: 图谱力学 worker 化（96 项真实断言；环境信息另存 notes）。后端三级回退（app:// 直载 → fetch+Blob → 本地）、位置发布与主线程零物理、钉住/解钉、力参数唤醒与再沉降、空图停摆与唤醒、关闭终止 worker、消息载荷与原版 sim.js 逐字段对齐（stub Worker 截获）、本地回退后端回归、crossOriginIsolated=false 时如实走 transfer。
graph-perf.js: 图谱性能门槛（100/1000/5000 节点）。断言打开预算、帧率、Worker 发布、真实释放与关闭后响应。
graph-persist-read.js: 重启核对图谱偏好。
graph-persist-write.js: 写入图谱偏好。
math.js: 离线 CHTML、字体、错误隔离与两种视图。
notes.js: 五个笔记插件的创建、编辑与重启。
notes-settings.js: 四类笔记插件设置页。输入真实控件，验证选项、落盘和重开，每页 9 项。
recovery.js: 快照、恢复、工作区与幻灯片的分阶段验收。覆盖旧 intervalSeconds→分钟迁移、设置页签文本输入即时生效、弹窗复制/差异开关、Canvas 快照与打开视图重载。
settings-restart.js: 重启核对四类设置。
settings-write.js: 写入四类用户设置。
sidebar.js: 反链、大纲、精确跳转与监听释放。
table-interaction.js: 实时预览表格交互：手柄拖拽重排（真实 PointerEvent、.table-drag-target 落点线、Esc 取消）、单元格矩形选区与选区菜单（剪贴板/对齐/清空/删除）、Tab 换格（末格加行、首格上方插行）、单元格原位编辑（blur 提交/Enter 下移/Esc 取消/IME 挂起）；无选区单元格菜单（剪贴板/文本格式/Row/Column/Sort 的排列与子菜单动作、复制粘贴往返）、删首/末行的块间空行（紧贴补、已隔空行不叠加）、原位编辑菜单追加表格子菜单、触屏手柄常显的 CSS 门控与桌面 hover 规则。
table-widget.js: 实时预览表格部件：加行/加列按钮、行列拖拽手柄右键菜单、对齐写回、排序、点击单元格进入源码；菜单标题断言同时接受中英文案。
theme-tokens.js: 主题设计变量逐条对齐（374 项消费令牌、785 项断言、浅/深各一遍、期望值带 app.css 行号）：断言语义解析值（颜色 sRGB/oklch/color(srgb …)、h1-h6 px、calc 折叠）、令牌消费实证（safe-area → padding）、派生色（accent 系）、原版缺口一致性（深色 --shadow-edges 失效）；1.14.4 全量基线（浅 base-25/30/35、深 base-00/10/20/25/30、--radius-xl 24、--tab-curve 10、--search-icon-size 16）与 --icon-m 16px / stroke 2px 已锁；附色块对照面板渲染。
vault-hidden.js: 文件监听排除隐藏路径。
zoom-lock.js: 触摸板缩放锁。默认捏合/Ctrl+滚轮不改字号且默认行为被吞（preventDefault）、开关开启后 ±1 与 10/30 上下限、非 ctrl 滚轮无感、webFrame zoomFactor 与 visualViewport.scale 恒 1（整页视觉缩放不存在）。
probe-topbar.js / probe-canvas.js / probe-reading.js / probe-ui.js / probe-canvas-geometry.js / probe-settings-shot.js: 截图诊断探针（非断言锁，用于 UI 巡检与前后对比取证，结果 PNG 路径见场景 JSON）：
- probe-topbar：`--screen "collapsed+focused+dark"` 等九态令牌（OBS_SIDEBAR_VIEW）；`aligned` 顶栏几何与 `empty` 空态令牌。
- probe-canvas：`PROBE_SCENE=board|dark|empty|states|menus`。
- probe-reading：`--screen "light|dark[:scrollTop]"`。
- probe-ui：`--screen settings|palette|menu|graph|search`。
- probe-canvas-geometry：新建标签页→新建画布后打印祖先链 rect/计算样式，定位 view-content 占位残留。
- probe-settings-shot：`--screen <tabId>` 打开指定设置页并打印侧栏分组/条目与关于页版本行。
probe-canvas-drop: 画布拖入诊断探针（残留虚影体检）。模拟文件树拖入与卡片菜单纯点击两条路径，报告 .is-dummy 数量、accent 填充元素、画布内彩色框与卡片 DOM/几何；非断言锁，用于定位画布残影。

bases.js: Bases P1。原版格式、嵌套筛选、排序、未知键保留与两种笔记嵌入，55 项。
small-gaps.js: 底部反链、根 CSS、默认应用头按钮缺席/文件菜单保留与原生半透明，50 项。
canvas-export.js: 整窗分块导出。跨块连续、正文、缩放、隐私、取消与异常恢复，24 项。
full.sh: 全量入口。定位仓库根并独占构建锁，参数原样传给 full.mjs。
full.mjs: 枚举正式场景和链式阶段。--only 定向补跑并补齐读回前置；输出回执与汇总。

bases-views.js: Bases P2。四种布局、配置、分组汇总、看板写回、图片封面与嵌入生命周期。
bases-formulas.js: 真实元数据的 P3 公式和文件属性，覆盖阅读/实时预览的宿主 this。
bases-values.js: 富值 DOM、受控导航、SVG 资源与 CSV 命令写盘，不弹原生保存框。

bases-editing.js: 真实编辑与列操作、类型候选、分组和并发写盘，86 条。
bases-ui.js: 原版工具栏、视图菜单、类型筛选、改名拒写与公式帮助，68 条。
bases-new-item.js: 立即创建与锚定编辑、属性推导、CAS 及草稿关闭/拒停保护，36 条。
bases-perf.js: 千/万笔记及万组压力。四类布局挂载上界、查询/刷新预算、滚动末组与释放，98 条。
bases-rich-render.js: 净化 HTML、块 Markdown、嵌入/数学/图表与派生只读控件，30 条。
bases-rich-lifecycle.js: 挂起渲染时取消、稳定宿主、重绘及虚拟换窗释放，32 条。
canvas-export-fidelity.js: 真实大图、密度、弹层视口、隐私裁切/遮挡/媒体与预算，30 条。
window-save-race.js: 真实双窗竞争、恢复在途新输入、最后输入和损坏布局拒绝丢稿，35 条。
sidebar-transitions.js: 左右并行、快速反向、内容宽度锁、动画取消、重建与焦点回归，76 条。

view-actions.js: 文件视图原生动作、默认应用头按钮缺席、通用菜单事件、模式目标与焦点，124 条。
sidebar-resize.js: 真实根边界、中心弹性、内部轴向比例、重建/恢复和取消释放。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
