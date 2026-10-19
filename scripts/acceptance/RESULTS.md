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

## 图谱力学内核常量对齐核验（REA 证据，2026-10-18）

- 证据：`ev_69f236a37d7a2b53e3e3767963585c25fa268947f4f9c986d4480b468f9a1458`（provider `REA WABT artifact adapter wabt@1.0.42`，authority `shipped-artifact`）。原版 `sim.js` 内嵌 WASM（3322 字节，零 imports，导出 `init/complete/visitCharge/visitCollide/manyBody/simulate/memset/memory`）。
- 原版调用点（sim.js JS 侧）：`simulate(0, n, m, alpha, centerStrength, linkStrength, linkDistance, charge, 0.9, 0.5)` + `complete(0, n, 0.6)`；JS 回退实现（同文件）显式构造：`manyBody.strength(() => -1000).distanceMin(30)`、`collide.radius(60).strength(.5)`。
- 常量比对表（原版 ↔ `plugins-core/graph-force.js`）：

| 参数 | 原版 | 本实现 | |
|---|---|---|---|
| 斥力 charge | -1000 | -1000 | ✓ |
| distanceMin | 30 | 30 | ✓ |
| Barnes-Hut θ | 0.9（θ²=0.81） | 0.81 | ✓ |
| 碰撞半径 / 强度 | 60 / 0.5 | 60 / 0.5 | ✓ |
| 连线距离 / 强度 | 250 / 1（÷min(两端度数)） | 250 / 1（同） | ✓ |
| 向心力 | 0.1 | 0.1 | ✓ |
| 速度衰减 | 0.6（`complete(...,0.6)`） | 0.6 | ✓ |
| alpha 衰减 | `1-0.001^(1/300)`，alpha<0.001 停 | 同 | ✓ |

- 结论：参数与公式为**行为级 1:1**（原版 WASM 与其自带 JS d3 回退同源；本实现即按该 d3 语义重写）。未复刻位级 WASM 二进制（法律与收益原因，见 AGENT-STATE“REA 自动使用政策”）。

## 图谱力学内核深挖对齐（原版 JS 回退实现逐行对照，2026-10-18）

- 证据：REA `ev_69f236a3…`（WASM 3322B，WAT 34527 字符）+ 原版 `sim.js` 自带可读 JS 回退实现（与 WASM 同源）。
- 原版每帧调用（JS 胶水）：`simulate(0, n, m, alpha, centerStrength, linkStrength, linkDistance, charge, 0.9, 0.5)` → `complete(0, n, 0.6)`；力顺序 `[forceX, forceY, link, manyBody, collide]`。
- 逐条核对结论（`graph-force.js`）：
  - 中心力 `.strength(.1)` 目标原点 ×alpha ✓；弹簧：预测位置 `x+vx`、`bias=count(vk)/(count(v)+count(k))`、距离 250、strength `1/min(度数)`、iterations=1 ✓；斥力：θ²=0.81、`distanceMin²=30²` 钳制、`value*alpha/l`、自节点排除 ✓；碰撞：半径 60、strength .5、预测位置、**不乘 alpha**、面积比权重 `r²/(r_s²+r_n²)`、包围盒裁剪 `s+cell.r`、`index>` 去重、iterations=1 ✓；积分 `vx*=.6; x+=vx` + `fx/fy` 钉住 ✓；alpha 衰减 `1-0.001^(1/300)`、`>0.001` 继续 ✓。
  - **本批修正的 4 处偏差**：① jiggle 由 `Math.random` 改为原版确定性 LCG（seed=1，逐位同序列）；② 弹簧逐分量补零 jiggle；③ 自环度数计两次；④ 碰撞逐分量补零（累加 jiggle²）。
- 回归：graph-worker 55、graph 72、core-ribbon 47 全绿。

## 检查更新批（2026-10-18）

- `core/update-check.js`：静态更新源检查（GitHub Release `{tag_name,html_url}` 或自建 `{version,url}`），semver 比较，新版本 → Notice + 「更新」按钮打开下载页；未配置 updateFeed 不联网；失败/已最新按 silent 区分提示。
- 命令 `app:check-updates`；启动后 5s 静默检查（仅当配置了 updateFeed 且 checkUpdates≠false）。
- 顺手修 `i18n.tt()`：兜底文案现在也做 `{{name}}` 插值（此前 fallback 里的占位符原样输出）。
- 验收 update-check 7 项（stub requestUrl 零真实网络：未配置不联网/新版本+按钮/已最新无按钮/失败提示/静态 JSON）；回归 settings-ui、core-views、editor-menu、notes。

## 侧栏收展动画与顶栏穿模修复（2026-10-18）

