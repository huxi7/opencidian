# OpenSidian 开曜

> Obsidian 桌面版 1.12.4 的独立开源复刻 —— 用 Electron + CodeMirror 6 从零重建，直接打开你的 `.obsidian` 库。

OpenSidian（中文名「开曜」）不是一个皮肤，而是一次完整的重写：编辑器、视图框架、核心插件、设置系统、主题引擎全部重新实现，目标是与原版 Obsidian 桌面端一致的操作手感与视觉表现。

## 特性

- **编辑器**：CodeMirror 6 实时预览（所见即所得）、源码模式、阅读视图；列表/表格/引用/代码块/标题折叠；MathJax 3 公式；Mermaid 图表；语法高亮。
- **视图框架**：可拖拽分栏、标签页、左右侧栏、功能区、状态栏、工作区布局保存与恢复。
- **核心插件**：文件浏览器、全局搜索、快速切换、命令面板、关系图谱、白板（Canvas）、书签、大纲、标签面板、反向链接、每日笔记、模板、笔记合成器、随机笔记、ZK 前缀、幻灯片演示、文件恢复、工作区。
- **设置系统**：关于 / 编辑器 / 文件与链接 / 外观 / 快捷键 / 核心插件六组页签，主题、CSS 片段、缩放、字体、语言（中文 / English）。
- **库格式兼容**：直接打开 Obsidian 库（`.obsidian/` 配置目录保持原样），不迁移、不锁定你的数据。

## 快速开始

```sh
npm install
npm run build
npm start          # 构建并启动
npm run dev        # 开发模式（watch + 自动重启）
```

首次启动会显示仓库选择窗口：打开一个已有 Markdown 文件夹，或新建一个库。

## 项目结构

```
src/main/         Electron 主进程：窗口、app:// 协议、IPC、原生菜单
src/renderer/
  core/           应用内核：工作区、视图、设置、命令、快捷键、i18n
  editor/         CodeMirror 6 编辑器与实时预览
  markdown/       阅读模式渲染（markdown-it + MathJax + Mermaid）
  plugins-core/   核心插件
  views/          视图实现（设置页、白板、图谱、书签等）
  styles/         逐字对齐原版 app.css 的样式层
scripts/          构建脚本与隔离验收（scripts/acceptance/）
assets/           图标表、字体、离线 MathJax
```

## 验收

```sh
node --experimental-vm-modules src/renderer/core/workspace-regression.js
node scripts/acceptance/run.mjs core-ribbon --no-screenshot
node scripts/acceptance/run.mjs canvas --no-screenshot
```

运行器会在系统临时目录创建隔离测试库，不会触碰你的真实笔记。

## 边界与说明

- 不劫持 `obsidian://` 协议；不读写真实 Obsidian 应用的 userData。
- 社区插件市场未接入；第三方插件运行逻辑保留，默认保持安全模式。
- 本项目与 Obsidian（Dynalist Inc.）无关联，未获其背书。「Obsidian」是其权利人的商标。

## 许可证

待定（LICENSE 文件尚未加入）。
