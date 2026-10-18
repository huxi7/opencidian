# 2026-10-17 桌面验收

所有场景在独立临时 vault 运行。原版安装与用户笔记未作为写入目标。
构建通过。最终成功场景没有未捕获异常、TypeError、ReferenceError。
开发版 Electron 的 CSP 提示仍存在。

| 范围 | 验证 | 证据目录（/tmp/obs-copy-acceptance/） |
| --- | --- | --- |
| 画布 | 输入落盘、连线、缩放收敛、关闭重开 | canvas-run-result-wtqHAJ |
| 书签 | 分组创建/重命名、打开、删除、落盘 | bookmarks-run-result-WOoRGN |
| 图谱 | 40 项交互断言，图元/过滤/拖拽/局部图/销毁 | graph-run-result-6tEHBy |
| 笔记五插件 | 72 项断言，重启 30 项 | notes-run-result-Yokom0、notes-reload-result-ynnaWQ |
| 恢复/工作区/幻灯片 | 首次55项、重启41项 | recovery-exercise-result-5X8XP7、recovery-restart-result-v39Oyu |
| 编辑器 | 标题/缩进独立开关、两视图高亮、模式恢复 | editor-run-result-HIX077 |
| 右侧栏 | 93 项断言，折叠/精确跳转/无监听增长 | sidebar-run-result-5l8vDC |
| 数学 | 5个有效公式、2个错误隔离、CHTML、本地字体 | math-run-result-lgz9xq |
| 设置 | 四份配置写入并重启读取 | settings-write-run-result-npCsD8、settings-restart-run-result-p5jWOl |
| 文件切换 | 未保存编辑先落盘、删除后恢复视图 | editor-switch-run-result-VImPbE |

每个证据目录包含 run.log 与 screen.png。其他阶段截图与初始失败复现保留在同级目录。
路径指向本机验收产物，不属于可分发应用资源。

## 重跑

先执行 `npm run build`，再运行 `node scripts/acceptance/run.mjs <场景> --no-screenshot`。
用户已停止视觉验收；上文截图是历史证据。
运行器输出创建的 vault 和日志路径；无截图模式的 screenshot 为 null。只接受带验收标记的临时库。

重启验证用 `--vault <上次输出的路径>`：

- notes：`--phase reload`。
- recovery：`--phase restart`；截图可选 `history`、`layout`、`slides`。
- settings-write 后使用 settings-restart 场景。
- graph-persist-write 后使用 graph-persist-read 场景。

额外运行 `node --experimental-vm-modules src/renderer/core/workspace-regression.js`，19组内存回归。
MathJax 独立适配器子代理的41项基础/故障测试见 assets/mathjax/SOURCE.md 所指交付证据。

## 验收边界

截图已由主代理逐张查看，交互由真实 Electron 内 DOM 事件与应用入口执行。
并未宣称手工鼠标手感、超大图库性能、原版全屏逐像素截图比对全部完成。
未覆盖项以 AGENT-STATE.md §8 为准。

## 侧栏与功能区补漏

- 侧栏外壳：53项包含真实双库切换、设置点击、固定工具及旧布局恢复；180px窄栏50项；重启3项通过。用户已确认视觉无问题并要求停止视觉验收。
- 功能区：`core-ribbon --no-screenshot` 的47项逻辑断言通过；重启10项通过。覆盖五插件的启停、重复注册、命令撤销、图谱打开与Mod新标签。
- 日志：`core-ribbon-run-result-dYoVlv/run.log`、`core-ribbon-restart-result-XDp9li/run.log`，均位于 `/tmp/obs-copy-acceptance/`，无截图。
- 工作区内存回归现为19组，包含固定侧栏不可关闭和底部库栏的稳定节点。
- `run.mjs` 新增 `--no-screenshot`，仅收集日志并按异常与场景断言判定。

## 文件恢复对齐（2026-10-17，原主 agent 接续）

- recovery：exercise 82 项、restart 43 项通过。新增断言：旧 `intervalSeconds`→分钟迁移、设置页签文本输入即时生效并写盘、弹窗复制按钮写入剪贴板、显示差异开关渲染成对/行内/折叠上下文、Canvas 创建与修改快照、恢复后打开的画布视图重载、重启后 Canvas 快照与迁移选项保留。
- canvas：回归通过（外部修改重载 + watcher 回声过滤 + 视口保留）。
- 日志：两场景 0 未捕获异常；开发版 CSP 提示仍存在。
- 证据：`/tmp/obs-copy-acceptance/recovery-exercise-result-VbjGga`、`recovery-restart-result-zTxmps`、`canvas-run-result-n4hJop`（均无截图）。
- 存储仍为按天 JSON（未迁移 IndexedDB）；快照范围含 canvas/base；间隔单位为分钟。行为差异与未覆盖项见 AGENT-STATE.md §11。

