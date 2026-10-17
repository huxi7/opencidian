# Obsidian Copy - Obsidian 桌面版 1.12.4 的 1:1 复刻

Electron 33 + esbuild + CodeMirror 6 + markdown-it + 原生 CSS 变量主题

<directory>
src/ - 全部源码 (2 子目录)
  main/ - Electron 主进程：窗口、app:// 协议、IPC、原生菜单；dev-hooks 承接验收
  renderer/ - 渲染进程：应用主体 (6 子目录: core, editor, markdown, views, plugins-core, styles)
scripts/ - 构建脚本 (esbuild 打包 + 资源复制)
assets/ - 从原版提取的事实型资产 (图标表、字体)
_analysis/ - 原版解包产物 (app.asar/obsidian.asar)，只读参考资料
dist/ - esbuild 输出 (renderer.js, starter.js, katex.css)
</directory>

<config>
package.json - 依赖与脚本 (build/watch/start/dev)
scripts/build.mjs - 打包入口: src/renderer/main.js → dist/renderer.js
scripts/dev.mjs - 开发模式 (watch + electron 热重启)
src/renderer/index.html - 主窗口 HTML，链接 styles/*.css 与 dist/renderer.js；画布和变量样式按序导入分片
src/renderer/starter.html - 仓库选择窗口 HTML
</config>

<rules>
1. 复刻原则：只依据观察到的行为与设计事实重建，不搬运原版专有代码。可复用的"事实型资产"：图标表、locale、CSS 设计变量 tokens、快捷键表。
2. 不劫持系统 obsidian:// 协议；不读写真实 Obsidian 的 userData。
3. CSS class 命名与 DOM 结构对齐原版 (app.css 为对照源)：.workspace-split/.workspace-leaf/.nav-file/.markdown-source-view 等。
4. 分割方向语义：.mod-vertical = 横向排列 (row)，.mod-horizontal = 纵向堆叠 (column)。
5. 视图生命周期：setViewState → view._rootEl=createDiv('view-content') → load() → setState(state) → _ensureLeafDom。
6. 插件 id 与 .obsidian/core-plugins.json 一致 (file-explorer, global-search, switcher...)。
7. 单文件 ≤800 行；超出即重构。
</rules>

[PROTOCOL]: 变更时更新此头部，然后检查 src/CLAUDE.md 与本文件
