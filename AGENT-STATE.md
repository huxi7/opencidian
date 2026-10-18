# AGENT-STATE — 复刻项目记忆（给 AI 自己看的进度与事实库）

> 本文件不属于 GEB 文档体系，是 agent 的跨上下文记忆。每次重要推进后更新。
> 更新时机：阶段完成 / 提交前后 / 发现关键事实 / 子代理交付验收后。
> **交接安排以 §10 为准；实现状态见 §9，功能边界见 §8。§3 和 §7 是历史记录。**

---

## 0. 项目身份

- 项目名：**OpenSidian**（包名 `opensidian`，中文名「开曜」）。2026-10-17 完成品牌化改名：产品名、窗口标题、菜单、About 页、README、包名、userData 目录全部改为 OpenSidian；库内配置目录继续使用 `.obsidian`（数据格式兼容的一部分，禁止改名）。
- 目标：1:1 复刻 macOS 上的 Obsidian 1.12.4 桌面版（/Applications/Obsidian.app）。
- 仓库位置：`/Users/link/Desktop/opencidian`（本仓库；文件夹名为用户所改）。HANDOFF.md 已按用户要求删除，交接信息以本文件为准。
- 技术栈：Electron 33 + esbuild（bundle/iife/chrome120，Node 内置 external）；renderer `nodeIntegration:true`；编辑器 CM6；阅读渲染 markdown-it。
- 用户约束（铁律）：
  1. 不劫持 `obsidian://` 协议；不干扰真实 Obsidian 数据。
  2. 第三方/社区插件**暂不做**（市场不接入）；**自带核心插件要做**。
  3. 设置功能是重中之重，必须可用。
  4. 用 REA 工作流：静态/行为分析 → 常规工具重建；不搬运专有代码。
  5. GEB 分形文档：L1 `/CLAUDE.md`、L2 模块 `CLAUDE.md`、L3 文件头 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`；改代码必须回环更新文档；单文件 ≤800 行。
  6. CSS/布局一切以 `_analysis/obsidian-asar/app.css`、`app.js` 为事实源，逐字移植。
  7. 提交策略：按阶段提交（用户授权 agent 自行决定时机）。

## 1. 事实源（_analysis，未入库）

- `_analysis/obsidian-asar/app.js` — 原版主 bundle（反混淆片段可 grep）。
- `_analysis/obsidian-asar/app.css` — 原版样式（逐字移植来源）。
- 图标链：36 自有图标 + 152 别名 + Lucide；解析键双类 `svg-icon <key>`。
- 原版设置宿主类 `fte`（我们复刻为 SettingsHost）；页签基类 `U1`；组构建器 `Hk`；控件 `Wk/jk/Uk/Jk/Gk/Kk/eC`。
- 原版页签：`O7`=关于、`nte`=编辑器、`lte`=文件与链接、`Jee`=外观、`w0`=快捷键、`dte`=核心插件、`tte`=第三方插件。
- app.json 关键键：`focusNewTab`、`defaultViewMode`（source|preview）、`livePreview`（bool）、`promptDelete`、`deleteUnlinkedAttachments`（ask|always|never）、`trashOption`（system|local|none）、`openBehavior`（''|new|daily|file:<path>）、`attachmentFolderPath`（'/'|'./'|'./sub'|'name'）、`userIgnoreFilters`、`baseFontSizeAction`。
- 原版外观细节：`--indent-size` = tabSize；`document.documentElement.style.fontSize` = baseFontSize；缩放在 `webFrame.setZoomLevel`（slider -2.5..3 step .5，pretty=round(100*1.2^z)%）。
- locale：**扁平点号键**（如 `setting.editor.option-spellcheck`），zh 2510 键 / en 2517 键。`t()` 缺键返回键末段；设置界面用 `tt(key, fallback)` 兜底。
- 语言：`app.getLocale()` → 本机 `zh-CN`；`setLanguage` 写 localStorage `language`；**必须在任何界面模块构造之前设置**（renderer/main.js 顶部已修）。

## 2. 运行与验证套路

```sh
# 构建
npm run build

# 历史截图方式（当前用户已停止视觉验收；日常使用 §10 无截图命令）
T=/private/var/folders/st/nd9_l9b17zs6x6bg2cmysqph0000gn/T/opencode
OBS_ALLOW_MULTI=1 OBS_VAULT_PATH=$T/vault-main OBS_SCREENSHOT=$T/shot.png OBS_SCREENSHOT_DELAY=5000 OBS_SCREENSHOT_EXIT=1 npx electron . > $T/run.log 2>&1

