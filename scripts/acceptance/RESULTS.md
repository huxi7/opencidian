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

## 画布 UI 大修批（2026-10-19 上午）：原版对照 12 类缺陷

- 修复：图片卡崩（`vault.getResourcePath` 不存在 → 走 `vault.adapter`）；手柄/热区（悬停命中出 `mod-handles`、单选卡片恢复缩放手柄、未命中让位框选）；md 卡正文 padding/弹性留白/居中；卡片外标签（`updateNodeLabel` + 三态 always/hover/never + Mod/中键/双击）；文本卡占位改 `lucide-align-left`；控件第四组 + 帮助弹窗（新 `canvas-help.js`）；`mod-animating` 只在收尾帧切换 + `--zoom-multiplier` 同步 + 视口落库；媒体卡按资源宽高比回写几何；损坏图/缺文件占位；链接卡标签与菜单；三处快捷键文案平台化；画布 CSS 对齐（155 选择器零缺失）。
- 新增永久验收 `scripts/acceptance/canvas-ui.js`（107 项，浅深两套，纯计算样式/DOM）。
- 复跑：canvas 95 ✓、canvas-edit 77 ✓、canvas-selection 72 ✓、canvas-ui 107 ✓、editor-block-button 11 ✓、core-ribbon 47 ✓；六日志零 `TypeError|ReferenceError|act failed|setState failed`。
- 截图（修复后）：浅色 `…/probe-canvas-run-result-wpPOdA/screen.png`、深色 `…/Te85yW/screen.png`、空态 `…/xQWEfc/screen.png`、帮助弹窗 `…/s7DUhp/screen.png`。
- 剩余差异（有据未做）：链接卡不嵌 webview（既定跳过 webviewer）、分组背景图未实现、画布插件设置页缺失（选项与语义已有，缺 UI）、手柄 DOM 保留在各节点内、导出路径未逐字对齐原版截屏分支。

## 阅读视图排版深挖批（2026-10-19 上午）：原版对照 20 类

- 修复：H1–H6 阶梯（1.618em…1em，含字重/行高/字距）与「段落型块→标题」间距；段落 `unicode-bidi: plaintext`；首/末块边距归零（等价选择器复刻原版 el-* 容器）；外链内联 SVG 角标 + 未解析 `opacity .7` 与专属下划线；标签 `--tag-radius 2em`；列表造原版 DOM（`.list-bullet`）+ `li{margin-inline-start:3ch}` + 嵌套 `--list-indent`；任务 checkbox 16px + 勾选 mask + 完成态删除线（原版 12912-13003）；引用去自造圆角/底色；17 类 callout 色彩映射与 rgba(.1) 底色；代码 padding/pre 规格/`--code-white-space`；表格 `4px 8px`/行高 1.3/交替底色；hr 2px；脚注；图片去圆角 + `-webkit-optimize-contrast`；音视频固定规格；笔记嵌块（标题 + .markdown-embed-content + 右上打开按钮）与非可渲染附件占位（`.file-embed.mod-generic`）；progress 样式。
- 文件拆分守规：`markdown-content.css` 352→864 触顶后，把嵌入对象段（166 行）迁至 `markdown.css` → **700 / 175**，级联安全逐条核实、截图无变化。
- 新增永久验收 `scripts/acceptance/reading-ui.js`（**212 项**计算样式断言，浅深共用）；探针 `probe-reading.js`（`light|dark[:scrollTop]`）。
- 复跑（主会话独立）：reading-ui 212 ✓、reading-menus 13 ✓、notes 72 ✓、editor 131 ✓、image-size 36 ✓、page-preview 16 ✓、math ✓；代理另跑 table-interaction 178 / table-widget 76 / core-views 83 / editor-block-button 11 / editor-menu 23 / editor-layout 23 全绿，15 份日志零错误。
- 截图：浅色顶部 `…/probe-reading-run-result-f07wns/screen.png`、浅色 callout/代码/表格 `…/kpCxh1/screen.png`、浅色嵌入/脚注 `…/Zttrex/screen.png`、深色顶部 `…/QfmEa5/screen.png`、深色 callout/表格 `…/fDXpNp/screen.png`。
- 已知差异：容器 DOM 未复刻（视觉等价选择器）、阅读滚动容器留在 `.markdown-reading-view`、表格列对齐用 style 而非 `align` 属性、嵌块打开按钮 svg 省略 width/height（同原版被 CSS 覆盖）。

## 终版全量回归（2026-10-19 中午 · UI 深挖三批后 · 56/56 通过、0 失败）

- 主循环 42 场景（各自独立临时库）+ graph-perf 100/1000/5000：**45/45 通过**。
- 链式两连 5 组（同库）：graph-persist write→read、settings write→restart、community run→restart(3)、recovery exercise→restart(45)、audio-recorder run→restart(7)：**10/10 通过**。
- 内存回归 `workspace-regression`：**19/19**。
- 断言总量 ≈2700（计数场景合计 2709 + 6 个无计数场景 + 内存 19）；50 份日志零 `TypeError|ReferenceError|act failed|unhandledrejection|SyntaxError`。
- 本轮新增/扩容锁：theme-tokens 717、reading-ui 212、canvas-ui 107、editor 131、dialogs 8、zoom-lock 11、sidebar-chrome 35。
- 运行脚本与日志：`/private/var/folders/…/T/opencode/full-regression.sh` + `ui-deep-regression.log`。

## 1.14.4 保真批全量回归（2026-10-19 晚 · 插件整删/设置窗口/顶栏/菜单/快速切换)

- 范围：第三方插件整体移除、设置独立窗口（popout）、1.14.4 顶栏（标签栏消缝 + 「+」「⌄」+ view-header）、菜单家族、快速切换 1:1。
- 新增/扩容永久场景：`quick-switcher` 130 项（浅/深各一遍）、`view-header` 61 项、`menu-family` 52 项、`settings-window` 49 项、`modal-ui` 21 项、`sidebar-chrome` 35→66 项、`editor-menu` 42 项、`settings-plugins` 42 项；`community.js` 删除。
- 全量主循环（56 场景、独立临时库、`--no-screenshot`）：52 直过；4 个按正确相位/参数复核后通过——
  - `settings-restart --vault <settings-write 库>` → `/tmp/obs-copy-acceptance/settings-restart-run-result-sx89P3/run.log`
  - `graph-persist-read --vault <graph-persist-write 库>` → `…/graph-persist-read-run-result-Y5lkeV/run.log`
  - `graph-perf --nodes 100` → `…/graph-perf-run-result-goyTUq/run.log`
  - `core-ribbon`（旧断言依赖自造 `mod-quick-switcher`，已改为 `.prompt .prompt-input`）→ `…/core-ribbon-run-result-UsdJYo/run.log`
