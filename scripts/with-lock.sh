/**
 * [INPUT]: 一个 shell 命令字符串（$1）
 * [OUTPUT]: 串行化执行结果；退出码透传
 * [POS]: scripts/ 的构建/验收互斥锁。多个并行子代理共享同一锁目录，先到先得；超时 30 分钟退出码 75。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
LOCK="${TMPDIR:-/tmp}/opensidian-build.lock"
i=0
while ! mkdir "$LOCK" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 900 ]; then
    echo "with-lock: timeout waiting for $LOCK" >&2
    exit 75
  fi
  sleep 2
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
sh -c "$1"