# 打开文件 / 打开设置页签 / 执行命令 / 求值（dev 钩子，env 门控）
OBS_OPEN_FILE=test.md
OBS_ACT='{"action":"open-settings","tab":"appearance"}'
OBS_ACT='{"action":"exec","command":"app:open-settings"}'
OBS_ACT='{"action":"eval","js":"JSON.stringify(app.settings.appSettings)"}'
OBS_DUMP=1        # DOM dump
OBS_DUMP_HTML=.modal  # 单元素 outerHTML
OBS_SCREENSHOT_RECT=x,y,w,h
```

- 测试 vault：主代理 `$T/vault-main`；子代理 `$T/vault-test`（避免互踩）。`OBS_ALLOW_MULTI=1` 跳过单实例锁。
- OBS_ACT 支持：`open`（file）/ `open-settings`（tab）/ `exec`（command）/ `eval`（js，仅 dev 钩子直接执行）；一个进程只能发一个 OBS_ACT，多步操作在 eval 里先 `app.commands.executeCommandById(...)` 再探测。
- zsh 坑：不要用 `${var:+OBS_ACT="$var"}` 这类展开（会被当成命令执行），直接写完整命令。
- 判定脚本正确性：日志 `grep -E "dev\] eval|act failed"` + `grep -icE 'uncaught|typeerror|referenceerror'`。

## 3. 阶段进度

### 已完成
- [x] 侦察 + 资产提取（图标/locale/CSS 变量/快捷键表）。
- [x] 脚手架、数据层（vault/metadata/settings）、基础设施（DOM 助手/事件/通知/模态/菜单/suggest）、编辑器层、阅读渲染、视图框架、9 个核心插件、全部 CSS 骨架。
- [x] 实时预览块级 widget、properties、图标系统、树形体系、.obsidian 隐藏、GEB 文档回填。
- [x] 6 个核心插件桩注册（graph/canvas/bookmarks/daily-notes/templates/note-composer）+ styles 链接。
- [x] **设置功能主体**（本阶段）：
  - `core/setting.js`：Setting/SettingGroup/SettingTab + 全部控件（DOM 对齐原版）。
  - `core/i18n.js`：新增 `tt(key, fallback, vars)`；`detectLanguage(systemLocale)`。
  - `views/settings-view.js`：SettingsHost 重写（三组导航 options/core/community、openTab/closeActiveTab/openTabById/openPluginOptions/onOpen/onClose）。
  - `views/settings-tabs.js`：About/Editor/File（含 Vim 验证弹窗、忽略文件弹窗）。
  - `views/settings-tabs-appearance.js`：外观（基础颜色/主题色/主题/界面/字体+字体管理弹窗/高级：缩放·原生菜单·窗口边框·硬件加速/CSS 片段）。
  - `views/settings-tabs-plugins.js`：Hotkeys（搜索/筛选/冲突/录制弹窗）、CorePlugins（齿轮→openPluginOptions）、CommunityPlugins（安全模式语义）。
  - `styles/settings.css` 整体重写（逐字移植）；`styles/components.css` modal 基座对齐。
  - 配置键对齐原版 app.json（focusNewTab/smartIndentList/promptDelete/deleteUnlinkedAttachments/trashOption(none)/openBehavior/defaultViewMode(source|preview)+livePreview）。
  - fileManager：附件路径四语义、trash none、promptDelete；workspace：defaultViewMode 映射 + focusNewTab 后台开标签；app.js：`_applyCustomCss()`（主题+片段注入）、`_runOpeningBehavior()`、Ctrl+滚轮字号、`--indent-size`、根字号、settings 'change' 监听修复、bootTime；main.js：frameWindowOptions（hidden/custom/native）、disable-gpu 读写、locale ipc、dev OBS_ACT eval。
  - 验证：全部 7 个页签截图渲染正常，日志零报错。
- [x] **滚动条保真修复**：原版 macOS 不加 `body.styled-scrollbars`（用系统 overlay 滚动条）；base.css 全局强制样式已改为原版 `body.styled-scrollbars` 前缀逐字移植；app.js 非 macOS 才加 class。
- [x] **编辑器设置即时生效**：editor.js 新增 `_indentCompartment`（useTab/tabSize 热重配）+ `_bracketsCompartment`（autoPairBrackets）+ `setSpellcheck`；markdown-view `_applyEditorSettings` 统一接线（行号/缩进/括号/拼写/阅读重渲染）。
- [x] **实时预览代码块 + mermaid widget**：live-preview.js 新增 `CodeBlockWidget`（<pre><code class=language-x>）与 `MermaidWidget`（复用 reading.js 抽出的 `renderMermaidBlocks`）；classifyBlocks 捕获围栏代码块（含 lang）；editor.css 补 `.lp-codeblock`/`.cm-lp-mermaid` 样式。两视图均已截图验证。
- [x] **dev 钩子增强**：`OBS_ALLOW_MULTI=1` 跳过单实例锁（多代理并行测试不再互杀）；主代理专用测试 vault `$T/vault-main`（子代理用 `$T/vault-test`，避免互踩）。
- [x] **build.mjs**：`chokidar`/`fsevents` 加入 external（原生 .node 不可打包；renderer 有 nodeIntegration，esbuild __require 垫片委托真实 require）。
- [x] **原版默认配置逐字对齐**：settings.js 重写 DEFAULT_APP_SETTINGS/DEFAULT_APPEARANCE_SETTINGS（DC 桌面全套默认值：alwaysUpdateLinks:false、spellcheck:true、readableLineLength:true、propertiesInDocument:"visible"、useTab:true、tabSize:4、showViewHeader/showRibbon:true、attachmentFolderPath:"/"、newLinkFormat:"shortest"、defaultViewMode:"source"、trashOption:"system"、pdfExportSettings{...} 等）+ 新增 `get config()`（app.json + appearance.json 合并，appearance 优先，对齐原版 vault.config）；DEFAULT_CORE_PLUGINS 修正 outgoing-link:true、file-recovery:true；app.js/workspace.js/settings-tabs-appearance.js 读写全部改走 config/appearance。
- [x] **重命名链接更新（对齐原版语义，端到端验证通过）**：
  - `_countAffectedLinks(oldPath)` 在重命名**前**快照受影响链接（`sources: 源文件 → 命中链接目标集合`）。
  - `updateLinks(oldPath, file, affected)` 按快照精确匹配。根因：弹窗等待期间 metadataCache 会重解析并清掉 resolvedLinks 旧键，实时扫描必然落空（之前"总是更新后文本不变"的原因）。
  - `generateMarkdownLink(file, source, subpath, alias, linkStyle)` 第 5 参保持既有链接格式（'wiki'|'markdown'）。
  - 四形态验证：`[[B]]→[[C]]`、`[[B|别名]]→[[C|别名]]`、`[标记](B.md)→[标记](C.md)`、`![[B]]→![[C]]`；"不做更新"保持原样。
- [x] **图谱渲染修复（两处，fresh/restored 布局均验证）**：
  1. renderer.onResize：首次拿到真实尺寸时 resetPan（构造时容器未布局 → pan=(0,0)，updateZoom 围绕屏幕中心缩放把 pan 算成负值 → 节点全在视口外）。
  2. renderer 加 ResizeObserver：视图打开时容器可能 0x0，拿到真实尺寸后重建画布（fresh layout 命令打开图谱 canvas 0x0 的根因）。
  - 验证数据：canvas 1008x1388（dpr 2）、pan (504,694)、4 节点 1 连线正常渲染。

### 接任前子代理交付快照（历史记录，现状见 §8）
- canvas / bookmarks+4 插件 / graph / R1 五插件 四个子代理均因 "Rate limit exceeded" 终止，**非正常完成**；产物在磁盘上，build 通过、registry 全部注册（20 模块）。
- graph：`plugins-core/graph.js`（**1119 行 ⚠️ 超 800 上限，待拆分**）、`views/graph-view.js`（800 行整）、`styles/graph.css`。**已验收**（渲染正常；交互未抽查）。
- canvas：`plugins-core/canvas.js`、`views/canvas-view.js`/canvas-node.js/canvas-edge.js/canvas-interactions.js/canvas-menu.js/canvas-utils.js/canvas-viewport.js、`styles/canvas.css`。**未验收**。
- bookmarks：`plugins-core/bookmarks.js`（464 行）、`views/bookmarks-view.js`、`styles/bookmarks.css`。**部分验收**（bookmarks:open 可打开、零报错）。
- daily-notes / templates / note-composer：文件完整（12-16KB），daily-notes/templates 已导出 `settingTab(app, containerEl)`。**未验收**。
- R1 五插件：file-recovery（449 行）、random-note、zk-prefixer、workspaces、slides（+`views/slides-view.js`、`styles/slides.css`）。**未验收**。
- 验收标准：build 通过 + 日志零报错 + 打开视图/执行命令截图 + 交互抽查（新建/编辑/持久化）。

### 接任前待办（历史记录，现状见 §8）
1. **核心插件逐个验收**（子代理产物，见上节）：canvas（新建/打开/节点编辑/连线）→ bookmarks（添加/删除/分组/持久化）→ graph 交互抽查（拖拽/筛选/局部图/右键菜单）→ daily-notes（打开今日）→ templates（插入模板 + 设置页签）→ note-composer（创建笔记）→ file-recovery（快照列表/恢复）→ random-note → zk-prefixer → workspaces（保存/加载布局）→ slides（演示模式）。
2. **graph.js 拆分**：1119 行超 800 上限 → 按 GEB 拆分（建议：buildGraphData/工具函数与 GraphEngine 分文件）。
3. 设置持久化冒烟：改值 → 重启 → app.json / appearance.json / hotkeys.json / core-plugins.json 保留。
4. 保真度缺口（排队）：
   - 右侧栏视觉核对：默认布局右侧栏（反链+大纲）空态文案可见；分隔线/背景需与原版截图对比。
   - 编辑器 foldHeading/foldIndent（foldService 配置）。
   - live preview 代码块语法高亮（当前纯 <pre><code>）。
   - 数学引擎（KaTeX 暂留，原版 MathJax）。
5. 核心插件功能性抽查（file-explorer/search/switcher/命令面板/backlink/tag-pane/outline/word-count）。
6. 有意跳过（不造假 UI，除非用户要求）：keychain、账户组、CLI 行、insider build、自定义图标、translucency、拼写词典弹窗、主题管理弹窗、功能区设置 modal、URI 回调行、切换设置文件夹、社区市场、publish/sync/bases/webviewer/footnotes/slash-command 行、Vim 模式（依赖未装）。

## 4. 提交记录

- 首个提交（2026-10-17）：设置系统主体 + 默认配置对齐 + 重命名链接更新 + 图谱渲染修复 + 子代理产出入库（graph/canvas/bookmarks/daily-notes/templates/note-composer/file-recovery/random-note/zk-prefixer/workspaces/slides）。之后按阶段提交。

## 5. 关键文件地图（快速导航）

- 入口：`src/main/main.js`（主进程）、`src/renderer/main.js`（渲染入口）、`src/renderer/index.html`。
- 核心：`core/app.js`（App：boot/_applyTheme/_applyCustomCss/_runOpeningBehavior/OBS_ACT）、`core/settings.js`（配置读写）、`core/plugins.js`（PluginManager：internalPlugins/restrictedMode）、`core/workspace.js`（叶子/标签/打开文件）、`core/vault.js`、`core/metadata.js`、`core/fileManager.js`、`core/commands.js`、`core/keymap.js`、`core/i18n.js`、`core/icons.js`、`core/dom.js`、`core/modals.js`、`core/setting.js`、`core/ipc.js`、`core/notices.js`、`core/suggest.js`、`core/menu.js`。
- 视图：`views/settings-view.js`、`views/settings-tabs.js`、`views/settings-tabs-appearance.js`、`views/settings-tabs-plugins.js`、`views/markdown-view.js`、`views/explorer-view.js`、`views/search-view.js`、`views/graph-view.js`、`views/canvas-view.js`、`views/bookmarks-view.js`、`views/index.js`（内置视图注册 + installSettingsHost）。
- 编辑器：`editor/editor.js`（compartments：lineNumbers/wrap/livePreview/readonly/ext/theme）、`editor/live-preview.js`、`editor/completions.js`、`editor/editor-commands.js`。
- 渲染：`markdown/reading.js`、`markdown/properties.js`。
- 插件：`plugins-core/registry`（`core/plugins-registry.js` 注册 15 个模块）、各插件文件。

## 6. 踩坑记录（避免重犯）

- **语言时序**：视图模块在 `registerBuiltinViews`（App.initialize 之前）构造 → 语言必须在 renderer 入口最顶部 setLanguage，否则设置导航栏英文/内容中文混排。
- **循环依赖**：SettingTab 基类放 `core/setting.js`（不能放 settings-view.js，否则 tabs ↔ view 循环 import 在类定义期崩溃）。
- **tt() 兜底**：locale 缺键时 t() 返回键末段（如 "option-spellcheck"），必须用 tt() 包一层 fallback。
- **子代理并发测试冲突**：多个 agent 同时 kill electron / 跑构建会互相干扰；验收时串行跑，或容忍重试。
- **esbuild JSON import**：locale 直接 import，改 locale 后必须 rebuild。
- **settings 'change' 事件**：updateAppSettings/updateAppearance 触发 `settings.trigger('change')` 与 `workspace.trigger('settings-changed')`；App 监听的是 settings 的 'change'（历史上监听过 'settings-changed' 导致主题不刷新，已修）。
- **重命名链接必须用快照**：弹窗等待期间 metadataCache 会重解析并清掉 resolvedLinks 旧键 → `updateLinks` 实时扫描必然落空（文本不变）。正确做法：`_countAffectedLinks` 在重命名前快照（源文件 → 命中链接目标集合），更新按快照匹配。
- **图谱画布 0x0**：视图构造/打开时容器可能未布局，onResize 拿到 0x0；必须用 ResizeObserver 在拿到真实尺寸后重建画布；首次真实尺寸时 resetPan（否则 pan=(0,0)，updateZoom 围绕屏幕中心把 pan 算成负值，节点全在视口外）。
- **zsh 展开坑**：`${var:+OBS_ACT="$var"}` 这类条件展开在 zsh 下会被拆成命令执行；直接写完整命令，别玩花活。

## 7. 接任验收过程（2026-10-17，历史记录）

- 画布：已修复正常缩放下正文卸载、初始尺寸 0×0、输入未失焦不保存、无限缩放帧与关闭后帧残留。
- 画布：已通过新建、输入落盘、指针连线、上下限缩放收敛、视图重开及进程重启恢复。截图与日志在 `$T/acceptance-20261017/`。
- 书签：已修复空分组隐藏、延迟重绘打断重命名、removeAttr 不存在、自定义名称活动项匹配。文件视图均可收藏，目录改名同步子项。
- 书签：已通过 UI 新建/重命名分组、分组内打开、增删及进程重启读回。
- 公共命令：editorCheckCallback 原先误传 checking=true；已修正 false 并传入视图，后续笔记插件回归覆盖。
- CSS：画布与设计变量按规则边界拆分，数值与级联顺序不变。L2 已补入画布、书签与笔记插件成员。
- 并行：graph / notes / recovery 三组已产出修复，待主代理验收；编辑器折叠与高亮正在实现。
- GPT-6.1 sol 两次因供应商峰值容量拒绝中断，无代码产出；编辑器已由继承模型接手。
- 新发现的历史超限：workspace.js 1356 行、main.js 857 行；交接只列 graph.js。后续按职责拆分。
- 验收日志存在 Electron 开发模式 CSP 警告；业务错误与未捕获异常单独计数，不能把警告称为完全零日志。

- 新建元数据：App 原先仅监听 modify；已把 create 接入解析，新文件链接与标签即刻可检索。
- 设置持久化：app/appearance/hotkeys/core-plugins 四文件跨进程通过。独立截图确认设置双栏；原 modal-content 强制纵向 flex 已按原版删除。
- 通用弹窗：修复关闭后立即复开被旧计时器卸载、确认 Promise 提前按 false 结算；模板/命令选择器输入移到结果前。
- 笔记五插件：71 项真实交互断言通过，重启读回通过；配置截图已生成。提取脚本必须只选择可见 prompt-input，150ms 退出过渡仍保留旧节点。
- 图谱脚本鼠标坐标：MouseEvent clientX 截断到整数；锚点断言改用实际整数坐标。菜单跳转暴露 workspace.openLinkText 把路径当文件传入，正在修复。
- 恢复组：首轮 53 项通过，重启暴露 Markdown mode 与 DOM 不同步，编辑器代理修复中。
- 用户更新：后续子代理仅当前模型、中思考；编辑器已按此重建，不再使用 sol。

- 阶段提交 `9be2517`：画布、书签、笔记五插件、设置/弹窗基座与主进程验收钩子拆分（30 文件）。图谱/恢复/工作区/编辑器尚未进入该提交。


## 8. 当前状态（2026-10-17，本轮验收完成）

### 已验收并修复

- 11 个优先核心插件全部完成本轮交互抽查：canvas、bookmarks、graph、daily-notes、templates、note-composer、file-recovery、random-note、zk-prefixer、workspaces、slides。
- 画布：节点正文挂载、初次尺寸、编辑自动保存、指针连线、缩放停止、切换/关闭保存与进程重启恢复。
- 书签：空分组、重命名、分组项打开/删除、文件视图收藏、目录改名同步子路径、重启恢复。
- 图谱：40 项断言涵盖数据、标签/附件/孤立筛选、颜色组、平移/缩放、跨边界拖拽、菜单/中键打开、局部方向/深度/跟随与关闭清理；graph.json 重启保留。
- 笔记五插件：72 项交互断言通过；跨进程读回配置、提取/合并正文、回收副本。末节提取使用宿主 lineCount 属性。
- 恢复组：新建/修改快照、选中版本恢复、删除后恢复、工作区保存前 flush、布局加载关闭旧视图、监听无增长、幻灯片翻页与 Esc 还原选区。全新测试库首次 55 项、重启 41 项通过。
- 设置：app.json、appearance.json、hotkeys.json、core-plugins.json 的改值/退出/重启通过。设置双栏与弹窗复开、确认结果回调已修正。
- 编辑器：foldHeading/foldIndent 独立即时开关；关闭时清除对应折叠；事务过滤阻止语法回退绕过设置。阅读、实时预览及源码共用 Lezer 高亮；JS/Python/JSON、未知语言与文本保真检查通过。
- 模式恢复：MarkdownView 首次 setState 统一 _applyMode，已移除工作区/幻灯片重复 setState 绕行。
- 文件切换：同类型叶子切换前保存未落盘编辑；已删除视图可复用打开其他文件，回归通过。
- 位置接口：scrollIntoView 使用 EditorSelection.range；scrollTo 从 CM 文档读取行数；setCursor 支持 {line,ch}。同名大纲标题精确跳转通过。
- 右侧栏：反链与大纲 93 项断言通过；标题层级、折叠保持、筛选、空态、焦点上下文及关闭清理。源码规则及截图均复核，未启动真实 Obsidian。
- 数学：切换为 MathJax 3.2.2 CHTML，官方公开构建与字体离线托管。阅读/实时预览、aligned/矩阵、字体、错误隔离、协议过滤均通过。适配器子代理另测 41 项；来源和完整性见 assets/mathjax/SOURCE.md。
- 基础插件：文件树、全文搜索、快速切换、命令面板、标签与字数冒烟通过。
- 文件边界：新建文件立即解析元数据；首次扫描与 watcher 共用隐藏路径过滤，.obsidian 及测试标记不进入文件树/图谱。
- 分拆：graph.js 80 行；workspace.js 680 行，拆为 model/renderer/interactions；main.js 调试钩子提至 dev-hooks.js。画布/设计变量/Markdown CSS 按规则边界拆分，保留级联顺序。
- 源码 JS/CSS 全部 <=800 行。修改文件 L3 与模块 L2 已同步。原版 app.js/app.css SHA-256 不变。
- 当前构建通过；最终验收日志无未捕获异常/TypeError/ReferenceError。开发版 Electron CSP 提示仍存在，不计为业务错误。

### 可重复验收

```sh
npm run build
node scripts/acceptance/run.mjs canvas
node scripts/acceptance/run.mjs bookmarks
node scripts/acceptance/run.mjs graph --screen global
node scripts/acceptance/run.mjs notes
node scripts/acceptance/run.mjs recovery
node scripts/acceptance/run.mjs editor
node scripts/acceptance/run.mjs sidebar
node scripts/acceptance/run.mjs math
node --experimental-vm-modules src/renderer/core/workspace-regression.js
```

- 运行器自动创建 `/tmp/obs-copy-acceptance/` 下独立测试库和截图/日志目录。
- 重启流程复用运行器输出的 vault：`recovery --phase restart --vault <路径>`；`notes --phase reload --vault <路径>`；`settings-write` 后用 `settings-restart --vault <路径>`。
- 运行器拒绝非临时目录及没有验收标记的既有 vault。不得改成真实 Obsidian 库。
- 17 组工作区内存回归固定导出、导航、分栏、恢复、侧栏上下文；测试不进入 renderer 依赖图。
- 更详细验证记录见 `scripts/acceptance/RESULTS.md`。

### 后续保真边界（本轮不声称整产品已 1:1）

- 保留 §3 原有的主动跳过清单；社区插件/市场不做。
- 画布仍用 textarea 编辑卡片；完整撤销历史、图片导出、转换为文件等原版功能尚未覆盖。
- 图谱斥力/碰撞仍为 O(n²)；超大图性能、悬停预览、完整查询语法、颜色组拖拽等未覆盖。
- 文件恢复沿用 .obsidian/.file-recovery 的每日 JSON、秒配置与 Markdown 范围；未对齐原版 IndexedDB/默认5分钟/Canvas快照。
- 幻灯片仍在 leaf 内展示，未实现原版覆盖全窗口的演示宿主。
- 本轮截图为复刻品验收，静态原版代码/CSS是对照源；尚未完成与真实 Obsidian 同步截图的全屏逐像素对比。
- KaTeX 不再参与渲染与资源加载；package.json 中旧依赖暂保留，未重新安装或改动锁文件。
- 后续子代理使用当前模型、思考等级中；不使用 sol。所有本轮子代理已停止。

## 9. 侧栏外壳与核心插件功能区（2026-10-17）

- 用户反馈：侧栏工具被当作文档标签关闭或拖走，设置和底部切库入口缺失。已修复，用户确认侧栏实机没有问题。
- 用户随后明确停止视觉验收。后续只运行构建、逻辑回归和 `--no-screenshot` 场景，未再操作或截图实机。
- 固定工具：左侧文件/搜索/书签，右侧反链/大纲/标签。没有关闭叉、文档加号、拖走和关闭菜单；关闭命令只作用于中心文档。
- 旧布局恢复会按插件启用状态补齐工具。禁用插件才撤销对应入口，再启用恢复唯一入口。
- 左下角库信息栏包含当前库名、向上打开的切换菜单、帮助与设置。菜单从真实注册表读取，切换调用 vault-open；原生菜单也补上 Settings。
- 顶部左右开关始终可展开；左栏收起后功能区保留设置与仓库入口。180px 窄栏长库名省略，操作图标不被挤出。
- 结构根因：外层错误的 mod-root 污染侧栏背景与标签样式。外层改为 workspace-root，mod-root 只给中心区域。
- 图谱遗漏：原版 app.js 字符约 2542500 注册 git-fork 功能区按钮，复刻仅注册命令。已补图标；普通点击打开并聚焦中心图谱，Mod 点击新标签。
- 同类遗漏已补：白板 layout-dashboard、命令面板 terminal、快速切换 file-search、模板 files。复用既有功能，禁用对称移除按钮和命令。
- 图谱快捷键沿用 `⌘G`；启用路径为设置 → 核心插件 → 关系图谱。
- 工作区19组逻辑回归通过；此前侧栏外壳53项含真实双库切换、窄栏50项、重启3项通过。
- 功能区47项逻辑检查通过：五插件启停、重复启用、设置开关同步、图谱路由、键盘与其他入口。重启10项通过。
- 功能区日志：`/tmp/obs-copy-acceptance/core-ribbon-run-result-dYoVlv/run.log` 与 `core-ribbon-restart-result-XDp9li/run.log`。两次 screenshot 均为 null。
- 复跑：`node scripts/acceptance/run.mjs core-ribbon --no-screenshot`；使用输出 vault 加 `--phase restart --vault <路径> --no-screenshot` 验证重启。
- 构建通过，原版事实源保持只读。本次源码修改需重新打开复刻程序后载入；不声称已热更新用户运行中的旧实例。

## 10. 交回原主 agent（2026-10-17）

- 当前实现基线是 `92f0eda`；其前两阶段为 `0fc1393`、`9be2517`。
- `HANDOFF.md` 已重写。旧版“插件大多未验收、graph.js待拆、必须截图”已失效。
- 本轮仅核对源码和文档。未改应用代码，未重跑构建/测试，未做视觉验收。
- 代码抽查确认：恢复默认60秒/每日JSON；画布文字用textarea；图谱力学双层循环；幻灯片宿主在leaf。
- 建议顺序：恢复默认值/间隔语义与Canvas快照 → 画布撤销/重做与转文件 → 图谱规模基线及优化 → 演示宿主与交付收尾。
- 这些是待实施建议，不是本轮新增完成项。原版细节应在实施前再定位事实源。
- 恢复存储迁移需兼容已有配置和快照；不为了内部结构一致先做破坏性迁移。
- 故障恢复/外部修改冲突是待检查项，尚无新增缺陷结论。大库性能也未实测。
- 用户停止视觉验收的要求持续生效。所有 Electron 验收命令加 `--no-screenshot`；§2/§8 截图命令仅作历史记录。
- 所有子代理已停止，无需重复启动旧任务。后续继承当前模型、medium，不使用 sol。
- 交接文档新增入口已登记在 L1。最新验收计数以 §9 与 RESULTS.md 末节为准。

## 11. 文件恢复对齐（2026-10-17，原主 agent 接续）

- 原版事实（`_analysis/obsidian-asar/app.js` 定位，idx≈3242300）：
  - 选项 `A8={intervalMinutes:5, keepDays:7}`；设置页文本输入：间隔 `parseFloat>=0`、天数 `parseFloat>=1`；间隔 0 表示每次变更即存。
  - 采集范围：TFile 且扩展名 `md|canvas|base`；vault modify / file-open 触发，create 在 onLayoutReady 后注册；resave 每 60 秒，cleanup 每 3600 秒，启动后 60 秒首轮 cleanup；cleanup 按 ts 索引删除早于 keepDays 秒级的记录。
  - 存储：IndexedDB（`appId+"-backup"`，store `backups`，path/ts 索引，autoIncrement）。
  - 弹窗（原版 F8）：左栏搜索建议（显示去 .md 的路径）+ 版本列表（`llll` 时间 + 大小）；右栏标题栏 = 显示差异开关 + 复制 + 恢复此版本；`textarea[data-ext]` 预览；差异为行/词两级（FX，jsdiff 语义清理）。
  - 恢复：建父目录 → `adapter.write` → forceAdd → Notice → switchToPath。
- 本实现决策（遵循 HANDOFF：不立即迁移存储）：
  - 保留按天 JSON（旧快照继续可读，新快照同格式写入）。行为差异：cleanup 按日文件粒度删除，快照最多多存活不足 1 天；快照随仓库目录同步（原版 IndexedDB 在 userData 内）。
  - 间隔改分钟语义，读取时迁移旧 `intervalSeconds`（60 秒=1 分钟，0→0）；迁移不重写文件，写入新键时旧键保留（loadOptions 优先 intervalMinutes）。
  - 设置页签改文本输入，直接改运行实例 `options`（改动即时生效）；实例新增 `saveOptions()`，包装层暴露 `options` getter。
  - 弹窗补齐：复制按钮（Electron clipboard + `interface.copied_generic` Notice）、显示差异开关（`views/diff-view.js`：行级 LCS + 行内 diff-changed + 折叠阈值对齐）、`data-ext` 属性、标题/建议去 .md（仅 md）。
  - 恢复路径保持 `vault.modify`（触发 modify → canvas 视图重载；markdown 视图 `_onExternalModify`）。
- Canvas 视图外部同步（`views/canvas-view.js`）：
  - onOpen 注册 vault modify；磁盘内容与 `_savedText` 不同才重载（过滤自身写入的 watcher 回声，与 markdown-view 同构）；重载保留视口（`clear()` 会重置，需显式恢复）；save 期间 `_writing` 防自触发。
  - `loadFile` 拆出 `_applyFileFromDisk(path, {keepViewport})`。
- 验收：recovery exercise 82 项、restart 43 项通过（新增迁移/设置页/复制/差异/Canvas 断言）；canvas 场景通过；日志 0 未捕获异常。
  - 证据：`/tmp/obs-copy-acceptance/recovery-exercise-result-VbjGga`、`recovery-restart-result-zTxmps`、`canvas-run-result-n4hJop`（均为 `--no-screenshot`）。
- 未覆盖（不声称 1:1）：IndexedDB 存储、CLI `history:*` 命令、`onExternalSettingsChange`、supportsIndexedDb 回退文案、diff 的 jsdiff 语义清理（本实现为 LCS+前后缀裁剪）。

## 12. 画布撤销/重做与转换为文件（2026-10-17，主 agent 接续）

- 原版事实（`app.js` 定位）：
  - 撤销栈 `a5`：有界快照栈 max=100；`requestPushHistory = debounce(pushHistory, 250, resetTimer)`；`requestSave(save=true)` 取 getData() 后推进历史；undo/redo 应用快照并只触发视图写盘（不产生新条目）；`clear()` 清历史（装载/卸载路径）；`overrideHistory()` 用当前数据替换当前条目（加载期几何修正用）。
  - 初次装载/切换文件：`setViewData(text, initial)` 中 `initial && view.clear()` → canvas.clear()（清内容+历史+视口+readonly）；外部修改重载：不 clear，`setData` → importData(prune) + pushHistory。
  - `importData(data, prune)`：按 id 复用节点/边，prune 时删除数据中已不存在的项；不整表重建。
  - 键盘 scope：Mod+Z 撤销、Mod+Shift+Z / Mod+Y 重做、Mod+A 全选、Shift+1 总览、Shift+2 聚焦卡片；焦点在输入控件时不响应（`C$(targetNode)`）。
  - 控件组：撤销/重做组（lucide-undo-2 / lucide-redo-2，tooltip `setting.mobile-toolbar.option-undo/redo`，`is-disabled` 随历史变化）。
  - 转换为文件：命令 `canvas:convert-to-file`（仅单选文本卡片）；文本卡片菜单追加「编辑」「转换为笔记…」；命名弹窗 `aI/sI`（标题 `dialogue.label-rename-file-generic`、`textarea.rename-textarea`、保存/取消、Enter 提交、校验：非法字符 `\ / :` → 点开头 → 链接不安全 `# ^ [ ] |`）；流程 = 建 md（内容为卡片文本）→ 文件节点继承几何 → 关联边改指新节点 → 移除文本节点 → 选中新节点 → requestSave。