- 主循环日志目录：`/tmp/opensidian-full-1019-220645/`（`summary.txt` + 每场景 run.log）。最终 **56/56 通过**。
- 视觉取证：`_analysis/topbar-114/`（改前/改后浅深、空态、裁切）、`_analysis/quick-switcher-114/screens/`（我方与原版复现页截图 + 计算样式 json）、`_analysis/menu-family-114/`（audit.md + screens）；设置窗口浅/深截图见 `settings-window` 场景输出目录。
- 已知边界：per-leaf 前进后退、自动显示设置项、画布/图谱右键菜单、属性类型子菜单、标签组模型仍待单独立项。

## 像素级保真 + 核心交互批（2026-10-20 · 58/58）

- 四路交付：文件树/标签拖拽、1.14.4 令牌与图标、hover/动效、仓库切换窗口。
- 新增永久场景：`drag-drop` 76 项（CDP 真实指针路径验证落盘与重排）、`vault-switcher` 142 项（主窗 13 + starter 129，含第二窗口浅/深）。
- 扩容：theme-tokens 717→785（374 项消费令牌）、sidebar-chrome 66→73、view-header 61→68、menu-family 52→57、settings-ui 34、appearance 34、quick-switcher 130、dialogs 8。
- 全量主循环（58 场景、`--no-screenshot`）：57 直过；`graph` 一次悬停命中时序假红——单独复跑 2 次均 72/72；该断言已加有限重试（20×50ms），再复跑 3 次 72/72。最终 **58/58 通过**。
- 日志：`/tmp/opensidian-full-1020-091832/`（`summary.txt` + 每场景 run.log）；graph 复核 `graph-run-result-CMQvZ3 / I3qbUi / t1IxsH / BLzCGu / FB9tI9`。
- 视觉证据：`_analysis/drag-drop-114/`、`_analysis/tokens-114/`、`_analysis/motion-114/`；starter 截图见 `vault-switcher-run-result-7C2D4x/`。
- 已知差异：通知出场 easing 已在 2026-10-20 UI 收口修为 ease-in-out；菜单宽度 180/360 保留；starter 品牌/版本文本与浅色仅验收钩子；`--file-header-justify` 已按桌面原版改为 start。

## 编辑区几何 + 标签落点/开合 + 模式切换（2026-10-20 · 58/58）

- 原版实测（隔离实例 Obsidian 1.14.4 + CDP）：编辑态无 `.cm-gutters`；标题/正文同左缘；H1 段前 16px、行高 1.2；桌面 `--file-header-justify: start`。
- 修复：折叠 gutter 绝对定位不占正文宽；hN 行高与 `--p-spacing` 段前距；视图头标题左对齐；标签落点改 `workspace-drop-overlay` 10px 竖条（`::before` 内缩 3px/50% accent）；新增 `core/tab-animation.js` 200ms 标签开合补间。
- 断言：editor-layout 23→26、view-header 68→73、drag-drop 76→79（真实指针命中、落点几何/透明度、开合动画、四入口模式切换）。
- 全量主循环 58 场景（`--no-screenshot`）：**58/58 通过、0 失败**。日志 `/tmp/opensidian-full-1020-111628/`。
- 证据：`_analysis/editor-layout-114/README.md`（原版/修复前后数值）、`after-dark.png`、`tab-drop-overlay.png`。

## 右键菜单修复 + 悬浮预览嵌块 + 设置红绿灯（2026-10-20）

- **编辑区右键（用户报「一个都不能用」）**：
  - 子菜单真实鼠标点击回归：`menu.js` 的 document mousedown 改为沿 `parentMenu` 链判断归属；旧验收用 `.click()` 绕过 mousedown，故全绿但真机全失效。`editor-menu` 新增 `realClick`（mousedown→mouseup→click）锁死；段落设置→1级标题、插入→表格也改真实点击。
  - CM6 选区不写原生 DOM selection，Electron `editFlags.canCopy/canCut` 恒 false；菜单又把 `editor.getSelection()` 的 `{anchor,head}` 当字符串。改经 `getRange` 取文本，有选区即启用。
  - 真实右键折叠选区：`markdown-view.js` 捕获阶段记选区，contextmenu 落点在选区内时恢复（含 macOS Ctrl+Click）。
  - copy/cut/paste 改 Electron `clipboard`，不再依赖失焦后的 `execCommand`。
- **悬浮预览（用户报「跟原版完全不一样」）**：`.markdown-embed > .markdown-embed-content > .markdown-preview-view` + `.inline-title` 文件名；450px 宽、400px 限高自身滚动、32px padding、80ms swing 淡入、gap 10、内部滚动不关闭；来源默认门控 search/editor/tab-header=true、preview=false。
- **设置红绿灯（用户报「歪了」）**：Electron 33 用 `setWindowButtonPosition`；旧 API 无效导致停在 `(19,12)`。新增 `core/window-chrome.js`，主窗 `(14,12)`、设置 popout `(10,8)`，`is-popout-modal` 与缩放后重算；验收读原生 `getWindowButtonPosition()`。
- 断言：editor-menu 42→49、page-preview 16→21、settings-window +红绿灯；editor 131、menu-family 57、quick-switcher 130、theme-tokens 785、reading-ui 212、view-header 73、modal-ui 6、drag-drop 79 全绿。
- 全量 58：主循环 55/56 直过（`vault-switcher` 漏传 `--seed-vaults 3`，复跑 142 项全过），`settings-restart` / `graph-persist-read` 链式通过 → **58/58**。日志 `/tmp/opensidian-full-1020-122223/`、`/tmp/obs-copy-acceptance/vault-switcher-run-result-X4JBot/`。
- 证据：`_analysis/page-preview-114/`、`_analysis/settings-window-114/`。

## 1.14.4 UI 收口（2026-10-20 · 定向）

