# src/renderer/styles/

> L2 | 父级: /src/renderer/CLAUDE.md

全部 CSS。加载顺序由 index.html 决定：fonts → tokens → base → layout → components → explorer → editor → markdown → search → graph → settings → canvas → bookmarks → slides。所有颜色/间距/字体一律引用 tokens.css 中的变量，禁止硬编码色值(阴影与罕见例外除外)。

成员清单
starter.css: 仓库选择窗口布局与文件夹入口。
fonts.css: @font-face。Inter(界面) 与 Source Code Pro(等宽)，字体文件在 assets/fonts/。
tokens.css: 设计变量入口。按序导入 foundation 与 interface，保持原版数值。
tokens-foundation.css: 字重与前半全局变量。保留原版规则顺序。
tokens-interface.css: 后半全局变量、明暗主题与字体族。
base.css: 重置、滚动条(仅 body.styled-scrollbars 下生效，macOS 用系统 overlay 滚动条，逐字移植原版)、输入/按钮/开关/滑块基础样式、clickable-icon、.is-hidden。
layout.css: 应用外壳。ribbon/workspace-split/tabs/leaf/view-header/status-bar。方向语义见 L1 规则 4。
components.css: 菜单、弹窗、建议、通知、设置外壳与快照历史。原版布局规则保持闭合。
tree.css: .tree-item 体系(collapse-icon 尺寸与旋转、tree-item-self/icon/inner/children/flair)，逐字移植自原版 app.css 7263-7287 与 9446-9591。全部树视图共用。
explorer.css: .nav-* 文件树层(标题内容、nav-file-tag、拖拽高亮)，被 explorer/outline/tag 面板共用。基础结构来自 tree.css。
editor.css: CodeMirror 与 live preview(HyperMD-*)、inline-title、media 视图。
markdown.css: 阅读样式入口，按原顺序导入内容、属性与高亮规则。
markdown-content.css: 阅读排版、表格、代码、引用与嵌入。
markdown-properties.css: 属性、标签与内容补充规则。
markdown-highlight.css: 阅读、实时预览与源码共用原版 token 色彩。
search.css: 搜索面板、backlinks、outline、tag pane 的专属样式。树基础结构来自 tree.css。
graph.css: 原版图谱颜色探针、筛选控件与折叠面板规则。
settings.css: 设置页签完整样式，逐字移植原版 app.css 设置段(vertical-tab 导航/内容、setting-item、mod-toggle、设置组头、hotkey 胶囊、CSS 片段列表)。
canvas.css: 画布样式入口。按序导入节点规则与连接线规则。
canvas-nodes.css: 原版画布布局、节点、分组与手柄规则。
canvas-edges.css: 原版连接线与标签规则，补足本实现编辑控件。
bookmarks.css: 书签树滚动、操作图标与视图头部收藏状态。
slides.css: 幻灯片视图。.slides-container/.slides-close-btn/.collapse-indicator/.controls 段移植自原版 app.css slides 段；deck/section/progress 为视图内翻页新增；容器填满 leaf(原版为全屏覆盖层)，背景走 --background-primary。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