- 本实现：
  - `views/canvas-history.js`（CanvasHistory 100）；canvas-view 接入 `requestSave(saveHistory)` / undo / redo / applyHistory / pushHistory / overrideHistory / updateHistoryUI；`importData` 改差分式 prune；初次装载 clear、外部重载保留历史与视口。
  - `canvas-interactions.onKeydown` 增加 scope 快捷键（含可编辑目标判定）。
  - `core/events.js` debounce 增加 `run/cancel`（对齐 `yc`）；`core/modals.js` 新增 `FileNameModal`；canvas-node 文本卡片菜单 + `convertToFile`；`plugins-core/canvas.js` 新增 `canvas:convert-to-file` 命令。
  - 修复历史遗留：`CanvasFileNode.mountContent/render` 未判空 `contentEl`，正常缩放下新建文件节点即崩溃（「库添加笔记」路径此前未覆盖）；拆出 `views/canvas-file-node.js` 守住 800 行（canvas-node.js 811→702）。
- 验收：canvas 场景通过（新增断言：历史初始 is-disabled、动作后 undo 可用、Mod+Z 撤销节点、撤销落盘、Mod+Shift+Z 重做、按钮撤销/重做、转换命令可用性、弹窗默认 Untitled、非法名拦截、建文件/内容/几何/边改指、撤销恢复文本卡、重做再应用）；日志 0 未捕获异常。证据 `/tmp/obs-copy-acceptance/canvas-run-result-lpAd6p`。
- 未覆盖：图片导出（`canvas:export-as-image`）、方向键微移（nudgeSelection）、快速设置菜单（对齐网格/对齐物体入口）、CM6 卡片编辑（仍 textarea）。

