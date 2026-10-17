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

先执行 `npm run build`，再运行 `node scripts/acceptance/run.mjs <场景>`。
运行器输出创建的 vault、截图和日志路径。只接受带验收标记的临时库。

重启验证用 `--vault <上次输出的路径>`：

- notes：`--phase reload`。
- recovery：`--phase restart`；截图可选 `history`、`layout`、`slides`。
- settings-write 后使用 settings-restart 场景。
- graph-persist-write 后使用 graph-persist-read 场景。

额外运行 `node --experimental-vm-modules src/renderer/core/workspace-regression.js`，17组内存回归。
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
