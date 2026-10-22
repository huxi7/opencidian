#!/bin/sh
# [INPUT]: 可选 --skip-build、--only <逗号分隔场景>、--output <目录>。
# [OUTPUT]: 全量场景日志、summary.json、summary.txt 与失败退出码。
# [POS]: 仓库根目录可复现的串行验收入口，自持构建互斥锁。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
cd "$(dirname "$0")/../.."
# 参数经环境传递，避免拼接 shell 命令；full.mjs 读取原始参数数组。
OPENSIDIAN_FULL_ARGS="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@")"
export OPENSIDIAN_FULL_ARGS
exec sh scripts/with-lock.sh 'node scripts/acceptance/full.mjs'
