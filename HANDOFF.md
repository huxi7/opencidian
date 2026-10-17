# 交接：Obsidian 桌面版 1:1 复刻（接任主 agent 提示词）

你是本项目接任的主 agent。工作目录：`/Users/link/Desktop/Obsidian copy`（git 仓库，已有首个 commit）。

## 第一步（强制）
开工前按顺序读完：
1. `AGENT-STATE.md` —— 项目记忆与事实库（跨上下文记忆，最新状态全在这里）。
2. `CLAUDE.md` —— GEB L1 项目宪法；每个 `src/renderer/**/CLAUDE.md` 是 L2 模块地图。
3. `_analysis/obsidian-asar/app.js`、`app.css` —— 原版 Obsidian 1.12.4 事实源（**只读**，禁止修改 `_analysis/`）。

## 任务
继续 1:1 复刻 macOS Obsidian 1.12.4 桌面版：核心功能完整、运行流畅、UI 尽量还原。当前处于「核心插件验收 + 保真补漏」阶段。技术栈与架构（Electron 33 + esbuild、CM6、markdown-it、renderer nodeIntegration）已定型，不要重选。

## 铁律（违反即回滚）
1. 不劫持 `obsidian://` 协议；不干扰真实 Obsidian 数据；不搬运专有代码（REA 分析 → 常规重建）。
2. CSS/布局一切以 `_analysis/obsidian-asar/app.css` 与 `app.js` 为事实源，逐字移植。
3. GEB 分形文档：改代码必须回环更新 L1/L2/L3 文档；单文件 ≤800 行，超限即拆分。
4. 第三方/社区插件与市场不做；自带核心插件全部要做；设置功能是重中之重。
5. 提交：按阶段 `git commit`（用户已授权自行决定时机），每完成一个可验收阶段提交一次。
6. 不造假 UI：原版有但未实现的功能宁缺毋滥（跳过清单见 AGENT-STATE.md §3）。

## 当前状态（2026-10-17）
- `npm run build` 通过；启动零报错；设置 7 页签、编辑器、实时预览（含代码块/mermaid widget）、阅读渲染、重命名链接更新（四形态验证通过）、图谱渲染（fresh/restored 布局均验证）均可用。
- 上批 4 个子代理因 rate limit 中断；canvas/bookmarks/graph/daily-notes/templates/note-composer/file-recovery/random-note/zk-prefixer/workspaces/slides 的产物已入库（build 通过、registry 已注册），但**大多未做交互验收**。

## 优先级任务（按序推进）
1. **核心插件逐个验收**：canvas → bookmarks → graph 交互 → daily-notes → templates → note-composer → file-recovery → random-note → zk-prefixer → workspaces → slides。验收标准：build 通过 + 日志零报错 + 截图 + 交互抽查（新建/编辑/持久化）；不合格的修复或重写。
2. **graph.js 拆分**：1119 行超 800 上限。
3. 设置持久化冒烟：改值 → 重启 → app.json / appearance.json / hotkeys.json / core-plugins.json 保留。
4. 保真缺口：右侧栏视觉核对、foldHeading/foldIndent、代码块语法高亮、数学引擎（详见 AGENT-STATE.md §3）。

## 工作方式（重要）
- **敢于用子代理拆任务加速**：难度高、体量大的任务（插件验收修复、graph.js 拆分、保真缺口补全）一律拆成多个子代理并行执行，显著加快构建速度；给每个子代理明确文件边界、接口约定与「禁止改动」清单（registry / index.html / CLAUDE.md / settings 相关文件）。
- 子代理产出必须由主 agent 逐个验收（build + 日志 + 截图 + 交互）后才提交；rate limit 中断时先盘点磁盘产物，再决定补跑或自己收尾。
- 每阶段推进后更新 `AGENT-STATE.md`（对抗上下文压缩的记忆文档）。

## 测试套路（照抄）
```sh
T=/private/var/folders/st/nd9_l9b17zs6x6bg2cmysqph0000gn/T/opencode
npm run build
OBS_ALLOW_MULTI=1 OBS_VAULT_PATH=$T/vault-main OBS_ACT='{"action":"exec","command":"graph:open"}' OBS_SCREENSHOT=$T/x.png OBS_SCREENSHOT_DELAY=8000 OBS_SCREENSHOT_EXIT=1 npx electron . > $T/x.log 2>&1
grep -E "dev\] eval|act failed" $T/x.log
```
- 主 agent 用 `$T/vault-main`；子代理用 `$T/vault-test`；`OBS_ALLOW_MULTI=1` 跳过单实例锁。
- OBS_ACT：`open` / `open-settings` / `exec` / `eval`；一个进程只发一个 act，多步操作在 eval 里先 `app.commands.executeCommandById(...)` 再探测。
- 验收看：截图（布局/控件/文案）+ `grep -icE 'uncaught|typeerror|referenceerror'`。
- 坑：zsh 别用 `${var:+...}` 条件展开；重命名链接必须用重命名前快照（见 AGENT-STATE.md §6）。