## 13. 图谱性能基线（2026-10-17，主 agent 接续）

- 事实源：`_analysis/obsidian-asar/sim.js` 是 d3-force + d3-quadtree 打包产物（在 worker 运行）；参数：manyBody `.strength(() => -1000).distanceMin(30)`（theta 默认 0.9）、forceX/Y `.strength(.1)`、collide `.radius(60).strength(.5)`、速度衰减 0.6、alpha 衰减 1-pow(0.001,1/300)。原版把力学放在 worker，主线程零阻塞。
- 基线（优化前，Electron 实测，`graph-perf` 场景）：100 节点 open 16ms / tick 0.78ms / 121fps；1000 节点 26ms / 4.92ms / 119fps；5000 节点 81ms / 101.5ms / 11.3fps（不可用）。
- 优化（本阶段）：
  - 新增 `plugins-core/graph-quadtree.js`：建树 + 聚合遍历；重合点 next 链；40 层保护。
  - `graph-simulation.js`：斥力改 Barnes-Hut（theta²=0.81，与 d3 默认一致）；碰撞改四叉树包围盒裁剪（半径 120、配对权重 0.5，与 d3 相同）；两者共用同一棵树；受力遍历内联为复用栈（去逐点闭包/数组分配）。参数与 d3 对齐。
