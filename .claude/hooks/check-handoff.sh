#!/bin/bash
# Hook: SessionStart
# HANDOFF.md 存在且未完结 → 提示主 Agent 先读交接文件再接任务。
F="$CLAUDE_PROJECT_DIR/HANDOFF.md"

if [ -f "$F" ] && ! head -5 "$F" | grep -q "已完结"; then
  echo "📄 检测到未完结的上下文交接文件 HANDOFF.md——上个会话留下的任务状态。接手任何工作前先把它完整读一遍，按其中的「下一步」继续。"
fi
exit 0
