# OpenSidian

> Obsidian 桌面版 1.14.4 的独立开源复刻 —— 用 Electron + CodeMirror 6 从零重建，直接打开你的 `.obsidian` 库。

OpenSidian 不是一个皮肤，而是一次完整的重写：编辑器、视图框架、核心插件、设置系统、主题引擎全部重新实现，目标是与原版 Obsidian 桌面端一致的操作手感与视觉表现。

## 特性

- **编辑器**：CodeMirror 6 实时预览（所见即所得）、源码模式、阅读视图；列表/表格/引用/代码块/标题折叠；MathJax 3 公式；Mermaid 图表；语法高亮；`[[` 链接补全按原版单列浮窗（含算子建议与搜索历史）。
- **视图框架**：可拖拽分栏、标签页、左右侧栏、功能区、状态栏、工作区布局保存与恢复；页头模式钮图标随编辑/阅读视图实时切换。
- **核心插件**：Bases 数据库（表格/列表/卡片/看板、分组汇总、公式、CSV、笔记嵌入）、文件浏览器、全局搜索（虚拟列表 + 字段/属性/范围查询 + 解释视图 + 复制结果）、快速切换、命令面板、关系图谱（触屏拖拽/捏合/颜色组）、白板 Canvas（卡片/分组/连线/嵌入/导出/白板设定）、书签、大纲、标签面板、反向链接、每日笔记、模板、笔记合成器、随机笔记、ZK 前缀、幻灯片演示、文件恢复、工作区。
- **设置系统**：独立可拖动设置窗口，七组页签（关于 / 外观 / 界面 / 编辑器 / 文件与链接 / 快捷键 / 核心插件），含跨页签设置搜索（含别名匹配）、主题管理、CSS 片段、缩放、字体、语言（中文 / English）。
- **库格式兼容**：直接打开 Obsidian 库（`.obsidian/` 配置目录保持原样），不迁移、不锁定你的数据。

## 快速开始

```sh
npm install
npm run build
npm start          # 构建并启动
npm run dev        # 开发模式（watch + 自动重启）
```

首次启动会显示仓库选择窗口：打开一个已有 Markdown 文件夹，或新建一个库。

数据库入口：点击左侧功能区的列表布局图标「新建数据库」，或空标签页、文件夹右键菜单的「新建数据库」。打开已有数据库时，直接点击文件树中的 `.base` 文件。

侧栏文件树、书签、标签、反链、全部属性工具按钮统一靠左，首个图标与文件树保持同一横纵起点，顶部工具标签保持自然宽度。文件视图头只保留视图动作和竖三点，默认应用入口放在文件菜单内。

数据库顶部可切换视图、排序、分组、筛选、选择属性和搜索。表格单元格双击或按 Enter/F2 编辑；拖动列边界调整宽度。工具栏「新建」立即创建笔记，并打开就地编辑器。入口随设置 → 核心插件 → 数据库的开关启停。

升级本轮代码后，请完整退出并重启 OpenSidian（源码运行用 `npm start`）。主进程新增了窗口与写盘 IPC，仅用 ⌘R 刷新不能加载它们。

## 项目结构