- 优化后（Electron 实测）：100 节点 open 8ms / tick 1.55ms / 120.7fps；1000 节点 25ms / 3.65ms / 120fps；5000 节点 83ms / 16.2ms / 77.3fps。
  - 对比：1000 节点 tick 4.92→3.65ms；5000 节点 tick 101.5→16.2ms（6.3×）、fps 11.3→77.3（6.8×）。100 节点 tick 略升（0.78→1.55ms，建树固定开销），帧率无差别。
  - 关闭释放与关闭后可响应在所有规模通过（destroyed / canvas 摘除 / timer 清空 / DOM 清空）。
- 复跑：`node scripts/acceptance/run.mjs graph-perf --nodes 100|1000|5000 --no-screenshot`；结果写 `<vault>/.obs-copy-graph-perf.json`。
- 未覆盖：worker 化（原版力学在 worker，本实现仍在渲染线程，5000 节点沉降期约 77fps）；颜色组拖拽、悬停预览、完整查询语法仍未做（历史记录）。

## 14. 幻灯片全窗口演示宿主（2026-10-17，主 agent 接续）

- 原版事实（`app.js` 定位）：幻灯片不是视图。`M9.openFile(file)` 在 `activeDocument.body` 建 `.slides-container`（app.css：`position:fixed`、100vw/100vh、background #191919、`z-index: var(--layer-slides)`），reveal.js（`/lib/reveal/reveal.js` + reveal.css + black/white 主题）负责分页；关闭按钮为 `div.slides-close-btn`（lucide-x-square）；Escape 经 scope 关闭；命令 `slides:start`（仅 md）+ file-menu 菜单项。
- 本实现：
  - 新增 `views/slides-presentation.js`（SlidesPresentation + splitSlides）；删除 `views/slides-view.js` 与 'slides' 视图注册。
  - 宿主挂 `document.body`，`.slides-container` 改 `position:fixed` 全窗口（styles/slides.css）；关闭按钮 div + lucide-x-square；Escape/方向键/空格/PageUp/Down/Home/End 在 document 捕获（有弹窗或焦点在输入控件时不响应）。
  - 演示期间底层 markdown 视图不动 → 退出后模式、滚动与选区天然保持；退出时把焦点还给演示前的叶子（setActiveLeaf + editor.cm.focus）。
  - 无 reveal.js（不搬第三方运行时）：分页与翻页为自有实现；背景用 `--background-primary`（原版 #191919 由 reveal 主题 CSS 覆盖，实际主题相关）。
  - file-menu 菜单项省略（本项目无 file-menu 来源，与 graph-engine 相同处理）。
  - 依赖审计：katex 移出 package.json 直接依赖（JS 无引用；CSS 仅存 `.katex-error` 规则；lock 保留为 mermaid 传递依赖）。MathJax 资源不受影响。
