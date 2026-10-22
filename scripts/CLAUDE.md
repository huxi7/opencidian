# scripts/

> L2 | 父级: /CLAUDE.md

构建与开发脚本。esbuild 打包渲染进程两个入口；主进程不经打包直接 require。

成员清单
build.mjs: esbuild build(bundle/iife/chrome120/node builtins external)；入口 src/renderer/main.js→dist/renderer.js、src/renderer/starter.js→dist/starter.js、src/renderer/plugins-core/graph-sim-worker.js→dist/graph-sim-worker.js（图谱力学 Worker）。--watch 进入增量模式。
dev.mjs: 开发模式。watch + 启动 electron(热重启)。
with-lock.sh: 构建/验收互斥锁。并行子代理共享 $TMPDIR/opensidian-build.lock，先到先得，超时 30 分钟退出码 75；用法 `sh scripts/with-lock.sh "<命令>"`。

acceptance/: full.sh 是全量入口。真实 Electron 场景，隔离库与日志判定见 acceptance/CLAUDE.md。 子进程带 `E2E=1`：窗口不激活应用（accessory + showInactive + focusable:false）且整窗透明（opacity:0 + 忽略鼠标）——测试完全不可见、不抢焦点；带 `OBS_ACT` 的直连探针也自动进入 E2E（main.js 兜底）。
make-app-icon.py: 生成应用图标（原创设计：地平线与曜日）→ build/icon.png 与 icon.icns（iconutil）。
smoke-packaged.mjs: 打包产物冒烟。先核对 ASAR 身份、版本、许可证及当前代码哈希，再跑 20 条真实启动/编辑器/Bases/公式/CSV/SVG 断言。输出 {pass,count,checks}；--no-screenshot 不截图，超时只清理自身进程组。

bases-formulas.test.mjs: Node 公式单测。固定 UTC、时钟与随机源，对照原始 78 个函数说明。
bases-csv.test.mjs: Node CSV 单测。检查转义、富值、取消与写盘失败边界，不启动 Electron。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
