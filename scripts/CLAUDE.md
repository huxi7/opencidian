# scripts/

> L2 | 父级: /CLAUDE.md

构建与开发脚本。esbuild 打包渲染进程两个入口；主进程不经打包直接 require。

成员清单
build.mjs: esbuild build(bundle/iife/chrome120/node builtins external)；入口 src/renderer/main.js→dist/renderer.js、src/renderer/starter.js→dist/starter.js。--watch 进入增量模式。
dev.mjs: 开发模式。watch + 启动 electron(热重启)。
with-lock.sh: 构建/验收互斥锁。并行子代理共享 $TMPDIR/opensidian-build.lock，先到先得，超时 30 分钟退出码 75；用法 `sh scripts/with-lock.sh "<命令>"`。

acceptance/: 真实 Electron 场景，隔离库与日志判定见 acceptance/CLAUDE.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