- 布局：默认只开左栏；文件树无仓库名根标题、根级 y=84；`nav-header` 15px、五按钮居中 x=120/150/180/210/240；右栏收起时右上开关 fixed、标签栏 38px 右侧留白；库信息栏 41.9px。
- 功能区：删除文件列表按钮，顺序 quick-switch→graph→canvas→daily→templates→command，gap 6、步长 30；Bases 按约定跳过。
- 阅读/编辑器：view-header 38px flex 收窄；callout note 图标 `lucide-pencil` 且无标题 softbreak；pre 16/24、pre code 14/21；普通变量不再着色。
- 状态栏反链条目 + 通知出场 `ease-in-out`；侧栏 chrome 抽到 `workspace-sidebar-chrome.js`（renderer 810→642 行）。
- 定向断言：reading-ui 219、sidebar 98、sidebar-shell 61、sidebar-chrome 82、file-explorer-multi 80、core-views 83、view-header 74、menu-family 57、theme-tokens 785、editor 131、core-ribbon 47、appearance 34、audio-recorder 72、basic-plugins 6、dialogs 8。
- 真实指针验证子菜单动作、右栏开关、反链状态栏、tooltip；全量 58 待白板子代理合入。


## 白板深挖 + 全量回归（2026-10-20）

- 链接卡 webview（标题回写/重载/断点保活/iframe 回退）、分组背景图 cover|ratio|repeat、md 文件卡内嵌 CM6 编辑与 400ms 写回、滚轮语义、画布剪贴板与拖入建卡、拖动阴影/文本卡占位/缺失文件警告/节点聚焦键盘语义、导出分组背景。
- 断言：canvas 96、canvas-edit 91、canvas-selection 72、canvas-ui 145、core-views 83、menu-family 57。
- 全量 56 场景 / 58 次执行（含 settings-restart、graph-persist-read 链式复跑）：**56/56 通过，3525 断言**。日志 `/tmp/opensidian-full-1020-ui/`，汇总 `summary-clean.txt`；`vault-switcher --seed-vaults 3` 142 项，`graph-perf --nodes 1000` 4 项。
- 证据：`_analysis/canvas-114/audit.md`、`screens/after-board-light.png`、`after-board-dark.png`。
- 未完成：画布设置页、右键拖拽平移、分组背景文件重命名/删除监听、链接卡 UA/离线占位、导出链接卡网页画面。

## 搜索/设置/画布/图谱/链接补全（2026-10-21）

- 全量：**58 场景 / 60 次执行全绿，4101 断言**；日志 `/tmp/opensidian-full-1021-ui/`（`summary.txt`）。
- 主循环包含新增 `search` 281、`link-suggest` 168；链式 `settings-restart`、`graph-persist-write → graph-persist-read` 通过；`vault-switcher --seed-vaults 3` 142、`graph-perf --nodes 1000` 4。
- `link-suggest`：移除 CM6 `.cm-completionInfo` 双列，改为原版单列 `.suggestion-container`；真实键盘/输入驱动，锁 382.8×78.1 容器、31.5 行高、15/19.5 标题、12/15.6 路径与 168 项交互。
- 白板：`canvas-ui` 171（右键/中键平移、contextmenu 顺序、背景附件生命周期）、`canvas` 101（链接卡真实网页截图导出）、`canvas-edit` 91、`canvas-selection` 72。
- 图谱：`graph` 87（触屏拖节点/轻点/平移/双指捏合；无悬停后 Mod 补弹）、`graph-worker` 58（worker 缓冲/SAB 回退）。
- 搜索：`search` 281（字段/属性/OR/括号/否定/正则/大小写、排序/折叠/解释/键盘/复制结果）。
- 设置：`appearance` 45、`settings-ui` 69、`settings-plugins` 74；页签顺序、快捷键行内录制、核心插件空态与入口显隐、编辑器/文件/关于/外观行级。
- 内存回归：`node --experimental-vm-modules src/renderer/core/workspace-regression.js` 19/19；VM 补 Element/Document/document 与 tab-animation mock。
- 边界：搜索未做虚拟列表/hover 上下文按钮/历史；画布设置页与 Windows 真实右键顺序未真机验证；链接卡 iframe/失败态导出回退 URL；设置 Interface 独立页签、主题管理仍跳过。

## 四路并行批：画布残影 / 搜索虚拟化 / 设置补漏 / 图谱深挖（2026-10-21 夜）

- 新增场景：`canvas-dummy` 59、`canvas-settings` 83、`search-views` 69；更新：`search` 489、`graph` 142、`graph-worker` 100、`settings-ui` 185、`settings-plugins` 105、`appearance` 99、`canvas-ui` 192、`menu-family` 58、`editor-menu` 51。
- 画布：残留虚影三条路径（卡片菜单加卡 / 连线手柄 / **边端点改接**）在纯点击后 `.is-dummy` 必须为 0；虚影一律在拖拽真正开始时才建并按原版吸附；`.is-dummy` 加 pointer-events:none 兜底；新建文本卡进编辑态、已聚焦 md 卡单击正文进编辑并写回真实文件；`.canvas` 文件卡渲染缩略图（canvas-minimap.js）而非原始 JSON；白板设定页（settingTab + canvas-options.js，写 .obsidian/canvas.json）。
- 搜索：虚拟列表（视口窗口 + 占位块撑总高，>500 命中时 DOM 节点数有上限）、建议弹层（算子 6 项 + recent-searches 历史）、结果悬停预览、白板节点文本命中不计数、文件树/编辑器右键补原版「在文件夹中查找」「查找 …」。
- 设置：独立界面页签、主题管理弹窗、检查更新真实比较、硬件加速断言锁、侧栏全局搜索（跨页签）、字体子页面、旧版主题真生效、补 15 个 locale 键。
- 图谱：命中半径对齐（原版桌面 1×、移动端 5× 规则保留）、右键菜单 10 段分节表 + view.linked 子菜单、hover-link 载荷收敛、力参数控件对齐、修新建颜色组色相恒 0° 的真 bug。
- 跨路修正：`menu-family` 与 `editor-menu` 的期望同步原版新增项（原版 app.js E2.onFileMenu / E2.onEditorMenu 确有「在文件夹中查找」「查找 …」），并把图标断言改为按名查找（原版 qg.sort 按顶级节名插分隔线，selection.* 三节之间不插线）。
- 全量：**61 场景 / 62 次执行全绿、4843 断言**；日志 `/tmp/opensidian-full-1021-b/summary.txt`；`settings-restart`、`graph-persist-write → graph-persist-read` 链式通过；`vault-switcher --seed-vaults 3` 142、`graph-perf --nodes 1000` 4。内存回归 19/19。

## 模式钮图标 / 许可证 / 设置别名 / 笔记内嵌白板（2026-10-21 夜）

