# src/renderer/styles/

> L2 | 父级: /src/renderer/CLAUDE.md

全部 CSS。加载顺序由 index.html 决定：fonts → tokens → base → layout → components → explorer → editor → markdown → search → properties → graph → settings → canvas → bookmarks → slides。所有颜色/间距/字体一律引用 tokens.css 中的变量，禁止硬编码色值(阴影与罕见例外除外)。

成员清单
starter.css: 仓库选择窗口布局与文件夹入口。
fonts.css: @font-face。Inter(界面) 与 Source Code Pro(等宽)，字体文件在 assets/fonts/。
tokens.css: 设计变量入口。按序导入 foundation 与 interface，保持原版数值。
tokens-foundation.css: 字重与前半全局变量。保留原版规则顺序。
tokens-interface.css: 后半全局变量、明暗主题与字体族。
base.css: 重置、滚动条(仅 body.styled-scrollbars 下生效，macOS 用系统 overlay 滚动条，逐字移植原版)、输入/按钮/开关/滑块基础样式、clickable-icon、.is-hidden。
layout.css: 外层 workspace-root 与中心 mod-root 分开。只给中心文档应用主背景。
workspace-sidebar.css: 原版侧栏图标、库信息栏、开关与 macOS 留白。窄栏保留帮助和设置。
components.css: 菜单、弹窗、建议、通知、悬浮提示、设置外壳与快照历史。原版布局规则保持闭合。通知为右上角固定栈(app.css 7923-7978)，tooltip 含 mod-top/mod-left/mod-right 翻转与 tooltip-arrow(app.css 9324-9445)，建议弹层 .suggestion-container 取 --suggestion-background(app.css 8858-8867)。
tree.css: .tree-item 体系(collapse-icon 尺寸与旋转、tree-item-self/icon/inner/children/flair)，逐字移植自原版 app.css 7263-7287 与 9446-9591。全部树视图共用。
explorer.css: .nav-* 文件树层(标题内容、nav-file-tag、拖拽高亮)，被 explorer/outline/tag 面板共用。基础结构来自 tree.css。
editor.css: CodeMirror 与 live preview(HyperMD-*)、inline-title、media 视图。含原版 file layout（.cm-sizer/.cm-contentContainer 布局、is-readable-line-width 的 --file-line-width 居中、.cm-line padding 0、.cm-gutters folding offset）与阅读视图 sizer 居中。
markdown.css: 阅读样式入口，按原顺序导入内容、属性与高亮规则。
markdown-content.css: 阅读排版、表格、代码、引用与嵌入。
markdown-properties.css: 属性、标签与内容补充规则。
markdown-highlight.css: 阅读、实时预览与源码共用原版 token 色彩。
search.css: 搜索面板、backlinks、outline、tag pane 的专属样式。树基础结构来自 tree.css。
properties.css: 出链面板(outgoing-link，逐字移植原版 app.css 的 outgoing-link 段，含未解析链接色)与属性面板(all-properties/file-properties 的原版 data-type 规则、排序栏、只读列表滚动)。
graph.css: 原版图谱颜色探针、筛选控件与折叠面板规则。
popover.css: page-preview 的 .popover/.hover-popover 尺寸与内容规则（逐字移植 app.css）。
settings.css: 设置页签完整样式，逐字移植原版 app.css 设置段(vertical-tab 导航/内容、setting-item、mod-toggle、设置组头、hotkey 胶囊、.hotkey-filter 筛选芯片、.input-right-decorator 装饰图标与清除按钮让位、CSS 片段列表、installed-plugins-container、community 免责行 .setting-icon 与 .community-modal-button-container、.mod-trust-folder 宽度)。
canvas.css: 画布样式入口。按序导入节点规则与连接线规则。
canvas-nodes.css: 原版画布布局、节点、分组与手柄规则。
canvas-edges.css: 原版连接线与标签规则、拖动对齐参考线（.canvas-snaps 的 line/circle 取强调色，位于 .canvas-edges 之前），补足本实现编辑控件。
bookmarks.css: 书签树滚动、操作图标与视图头部收藏状态。
slides.css: 全窗口演示覆盖层。.slides-container/.slides-close-btn/.collapse-indicator/.controls 段移植自原版 app.css slides 段；deck/section/progress 为翻页渲染新增；容器 position:fixed 覆盖全窗口(对齐原版)，背景走 --background-primary（原版硬编码 #191919 由 reveal 主题覆盖，此处取应用主题色）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