```
src/main/         Electron 主进程：窗口、app:// 协议、IPC、原生菜单
src/renderer/
  core/           应用内核：工作区、视图、设置、命令、快捷键、i18n
  editor/         CodeMirror 6 编辑器、实时预览、链接补全浮窗
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

- 正式隔离 E2E 场景 **87 个**（不含 `probe-*` 诊断）。本轮有效覆盖 **120 次 / 7533 条断言**，包含焦点补修；完整执行的原始结果、失败与实际计数见 [验收报告](scripts/acceptance/RESULTS.md) 和 [逐条回执](scripts/acceptance/SIDEBAR-RECEIPTS.json)。运行器只操作带标记的临时库。
- E2E 在真实 Electron 内验证 DOM、事件、写盘与资源释放；Node/VM 逻辑检查单独计数。
- 本轮工作区逻辑回归 **30/30**；另有真实 GC/DOM/事件/Worker 生命周期验收。公式与 CSV 单测 **273 + 11** 条通过，完整数字与验证边界见报告。

## 打包分发

```sh
npm install
npm run dist:dir   # 快速验证：release/mac-arm64/OpenSidian.app
npm run dist       # 正式产物：release/*.dmg 与 *.zip
node scripts/smoke-packaged.mjs --no-screenshot  # ASAR 核对 + 隔离真实启动 + 正常退出
```

- 当前为**未签名**构建（`electron-builder.yml` 里 `identity: null`）。macOS Gatekeeper 首次打开需右键 → 打开，或 `xattr -dr com.apple.quarantine /Applications/OpenSidian.app`。
- 当前目录包：`release/mac-arm64/OpenSidian.app`，版本 **1.14.4**，打包冒烟 **71/71**；许可证原文随 ASAR 分发。本轮没有生成或更新 DMG/ZIP。
- 冒烟先核对身份、版本和当前构建哈希，拒绝启动陈旧包；回执后等待正常退出。超时明确失败，只清理自建进程组。
- 应用图标由 `scripts/make-app-icon.py` 生成（原创几何设计），可自行替换 `build/icon.icns`。
- 正式对外分发需 Apple 开发者证书：移除 `identity: null` 并配置签名/公证。

## 检查更新（非静默）

OpenSidian 内置**检查更新**（命令面板搜「检查更新」，或启动时后台静默检查）——只做"发现新版本 → 提示 + 打开下载页"，**不静默安装**（macOS 静默更新要求代码签名）。

更新源是**任意静态地址**，在库里写入设置即可（`.obsidian/app.json`）：

```json
{ "updateFeed": "https://api.github.com/repos/huxi7/opencidian/releases/latest", "checkUpdates": true }
```

- **GitHub Releases**：最省事，但中国大陆访问不稳定（时好时坏、下载慢）。
- **国内静态托管**（阿里云 OSS / 腾讯 COS / Cloudflare R2 等）：把 `{ "version": "1.2.3", "url": "下载页或安装包地址" }` 丢成一个静态 JSON，`updateFeed` 指过去即可。**不需要服务器与用户同地区**，只要该域名在用户网络可达。
- 也可两者都放：`updateFeed` 指向你的域名，域名侧回源 GitHub。
- 未配置 `updateFeed` 时**不联网**；`checkUpdates: false` 可关闭后台检查。

## 验收/E2E 模式（不打断你正在做的事）

验收脚本以 `E2E=1` 启动 Electron（`scripts/acceptance/run.mjs` 自动设置）；带 `OBS_ACT` 的直连探针也会自动进入该模式（防止绕过运行器时弹窗）。该开关只改**呈现层**与**外部副作用**：

- `app.setActivationPolicy('accessory')` + `app.dock.hide()`：不进 Dock、不夺菜单栏、不激活应用；
- 窗口 `focusable: false` + `showInactive()` + **`opacity: 0`（整窗透明）+ 忽略鼠标**：测试窗口完全不可见、键盘/系统焦点不跳走、不遮挡任何界面；
- 主进程拦截全部外部唤起（`open-external` / `open-url` / `help` / 访达 / 打开路径 / 打印后打开）：**不会在你跑验收时突然弹出浏览器或访达**；
- 所有窗口统一走 `defaultWindowOptions` 工厂，`E2E` 是唯一开关；`npm start` 等正常模式行为不变。

所以后台跑全量回归时，你可以正常看视频/学习/干别的活，不会被测试窗口抢焦点。

## 全量验收

```bash
sh scripts/acceptance/full.sh --output /tmp/opensidian-full
```

入口自持构建锁、先构建再串行运行全部正式场景，含重启与链式阶段。
所有执行都使用 `--no-screenshot`，窗口不可见且不抢焦点。
输出 `summary.json`、`summary.txt` 与逐次日志；失败返回非零。

## 已知边界

- **Bases**：四类布局、分组汇总、单元格编辑、列宽/列序、类型候选、新组、就地新建与两层虚拟滚动已接通。日期/链接/列表分组和 `file.folder` 可写；公式、派生对象和其它文件属性只读。HTML 先净化，Markdown 使用完整阅读管线。超预算表达式明确报错。特殊流式或锚点冲突的 YAML 写回保留值，不能保留全部排版。
- **画布导出**：真实 PNG 使用整窗分块，最长边 16284 像素，分配前检查 512 MiB 预算。隐私模式使用自绘字形并保留媒体；没有复制许可不明的原版字体，字形不宣称一致。
- **桌面兼容**：文档底部反链、默认应用打开、macOS vibrancy 已接通；库根 `obsidian.css` 开关和热更新为兼容扩展。文档可移动或复制到独立窗口，同库编辑同步，窗口布局与缩放可恢复；macOS 缺省使用系统菜单，可切回主题菜单。

- **不覆盖的原版功能**（按约定不做，不做假 UI）：第三方/社区插件生态（整体移除）、Sync、Publish、Web Viewer、slash-command、密钥链、账户、insider build。
- **验证边界**：本轮以原版静态包、真实 DOM/事件与写盘验收对齐，未做截图像素对比；社区主题的下载/更新未接通，Windows 平台未真机验证。
- 不劫持 `obsidian://` 协议；不读写真实 Obsidian 应用的 userData。
- 本项目与 Obsidian（Dynalist Inc.）无关联，未获其背书。「Obsidian」是其权利人的商标。

## 许可证

GNU Affero General Public License v3.0（AGPL-3.0，见 [LICENSE](LICENSE)）。

- 源码地址：<https://github.com/huxi7/opencidian>（本仓库即该版本的**完整对应源码**，满足 AGPL 第 13 条的源码提供要求）。
- 转载、二次分发或基于本项目提供网络服务时，请保留版权声明与许可证全文，并按 AGPL-3.0 提供修改后的对应源码。
