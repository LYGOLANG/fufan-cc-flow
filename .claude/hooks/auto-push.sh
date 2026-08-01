#!/bin/bash
# Hook: PostToolUse (Bash)
# commit 后自动 push。用户 2026-07-14 明确要求 master 也自动推(单人仓库,原"保护分支跳过"空转)。
# 不再依赖 settings 的 if 前缀过滤——复合命令(cd .. && git commit)不以 git commit 开头会漏触发,
# 改为脚本自读 stdin 判断命令里是否真含 git commit。

INPUT=$(cat 2>/dev/null)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$CMD" in
  *"git commit"*) : ;;
  *) exit 0 ;;
esac

# 没有 upstream 或没有领先提交(commit 失败/已推过)就静默退出
AHEAD=$(git -C "$CLAUDE_PROJECT_DIR" rev-list --count '@{u}..HEAD' 2>/dev/null)
if [ -z "$AHEAD" ] || [ "$AHEAD" = "0" ]; then
  exit 0
fi

PUSH_OUT=$(git -C "$CLAUDE_PROJECT_DIR" push 2>&1)
if [ $? -ne 0 ]; then
  echo "❌ 自动 push 失败，请手动检查：" >&2
  echo "$PUSH_OUT" >&2
else
  echo "{\"systemMessage\": \"⬆️ 已自动推送 $AHEAD 个提交到远程\"}"
fi

exit 0
