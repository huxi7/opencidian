# [INPUT]: 一个 shell 命令字符串（$1）
# [OUTPUT]: 串行化执行结果；退出码透传
# [POS]: scripts/ 的构建/验收互斥锁。多个并行子代理共享同一锁目录，先到先得；超时 30 分钟退出码 75。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# 防呆：参数若只是孤立的 "VAR=value"（无空格），几乎一定是把环境变量写在了引号外，
# 例如 with-lock.sh T=...; npx electron . —— 这会让真正的命令脱离锁、裸跑并卡死。
case "$1" in
  *=*)
    case "$1" in
      *" "*) : ;;
      *) echo "with-lock: 参数看起来是孤立的环境变量赋值（$1）。" >&2
         echo "用法：sh scripts/with-lock.sh 'VAR=value <命令>'" >&2
         exit 2 ;;
    esac ;;
esac
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
