# src/renderer/editor/

> L2 | 父级: /src/renderer/CLAUDE.md

CodeMirror 6 编辑器层。Editor 类向视图暴露 Obsidian Editor API 子集；live-preview 是唯一的装饰器；completions 提供 [[链接]] 补全。

成员清单
editor.js: Editor 包装。构造原版 file layout DOM（.cm-scroller > .cm-sizer > .cm-contentContainer > .cm-gutters + .cm-content，_buildSizerDom；gutter 挂载的 insertBefore 重定向到 contentContainer）。持有 CM6 EditorView 与 _rootEl；暴露 getValue/setValue/getLine/replaceSelection/listSelections/posToOffset 等；updateListener → onChange 回调。Compartments：folding(标题与缩进开关)、theme/livePreview/readonly/lineNumbers/wrap/keymap/ext/indent(缩进单位+Tab 宽度,随 useTab/tabSize 热重配)/brackets(自动补全标点,随 autoPairBrackets)。setSpellcheck 切换拼写；系统外部文件拖入复制进库并插入嵌入（Alt/Ctrl 直链）；滚动使用 SelectionRange，setCursor 接受位置对象。
attachments.js: 附件落盘。saveAttachment 按 attachmentFolderPath 选目录、重名追加序号、vault.createBinary 写入；拖入与 attach-file 命令共用。
editor-menu.js: 编辑器右键菜单（拼写建议 → 链接 → 剪贴板 → 链接插入 → 文本格式 → 段落设置 → 插入 → 复制路径），先触发 workspace 的 editor-menu 事件再显示；桌面端向主进程申请 context-menu 参数（90ms 超时）。
live-preview.js: ViewPlugin。隐藏光标外语法；渲染 checkbox/bullet/图片/MathJax CHTML/hr/wikilink 部件；行级 HyperMD-* 类(header/quote/codeblock/list/task)；依赖 view.__sourcePath 解析相对路径。
folding.js: 标题与缩进范围按文档缓存。事务过滤禁止语法回退绕过设置。
completions.js: [[wikilink]] 自动补全(文件建议 + 锚点)。
editor-commands.js: registerEditorCommands(app)。注册 editor:* 与 markdown:* 命令。含 set-heading-1..6/0（按行改写前缀）、toggle-blockquote、clear-formatting（选区去标记）、attach-file（选文件复制进库并插入嵌入）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