## 画布撤销/重做与转换为文件（2026-10-17，主 agent 接续）

- canvas：`--no-screenshot` 通过。新增断言：历史初始 `is-disabled`、动作后撤销可用、Mod+Z 撤销节点并落盘、Mod+Shift+Z 重做、按钮撤销/重做、`canvas:convert-to-file` 可用性、命名弹窗默认 Untitled、非法名拦截、建 md/内容/几何继承/关联边改指、撤销恢复文本卡、重做再应用。
- 修复：文件卡片在正常缩放下创建即崩溃（`contentEl` 未初始化时无保护访问）；拆出 `views/canvas-file-node.js`。
- 日志 0 未捕获异常；证据 `/tmp/obs-copy-acceptance/canvas-run-result-lpAd6p`。
- 未覆盖：图片导出、方向键微移、快速设置菜单。见 AGENT-STATE.md §12。

## 图谱性能基线（2026-10-17，主 agent 接续）

优化前（Electron 实测，`graph-perf` 场景，`--no-screenshot`）：

| 节点 | 边 | 打开 ms | tick ms | fps |
| --- | --- | --- | --- | --- |
| 100 | 200 | 16 | 0.78 | 121.3 |
| 1000 | 2000 | 26 | 4.92 | 119.3 |
| 5000 | 10000 | 81 | 101.5 | 11.3 |

优化后（Barnes-Hut 四叉树 + 四叉树碰撞裁剪 + 内联遍历）：

| 节点 | 边 | 打开 ms | tick ms | fps |
| --- | --- | --- | --- | --- |
| 100 | 200 | 8 | 1.55 | 120.7 |
| 1000 | 2000 | 25 | 3.65 | 120.0 |
| 5000 | 10000 | 83 | 16.2 | 77.3 |

- 5000 节点：tick 6.3× 加速、fps 11.3→77.3；100 节点 tick 略升为建树固定开销，帧率无差别。
- 所有规模关闭释放与关闭后可响应通过；graph 交互 40 项断言在优化后全过。
- 复跑：`node scripts/acceptance/run.mjs graph-perf --nodes <N> --no-screenshot`。
- 未覆盖：worker 化（原版力学在 worker）见 AGENT-STATE.md §13。

## 幻灯片全窗口演示宿主（2026-10-17，主 agent 接续）

- recovery：exercise 84 项、restart 45 项通过。幻灯片改为 body 级全窗口覆盖层（对齐原版 M9），不再注册 'slides' 视图。
- 新增断言：覆盖层挂 document.body 且铺满窗口、演示期间 markdown 视图原样、弹窗层级在覆盖层之上、Esc 摘除覆盖层并保持模式/选区、容器与监听释放。
- 依赖审计：katex 移出 package.json 直接依赖（JS 无引用；lock 保留为 mermaid 传递依赖）。
- 回归：core-ribbon 47 项、工作区 19 组通过；日志 0 未捕获异常。证据 `/tmp/obs-copy-acceptance/recovery-exercise-result-dHzVQf`、`recovery-restart-result-kRfoNr`。

## 画布快速设置、方向键微移与边跟随修复（2026-10-17，主 agent 接续）

- canvas：`--no-screenshot` 通过。新增断言：边跟随节点移动（往返路径一致）、方向键步长与 Shift 5 倍、对齐网格吸附、快速设置三项菜单与 has-active-menu、对齐网格切换写入 canvas.json、只读切换与 localStorage 持久化、重开后只读恢复、按钮退出只读。
- 修复：拖动/微移节点时边不跟随（帧渲染缺少 moved→edges 传播）；画布选项默认改为原版的 snapToGrid/snapToObjects 均为 true。
- 日志 0 未捕获异常；证据 `/tmp/obs-copy-acceptance/canvas-run-result-kOY03b`。
- 未覆盖：图片导出、CM6 卡片编辑、画布空间索引/可视区域渲染。见 AGENT-STATE.md §15。

## OpenSidian 品牌化与 UI 保真批次（2026-10-17，主 agent 接续）

