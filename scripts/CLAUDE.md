# scripts/

> L2 | 父级: /CLAUDE.md

构建与开发脚本。esbuild 打包渲染进程两个入口；主进程不经打包直接 require。

成员清单
build.mjs: esbuild build(bundle/iife/chrome120/node builtins external)；入口 src/renderer/main.js→dist/renderer.js、src/renderer/starter.js→dist/starter.js。--watch 进入增量模式。
dev.mjs: 开发模式。watch + 启动 electron(热重启)。
with-lock.sh: 构建/验收互斥锁。并行子代理共享 $TMPDIR/opensidian-build.lock，先到先得，超时 30 分钟退出码 75；用法 `sh scripts/with-lock.sh "<命令>"`。

acceptance/: 真实 Electron 场景，隔离库与日志判定见 acceptance/CLAUDE.md。
make-app-icon.py: 生成应用图标（原创设计：地平线与曜日）→ build/icon.png 与 icon.icns（iconutil）。
smoke-packaged.mjs: 打包版冒烟。用 OBS_ACT 通道启动 release/ 下的 .app，断言库启动/建文件/开文件后退出；用法 `node scripts/smoke-packaged.mjs [binary]`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