- **视图头模式钮图标不换**（用户实机反馈）：根因是 `_applyMode()` 调 `_fillViewActions()` 不传参 → 函数直接 return，图标只在建头时填过一次。修法按原版 1.14.4 实测：图标表示「点它会切到哪个视图」（编辑 `lucide-book-open` / 阅读 `lucide-edit-3`）、aria-label 三行（状态句 + 动作句 + ⌘+单击新标签页提示）、去掉原版没有的 `is-active`、⌘+单击真的在新标签页打开且不切当前模式。view-header 74 → **82**。
- **许可证 MIT → AGPL-3.0**（用户裁定）：LICENSE 换 gnu.org 官方全文 + 版权头，package.json `license: AGPL-3.0`，README 同步并补源码提供说明。
- **设置搜索别名**：原版 `loe.search` 的 name/desc/aliases 三路匹配 + 子串 AND 匹配器（替掉模糊子序列）；4 个外观别名的 locale 键按原版 i18n 补齐；默认编辑模式接 ['live-preview','source']。settings-ui 185 → **220**（+35）。原版取证纠正两点：结果行只显示设置名（不拼描述）、只有名称命中才高亮。
- **笔记内嵌白板**：`.canvas` 嵌入改走原版 `cte/lte`（`.canvas-embed` 容器 + inline-embed 图标/文件名 + 缩略图 SVG，限高 `--embed-canvas-max-height: 400px`），阅读视图与实时预览都支持；缺文件落 `.file-embed.mod-empty`。新增 `canvas-embed` 场景 **81** 项；主代理另裁决两处：把行内 widget 从 `live-preview.js`（817 行）拆到 `live-preview-inline-widgets.js`（该文件回到 660 行）；画布嵌入**右键不弹菜单**（原版渲染器只对链接/标签/图片派发右键）。
- **修真 bug**：画布文件卡进编辑态后异步读原文会覆盖用户已输入内容（数据丢失竞态）→ 加 dirty 标志，不再覆盖。
- **E2E 不再唤起系统浏览器/访达**：验收点「在默认浏览器打开/帮助/下载更新」曾真的拉起用户默认浏览器；现主进程在 E2E 下拦截 `open-external`/`open-url`/`help`/`show-item-in-folder`/`open-path`/`print-to-pdf(open)`。
- 本轮最终全量：**62 场景 / 62 次执行全绿、4967 断言**；日志 `/tmp/opensidian-full-1021-d/summary.txt`；链式 `settings-restart` 与 `graph-persist-write → graph-persist-read` 通过；`vault-switcher --seed-vaults 3` 142、`graph-perf --nodes 1000` 4。

## 核心插件设置进侧栏 / 半屏死区 / 书签图标 / 版本号（2026-10-22）

- **核心插件设置直接进侧栏**（用户实机反馈）：原版 1.14.4 的设置在打开时就把「已启用且导出 settingTab」的核心插件登记到左栏「核心插件」分组，不需要先点齿轮。实现 `SettingsHost.registerCorePluginTabs()` + `ensureCorePluginTab()`（构造时与每次 `openInApp()` 幂等登记），插件启停时 `registerCorePluginTabs`/`removePluginTabs` 增删；新增命令面板设置页（置顶命令，数据 `.obsidian/command-palette.json`，面板内置顶优先于最近使用）。settings-plugins 105 → **111**。
- **半屏死区（真 bug）**：`_renderLeaf` 在叶子还没有视图时先塞了一个占位 `.view-content`；随后的 `setViewState` 又追加真实视图内容，旧占位永不移除 → 一个叶子里两个 `.view-content` 各占一半高度，上半屏成为点不动的死区。新建标签页后打开画布可稳定复现（canvas 347px / 叶子 734px）。修法：`_refreshLeafContent` 只保留当前视图的 `.view-content`。新增 `layout-split`（**78** 项几何断言）与 `layout-modals`（**31** 项：设置弹窗、布局管理弹窗、加载布局 SuggestModal、新建标签页、新建画布全屏几何）。
- **书签图标对齐原版**：`folder` 走别名表会变成 `folder-open`，原版写死 `lucide-folder`；改为显式 `lucide-*` 前缀并逐类型锁定（file/heading/toy-brick/layout-dashboard/folder/search/git-fork）。同时删掉原版没有的行尾「…」按钮（重命名/删除/复制路径只走右键），补上原版视图头第四个「搜索」钮（SearchComponent + 标题/路径过滤）。bookmarks 0 → **28** 项。
- **旧版本残留清理**：About 页与主进程 `version` 通道还写着 **1.12.4**，安装程序版本写死 **1.0.0**；现统一为 1.14.4，渲染层 `VERSION` 改从主进程 IPC 读取（单一事实源）。同时把 `_analysis/obsidian-asar` 旧取证引用改为 `_analysis/obsidian-114/renderer`。
- **Bases 仍未实现**：`plugins.bases.*` 只有 149 条文案，没有插件模块；核心插件清单里点不到「数据库」。
- 本轮最终全量：**64 场景 / 5110 断言全绿**；日志 `/tmp/opensidian-full-1022-a/summary.txt`；链式 `settings-restart` 与 `graph-persist-write → graph-persist-read` 通过；`vault-switcher --seed-vaults 3` 142、`graph-perf --nodes 1000` 4。版本号收口后补跑 `settings-ui` 220 / `settings-plugins` 111 / `bookmarks` 28 / `layout-modals` 31 全绿。

## 画布拖线紫框 / 点击后卡住（2026-10-22）

- **拖线端点出现 100×100 紫色方框**：原版的临时节点（`Pee`）只做几何占位，**从不 attach/render**；我们的 `createDummyNode()` 无条件 `attach()+render()`，把 `.canvas-node.is-dummy` 的 accent 边框 + 20% 填充画了出来。现改为 `createDummyNode({ attach: false })`，拖线端点与卡片连线手柄两条路径都不再挂 DOM。
- **点击卡片后画布卡住、节点动不了**：`handleDragWithPan` 在 pointerdown 就 `setDragging(true)`，但纯点击（位移 < 5px）时拖拽工厂不会创建，`cleanup` 不执行 → `isDragging` 永久为真。滚轮缩放、悬停手柄（连线点/缩放手柄）、双击建卡全被 `if (this.isDragging) return` 吞掉。`startDrag` 增加 idle 收尾：未越过阈值也复位拖动状态。
- canvas-dummy 59 → **71** 项：新增「拖动中无可见虚影」「连线成功吸附后建边 / 拖动态复位 / 节点仍可拖动」「纯点击后状态复位并仍可拖动」。

## 白板底部建卡按钮卡死（2026-10-22）