- 品牌化改名、社区插件安全模式、shell 手感批、设置页行级、外观页、编辑器（代码块复制/LP 嵌入）、page-preview、自定义应用图标均已完成并提交；提交序列见 AGENT-STATE.md §16。
- 全量回归（20 场景，`--no-screenshot`，20/20 通过；graph 首跑为时序抖动，复跑 40 项通过）：
  basic-plugins 6、bookmarks、canvas、community 19、core-ribbon 47、dialogs 7、editor 107、editor-switch 2、folding-disabled、graph 40、math、notes 72、notes-settings、settings-ui 22、settings-write、sidebar 93、sidebar-shell 61、vault-hidden、appearance 22、page-preview 13。
- 汇总日志：`/tmp/opencidian-full-regression.log`（含各场景 logfile 路径）。新增场景：community、settings-ui、appearance、page-preview。
- 本批修复的关键缺陷：reading.js wiki 链接切片（`[[A]]` 目标丢前 2 字符）、插件 shim 未导入 Keymap、math 场景旧协议域名、字体检测（document.fonts.check 不可靠）、clipboard 未聚焦 rejection。
- 已知缺口：菜单 `.menu-scroll` 结构、功能区配置弹窗、画布 CM6 卡片编辑/图片导出/对齐参考线、图谱颜色组拖拽、macOS 分发包。详见 AGENT-STATE.md §16。

## 最终全量回归（2026-10-18，OpenSidian 收口）

- 23 个场景 `--no-screenshot` 全量：**23/23 通过、0 失败**。汇总日志：`/tmp/opencidian-final-regression-2.log`。
- 覆盖：basic-plugins 6、bookmarks、canvas 68、community 19、core-ribbon 47、core-views 83、dialogs 7、editor 113、editor-switch 2、folding-disabled、graph 72（本批连续 3 次稳定）、math、notes 72、notes-settings、settings-ui 22、settings-plugins 52、settings-write、sidebar 93、sidebar-shell 61、vault-hidden、appearance 32、page-preview 13、recovery。
- 本批新增/更新场景：core-views（出链 + 属性视图 + Unlinked mentions）、settings-plugins（52）、appearance（+功能区配置）、canvas（+导出/参考线）、graph（+色组拖拽/悬停预览/力参数）、page-preview、community、settings-ui。
- 运行前提：`npm run build`；Electron 场景一律 `--no-screenshot`；多代理并发时用 `sh scripts/with-lock.sh` 串行构建与验收。
- 已知未完成项见 AGENT-STATE.md §16（画布 CM6 卡片编辑/空间索引、音频录制、macOS 分发、LICENSE、像素级视觉验收等）。
- 重启/持久化阶段：recovery restart 45 项、community restart 3 项、settings-restart 通过（`/tmp/obs-copy-acceptance/recovery-restart-result-0D4oDX`、`community-restart-result-ahCzgN`、`settings-restart-result-kXSnfA`）。
- 工作区内存回归：`node --experimental-vm-modules src/renderer/core/workspace-regression.js` 19 组通过。

## 主编辑区 file layout 批（2026-10-18）

- 构造原版 DOM：`.cm-scroller > .cm-sizer > .cm-contentContainer > (.cm-gutters + .cm-content)`；行宽（readableLineLength）默认开启时内容列 700px 居中，关闭时满宽贴边。
- 行内标题移入 `.cm-sizer`（原版行为：随内容滚动、与列同宽）；`margin` 简写改 `margin-block-end`（修标题右移 ~14px）。
- `.cm-line` 去掉 2px 水平内边距（修中文文本位置）；`.cm-gutters` 增加 `--file-folding-offset: 24px`。
- 新增 `scripts/acceptance/editor-layout.js`（21 项）：结构/居中/行位置/设置联动/阅读视图/折叠全关后开行号 gutter 挂载。
- 回归：editor 113、editor-switch 2、folding-disabled、math、notes 72、sidebar-shell 61、core-ribbon 47、settings-ui 22、page-preview 13。

## 编辑器菜单 + 外部拖入批（2026-10-18）

- 新增 `editor/editor-menu.js`：原版 onContextMenu 结构（拼写建议→链接→剪贴板→链接插入→文本格式→段落设置→插入→复制路径），结束前触发 `editor-menu` 事件；桌面端借主进程 `context-menu` 一次性参数取拼写建议与编辑状态；`menu.js` 选中/Esc 关闭整条菜单链。
- 新增 `editor/attachments.js`：附件落盘（attachmentFolderPath 四语义、重名序号、二进制写入）。
- `editor.js` 支持系统外部文件拖入：复制进库 + `![[name.ext]]`；Alt/Ctrl 直链（库内→内链，库外→file://）。命令新增 `editor:attach-file`、`editor:set-heading-1..6/0`、`editor:toggle-blockquote`、`editor:clear-formatting`。
- 修两个深层 bug：① `generateMarkdownLink` 对附件误删扩展名（图片/附件嵌入全错）；② MarkdownView 外部修改同步把自家写入的迟到通知误判为外部改动并回滚文档（丢编辑）。
- 新增 `editor-menu` 场景 23 项；回归 editor 113、editor-switch 2、notes 72。