- 验收：recovery exercise 84 项、restart 45 项通过（新增：body 级全窗口覆盖、底层视图保持、Esc 后选区保持、弹窗层在覆盖层之上、覆盖层摘除与监听释放）；core-ribbon 47 项、工作区 19 组回归通过；日志 0 未捕获异常。
- 未覆盖：reveal.js 的过渡动画与主题 CSS；旧布局中的 'slides' 叶子降级为空视图（workspace 对未知类型的既有回退）。

## 15. 画布快速设置、方向键微移与边跟随修复（2026-10-17，主 agent 接续）

- 原版事实：
  - 控件第一组为快速设置按钮：非只读时点击弹菜单（对齐网格 lucide-grid / 对齐物体 snap-to-object / 只读 lucide-lock），只读时点击直接退出只读；按钮图标 `lucide-settings ↔ lucide-lock`，提示 `label-canvas-settings / label-disable-readonly`。
  - 只读标记存 localStorage：key `canvas-<路径>`，值 `{readonly:true}` 或删除；重命名迁移、删除清理；初次装载 `setViewData` 读取并 setReadonly。
  - 画布插件选项默认 `{snapToObjects:true, snapToGrid:true}`（此前我们误为 false/false，已修正）。
  - 方向键微移 `nudgeSelection`：步长 = gridSpacing，Shift 为 5 倍；snapToGrid 时按选中包围盒 min 对齐网格（原版 down 分支把增量误加到 x，本实现修正为 y 并在代码注明）。
  - 帧渲染：moved 集合中的节点会先把其关联边加入 moved，再统一 render（原版 renderFrame）——我们此前遗漏，导致拖动/微移节点时边不跟随。
- 本实现：
  - `canvas-viewport.renderFrame`：补 moved 节点 → 关联边传播。
  - `canvas-view`：快速设置控件组 + 按钮（has-active-menu 防重复打开）、setReadonly 图标/提示切换、初次装载恢复只读；选项默认改 true/true。本地数据存取拆到 `canvas-local-data.js`（load/save/migrate/drop；canvas-view.js 781 行）。
  - `canvas-menu.showQuickSettingsMenu` 增加只读项（三项，对齐原版）；`canvas-interactions` 增加方向键微移与吸附。
  - `core/menu.js`：新增 `setParentElement`（打开期间 has-active-menu）；补 L3 头部。
- 验收：canvas 场景通过（新增：边跟随节点移动且往返路径一致、ArrowRight 步长、Shift 5 倍、吸附网格线、快速设置三项菜单、has-active-menu 标记、对齐网格切换写入 canvas.json、只读切换 class/图标/localStorage、重开后只读恢复、按钮退出只读并清理标记）。日志 0 未捕获异常。
- 未覆盖：图片导出（`canvas:export-as-image`）、CM6 卡片编辑、画布大图的空间索引与可视区域渲染（原版 nodeIndex/edgeIndex + virtualize）。

## 16. OpenSidian 品牌化 + UI 1:1 保真（2026-10-17，进行中）

### 已提交
- `bfc2d9d` 品牌化改名（产品名 OpenSidian/opensidian；userData 迁移；locale 产品自称替换；HANDOFF.md 删除；README 新建）。
- `5d2aa1b` 启动日志品牌串。仓库文件夹由用户改名为 `/Users/link/Desktop/opencidian`（品牌仍是 OpenSidian）。
- 迁移验证：旧 `~/Library/Application Support/Obsidian Copy/obsidian.json`（18 库）→ 新 `OpenSidian/opensidian.json` 拷贝成功；标题冒烟 `OpenSidian`；core-ribbon 47 项过。
- 新增 `scripts/with-lock.sh`：并行子代理构建/验收互斥锁（$TMPDIR/opensidian-build.lock，超时 30 分钟退出码 75）。**所有子代理必须用锁跑 build 与 acceptance。**

### 进行中（子代理，均要求不 commit、用锁、--no-screenshot）
- 审计：编辑器保真、核心插件保真（重跑中；shell 与设置/组件两份审计已回，结论见下）。
- 实现：社区插件安全模式对齐（plugins.js + settings-tabs-plugins.js + settings.css + 新场景 community.js）。
- 实现：通用组件批 tooltip/notice/suggest（新 tooltip.js + notices.js + suggest.js + components.css + file-explorer.js i18n）。
- 实现：设置页行级补齐（settings-tabs.js 编辑器/文件/关于 + 拼写字典/语言 IPC + settings-ui.js）。

### shell 审计结论（待实现，文件无人占用）
1. 拖拽视觉反馈全缺：`_dragGhost` 空函数（workspace-interactions.js:145）、`is-tab-drop-before/after` 与 `mod-drop-*` 无 CSS、无 drop overlay。原版：drag-ghost mod-leaf、workspace-drop-overlay（app.css 3385-3417/6014-6036，transition all 100ms）、文档 body is-grabbing。
2. 侧栏折叠无动画（display:none 瞬切）：原版 140ms width 补间 + swing 缓动，完成后 hide。
3. 标签列表按钮被 layout.css:298-299 display:none 永隐、位置错（应在 spacer 之后）；菜单缺 Close all；图标应为 lucide-chevron-down。
4. 标签宽度：原版 `.mod-root .workspace-tab-header{flex:1 1 0;width:var(--tab-width);container-type:inline-size}`；tab 容器 wheel→scrollLeft；锁定宽度 mouseleave 解锁。
5. 标签右键菜单缺 "Close tabs after"、Close others 应跳过 pinned；侧栏 tab 也应开菜单（仅 Close+pane 项）。
6. pin 无视觉：原版 status-container + lucide-pin（点击取消固定）且 pinned 隐藏关闭钮（app.css 6245-6280/6366-6373）。
7. 关闭钮：active 标签应常显；`@container tab-header (width<3rem)` 隐藏（app.css 6492-6505）。
8. 窗口：document.title 规则 `${displayText} - ${vault} - Obsidian`→我们用 OpenSidian；titlebar-text 应镜像 document.title 并去掉 display:none 与双层嵌套（根据用户品牌裁定保留 OpenSidian）；is-fullscreen/is-maximized/--zoom-factor 同步缺失；mac 双击标题栏缩放缺失；非 mac 窗口三按钮未建（IPC 已有）。
9. 分栏 resize：中心分栏尺寸未落库；body 应加 is-grabbing；最小 200（原版）vs 我们 80。
10. 空叶子空状态：displayText 应为 "New tab"；补 .empty-state-container 与 Close；去图标。
11. 侧栏开关按钮文案硬编码"展开/收起左侧边栏"→locale（sidebarExpand/sidebarCollapse）。
12. 状态栏：word-count 应 word+char 两段（char=含空白长度）、监听选区变化；editor-status 用图标+tooltip（lucide-book-open/code-2/edit-3）、去文本段、补 contextmenu；CSS gap 变量错（--status-bar-font-size→--size-4-1）、min-height 18px、tabular-nums。word-count 点击弹窗为"多出的功能"（原版无），保留需记录。
13. CSS 微差：resize-handle 过渡 200ms；.modal 我们去掉自加 scale/is-open 动画；.clickable-icon 过渡应在 svg opacity 140ms；.menu 结构（menu-scroll/padding）与 separator 首尾隐藏（与设置审计一致）。