- **点击/拖出「添加卡片」后整窗卡死**：`dragTempNode` 把 **rect**（x/y/width/height）直接传给 `getSnapping`，而该函数的契约是 **bbox**（minX/minY/maxX/maxY）→ `boxSnapPoints` 解构出 undefined → 吸附点全为 NaN → `findSnapMatches` 内层 `NaN === NaN` 恒为 false、`index` 不前进 → 主线程死循环。空画布时没有吸附目标所以旧用例没暴露（`snapToObjects=false` 的拖出用例也不经过该分支）。
- **修法**：`place()` 传 bbox；`findSnapMatches` 过滤非有限坐标并在分组为空时强制前进（双保险）。
- canvas-dummy 71 → **75**：新增 `snapToObjects=true + 板上已有卡片` 的拖出用例（虚影坐标有限、落卡成功、无残留）。


## Wave 1：Bases P1、桌面缺口、画布收口与工程卫生（2026-10-22）

基线：`c117d96`，工作区干净。未配置 remote。
先执行用户指定命令：

```sh
sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs canvas-dummy --no-screenshot"
```

构建成功，canvas-dummy **75 项通过**。
日志：`/tmp/obs-copy-acceptance/canvas-dummy-run-result-svcKsb/run.log`。
本轮只读 `_analysis/obsidian-114/renderer/`，未启动原版。
全部 E2E 使用 `--no-screenshot`，未调用浏览器或访达。

### T1 Bases P1

- 文件：`plugins-core/bases{,-model,-expression,-view,-embed,-styles}.js`；共享入口 `core/plugins-registry.js`、`core/workspace{,-file-view}.js`、`core/settings.js`、`plugins-core/file-explorer.js`、`markdown/reading.js`、`editor/live-preview-inline-widgets.js`。阅读模块为守上限拆出 `markdown/mermaid.js`。
- 场景：新增 `bases`，**55 项通过**。原版格式 YAML 能开，嵌套 and/or/not、排序、limit、基础公式、两种嵌入和 # 指定视图均验收。未知键/视图不丢；插件启停、外部修改、断开后的订阅释放均验收。
- 命令：`sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs bases --no-screenshot"`。
- 日志：`/tmp/obs-copy-acceptance/bases-run-result-OTIuzh/run.log`。
- 对照：`_analysis/bases-114/FACTS.md`。原版 e9 插件、d$/r$ 筛选、g$ 视图配置与 s$/l$ 默认列/排序。
- 缺口：仅 table 与安全表达式子集。其它视图、分组、汇总、完整公式、日期类型和 CSV 留 Wave 2。块式 YAML 按键局部写回；顶层流式或锚点冲突时保留值重写，排版与注释不保证全部保持。
- 主代理内存回归：新扩展名分派更新 VM 注册表替身，base 启停映射纳入既有用例，**19/19 通过**。

### T2 1.14.4 小缺口

- 文件：`plugins-core/backlink.js`、`core/{app,settings,ipc,custom-css,file-view-actions,view-header}.js`、`views/{markdown-view,settings-tabs-appearance}.js`、`styles/desktop-gaps.css`、`index.html`；主进程 `window-effects.js` 与对应 IPC 装配。删除旧 mod-translucent 假近似规则。
- 场景：新增 `small-gaps`，**49 项通过**；更新 `appearance`，**99 项通过**。共享文件动作再回归 `view-header`，**82 项通过**。
- 命令：`sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs small-gaps --no-screenshot && node scripts/acceptance/run.mjs view-header --no-screenshot"`；`appearance` 同运行器单独执行。
- 日志：`small-gaps-run-result-VI7CuX/run.log`、`view-header-run-result-yJKE5v/run.log`、`appearance-run-result-9jtmsk/run.log`，均在 `/tmp/obs-copy-acceptance/`。
- 对照：`_analysis/small-gaps-114/FACTS.md`。原版 A8 文档默认反链、Markdown backlinks 状态、embedded-backlinks 样式与 sidebar vibrancy。
- 缺口：根 obsidian.css 开关为兼容扩展；默认应用只验证受保护 IPC。vibrancy 验证真实 API 成功下发后的状态，无截图视觉结论。既有反链导航能力未扩展为全部原版选项。

### T3 画布收口

- 文件：`views/canvas-export.js`、`views/canvas-export-tiles.js`、`main/canvas-capture.js`、`core/app-commands.js` 与主进程注册入口。
- 场景：新增 `canvas-export`，**24 项通过**；受影响 `canvas`，**101 项通过**。
- 命令：`sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs canvas-export --no-screenshot && node scripts/acceptance/run.mjs canvas --no-screenshot"`。
- 日志：`/tmp/obs-copy-acceptance/canvas-export-run-result-BfUL9c/run.log`、`canvas-run-result-ewJD0T/run.log`。后者为新增场景扩为 24 项前的旧场景回归，最终集成结果见全量汇总。
- 对照：原版 app.js 字符偏移 3351618（generateHDImage）、3357674（取整）、3358537（整窗截图）、3358805（分块）、3359608（恢复）；app.css 18214–18223。
- 结果：真实落盘使用同一场景整窗分块。验收跨块连续 1770 像素、真实正文、缩放、隐私与选择恢复、取消零截图、异常不写假图。删除未实现的文档新窗口命令。
- 缺口：沿用 4096 像素上限；隐私模式隐藏正文与媒体，未复刻 Flow Circular 乱码字体。同步 renderCanvasImage 仅为简化预览验收，真实落盘完全不用它。设置独立窗口仍可用。

### T4 工程卫生

- 主进程拆出 `app-menu.js`、`app-protocol.js`；画布拆出 `canvas-drag.js`、`canvas-node-factory.js`。原入口保持不变。
- 扫描另发现两个既有超限样式文件，按原层叠顺序拆出 `layout-shell.css`、`components-overlays.css`。
- 正式场景统一 `{pass,count,checks}`；运行器严格检查数量一致，超时只清理自身 Electron 进程组。
- `notes-settings` 从零计数改为真实控件输入、内存选项、JSON 写回与重开读回，每页 **9 项**。
- 新增 `full.sh` 与 `full.mjs`，自持锁、默认 build、链式读回与逐次日志/汇总。复跑：`sh scripts/acceptance/full.sh --output /tmp/opensidian-wave1-full-1022`。
- 断言数量以最终全量汇总为准；不同 phase、主题和图谱规模分别计一次执行，不把次数冒充独立场景。


#### 最终全量与计数审计

