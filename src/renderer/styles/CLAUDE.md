# src/renderer/styles/

> L2 | 父级: /src/renderer/CLAUDE.md

全部 CSS。加载顺序由 index.html 决定：fonts → tokens → base → layout → components → explorer → editor → markdown → search → graph → settings → canvas → bookmarks → slides → katex。所有颜色/间距/字体一律引用 tokens.css 中的变量，禁止硬编码色值(阴影与罕见例外除外)。

成员清单
fonts.css: @font-face。Inter(界面) 与 Source Code Pro(等宽)，字体文件在 assets/fonts/。
tokens.css: 901 个从原版提取的设计变量。body 级字体族变量在末尾。
base.css: 重置、滚动条(仅 body.styled-scrollbars 下生效，macOS 用系统 overlay 滚动条，逐字移植原版)、输入/按钮/开关/滑块基础样式、clickable-icon、.is-hidden。
layout.css: 应用外壳。ribbon/workspace-split/tabs/leaf/view-header/status-bar。方向语义见 L1 规则 4。
components.css: 菜单、弹窗、prompt/suggestion、notice、tooltip、空状态、设置外壳与 setting-item、collapse-indicator/text-icon-button。
tree.css: .tree-item 体系(collapse-icon 尺寸与旋转、tree-item-self/icon/inner/children/flair)，逐字移植自原版 app.css 7263-7287 与 9446-9591。全部树视图共用。
explorer.css: .nav-* 文件树层(标题内容、nav-file-tag、拖拽高亮)，被 explorer/outline/tag 面板共用。基础结构来自 tree.css。
editor.css: CodeMirror 与 live preview(HyperMD-*)、inline-title、media 视图。
markdown.css: 阅读视图排版、callout、代码块、表格、embed、properties。
search.css: 搜索面板、backlinks、outline、tag pane 的专属样式。树基础结构来自 tree.css。
graph.css: 图谱视图(占位，随 graph 插件补全)。
settings.css: 设置页签完整样式，逐字移植原版 app.css 设置段(vertical-tab 导航/内容、setting-item、mod-toggle、设置组头、hotkey 胶囊、CSS 片段列表)。
canvas.css: 画布视图(占位)。
slides.css: 幻灯片视图。.slides-container/.slides-close-btn/.collapse-indicator/.controls 段移植自原版 app.css slides 段；deck/section/progress 为视图内翻页新增；容器填满 leaf(原版为全屏覆盖层)，背景走 --background-primary。
