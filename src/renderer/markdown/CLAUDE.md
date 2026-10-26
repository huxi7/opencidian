# src/renderer/markdown/

> L2 | 父级: /src/renderer/CLAUDE.md

阅读视图渲染与属性 UI。markdown-it 管线在 reading.ts；frontmatter 属性行在 properties.ts。

成员清单
reading-dom.ts: 阅读后置装饰。补齐任务列表、代码复制按钮和标题锚点，不读取文件。
reading-types.ts: 阅读与属性共享输入。定义渲染选项、嵌入任务和未知属性值。
markdown-it-task-lists.d.ts: 第三方插件类型适配。连接 ESM MarkdownIt 与任务列表选项。
reading.ts: 渲染管线。可选 AbortSignal 向嵌入、数学和图表传播取消。导出 getMarkdownIt/renderMarkdown/attachMarkdownInteractions/scrollToSubpath 与转发 source-text.ts 的 stripFrontmatter/escapeHtml。子路径滚动与段落块锚点标记委托 reading-subpath.ts。扩展：wikilink/embed/tag/highlight/%%注释%%/行内与块级数学/代码块+mermaid 懒加载/footnote/task-lists/callout/内部链接解析/标题锚点。callout 标题行 softbreak 剥离（正文前无 <br>），图标走 lucide- 原名。图片与图片嵌入渲染为 `.image-wrapper > img`，尺寸语法落成 img 的 width/height。右键菜单：内部链接与笔记/音视频/PDF 嵌块（workspace.handleLinkContextMenu）、外链（handleExternalLinkContextMenu）、图片（转交 source-text.ts 的 fillImageContextMenu）。 .canvas 嵌入改走「画布嵌入」（原版 cte：容器 .canvas-embed + 缩略图 + inline-embed 形态），占位与异步挂载委托 views/canvas-minimap.ts 的 mountCanvasEmbed；目标文件不存在时按原版落 .file-embed.mod-empty 提示。数据库嵌入委托 bases-embed，this 保留宿主文件，# 指定视图；重绘先释放旧订阅。
reading-subpath.ts: 子路径导航与块引用层。解析标题（#Heading）与块引用（#^block-id），管理滚动居中、is-flashing 闪烁与段落 data-block-id 标记。
source-text.ts: 源文本层。把渲染 DOM 映射回源文本：图片尺寸语法解析（parseImageSize/sizeAttrText/splitImageSize/splitEmbedSize/imageSizeSpan，对齐原版 Vx/Hx/c6 与 image/iembed 两个 transformer）、核心规则 installSourceOffsets 按 token 顺序把行内图片与嵌入的源起点写进 token.meta.srcFrom、sourceRangeAttrs 把它落成 DOM 的 data-source-* 提示、fillImageContextMenu 生成原版 h6 的图片右键项（复制图片 → 链接菜单 → 重置大小 → 删除图片）并经编辑器事务改写源文本（isolateHistory 切分组，撤销只回退这一格属性）。escapeHtml/escapeAttr/stripFrontmatter 也在这里，阅读视图与实时预览共用同一套尺寸口径。
highlight.ts: 阅读与实时预览共用 Lezer 解析器缓存，生成语义 token 类；普通变量名不产出 token（Prism JS 对齐）。
math.ts: MathJax 3.2.2 CHTML 与字形样式复用。cancelMath 取消宿主，异步转换只持弱引用。
properties.ts: 文档与侧栏共用属性编辑器。显示类型警告，写回经 FileManager；支持首项添加与属性改名。
properties-types.ts: 库级属性类型事实源。按忽略大小写的键读写 types.json，保留未知配置，监听外部修改。
properties-menu.ts: 按真实输入元素类型读写选区。属性类型与剪贴板菜单。转换前确认，不兼容值保留并提示；剪贴板操作真实选区。

mermaid.ts: 图表适配。共享引擎，单块错误隔离；AbortSignal 和 cancelMermaidBlocks 阻止迟到 SVG。

render-cancel.ts: 阅读流水线取消原语。取消结算等待并清空监听与回调，不保留旧宿主。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