- **67 个正式场景 / 97 次有效覆盖 / 6477 条真实断言，全部通过**。实际执行 **104 次**，包含首轮 97 次与计数修正补跑 7 次。
- 首轮为 96/97，通过条件未被放宽。theme-tokens 的 785 条检查均通过，但回执遗漏 748 条明细，严格运行器拒绝该回执；补齐后独立重跑通过。
- 另修正 dialogs 8→43、modal-ui 6→21、page-preview 21→22、settings-window 浅深各 18→50 的步骤/断言混计；graph-worker 100→96，四条环境信息改放 notes。每条计数都对应实际检查，不把步骤或环境说明计入。
- 最终证据：`/tmp/opensidian-wave1-full-1022/summary-final.json`、`summary-final.txt`。该报告保留原报告引用，以七份补跑有效回执替换旧口径；原始 `summary.json`、97 份日志和唯一失败日志均未覆盖。
- 补跑命令：`sh scripts/acceptance/full.sh --skip-build --only dialogs,modal-ui,page-preview,graph-worker,settings-window --output /tmp/opensidian-wave1-count-audit-1022`；另用 `--only theme-tokens --output /tmp/opensidian-wave1-theme-count-1022`。下次默认全量直接使用正确计数。
- 最终内存回归：`node --experimental-vm-modules src/renderer/core/workspace-regression.js`，**19/19 通过**。日志 `/tmp/opensidian-wave1-memory-1022.log`。这 19 组未混入 E2E 的 6477 条。
- 行数检查：src/scripts 中 JS、MJS、CSS、SH、Markdown 均不超过 800 行；最大 795 行。L3、L2 与本结果文档已回环。
- 本轮范围止于 Wave 1。Wave 2 的 Bases P2/P3、Wave 3 的打包冒烟尚未执行。未配置 remote，未 push。


## Wave 2：Bases P2/P3（2026-10-22）

基线 `c532b55`，工作区干净。先跑 build + bases，**55 项通过**。
日志：`/tmp/obs-copy-acceptance/bases-run-result-B5IA9u/run.log`。
只读原版静态包，未启动原版。所有 E2E 加 --no-screenshot，不弹原生保存框或外部程序。
两条线并行，P3 类型/公式/CSV 先提交，P2 布局依赖它们后提交。

### T6 Bases P3

- 改动：`plugins-core/bases-expression.js`、`bases-formula-functions.js`、`bases-context.js`、`bases-values{,-file,-render}.js`、`bases-csv.js`；共享 `bases-model.js`、`bases.js`、`markdown/reading.js`、`editor/live-preview-inline-widgets.js`。主进程资源协议补 SVG 媒体类型，文件视图接富值与宿主上下文。
- Node：`node scripts/bases-formulas.test.mjs`，**273 条通过**，逐项覆盖原版 formulas.funcs 的 **78 个说明键**；`node scripts/bases-csv.test.mjs`，**11 条通过**。固定 UTC、时钟和随机源，不依赖当前日期。
- E2E：新增 `bases-formulas` **34 条**、`bases-values` **30 条**通过；后者验证真实富值 DOM/导航、PNG/SVG 资源、CSV 命令及取消/最新配置/插件卸载。
- 公式对齐 Null 传播、稀疏属性算符、惰性条件、类型继承、同一正则状态、日期溢出、无效日期及 ISO 时长截断。this 在独立数据库指 base，在阅读/实时预览指宿主 Markdown。
- CSV 复用当前列与查询，按原版 LF/引号转义，无 BOM/尾换行；失败单元格留空。确认后重读磁盘，取消不写盘。默认视图名.csv，复用受控 Desktop 保存通道。
- 对照：`_analysis/bases-114/P3-FACTS.md`、`P3-FUNCTIONS.md`。CSV app.js 偏移 1620621、2497522、2518446；类型、算符和文件属性偏移见事实表。
- 边界：HTML 以源码显示；Markdown 只渲染标准行内语法且明示降级；超预算表达式与危险正则报错。未声称这些渲染能力已完全 1:1。
- 证据：`/tmp/opensidian-wave2-formulas-unit.json`、`/tmp/opensidian-wave2-csv-unit.json`；最终 E2E 原日志路径见下方目标回归汇总。

- P3 独立提交验证：从暂存树生成隔离快照，未带入 P2 布局代码；独立 build、Node 273+11、bases-formulas 34、bases-values 30、bases 55 均通过。三个 E2E 回执 CjDjPM、3Sjmw8、TrvbV7 保留在 /tmp/obs-copy-acceptance/；临时源码快照已删除。

### T5 Bases P2

- 改动：`bases-view.js`、`bases-styles.js`、`bases-layouts.js`、`bases-grouping.js`、`bases-config.js`、`bases-kanban.js`、`bases-card-media.js`；共享查询放开四类视图，补齐八条中英文看板文案。
- 新增场景 `bases-views`，**125 条通过**。四种布局、分组折叠/显隐/重排、内置/自定义汇总、视图切换与配置落盘均有断言。
- 看板 DOM 拖放实际改写标量笔记属性，覆盖大小写保留、空值删除、正文及其它属性保留、不可写分组与失败提示。封面覆盖 PNG 资源、尺寸、fit、列表首项、链接、颜色与错误占位。
- 阅读/实时预览三种新布局和宿主生命周期均验收；隐藏阅读嵌入挂起订阅，重现重读，移除销毁。
- 对照：`_analysis/bases-114/P2-FACTS.md`。app.js 3234271 注册四种布局；2339476 汇总；2489646 分组；3155235/3155586 拖放写回；3138776/3145023/3145082 封面。
- 边界：文件/公式/日期/链接/复杂列表分组只读并提示原因；file.folder 移动、列拖动、虚拟滚动、单元格编辑与新组创建尚未实现。

### 集成目标回归与收尾补跑

```sh
sh scripts/acceptance/full.sh --only bases,bases-views,bases-formulas,bases-values,reading-ui,editor,small-gaps --output /tmp/opensidian-wave2-targeted-1022
```

**7 场景 / 7 次执行 / 640 条 E2E 断言，全部通过**。
bases 55、bases-views 122、bases-formulas 34、bases-values 30、reading-ui 219、editor 131、small-gaps 49。
汇总：`/tmp/opensidian-wave2-targeted-1022/summary.json` 与 `summary.txt`，含原始 Electron 回执路径。
273 + 11 条 Node 单测单独计数，未混入 640 条 E2E。
首次富值场景发现标签复用搜索窗格时未更新查询，修复 setQuery 后通过；原失败 u9C3RC 日志保留。
封面初轮发现 SVG 无 MIME 解码失败，原失败 8qClmo 保留；协议修复后真实 SVG 解码通过。
本轮未做视觉验收，未执行 Wave 3 全量回归或打包冒烟；Wave 1 的 6477 条不能作为本轮全量结果。

