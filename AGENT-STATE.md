# AGENT-STATE — 复刻项目记忆（给 AI 自己看的进度与事实库）

> 本文件不属于 GEB 文档体系，是 agent 的跨上下文记忆。每次重要推进后更新。
> 更新时机：阶段完成 / 提交前后 / 发现关键事实 / 子代理交付验收后。

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

# 启动 + 截图（zsh，注意引号）
T=/private/var/folders/st/nd9_l9b17zs6x6bg2cmysqph0000gn/T/opencode
pgrep -f "node_modules/electron/dist/Electron.app" | xargs -I{} kill {} 2>/dev/null
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

### 子代理交付状态（四个全部 rate-limit 中断，产物已入库）
- canvas / bookmarks+4 插件 / graph / R1 五插件 四个子代理均因 "Rate limit exceeded" 终止，**非正常完成**；产物在磁盘上，build 通过、registry 全部注册（20 模块）。
- graph：`plugins-core/graph.js`（**1119 行 ⚠️ 超 800 上限，待拆分**）、`views/graph-view.js`（800 行整）、`styles/graph.css`。**已验收**（渲染正常；交互未抽查）。
- canvas：`plugins-core/canvas.js`、`views/canvas-view.js`/canvas-node.js/canvas-edge.js/canvas-interactions.js/canvas-menu.js/canvas-utils.js/canvas-viewport.js、`styles/canvas.css`。**未验收**。
- bookmarks：`plugins-core/bookmarks.js`（464 行）、`views/bookmarks-view.js`、`styles/bookmarks.css`。**部分验收**（bookmarks:open 可打开、零报错）。
- daily-notes / templates / note-composer：文件完整（12-16KB），daily-notes/templates 已导出 `settingTab(app, containerEl)`。**未验收**。
- R1 五插件：file-recovery（449 行）、random-note、zk-prefixer、workspaces、slides（+`views/slides-view.js`、`styles/slides.css`）。**未验收**。
- 验收标准：build 通过 + 日志零报错 + 打开视图/执行命令截图 + 交互抽查（新建/编辑/持久化）。

### 待办（优先级从高到低）
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

## 7. 接任验收（2026-10-17，进行中）

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
