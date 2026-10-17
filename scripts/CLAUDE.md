# scripts/

> L2 | 父级: /CLAUDE.md

构建与开发脚本。esbuild 打包渲染进程两个入口；主进程不经打包直接 require。

成员清单
build.mjs: esbuild build(bundle/iife/chrome120/node builtins external)；入口 src/renderer/main.js→dist/renderer.js、src/renderer/starter.js→dist/starter.js；复制 katex.css 与字体到 dist/。--watch 进入增量模式。
dev.mjs: 开发模式。watch + 启动 electron(热重启)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
