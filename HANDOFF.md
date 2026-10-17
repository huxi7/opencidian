# 交接：Obsidian Copy 后续功能补齐

更新时间：2026-10-17。实现基线：`92f0eda`。
这是给原主 agent 的接续指令。旧版交接任务已完成，不要重复执行。

## 开工顺序

1. 进入 `/Users/link/Desktop/Obsidian copy`，核对 `git status` 与最近提交。
2. 读取 `AGENT-STATE.md`：§10 是交接安排，§9 是最新实现，§8 是验收与功能边界。
3. 读取根 `CLAUDE.md`，再读目标目录的 L2 和文件 L3。
4. 读取 `scripts/acceptance/RESULTS.md`。旧临时证据可能被系统清理，以可复跑脚本为准。
5. 对本阶段目标，只读分析 `_analysis/obsidian-asar/app.js`、`app.css` 对应片段。行为分析后独立重建实现。

## 已完成，避免重做

- 11 个优先核心插件已完成交互抽查及修复；不是此前的未验收状态。
- graph/workspace/main 已拆分；设置四类 JSON 已通过跨进程持久化验证。
- 标题/缩进折叠、代码高亮、离线 MathJax、右侧反链/大纲已补齐本轮目标。
- 左右侧栏是固定工具：无关闭叉、文档加号、拖出或中键关闭。
- 旧布局按插件状态恢复缺失工具；中心文档标签保留正常关闭行为。
- 左下角有库切换、帮助、设置；折叠后功能区仍可进入设置和仓库入口。
- 图谱、白板、命令面板、快速切换、模板的功能区按钮已补齐。
- 插件启用注册入口，禁用撤销，重复启用不重复注册。
- 图谱：设置 → 核心插件 → 关系图谱，点击最左侧图标或按 `⌘G`。
- 最新逻辑验收：功能区47项、重启10项、工作区19组。构建已在实现阶段通过。
- 代码提交：`9be2517`、`0fc1393`、`92f0eda`。本次交接只更新文档，未重跑应用测试。

## 当前工作规则

- 用户已实机确认侧栏，明确要求停止视觉验收。不要截图、启动真实 Obsidian 或操作桌面做视觉检查。
- 验收使用构建、逻辑断言、日志与重启持久化；Electron 场景必须加 `--no-screenshot`。
- 技术栈固定：Electron 33、esbuild、CM6、markdown-it、MathJax CHTML、renderer nodeIntegration。
- 不修改 `_analysis/`，不搬运专有 JS。不劫持 `obsidian://`，不读写真实 Obsidian userData 或用户笔记。
- CSS 规则及布局值对齐原版事实源。不要凭印象重新设计已确认的侧栏。
- 社区插件/市场不做。保留 §3 主动跳过清单；不能把“全部核心插件”理解为已完成或自动取消跳过项。
- 代码变更同步 L3/L2，并检查 L1。单文件不超过800行。
- 大任务拆给子代理：继承当前模型，思考等级 medium，不使用 GPT-6.1 sol。当前没有待恢复的子代理。
- 明确文件所有权。共享 registry、index.html、settings 与 CLAUDE.md 由主 agent 集成，子代理提交所需变更说明。
- 构建与 Electron 场景串行集成。各场景使用独立临时库，不广泛 kill Electron，不与其他 agent 共用测试库。
- 阶段通过后自主提交，并更新 AGENT-STATE.md。应用源码修改需重开复刻品载入，不声称旧实例已热更新。

## 建议推进顺序

以下是后续范围，尚未实施。先完成一个可验收阶段，再进入下一阶段。

### 1. 文件恢复：先补用户可见语义与数据边界

当前 `plugins-core/file-recovery.js` 默认60秒，只采集 Markdown，快照为每日 JSON。
上一轮记录原版使用 IndexedDB、默认5分钟且覆盖 Canvas；实施前重新定位原版片段确认。
先对齐间隔文案、默认值与 Canvas 快照/恢复。旧配置应保留用户设置，旧快照应继续可读。
不要仅为内部实现相同而立即迁移存储；先说明存储差异对行为的影响。
回归覆盖未落盘编辑、删除后恢复、重启、清空与在途采集、禁用再启用。
故障注入和外部修改冲突属于待检查项，不是已经证实的数据丢失问题。

### 2. 画布：补日常编辑闭环

当前文字卡片使用 textarea；完整画布撤销/重做、转换为文件、图片导出尚未覆盖。
优先实现节点/连线/移动/删除的撤销与重做，以及文本卡片转换为文件。
复用既有编辑器能力补齐卡片编辑体验；先明确生命周期与保存接口，再决定 CM6 嵌入方式。
检查连续编辑、切换文件、关页与重启的数据一致性。图片导出作为后续独立阶段。

### 3. 图谱：先建立性能基线

`graph-simulation.js` 的斥力与碰撞有两层节点循环，复杂度为 O(n²)。
用隔离生成库测量约100/1000/5000节点的打开耗时、模拟帧耗时和关闭后资源释放。
这些规模是建议测试输入，不是当前性能承诺。先记录结果，再决定空间索引或其他优化。
保持现有筛选、局部图、拖拽与打开行为。查询语法、悬停预览、颜色组拖拽分阶段补齐。

### 4. 演示与交付收尾

幻灯片仍在 leaf 内展示。后续对齐覆盖全窗口的演示宿主，并保留 Esc 返回模式、滚动和选区。
最后再审计无效依赖（KaTeX 已停用但仍在 package.json），同步锁文件并检查打包资源。
当前只有开发构建/启动脚本；macOS 可分发包是后续交付选项，不代表已经支持。

## 逻辑验收命令

```sh
npm run build
node --experimental-vm-modules src/renderer/core/workspace-regression.js
node scripts/acceptance/run.mjs core-ribbon --no-screenshot
# 从上一条输出复制 vault 路径：
node scripts/acceptance/run.mjs core-ribbon --phase restart --vault <vault路径> --no-screenshot
```

按修改范围追加对应场景，不必每阶段重跑全部：

```sh
node scripts/acceptance/run.mjs recovery --no-screenshot
node scripts/acceptance/run.mjs recovery --phase restart --vault <recovery输出的vault路径> --no-screenshot
node scripts/acceptance/run.mjs canvas --no-screenshot
node scripts/acceptance/run.mjs graph --no-screenshot
```

运行器创建带标记的隔离临时库，并拒绝非临时目录和无标记既有库。
日志要求没有业务错误或未捕获异常；开发版 CSP 警告已知，不能称为“所有日志为空”。

## 接续动作

先用几句话报告当前提交、已完成范围与准备推进的第一阶段。
然后从文件恢复开始，按事实分析 → 实现 → 逻辑回归 → GEB回环 → 提交推进。
不要停在计划，不要重复旧交接中的插件全量验收、graph.js拆分和视觉核对。
