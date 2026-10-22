# src/renderer/

> L2 | 父级: /src/CLAUDE.md

渲染进程。nodeIntegration:true，可直接 require Node 模块。启动入口 main.js；vault 选择窗口入口 starter.js。

成员清单
main.js: 渲染进程入口。顺序：core/dom.js(全局 DOM 助手) → App 构造 → registerBuiltinViews → registerEditorCommands → app.initialize() → registerAppCommands → 布局自动保存 + 全局错误捕获。设置独立窗口与主窗口共用本入口，以 `app.isSettingsWindow`(#settings-window) 分流。
starter.js: 仓库选择窗口 1.14.4（493 行）：titlebar、最近仓库列表、打开/新建两屏、行菜单（重命名/移动/复制 ID/访达/移除）、快速开始、语言/帮助、空态；入口为侧栏库名「管理仓库…」。
index.html: 主窗口骨架，链接 styles/*.css 与 dist/renderer.js。公式由 math.js 懒加载官方资源。
starter.html: 仓库选择窗口骨架，加载 fonts/tokens/base/components/settings/starter 与 dist/starter.js。
core/ - 应用内核 (见 core/CLAUDE.md)
editor/ - CodeMirror 6 编辑器层 (见 editor/CLAUDE.md)
markdown/ - 阅读视图渲染 (见 markdown/CLAUDE.md)
views/ - 内置视图 (见 views/CLAUDE.md)
plugins-core/ - 核心插件 (见 plugins-core/CLAUDE.md)
styles/ - 全部 CSS (见 styles/CLAUDE.md)
locales/ - 从原版提取的 locale-en.json / locale-zh.json，key 命名唯一权威来源；补齐 1.14.4 看板文案。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
