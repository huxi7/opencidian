# src/renderer/markdown/

> L2 | 父级: /src/renderer/CLAUDE.md

阅读视图渲染与属性 UI。markdown-it 管线在 reading.js；frontmatter 属性行在 properties.js。

成员清单
reading.js: 渲染管线。导出 getMarkdownIt/renderMarkdown/attachMarkdownInteractions/scrollToSubpath 与转发 source-text.js 的 stripFrontmatter/escapeHtml。扩展：wikilink/embed/tag/highlight/%%注释%%/行内与块级数学/代码块+mermaid 懒加载/footnote/task-lists/callout/内部链接解析/标题锚点。图片与图片嵌入渲染为 `.image-wrapper > img`，尺寸语法落成 img 的 width/height。右键菜单：内部链接与笔记/音视频/PDF 嵌块（workspace.handleLinkContextMenu）、外链（handleExternalLinkContextMenu）、图片（转交 source-text.js 的 fillImageContextMenu）。
source-text.js: 源文本层。把渲染 DOM 映射回源文本：图片尺寸语法解析（parseImageSize/sizeAttrText/splitImageSize/splitEmbedSize/imageSizeSpan，对齐原版 Vx/Hx/c6 与 image/iembed 两个 transformer）、核心规则 installSourceOffsets 按 token 顺序把行内图片与嵌入的源起点写进 token.meta.srcFrom、sourceRangeAttrs 把它落成 DOM 的 data-source-* 提示、fillImageContextMenu 生成原版 h6 的图片右键项（复制图片 → 链接菜单 → 重置大小 → 删除图片）并经编辑器事务改写源文本（isolateHistory 切分组，撤销只回退这一格属性）。escapeHtml/escapeAttr/stripFrontmatter 也在这里，阅读视图与实时预览共用同一套尺寸口径。
highlight.js: 阅读与实时预览共用 Lezer 解析器缓存，生成语义 token 类。
math.js: 懒加载本地 MathJax 3.2.2。串行生成 CHTML，复用字形样式，错误仅回退当前公式。
properties.js: renderProperties。渲染 .metadata-container；读写在 fileManager.processFrontMatter。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
