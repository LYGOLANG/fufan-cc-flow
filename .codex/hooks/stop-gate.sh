#!/bin/bash
# Stop hook: 代码文件被修改但未 review 时阻止停止
# fail-closed：状态文件存在且内容不是 clean，一律拦截
# 不存在 = 无待审 = 放行；clean 或空 = 放行并删除；其余 = 拦截

STATE_FILE="$(git rev-parse --show-toplevel)/.codex/.needs-review"

if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

STATE=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]')

case "$STATE" in
  "clean"|"")
    rm -f "$STATE_FILE"
    exit 0
    ;;
  *)
    echo '{"decision": "block", "reason": "代码已修改但还没复核。请用复核技能（review）派审查员（reviewer）审一遍，通过后写入 clean。用自驱目标时，把复核通过写进完成条件。"}'
    exit 0
    ;;
esac