### 设置/组件审计结论（待实现；组件批与设置批已在跑，剩余见下）
- 已派：tooltip 全套、notice 位置/交互、suggest 细节、i18n 小修（通用组件批）；编辑器/文件/关于页签行级（设置批）。
- 仍待派（等 settings.css/settings-tabs-appearance.js 占用释放）：外观页 ribbon 配置弹窗、自定义应用图标行、字体管理弹窗细节（存在性指示/拖拽/建议）、主题 Legacy 项、重设主题色 #7f6df2/getAccentColor；核心插件页齿轮显示条件（enabled&&settingTab）、快捷键页筛选菜单/chip/按键筛选、启动时间弹窗（已并入设置批 C8）；菜单/模态（键盘分层、勾选右侧 mod-checked、is-label、separator、焦点管理）→ 等 components.css 释放后派"菜单+模态"批。
- 明确不做：设置全局搜索框、设置滚动记忆（原版无证据）。

### §16 进度看板（2026-10-17 晚，滚动更新）

- 已提交 `4c4fcc2` 社区插件安全模式（run 19 项 + restart 3 项 + core-ribbon 47 项）；顺带修复插件 shim 未导入 Keymap 的沉睡 bug（任何社区插件加载都会 ReferenceError）。新场景 `scripts/acceptance/community.js`。
- 工作区未提交半成品（来自被限流中断的设置批）：`settings-tabs.js`（启动时间弹窗/编辑模式同步）、`main.js`+`ipc.js`（拼写词典/语言 IPC 与启动恢复）。续做批正在补齐编辑器/文件页签剩余项。
- 在跑批次（6）：编辑器审计、核心插件审计、（shell 手感批）、（通用组件批 tooltip/notice/suggest）、（设置页续做）、（外观页批字体管理/主题）。
- 待派队列：菜单+模态批（等 components.css 释放）、功能区配置行/自定义图标（等 shell 批释放 workspace-renderer.js/main.js）、编辑器保真批（等审计）、核心插件保真批（等审计）、画布 CM6 卡片编辑/图片导出等（等审计）。
- 提醒：所有子代理用 `sh scripts/with-lock.sh` 跑构建与验收；不许 commit；完成后由主 agent 集成提交。

### §16 进度看板（2026-10-17 深夜，滚动更新）

本次会话已完成并提交的批次（每批都有可复跑验收）：
- `9cc2635` 修复新标签激活竞态（先激活后加载）+ graph 场景稳定化；`1967d6b` 文件树拖入编辑器插入链接（editor 113 项）。
- `c14d621` 插件设置页批：快捷键筛选菜单/chip/按键捕获、冲突 chip、核心插件行快捷键入口与齿轮显隐、社区插件卸载/设置（settings-plugins 52 项）。
- `bfef76c` 社区插件命令按 Obsidian API 自动加 `<pluginId>:` 前缀（裸 id 夹具验证）。
- `a63e3ec` 外观页功能区配置弹窗（原版 Zee）：隐藏/恢复/拖拽排序，localStorage 持久化（appearance 32 项）。
- `7b3ccd9` 画布：图片导出（离屏绘制 PNG/命令/菜单）+ 对齐参考线（svg.canvas-snaps）；canvas 68 项。
- `01de8fc` 菜单结构对齐原版：.menu-scroll + 指针位置驱动滚动（Uv），功能区同款（dialogs/core-ribbon/sidebar-shell/settings-plugins/community/canvas/graph 全过）。
- `402c786` 缺失核心插件：出链面板 + 属性视图（all-properties/file-properties/命令/状态栏计数），core-views 77 项。
- `add712a` 出链面板补 Unlinked mentions 分节（计数/上下文/Link 按钮），core-views 83 项。
- `2990964` 图谱批：颜色圆点拖拽排序（原版 TJ）+ 节点悬停 hover-link → page-preview（graph 来源默认 Mod、坐标定位）+ 力参数整链；graph 72 项 ×3。
- `3da01c1` 编辑器右键菜单（拼写/链接/剪贴板/文本格式/段落/插入/复制路径 + editor-menu 事件）+ `editor:attach-file`/`set-heading-*`/`clear-formatting`/`toggle-blockquote`；修复 generateMarkdownLink 附件丢扩展名、外部修改同步回滚迟到通知两个深层 bug。
- `865a781` 粘贴图片（截图/HTML data URL → Pasted image <时间戳>）+ 文件树外部文件拖入。
- `107a7f6` 表格批收尾（表格加行/列按钮、行列手柄与行列/排序/对齐菜单已随 3da01c1/865a781 入库）；with-lock 注释修正。
- `621ce9d` 阅读视图链接/图片右键菜单（workspace.handleLinkContextMenu/handleExternalLinkContextMenu 共享）+ LICENSE(MIT) + README 同步。
- `a213fb1` 块 widget「编辑此区块」（代码/数学/Mermaid 的 edit-block-button）。
- 新增场景：community→…、editor-menu 23、editor-paste 7、reading-menus 11、editor-block-button 11、table-widget 76。
- 录音机核心插件完成（代码随 621ce9d/a213fb1 入库，复跑 65+7+回归全过）；仍有两个子代理在跑：画布文本卡 CM6（ses_eb328402effeLiTwrVYsuf5t7i）、下载当前文件附件（ses_eb318f09cffeTK5M3uXLngNN5C）。
- 待办（代理结束后）：core/CLAUDE.md、styles/CLAUDE.md、scripts/acceptance/CLAUDE.md 的并行文档合并；表格手柄拖拽重排/单元格选择/Tab 换格；图谱 worker；electron-builder 分发包（LICENSE 已定 MIT）。
- `4c4fcc2` 社区插件安全模式：双布局/信任模态/setEnable 语义 + community 场景（run 19 + restart 3）。
- `ab44cba` shell 手感批：drag-ghost、drop overlay、侧栏 140ms 补间、标签列表按钮/Close all/Close after、pin、关闭钮容器查询、窗口状态与红绿灯、非 mac 三按钮、状态栏双段、空标签、titlebar 镜像；sidebar-shell 61 项。
- `8cf232a` 设置与窗口 IPC：拼写词典/语言 IPC + 启动恢复、启动耗时弹窗、窗口状态通道。
- `022feef` page-preview 插件 + **修复 reading.js wiki 链接切片 bug**（[[A]] 目标被切掉前 2 字符，阅读模式全部内部链接误判未解析）；math 场景旧 origin 修正。
- `3e69c47` 设置页行级：拼写词典弹窗、语言 pills、路径建议、忽略文件弹窗、重建缓存 destructive、Vim 弹窗；settings-ui 22 项。
- `79c6509` 外观页：字体管理（存在性指示/删除图标/拖拽/建议）、主题 Legacy、主题色恢复主题默认（app.js 不再写死 #7f6df2）；appearance 18→22 项。
- `e915b90` 编辑器：阅读代码块复制按钮、LP code-block-flair、LP 笔记嵌入 ![[...]]、clipboard 未聚焦保护；editor 107 项。
- `5cbc03c` 外观：自定义应用图标（set-icon/get-icon + dock/窗口应用 + 预览/重置）；文件树 drag-ghost。

关键 bug 记录（新发现）：
- `reading.js` wiki inline rule 偏移错误（pos+2），已修；嵌入/链接/解析全部受影响过。
- 插件 shim 引用未导入的 Keymap：任何社区插件加载都会 ReferenceError，已修。
- `metadataCache.getFirstLinkpathDest` 返回路径字符串而非 TFile（新代码需 getFileByPath 转换）。
- Chromium `document.fonts.check` 对未知字体返回 true → 字体检测改宽度测量法。
- `navigator.clipboard.writeText` 在窗口未聚焦时异步 reject → 全部调用点吞掉 rejection（否则验收日志判失败）。

