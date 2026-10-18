# src/renderer/markdown/

> L2 | 父级: /src/renderer/CLAUDE.md

阅读视图渲染与属性 UI。markdown-it 管线在 reading.js；frontmatter 属性行在 properties.js。

成员清单
reading.js: renderMarkdown/attachMarkdownInteractions/scrollToSubpath/stripFrontmatter。扩展：wikilink/embed/tag/highlight/%%注释%%/行内与块级数学/代码块+mermaid 懒加载/footnote/task-lists/callout/内部链接解析/标题锚点。右键菜单：内部链接与笔记/音视频/PDF 嵌块（workspace.handleLinkContextMenu）、外链（handleExternalLinkContextMenu）、图片复制（data-href 解析，库内读二进制 / URL 走 fetch）。
highlight.js: 阅读与实时预览共用 Lezer 解析器缓存，生成语义 token 类。
math.js: 懒加载本地 MathJax 3.2.2。串行生成 CHTML，复用字形样式，错误仅回退当前公式。
properties.js: renderProperties。渲染 .metadata-container；读写在 fileManager.processFrontMatter。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