## 粘贴图片 + 文件树外部拖入批（2026-10-18）

- `editor.js` 拦截带图片的 paste（File / HTML data URL），落盘 `Pasted image <YYYYMMDDHHmmss>.png|jpg` 并插入嵌入；文本粘贴交回 CM6。`editor:paste` 命令同序（剪贴板图片优先）。
- 文件树：系统外部文件拖到文件夹标题或根区域 → 复制进库（重名序号），不插链接。
- 新增 `editor-paste` 场景 7 项；回归 editor 113、editor-menu 23、basic-plugins 6、sidebar 93、sidebar-shell 61、notes 72。

## 阅读视图链接/图片右键菜单批（2026-10-18）

- `core/workspace.js` 新增 `handleLinkContextMenu`（已解析：在新标签页/新标签组/重命名 + file-menu 事件；未解析：创建此文件）与 `handleExternalLinkContextMenu`（复制链接 + 默认浏览器打开 + url-menu 事件），`openLinkText` 支持 'tab'/'split' 透传。
- `markdown/reading.js`：阅读视图右键接线（内部链接/外链/图片），图片节点补 `data-href`（库内读二进制、URL/data 走 fetch 复制到剪贴板，失败提示 copy-failed）。
- `editor/editor-menu.js`：链接区改为委托 workspace 共享处理器（编辑器与阅读视图同一套原版菜单）。
- 新增 `reading-menus` 场景 11 项；回归 editor-menu 23、notes 72、page-preview 13、sidebar 93、core-views 83、math。

## 块 widget「编辑此区块」批（2026-10-18）

- live-preview：代码块/数学块/Mermaid widget 增加原版 edit-block-button（lucide-code-2、aria-label=编辑这个区块、点击把光标放回块源码并让 widget 让位）；异步渲染完成后挂按钮，避免被 renderMath/renderMermaid 覆盖。
- editor.css：逐字移植原版 .edit-block-button 规则与 hover 显形。
- 新增 editor-block-button 场景 11 项；回归 editor 113、math、notes 72、editor-menu 23。

## 录音机核心插件批（2026-10-18）

- `plugins-core/audio-recorder.js`：功能区麦克风按钮（开始/结束切换、is-active）、`audio-recorder:start/stop` 命令（checkCallback 语义照原版）、权限/设备错误映射 locale 文案、MediaRecorder 落盘 `Recording <YYYYMMDDHHmmss>.webm|m4a` 到附件目录并插入嵌入；无状态栏项（原版证据）；卸载停止录音并释放轨道。
- 与原版差异：无 electron.remote → 用 navigator.permissions 降级；无 fix-webm-duration 时长修补；提示走 Notice 而非按钮 tooltip。
- 验收：audio-recorder 65 项 + restart 7 项（mock getUserMedia/MediaRecorder，双扩展名分支、错误四路径、卸载释放、设置页开关与 core-plugins.json 持久化）；回归 core-ribbon 47、settings-ui 22、settings-plugins 52。
- 阅读视图笔记/音频/视频/PDF 嵌块补 `data-href` 并接入链接右键菜单（reading-menus 11→13 项）。

## 下载当前文件附件批（2026-10-18）

- `editor:download-attachments` 由瘫痪桩变为完整功能：扫描（正文图片嵌入 + frontmatter 图片 URL，代码块掩码）、画廊勾选模态（复选框默认勾选、缩略图、可见文件名）、逐项下载（data URL 解码 / 远程经 Desktop.requestUrl，文件名走 URL→content-disposition→content-type→Image.jpg 规则）、改写（嵌入 `![[…]]`、frontmatter `[[…]]`）、Notice 计数；取消不落盘不改写。
- 新增 styles/download-attachments.css（原版 .attachments-gallery 逐字 + 补可见文件名标签）；core/attachments-downloader.js（375 行）。
- 验收 download-attachments 35 项（stub app.requestUrl，零真实网络）；回归 notes 72、editor 113。

## 终版全量回归（2026-10-18，网络恢复后 · 33 场景）