- 顶栏穿模根因：折叠侧的分隔条（`workspace-leaf-resize-handle`）是根分割的 flex 兄弟节点，左栏 `display:none` 后它仍留在 x=44、**1px 竖线全高**，正好穿过最小化按钮（红绿灯 x≈19..73）。
- 修复：根分割边界分隔条打 `data-divider-side`，折叠时 `opacity:0` + `pointer-events:none`（对齐原版 `r.style.opacity=0` 与折叠 split 隐藏后的不可交互）。
- 动画 1:1：宽度补间缓动改为原版 `--anim-motion-swing`；补齐原版 `y()` 的 toggle 迁移 FLIP（幽灵 oldStyle=offset/宽度收缩、新位 newStyle=offset；140ms；`oldStyle:'none'` 幽灵立即移除）；折叠/展开不再整树重建 DOM（改为类切换），使 FLIP 的旧父容器可用。
- 内存回归：`workspace-regression` 补 `vault.js` 替身与 `prepend/firstChild`，19/19 通过。
- 验收：新增 sidebar-chrome 19 项；回归 sidebar 93、sidebar-shell 61、core-ribbon 47、appearance 32。

## 录音机 webm 时长补丁（2026-10-18）

- 原版用 `fix-webm-duration` 重建元数据头补 Duration（MediaRecorder 产出的 webm 缺时长，播放器进度条异常）；我们同样引入该库（MIT，esbuild 打进 bundle）。
- `audio-recorder.js`：记录会话开始时间，webm 落盘前 `fixWebmDuration(blob, elapsedMs)`；**补失败回退原始 blob（录音绝不丢）**；`app.fixWebmDuration` 为验收注入点。
- 验收 audio-recorder 65→72（新增：补丁调用与时长、落盘内容来自补丁后 blob、失败回退原始数据）；real-library 在无效 fixture 上抛错走回退的路径也被覆盖。

## page-preview 悬停后按 Mod 批（2026-10-18）

- 原版行为：已悬停在链接上（未按 Mod 不弹），此时按下 Mod **补弹**预览、松开 Mod 收起。
- 实现：记录 hoverAnchor（链接）与 pendingHoverLink（图谱等 hover-link 来源）；keydown Mod → 立即弹出（图谱用最后指针坐标）；keyup Mod → 门控来源的预览收起。
- 验收 page-preview 13→16（悬停不弹仅挂起 / 按 Mod 补弹 / 松开收起）。

## 画布 activeEditor + 导出弹窗批（2026-10-18）

- `workspace.getActiveEditor/setActiveEditor/unsetActiveEditor` + `activeEditor` 属性：画布卡片宿主优先、回落活动叶子；`commands.js`/`editor-commands.js` 各只改解析入口。
- 导出弹窗：范围（全部/当前部分）、缩放、水印、隐私模式（13 个原版 locale 键；视口模式隐藏缩放与水印）；canvas-export 支持 frame/scale/showLogo/privacyMode 与尺寸预估。
- 超限拆分：canvas-controls / canvas-export-dialog / canvas-group-node（canvas-node 729、canvas-view 750）。
- 验收 canvas-edit 77、canvas 95、editor 113、core-ribbon 47、sidebar-shell 61。

## 表格剩余项批（2026-10-18）

- `table-format.js`：无选区单元格右键的 clipboard + 文本格式子菜单（basic/advanced/danger 三段）；`table-widget` 追加 Row/Column/Sort 子菜单并订阅 `editor-menu` 追加到原位编辑菜单末尾。
- 删首/末行补空行（相邻行有正文才补，避免连续空行）、触屏手柄常显（`body.is-touch` 门控 + `mod-active-row-handle`）、剪贴板同进程兜底。
- 验收 table-interaction 97→178、table-widget 76、editor 113。

## 终版全量回归（2026-10-18 深夜 · 隐形 E2E · 53/53 通过、0 失败）

- 主循环 41 场景（各自独立临时库）+ graph-perf 100/1000/5000：**44/44 通过**。日志 `/tmp/opensidian-terminal-regression.log`。
- 链式补跑 10 次（同库两连）：graph-persist-write→read、community 19→restart 3、recovery 84→restart 45、audio-recorder 72→restart 7、settings-write→settings-restart：**10/10 通过**。日志 `/tmp/opensidian-terminal-regression-b.log`。
- 内存回归 `node --experimental-vm-modules src/renderer/core/workspace-regression.js`：**19/19**。
- 断言总量 ≈1730（主循环 ≈1500 + 重启链 230 + persist 对与内存回归）。
- 本轮新增场景：file-explorer-multi 80、stacked-tabs 49、canvas-selection 72、image-size 36、editor-race 9→20。

