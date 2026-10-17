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
