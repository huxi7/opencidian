# AGENT-STATE — 当前项目交接

更新时间：2026-10-24。项目：OpenSidian，Obsidian桌面1.14.4复刻。
历史§0–§32完整保留在 [AGENT-STATE-20261023.md](AGENT-STATE-20261023.md)。

## 约束

- 仓库 `/Users/link/Desktop/opencidian`，只用OpenSidian品牌，不改LICENSE。
- 原版事实只读 `_analysis/obsidian-114/renderer/{app.js,app.css,i18n.js}`。
- 禁止启动原版应用。所有E2E --no-screenshot，隔离库、不可见、不抢焦点。
- 不打开浏览器、Finder或外部弹窗。不关闭用户现有应用。
- L3、L2、RESULTS同步；单文件≤800行。按任务中文提交，不push。
- 第三方插件、Sync、Publish等排除范围见README。未实现功能隐藏或明确降级。

## 当前审查

用户要求全项目并行调查，确认缺陷直接修复，并评估功能真实可用程度。
基线a39bf9a，工作区干净；build+canvas-dummy75条通过。
三线：storage独占main/core；features独占plugins-core及bookmarks-view；interface独占其它views/editor/markdown/styles。
主线维护忽略规则共享API、功能降级、验收质量、文档、全量回归与打包。
本轮报告：[_analysis/project-audit-20261024/REPORT.md](_analysis/project-audit-20261024/REPORT.md)。
本轮验收：[scripts/acceptance/RESULTS.md](scripts/acceptance/RESULTS.md)。

## 已确认问题与修复进展

- 数据安全：回收站被永久删除、移动父子索引不更新、未入索引同名文件被覆盖。（已提交 8c5ad9c）
- 文档加载：读取失败或坏CanvasJSON被接管为空内容，后续保存覆盖原文。（已提交 8b07df4）
- 编辑命令：交换行只移动光标；折叠增减命令语义偏差。（已提交 8b07df4）
- 核心插件：无views的合法Base无默认表格，Bases未排除忽略文件，graph书签无动作。（已修复，audit-features 66 项全绿）
- 书签交互与标签路由：Mod/中键事件被丢失；后台标签路由查重先于创建、不误发 file-open 事件。（已修复，audit-background-tabs 30 项全绿）
- 假能力：Vim开关显示开启，编辑器没有Vim实现。改为明确标明降级状态。（已修复，settings-ui 220 项全绿）
- 目录包冒烟：最新构建已打包至 release/mac-arm64/OpenSidian.app，冒烟 71 条全绿通过。

最终结果以本轮RESULTS与完整逐条回执为准，不沿用历史测试数字。