| 场景 | 断言 | 场景 | 断言 |
|---|---|---|---|
| editor | 113 | canvas | 95 |
| sidebar | 93 | recovery | 84 |
| core-views | 83 | file-explorer-multi | 80 |
| canvas-edit | 77 | table-widget | 76 |
| canvas-selection | 72 | notes | 72 |
| graph | 72 | audio-recorder | 72 |
| sidebar-shell | 61 | graph-worker | 55 |
| settings-plugins | 52 | stacked-tabs | 49 |
| core-ribbon | 47 | recovery restart | 45 |
| image-size | 36 | download-attachments | 35 |
| appearance | 32 | editor-layout / editor-menu | 23 / 23 |
| settings-ui | 22 | editor-race | 20 |
| sidebar-chrome | 19 | community | 19 |
| page-preview | 16 | reading-menus | 13 |
| editor-block-button | 11 | dialogs / editor-paste / update-check | 7 / 7 / 7 |
| audio-recorder restart | 7 | basic-plugins / e2e-focus | 6 / 6 |
| graph-perf ×3 | 4+4+4 | community restart | 3 |
| editor-switch | 2 | bookmarks / folding-disabled / math / notes-settings / settings-write / settings-restart / vault-hidden / graph-persist-read / graph-persist-write | 通过（无计数） |

- 链式场景调用协议：`--vault` 必须含 `.obs-copy-acceptance-fixture` 标记（run.mjs 防呆）；recovery 首次还需 `.obs-copy-recovery-fixture` 与 `.obsidian/file-recovery.json`；两连必须同库，否则被判失败。
- 全部运行 `--no-screenshot` + E2E 隐形呈现层（不抢焦点、不进 Dock、窗口不可见）；日志零 `TypeError|act failed|unhandledrejection|ReferenceError`。
- 本轮收口的新增功能：堆叠标签页、文件树多选/键盘导航、图片尺寸语法与重置大小、画布多选/框选/对齐/分布/分组、编辑器撤销栈跨文档边界修复（数据丢失级）。

## UI 深挖批（2026-10-19 上午）：LP 记号 + 命令面板 `1ea1e2b`

- 修复：LP 无序列表圆点整片缺失（widget 空 span、无 `.list-bullet` CSS；原版 app.css 12114/12164 `:after` 画 0.3em 圆点）；任务行残留 `- ` 原文、无缩进位、已勾无划线（silent 记号 widget 只留缩进位 + `cm-task-checked`）；列表缩进未接原版 `--list-padding-inline-start`（12105-12112）；折叠箭头常亮（原版 7236-7259 默认 `opacity:0`、悬停/已折叠才现）；命令面板热键折行（缺 `.suggestion-item.mod-complex`，原版 9003-9060 热键与标题同行靠右）。
- 验收：**editor 113→131、dialogs 7→8**，全绿；截图复核 probe-ui `search`/`palette`。
- 顺带查明：CM6 foldGutter 首个 gutterElement 是 `initialSpacer`（`visibility:hidden` 的折叠态假记号），非真折叠——断言按语义排除。
- 巡检结论（计算样式对照原版）：设置模态 90vw×85vh → 1033×658 ✓、nav 底色（`--modal-sidebar-background`=primary）✓、菜单底色（`--menu-background`=secondary）✓、搜索/图谱结构 ✓。
- 探针补充：`probe-ui`（UI 面巡检截图）用于 1:1 深挖取证，非永久场景。

## 主题 token 全量对齐批（2026-10-19 上午）

- 原版 `body`(2020-3059)/`.theme-light`(2866)/`.theme-dark`(2913)/`:root`(2001-2019)/`.mod-macos`(2970) 共 **906 项变量声明**；逐字比对后 **888 项一致**，真缺口 3 组已补：
  - `--zoom-factor: 1`、`--titlebar-height: 30px`（app.css 3958-3960 独立 body 块；前者原仅运行期内联）。
  - `--safe-area-inset-*` / `--preferred-text-scale` / `--keyboard-height`（app.css 17741-17747）：此前缺失使 `properties.css`/`search.css` 的 `max(var(--safe-area-inset-bottom), var(--size-4-8))` 整条失效；补齐后桌面端 `env()=0` → padding 32px，与原版一致（已固化消费实证断言）。
- 永久验收 `scripts/acceptance/theme-tokens.js`（528 行）：**717 项断言全绿**；变异测试反证非空（改 `--text-muted` + 删 `--titlebar-height` → 报 32 项失败）。
- 不覆盖并有据：pdf.js 内部 12 项（无 PDF 阅读器）、运行时内联（accent/font/zoom）、组件级同名（pill/canvas-color，body 级断言最终值）、原版自身缺口（深色 `--shadow-edges`）照搬不修、`@media print` 两处。
- 复跑：theme-tokens 717 ✓、appearance 32 ✓、graph 72 ✓、reading-menus 13 ✓、settings-ui 22 ✓、sidebar 93 ✓、core-views 83 ✓、sidebar-shell 61 ✓。
- 截图：`…/opencode/theme-token-shots/theme-tokens-panel.png`（面板"差异 0 项"）。