已完成补充（组件批，`0c8dbe9`）：
- 全局 tooltip（`core/tooltip.js`，1000ms 延迟/100ms 宽限/上下左右/翻转/抑制原生 title）、Notice 右上角+4000ms+hover 暂停+收拢动画、Suggest clear 按钮/PageUp/PageDown/Ctrl+p/n/auxclick；dialogs 场景扩到 7 项。同时把 file-explorer 移动失败的英文硬编码改成 locale 键（zh/en 同步）。

## 在跑/待集成（2026-10-18 深夜）

- ✅ 画布批已提交 `bbcfc57`+`e299200`（activeEditor + 导出弹窗 + 超限拆分；canvas-edit 77、canvas 95、editor 113、core-ribbon 47、sidebar-shell 61）。
- ✅ 表格剩余项已提交 `f187e36`（单元格菜单/删行补空行/触屏手柄；table-interaction 178、table-widget 76、editor 113）。
- ✅ 堆叠标签页已提交 `d792b8b`（stacked-tabs 49 + sidebar-shell 61、core-ribbon 47、editor-switch 2、notes 72；顺手修复标签条拖拽重排从未注册的既有 bug）。
- ✅ 文件树多选与键盘导航已提交 `57173de`（file-explorer-selection/multi 新模块；file-explorer-multi 80、sidebar 93、sidebar-shell 61、basic-plugins 6。根因：原版 vault.exists 在本复刻不存在，改用 getAbstractFileByPath）。
- ✅ 图片尺寸批已提交 `35af226`（source-text.js 新模块、阅读/LP 尺寸语法、重置大小；image-size 36 + editor 113、notes 72、reading-menus 13）。
- ✅ 数据丢失级修复已提交 `8921eb4`：Editor.setValue 整弹重建 state（撤销栈不跨文档边界）；修复前「打开笔记后一次 Mod+Z 清空文档并落盘」，editor-race 9→20 已钉死（含切文件撤消污染防护）。
- ✅ 画布多选批已提交 `d1569d5`（canvas-selection 72 + canvas 95、canvas-edit 77、core-ribbon 47；原版无「置顶/置底/取消分组」，未杜撰）。
- ✅ 文档合并已提交 `9ffcb4b`（七份 CLAUDE.md + editor-race 20 项 + AGENT-STATE）。
- ✅ **终版全量回归 53/53 通过、0 失败**：主循环 44/44（41 场景 + graph-perf×3）、链式 10/10（persist/community/recovery/audio/settings 双连）、内存回归 19/19。记录见 RESULTS.md；日志 `/tmp/opensidian-terminal-regression.log` 与 `-b.log`。
- ⏳ 剩余手点项：真机麦克风、打包版冷启动冒烟之外的签名/公证（无证书）、像素级视觉验收（用户豁免）。
- 已知纪律：子代理曾被免费网关限流（Forbidden/ConnectionRefused）；失败即续跑原会话或主会话接手。

## 验收纪律（2026-10-18 增补）

- **禁止 `npx electron .` 直连探针**：会弹窗口（或卡死）。调试一律 `node scripts/acceptance/run.mjs <场景> --no-screenshot`（内置隐形 E2E）。
- `with-lock.sh` 的环境变量必须写进引号内：`sh scripts/with-lock.sh 'VAR=1 cmd'`；孤立赋值会被防呆直接拒绝（exit 2）。
- 代理被杀可能留下**僵尸锁**（`${TMPDIR}/opensidian-build.lock`）：确认无持有者（所有 with-lock 都在 sleep）后 `rmdir` 即可；否则全员卡 30 分钟。
- 主会话集成顺序：代理完成 → 清僵尸锁/残留探针 → with-lock 串行 build+场景 → 显式路径提交。

## E2E 模式（2026-10-18 定稿）

- `E2E=1`（run.mjs 注入）：`setActivationPolicy('accessory')` + `dock.hide()` + `showInactive()` + `focusable:false` + `opacity:0` + `setIgnoreMouseEvents(true)` → 测试窗口完全不可见、不抢键盘/焦点、不夺菜单栏、不遮挡界面。
- **Dock 图标启动瞬间轻动一下是有意保留的行为**：Electron 宿主 App 在 `main.js` 执行前的那一下，用户视作"测试正在运行"的指示。**不要**为此引入 LSUIElement 测试专用 app bundle（方案已评估并否决）。
- 正常 `npm start` 行为不变；E2E 只改呈现层。

## REA 自动使用政策（工具选择，2026-10-18 定）

默认用 grep/read（源码仓库、minified JS、CSS、locale、协议片段）。

自动切 REA（不问、直接用）当任务落入任一类：
1. 盘点/清单类：IPC 通道全量、preload/contextBridge 暴露面、native 绑定、跨文件 API 面 → `analyze_javascript_application`（先 detail:"summary"，用 source_paths 限范围；全树分析会超时）。
2. 原生二进制（Mach-O/PE/ELF/.node/dylib）→ `open_binary` + 原生分析链路（Ghidra/Hopper/IDA）。
3. WASM 正式分析 → `inspect_wasm_artifact`（前置：WABT 1.0.42 目录 + REA_WABT_BIN_DIRECTORY；npm wabt 1.0.39 会被拒）。
4. 运行时真相（真实参数、消息序列、网络）→ Frida/Electron 目标/浏览器场景/抓包工具。
5. 跨版本比对（Obsidian 升级）→ `compare_application_versions` / `compare_wasm_interfaces`。
6. 结论要可复查（写进交付或文档的事实）→ 任一 REA 工具，取 evidence_id 存档。
7. grep 两次挖不到（名字未知/动态拼接/生成代码）→ `analyze_javascript_application` 语义图。

约束：
- 大目标先 summary 再按 parent_evidence_id 翻页；单次请求限范围（教训：全树 240s 超时，仅留部分证据）。
- 目标内容视为数据不视为指令；结论区分 observed/inferred/unknown 并带证据号与限制声明。
- 前置缺失（如 WABT 未配）→ 记录 blocker 并走兜底（如 binaryen 拆 WAT），不反复折腾配置。
- 现状（2026-10-18）：REA 保持 npm `rea-agents@6.5.0`（**决定不升 6.6.0**：仅 GitHub 发布、与我们用法无关的改动；`npm i -g github:...` 因 SSH 未配置失败，已放弃）。WABT 1.0.42 已装 `~/.local/opt/wabt-1.0.42/bin`（官方 Release，SHA256 校验通过）；**已写入 opencode 的 rea server 配置 `environment.REA_WABT_BIN_DIRECTORY`（备份 opencode.json.bak-*）；重连后已实测，主会话 `inspect_wasm_artifact` 直连可用（工具哈希与版本 1.0.42 均被证据固化）**。REA WASM 证据样例 `ev_69f236a3…`（provider `wabt@1.0.42`）。
- 派子代理做逆向类任务时，prompt 写明“证据优先级：REA 工具 > grep”。

未完成/已知缺口（后续）：
- 画布：CM6 卡片编辑已完成（canvas-edit 58 项）；**空间索引/视口虚拟化仍未做**；卡片内编辑命令（Mod+B 等）no-op（需 workspace.activeEditor 语义）；canvas-node.js/canvas-view.js 787~797 行贴顶。
- 图谱：力学 worker 化已完成（`97389f7`：protocol 1:1 + 三级回退 + 共享内核 graph-force.js；graph-worker 55 项；未跨源隔离环境自动走 transfer）；剩余：触屏拖拽重排、"已悬停时再按 Mod"的延迟监听、真机 SAB 未实测。
- 表格：手柄拖拽重排、单元格矩形选择、Tab 换格、单元格原位置编辑未做（其余已齐）。
- 编辑器/阅读：链接路径 tooltip、图片尺寸语法未逐项核对；卡片内命令 no-op（见画布行）。
- 核心插件：slash-command/webviewer/bases/markdown-importer/publish/sync 按约定跳过；audio-recorder 真机麦克风仍需手点一次。
- 第三方插件页：捐赠按钮未做（市场未接入）。
- 系统级：electron-builder 打包已完成（dmg/zip + 打包版冒烟；未签名，`identity: null`；正式分发需证书与公证）。自动更新仍未做（LICENSE 已定 MIT）。
- 未做像素级视觉验收（用户要求停截图）：只保证 DOM/逻辑/计算样式与回归。
