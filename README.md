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

## 打包分发

```sh
npm install
npm run dist:dir   # 快速验证：release/mac-arm64/OpenSidian.app
npm run dist       # 正式产物：release/*.dmg 与 *.zip
node scripts/smoke-packaged.mjs   # 打包版冒烟（真实启动 + 建文件 + 打开文件）
```

- 当前为**未签名**构建（`electron-builder.yml` 里 `identity: null`）。macOS Gatekeeper 首次打开需右键 → 打开，或 `xattr -dr com.apple.quarantine /Applications/OpenSidian.app`。
- 应用图标由 `scripts/make-app-icon.py` 生成（原创几何设计），可自行替换 `build/icon.icns`。
- 正式对外分发需 Apple 开发者证书：移除 `identity: null` 并配置签名/公证。

## 检查更新（非静默）

OpenSidian 内置**检查更新**（命令面板搜「检查更新」，或启动时后台静默检查）——只做"发现新版本 → 提示 + 打开下载页"，**不静默安装**（macOS 静默更新要求代码签名）。

更新源是**任意静态地址**，在库里写入设置即可（`.obsidian/app.json`）：

```json
{ "updateFeed": "https://api.github.com/repos/<你的账号>/<仓库>/releases/latest", "checkUpdates": true }
```

- **GitHub Releases**：最省事，但中国大陆访问不稳定（时好时坏、下载慢）。
- **国内静态托管**（阿里云 OSS / 腾讯 COS / Cloudflare R2 等）：把 `{ "version": "1.2.3", "url": "下载页或安装包地址" }` 丢成一个静态 JSON，`updateFeed` 指过去即可。**不需要服务器与用户同地区**，只要该域名在用户网络可达。
- 也可两者都放：`updateFeed` 指向你的域名，域名侧回源 GitHub。
- 未配置 `updateFeed` 时**不联网**；`checkUpdates: false` 可关闭后台检查。

## 验收/E2E 模式（不打断你正在做的事）

验收脚本以 `E2E=1` 启动 Electron（`scripts/acceptance/run.mjs` 自动设置）；带 `OBS_ACT` 的直连探针也会自动进入该模式（防止绕过运行器时弹窗）。该开关只改**呈现层**：

- `app.setActivationPolicy('accessory')` + `app.dock.hide()`：不进 Dock、不夺菜单栏、不激活应用；
- 窗口 `focusable: false` + `showInactive()` + **`opacity: 0`（整窗透明）+ 忽略鼠标**：测试窗口完全不可见、键盘/系统焦点不跳走、不遮挡任何界面；
- 所有窗口统一走 `defaultWindowOptions` 工厂，`E2E` 是唯一开关；`npm start` 等正常模式行为不变。

所以后台跑全量回归时，你可以正常看视频/学习/干别的活，不会被测试窗口抢焦点。

## 边界与说明

- 不劫持 `obsidian://` 协议；不读写真实 Obsidian 应用的 userData。
- 社区插件市场未接入；第三方插件运行逻辑保留，默认保持安全模式。
- 本项目与 Obsidian（Dynalist Inc.）无关联，未获其背书。「Obsidian」是其权利人的商标。

## 许可证

MIT License（见 LICENSE）。