收尾审查修复未知布局无法返回的问题：仍只提示降级，不显示该布局配置，但保留切回已支持视图的入口。新增 3 条真实切换/不改 YAML 断言。
修复后运行 `sh scripts/acceptance/full.sh --only bases,bases-views,bases-values --output /tmp/opensidian-wave2-final-p2-1022`，55 + 125 + 30 = **210 条通过**。
最终有效集成覆盖 **7 场景 / 7 次覆盖 / 643 条 E2E 断言**；本组集成实际执行 10 次（初轮 7 次 + 修复后 3 次）。
合并有效回执见 `/tmp/opensidian-wave2-final-1022/summary.json`、`summary.txt`，按最新回执替换三个重跑场景，保留两份原始报告及全部日志。
273 + 11 条 Node 单测、P3 隔离提交的 119 条 E2E 单独记录，未混入 643 条。
源码与验收脚本均 ≤800 行，L3/L2/结果文档已同步。本轮两任务两提交，不配置 remote，不 push。


## Wave 3：全量、内存与打包冒烟（2026-10-22）

基线 HEAD **5279ba8**，工作区干净，未配置 remote。
本轮不启动原版、不做视觉验收，不唤起浏览器、访达或原生保存框。

### 全量回归

```sh
sh scripts/acceptance/full.sh --output /tmp/opensidian-wave3-full-1022
```

**70 个正式场景 / 100 次执行 / 6666 条断言，全部通过。**
首轮全绿，无重跑或回执替换。所有执行都有 --no-screenshot，包含重启读回、链式场景、主题变体与图谱三档规模。
汇总：`/tmp/opensidian-wave3-full-1022/summary.json`、`summary.txt`；逐次日志及真实 checks 保留。

### 内存与 Node 单测

```sh
node --experimental-vm-modules src/renderer/core/workspace-regression.js
node scripts/bases-formulas.test.mjs
node scripts/bases-csv.test.mjs
```

- 工作区内存回归 **19/19**；日志 `/tmp/opensidian-wave3-memory-1022.log`。
- 公式 **273 条**，覆盖原版 **78 个说明键**；结果 `/tmp/opensidian-wave3-formulas-1022.json`。
- CSV **11 条**；结果 `/tmp/opensidian-wave3-csv-1022.json`。
- 三组不混入 6666 条 E2E；Node VM 与包类型提示属于已知工具提示，未作为通过依据。

### 目录包与真实冒烟

```sh
sh scripts/with-lock.sh 'npm run dist:dir -- --publish never'
sh scripts/with-lock.sh 'node scripts/smoke-packaged.mjs --no-screenshot'
```

- 构建成功：应用 **1.14.4**，Electron **33.4.11**，macOS **arm64**。
- 产物：`release/mac-arm64/OpenSidian.app`；Info.plist 的 CFBundleShortVersionString 也为 1.14.4。
- 初次目录包漏根 LICENSE。`electron-builder.yml` 补入原文后重建；LICENSE 内容未修改。首包日志 `/tmp/opensidian-wave3-dist-1022.log`，最终日志 `/tmp/opensidian-wave3-dist-final-1022.log`。
- 新冒烟器替换旧版无条件 passed:true 回执：**14 条启动前核对 + 20 条真实运行 = 34/34**。
- 启动前核对身份、版本、许可证与当前主进程、入口、bundle 哈希，拒绝启动陈旧或错误产物。
- 真实运行验证隔离库/userData、打包模式、版本、编辑器内容、Bases 新建/查询、公式、列表、CSV 写盘与 SVG 解码；CSV 保存路径注入临时库，不弹原生对话框。
- 采用严格 {pass,count,checks} 与错误日志判定；等待自己创建的进程退出，超时只清理自身进程组，不触碰用户应用。
- 回执 `/tmp/opensidian-wave3-packaged-1022.json`；原始运行日志路径包含在回执中，screenshot 为 null。
- ASAR：5405 个条目，86742697 字节；SHA-256 `d625f8fbfa4c77f3179ac4f73699067e577b6b95c9dcc69af9f3194410b6e82c`。

### 交付边界

源码与验收脚本均 ≤800 行，L1/L2/L3 已回环。本轮不改变应用功能、品牌或许可证原文。
只构建本机目录包，未更新旧 DMG/ZIP；未签名、公证、安装或发布。
原有 Bases 编辑/虚拟滚动、画布尺寸与隐私模式等已知边界没有被本轮验收抹去。
Wave 1–3 计划内工作已收尾。未配置 remote，未 push。

## 数据库可见入口修复（2026-10-22）

原版静态 app.js 1434044、3231062 附近和 3240190 证明空标签、功能区与文件夹菜单均有入口。此前实现漏接三处；不能以命令面板可执行替代可见入口。
修复 bases.js 与 empty-view.js：真实图标、普通/Mod 点击、键盘激活、目标文件夹创建；插件停用撤销全部入口，重启恢复。menu-family 更新原版菜单项序，full.mjs 纳入 Bases 重启阶段。L3/L2/README 同步。

- 基线：with-lock 内 build + canvas-dummy --no-screenshot，75 条通过。日志 /tmp/opensidian-bases-entry-baseline.log。
- 目标：with-lock 内 build + bases-entry/core-ribbon/menu-family/sidebar-shell，全部 --no-screenshot，23 + 47 + 58 + 61 = 189 条通过。日志 /tmp/opensidian-bases-entry-check2.log。
- 重启：bases-entry --vault /private/tmp/obs-copy-acceptance/obs-copy-bases-entry-R2McOR --phase restart --no-screenshot，6 条通过。日志 /tmp/opensidian-bases-entry-restart.log。
- 首次入口场景因菜单延后登记外部点击监听，测试在同一事件轮次关闭菜单失败。补齐真实事件轮次后重跑；未改业务通过条件，原失败 1NrQmy 保留。
- 本提交只修入口；界面、编辑、属性、窗口与性能任务继续并行。未启动原版、未截图、未修改真实库、未 push。

## P2 属性编辑闭环（2026-10-22）