- 主循环 **33/33 通过、0 失败**（`/tmp/opencidian-final-regression-3.log`）：appearance 32、audio-recorder 65、basic-plugins 6、bookmarks、canvas（68）、canvas-edit 58、community 19、core-ribbon 47、core-views 83、dialogs 7、download-attachments 35、editor 113、editor-block-button 11、editor-layout 23、editor-menu 23、editor-paste 7、editor-switch 2、folding-disabled、graph 72、graph-persist-write、math、notes 72、notes-settings、page-preview 13、reading-menus 13、recovery 84、settings-plugins 52、settings-ui 22、settings-write、sidebar 93、sidebar-shell 61、table-widget 76、vault-hidden。
- `graph-perf` 需 `--nodes`：100/1000/5000 三档各 4 项通过（`graph-perf-run-result-sNgO5U / ZRohG0 / LHX5hj`）。
- 阶段回归：graph-persist-read ✓、settings-restart ✓、community restart 3、recovery restart 45、audio-recorder restart 7。
- 本轮修复的深层 bug 汇总：附件链接丢扩展名（generateMarkdownLink）、自家写入迟到通知回滚文档（MarkdownView 外部同步）、菜单链点击不关闭父菜单、CM6 gutter 延迟挂载 NotFoundError（sizer DOM 重定向）、阅读视图 wiki 链接切片（早期）、插件 shim 缺 Keymap 导入（早期）。
- 运行方式：`npm run build`；单场景 `node scripts/acceptance/run.mjs <场景> --no-screenshot`；并发的构建/验收一律 `sh scripts/with-lock.sh "<命令>"`。
- 剩余缺口见 AGENT-STATE.md §16（表格拖拽重排/单元格选择、图谱 worker、画布空间索引、卡片内编辑命令、macOS 分发包、像素级视觉验收等）。

## 打包分发批（2026-10-18）

- `scripts/make-app-icon.py`：原创应用图标（地平线与曜日）→ build/icon.png + build/icon.icns；`electron-builder.yml`：appId app.opensidian、files 仅 dist/src/assets/package.json、asar、identity null（未签名）、mac dmg+zip。
- 产物：`release/OpenSidian-1.0.0-arm64.dmg`（119MB）、`OpenSidian-1.0.0-arm64-mac.zip`；`npm run dist:dir` 可快速验证。
- `scripts/smoke-packaged.mjs`：打包版真实启动冒烟（库启动/建文件/开文件/protocol=app:），实测冷启动约 1.9s 通过。

## 切文件竞态修复批（2026-10-18）

- 根因（视图层，非表格）：`_onExternalModify` 发起 `cachedRead` 后若期间切文件，迟到内容会被判定为外部改动并 `setValue` 进**新文件**，随后自动保存把旧内容写进新文件——跨文件内容损坏级 bug；表表格批的 `table-widget` 排序回归即由它触发（约 29% 概率）。
- 修复：`_onExternalModify` 记住发起读取时的文件路径，读毕路径不一致即丢弃；`save()` 写盘期间切文件则不更新 `_loadedText`。
- 新增 `editor-race` 场景 9 项（挂起 cachedRead 确定性复现）；**变异测试**：撤掉路径守卫必失败（`迟到内容未打进 B :: "# A\n\nAAA dirty\n"`），恢复后通过。
- 回归：table-widget 76、table-interaction 97、editor 113、editor-switch 2、notes 72 全过。

## 图谱力学 worker 批（2026-10-18）

- 协议 1:1：`{nodes,links,alpha,run}` / `{forces,alpha,run}` / 拖拽 `{alphaTarget,forceNode}` 与解钉、`alpha` 仅抬高、SAB+末尾 Uint32 版本守卫 / transfer 双通道、`ignore` 探测、60fps 循环与 `alphaDecay = 1-0.001^(1/300)`。
- 共享内核 `graph-force.js`（worker 与本地回退同一份数学）；`graph-sim-worker.js` 新入口（dist/graph-sim-worker.js）；门面三级回退（app:// 直载 → fetch+Blob → 本地线程）。
- 验收 graph-worker 55 项（协议逐字段对照、三级回退、SAB 注入、钉住/解钉、力参数、销毁幂等、本地后端全链路、双视图独立 worker）；回归 graph 72、core-ribbon 47、sidebar-shell 61。
- 与原版差异：物理内核不复刻 WASM（行为级对齐，常量与参数一致）；未跨源隔离环境自动走 transfer；替补 worker 重发镜像状态（原版无此路径）。
