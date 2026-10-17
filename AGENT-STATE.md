# AGENT-STATE — 复刻项目记忆（给 AI 自己看的进度与事实库）

> 本文件不属于 GEB 文档体系，是 agent 的跨上下文记忆。每次重要推进后更新。
> 更新时机：阶段完成 / 提交前后 / 发现关键事实 / 子代理交付验收后。
> **交接安排以 §10 为准；实现状态见 §9，功能边界见 §8。§3 和 §7 是历史记录。**

---

## 0. 项目身份

- 目标：1:1 复刻 macOS 上的 Obsidian 1.12.4 桌面版（/Applications/Obsidian.app）。
- 复刻品位置：`/Users/link/Desktop/Obsidian copy`（本仓库）。
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