新增 properties-types/properties-menu，文档与 file-properties 共用编辑器。types.json 忽略大小写并保留未知键；文本、数字、复选框、日期、日期时间与列表真实写盘。补齐类型菜单、显式转换确认、选区剪贴板、首个属性添加与改名。对象值只读展示，切换类型不批量改写其它笔记。
原版对照见 _analysis/properties-114/FACTS.md：UR/QR、showPropertyMenu 1859054、转换确认 1885097 及各类型控件。源码 L3、markdown/plugins-core/acceptance L2 已同步。
with-lock 内 build + properties-editing --no-screenshot 后，扩展最终场景 54 条通过；重启 verify 11 条、reading-ui 219 条通过。分段回执见 /tmp/opensidian-properties-complete.log、/tmp/opensidian-properties-verify-final.log；54 条原始日志 XVzQKd，阅读样式 U1QFPL。正式 full.mjs 纳入 verify 链。
menu-family 的属性菜单断言更新为类型/剪切/复制/粘贴/移除，core-views 更新无属性文件首项添加入口；旧只读期望不再适用。未启动原版、未截图、未 push。

## P0/P2 桌面窗口、菜单与数据边界（2026-10-22）

新增 main/document-window、native-menu、vault-write；renderer/core 对应协调器与 frontmatter-write。文档可复制或移至独立窗口，保存后转移，关闭先保存；同库文件双向同步。独立窗口恢复位置、尺寸、缩放和全部标签，不覆盖主 workspace.json。macOS 缺省系统菜单，开关可切回主题菜单；分节、子菜单、未勾选复选项和缩放坐标均对齐静态契约。原版对照见 small-gaps-114/DESKTOP-FACTS.md。
属性写回按文件串行，通过主进程 CAS 重试并原子替换；坏 YAML 拒写，不再退为空对象。ctime 改为原版取整 birthtimeMs。Electron 33 macOS 的 copyFile 不保留创建时间，使用 cp -p 保留元数据后替换，不经过 shell。新增并发、坏 YAML、正文/CRLF/BOM、失败恢复与创建时间回归。文件树延后聚焦绑定原视图，避免快速打开数据库后调用已换掉的标题方法。

- /tmp/opensidian-cas-preserve-final.log：with-lock 内 build + frontmatter-write/notes/properties-editing，20 + 72 + 54 条通过。
- /tmp/opensidian-document-window-layout.log 与 layout-restore.log：真实窗口 21 条、重启 6 条通过，包含 Markdown/Bases/Canvas、最后输入保存与全部标签恢复。
- /tmp/opensidian-native-menu-final.log：build + native-menus/settings-window/menu-family，17 + 50 + 58 条通过。
- /tmp/opensidian-desktop-final-check.log：sidebar-chrome 82 条通过；新增数据库顺序纳入断言。
- 所有场景都带 --no-screenshot。上述为分段回归，不能表述成一次连续全量。
- 失败保留：RWFh4X 的就绪前探针，native-menu 首轮事件对象不可克隆与延后标题聚焦竞态，f8EN9b/aqUwxv 的创建时间漂移；分别修复并重跑，未放宽检查。

## 真实堆与图谱性能门槛（2026-10-22）

workspace-regression 的 19 项是内存 DOM 逻辑单测，不是堆泄漏测量。新增 lifecycle-memory 在真实 Electron 中强制 GC：30 轮数据库/嵌入/图谱开关和插件启停，10 条通过，创建 34 个 Worker 后存活 0；Vault 15→15、Metadata 9→9、Workspace 37→37、DOM 660→660，堆变化 -397128 字节。日志 /tmp/opensidian-bases-editing-final-lifecycle.log，回执 Q7FFdY。
graph-perf 不再把 Worker 空 tick 当物理耗时；断言节点/边、打开预算、帧率、位置发布和每项释放。1000/5000 节点各 14 条通过，打开 25/73ms、帧率 120.7/120；回执 SgvSSu/Cj14T2，日志 /tmp/opensidian-lifecycle-check.log。预算由场景固定，结果只代表本机环境。

## 保存、关闭与监听竞态收口（2026-10-22）

Markdown/Canvas 保存委托 core/window-save，按真实加载原文做 CAS；失败保留 dirty 和输入。同内容冲突可采纳基线。window-save-conflict 提供常驻真按钮：载入磁盘先确认，另存副本成功后才解除原草稿。Workspace/命名布局尊重 save/setState/onClose false，异步关闭完成前保留 DOM。主窗与文档窗共用 main/window-close，退出等待 Markdown/Canvas/Bases 保存；设置窗不覆盖主布局。
Node 保存 27、Workspace VM 26 通过；build + window-save-race31/editor-race20/canvas-dummy75/layout-split78/layout-modals31，共235条通过，/tmp/opensidian-window-save-final.log。最新保存单测 /tmp/opensidian-final-window-save.json，逻辑VM /tmp/opensidian-final-workspace.log。
首次全量发现 sDrUjj：扫描完成至 Chokidar 初次 crawl 间可漏文件。Vault.watch 现返回就绪 Promise，串行处理初次事件并对账新增/修改/删除；stopWatch 立即失效旧代次并等关闭。真实 Chokidar Node22首轮与重复通过；双窗21+重启6+图谱14+Bases性能98=139通过，/tmp/opensidian-vault-watch-target-summary.json。
运行器实时落日志、异常快速失败，回执后仍须进程正常退出；count必须为正，缺伴随回执始终输出pass:false。dev-hooks等待应用装配及伴随动作/截图Promise，移除主脚本6500ms猜测。协调Node11、主13+starter129+focus6通过，见/tmp/opensidian-dev-hooks-handoff.md；提前关闭7rOdMj原失败保留。
图谱和搜索预览仅修夹具：真实显示并固定专用节点；每手势取得当前稳定搜索行，保留700ms无Mod观察及补弹/关闭断言。生产图谱/搜索/预览未改。filter两新库143+143，搜索两新库69+69通过；JQ3xUm/8b3481、bkPa2w/0aFd6N。原048/093失败保留，不能据旧日志断定具体触发因素。
L3/L2同步；源码与脚本均≤800行。上述为开发分段回归，不混入最终完整覆盖组。

最终只读审查补修两处丢稿边界：冲突恢复读盘后复核文件、草稿和请求序号；布局在隔离树完成校验与反序列化后才关闭原树。Node32、VM29、真实双窗35条通过；首轮 gj6Z7q。最后布局专项与完整覆盖的最新回执见末节。
最终布局专项：full.sh --only document-window,layout-split,layout-modals --output /tmp/opensidian-layout-final-1023，3场景4次136条全通过；保存一致性重跑35条 x2fpUA，/tmp/opensidian-save-review-final-e2e.log。Node /tmp/opensidian-save-review-node.json，VM /tmp/opensidian-save-review-vm.log。
