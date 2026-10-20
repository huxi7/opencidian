# src/renderer/styles/

> L2 | 父级: /src/renderer/CLAUDE.md

全部 CSS。加载顺序由 index.html 决定：fonts → tokens → base → layout → components → download-attachments → tree → explorer → editor → markdown → search → properties → graph → settings → canvas → bookmarks → slides。所有颜色/间距/字体一律引用 tokens.css 中的变量，禁止硬编码色值(阴影与罕见例外除外)。

成员清单
starter.css: 仓库选择窗口 1.14.4 几何（800×650、titlebar 30、最近仓库列 280/行高 76.49、设置组 448/语言行 70、按钮 100×30）；打开/新建/空态与行菜单，通用控件复用 components/settings。
fonts.css: @font-face。Inter(界面) 与 Source Code Pro(等宽)，字体文件在 assets/fonts/。
tokens.css: 设计变量入口。按序导入 foundation 与 interface，保持原版数值。
tokens-foundation.css: 字重与前半全局变量。保留原版规则顺序。1.14.4 全量基线：浅 base-25/30/35、深 base-00/10/20/25/30、--radius-xl 24、--tab-curve 10、--search-icon-size 16、--nav-item-radius 8、--mono-0/100、--font-preferred-size、--icon-m 16px / stroke 2px、桌面 --file-header-justify: start 与 --hotkey-* 组。
tokens-interface.css: 后半全局变量、明暗主题与字体族。颜色走 color-mix(in oklch)/oklch()/color(srgb)；.mod-macos 20 项覆盖（输入/弹窗/标签圆角、输入阴影 none、交互色取 border、搜索框 100px 胶囊、灰色滚动条拇指）。
base.css: 重置、滚动条(仅 body.styled-scrollbars 下生效，macOS 用系统 overlay 滚动条，逐字移植原版)、输入/按钮/开关/滑块基础样式、clickable-icon、.is-hidden。hover 事实对齐 1.14.4：clickable-icon padding 4/6、svg opacity 140ms；输入基础无过渡、hover 底色+border-hover 140ms、focus 2px 环；按钮无过渡与 input-shadow。
layout.css: 外层 workspace-root 与中心 mod-root 分开。只给中心文档应用主背景。含原版堆叠标签页段(app.css 6506-6590)：头竖排(writing-mode)、tab-container 横向滑动、pane 宽度区间。标题栏段对齐原版：ribbon ::before 用 var(--titlebar-background)（左上 44×40 顶栏色）、ribbon 收起只换底色（--ribbon-background-collapsed）而隐藏归 .is-hidden、标签 fillet 用 border+radius 原语。标签栏段对齐 1.14.4 app.css:6918-7338：容器底线 + 内层 -1px 负下边距消缝、活动标签凹弧(clip-path)与 box-shadow 描边、「+」「⌄」外层定位/内层按钮盒、.mod-stacked 归零；view-header 段（左导航钮/面包屑/左对齐标题/mod-fade/聚焦底色）。根标签图标 14px、关闭钮 16px（padding 2/radius-m）。标签落点复用 workspace-drop-overlay（10px 竖条，原版 getTabInsertLocation/showOverlay）。
workspace-sidebar.css: 原版侧栏图标、库信息栏、开关与 macOS 留白。窄栏保留帮助和设置。含顶栏焦点联动变量组（titlebar/ribbon/toggle/tab 容器）与 ribbon ::before 顶栏色 override。ribbon/侧栏标签/开关图标统一 --icon-m 16px。
components.css: 菜单、弹窗、建议、通知、悬浮提示、设置外壳与快照历史。原版布局规则保持闭合。通知为右上角固定栈(app.css 7923-7978)，tooltip 含 mod-top/mod-left/mod-right 翻转与 tooltip-arrow(app.css 9324-9445)，建议弹层 .suggestion-container 取 --suggestion-background(app.css 8858-8867)。含 1.14.4 prompt 段（700px 宽、15vh 顶部、圆角/阴影/边框、指令栏无顶部分隔线）与空态 pill 段(.empty-state-action/.mod-pill/.empty-state-hotkey)。菜单 gap 8/nowrap、label 不铺底；模态遮罩瞬时；通知入场 100ms ease-in-out。
download-attachments.css: 下载附件模态。.modal.mod-scrollable-content(app.css 8168-8184)与 .attachments-gallery/.download-attachment-item(app.css 3248-3312)逐字移植；末尾 .download-attachment-name 是本实现补的可见文件名标签。
tree.css: .tree-item 体系(collapse-icon 尺寸与旋转、tree-item-self/icon/inner/children/flair)，逐字移植自原版 app.css 7263-7287 与 9446-9591。全部树视图共用。键盘焦点环除原版 mod-active 规则外，另挂 .nav-files-container:focus 兜底（workspace-leaf 现随活动叶写 mod-active，兜底保留）。
explorer.css: .nav-* 文件树层(标题内容、nav-file-tag、拖拽高亮、容器 outline:none)，被 explorer/outline/tag 面板共用。基础结构来自 tree.css。含 .nav-header(8px 内边距) 与 .nav-buttons-container(gap 2px、flex-wrap) 面板按钮行（app.css:9574-9593）。
editor.css: CodeMirror 与 live preview(HyperMD-*)、inline-title、media 视图。含原版 file layout（.cm-sizer/.cm-contentContainer 布局、is-readable-line-width 的 --file-line-width 居中、.cm-line padding 0、.cm-gutters folding offset）与阅读视图 sizer 居中。折叠 gutter 绝对定位在左侧留白（不占正文宽度，标题与正文同左缘）；标题行按 hN 行高（H1 1.2）与 --p-spacing 段前距（源码模式归零）。图片段取原版 .cm-line .image-embed（inline-flex、加成内容宽、position:relative）与其 .image-wrapper 规则，实时预览的内嵌图片因此能按 img 的 width/height 渲染。表格段（app.css 3551-3797）含 .table-editor 单元格、table-row/col-btn、table-row/col-drag-handle 与 align 属性驱动的对齐，另移植单元格选区覆盖层（is-selected 与 start/end/top/bottom 边框，app.css 3586-3607/3769-3805）、拖拽落点线 .table-drag-target（app.css 12821-12836）与 is-dragging 手柄显隐；.table-cell-editor 是本实现的单元格编辑 textarea（mod-editing 隐藏渲染内容）；表格段末尾按 app.css 3725-3740 补触屏门控：body.is-touch（部件按 (hover: none) 探测）下非激活行列手柄 display:none、编辑中的行/列手柄与授权后的加行/加列按钮常显，桌面保持 hover 显形。
markdown.css: 阅读样式入口，按原顺序导入内容、属性与高亮规则；嵌入对象段（图片/音视频/PDF/笔记嵌块/附件/progress）在本文件承载，逐条对齐原版 app.css 9606-10966、11982。
markdown-content.css: 正文流式排版（标题阶梯与间距、段落、列表与任务、引用、callout、代码、表格、hr、脚注、链接三色与标签）。列表经 markdown/reading.js 的 decorateReadingDom 造原版 DOM（.list-bullet 圆点等），首/末块边距用等价选择器复刻原版 el-* 容器规则。
markdown-properties.css: 属性、标签与内容补充规则。
markdown-highlight.css: 阅读、实时预览与源码共用原版 token 色彩。
search.css: 搜索面板、backlinks、outline、tag pane 的专属样式。树基础结构来自 tree.css；面板内边距统一归 .nav-header，本文件不再复写。
properties.css: 出链面板(outgoing-link，逐字移植原版 app.css 的 outgoing-link 段，含未解析链接色)与属性面板(all-properties/file-properties 的原版 data-type 规则、排序栏、只读列表滚动)。
graph.css: 原版图谱颜色探针、筛选控件与折叠面板规则。
popover.css: page-preview 的 .popover/.hover-popover 尺寸与内容规则（逐字移植 app.css）：450px 宽、markdown-embed 400px 限高内部滚动、内容 32px padding、空态/图片/PDF 宽度。
settings.css: 设置页签完整样式，逐字移植原版 app.css 设置段(vertical-tab 导航/内容、setting-item、mod-toggle、设置组头、hotkey 胶囊、.hotkey-filter 筛选芯片、.input-right-decorator 装饰图标与清除按钮让位、CSS 片段列表)。导航 13px/radius-m/无 hover；开关单层 inset，active 排除 disabled。
canvas.css: 画布样式入口。按序导入节点规则与连接线规则。
canvas-nodes.css: 原版画布布局、节点、分组与手柄规则。文本卡片编辑器规则逐字移植 app.css 的 .markdown-source-view.mod-inside-iframe 段（原版编辑器跑在铺满卡片的内嵌 iframe，本复刻内联，10vh 换成卡片高度）：scroller 纵向布局 + 0 16px 内边距、::before/::after 上下留白、sizer 不撑满、--file-margins 归零、不挂行宽 class；另承接原版卡片内 callout 的 mix-blend-mode: normal、非编辑态正文不可选中（user-select: none）与卡片内容层的文本字体上下文（导出取该层计算样式）。末尾补导出弹窗用到的原版类 .modal.mod-narrow(宽度 400px) 与 .u-muted(次级说明文字，仅弹窗内)。
canvas-edges.css: 原版连接线与标签规则、拖动对齐参考线（.canvas-snaps 的 line/circle 取强调色，位于 .canvas-edges 之前），补足本实现编辑控件。
bookmarks.css: 书签树滚动、操作图标与视图头部收藏状态。
slides.css: 全窗口演示覆盖层。.slides-container/.slides-close-btn/.collapse-indicator/.controls 段移植自原版 app.css slides 段；deck/section/progress 为翻页渲染新增；容器 position:fixed 覆盖全窗口(对齐原版)，背景走 --background-primary（原版硬编码 #191919 由 reveal 主题覆盖，此处取应用主题色）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
