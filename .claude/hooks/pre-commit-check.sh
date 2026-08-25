#!/bin/bash
# Hook: PreToolUse (Bash) if git commit*
# commit 前自动编译检查，不通过则阻止 commit。
#
# 注意：settings.json 的 if 字段在当前 harness 不生效，会导致本 hook 对所有 Bash
# 无条件执行 tsc，typecheck 一红就拦住全部 Bash（含子 Agent 自检）。故在脚本内自行
# 判定命令，只对 git commit 执行编译门禁，恢复脚本注释与 settings 声明的本意。

INPUT=$(cat 2>/dev/null)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# dev 启动前：清占用端口，避免端口被占导致启动失败。
case "$CMD" in
  *"pnpm dev"*|*"npm run dev"*|*"yarn dev"*)
    for port in 3000 3001 4173 5173 8080; do kill -9 "$(lsof -ti:$port)" 2>/dev/null; done
    ;;
esac

case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# ── 工具链定位 ────────────────────────────────────────────────────────────────
# hook 的环境不继承用户 shell 的 PATH：macOS 上 Homebrew 的 node/pnpm 装在
# /opt/homebrew/bin，nvm 的在 ~/.nvm/versions/node/*/bin，两者都不在默认 PATH 里。
# 不补的话 `npx` 直接 command not found → 退出码非 0 → 被当成「编译失败」拦住提交，
# 而实际上检查**根本没跑**。
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
for d in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done

# ── 选择检查命令：优先项目自己的规范入口 ──────────────────────────────────────
# 直接在某个 tsconfig 目录跑裸 `tsc --noEmit` 与项目的真实检查并不等价
# （本仓 client 用的是 `tsc -b`，且 server/client 要分别检查）。
# 根 package.json 有 typecheck 脚本时一律走它，那才是单一真相源。
RUNNER=""
if [ -f "$CLAUDE_PROJECT_DIR/package.json" ] \
   && command -v jq >/dev/null 2>&1 \
   && jq -e '.scripts.typecheck' "$CLAUDE_PROJECT_DIR/package.json" >/dev/null 2>&1; then
  if command -v pnpm >/dev/null 2>&1; then RUNNER="pnpm typecheck"
  elif command -v npm >/dev/null 2>&1; then RUNNER="npm run typecheck"
  fi
  WORKDIR="$CLAUDE_PROJECT_DIR"
fi

if [ -z "$RUNNER" ]; then
  TSCONFIG=$(find "$CLAUDE_PROJECT_DIR" -maxdepth 3 -name "tsconfig.json" \
    -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | head -1)
  [ -z "$TSCONFIG" ] && exit 0   # 不是 TS 项目，没什么可查的
  WORKDIR=$(dirname "$TSCONFIG")
  if command -v npx >/dev/null 2>&1; then RUNNER="npx tsc --noEmit"; fi
fi

# ── 「查不了」必须与「查出问题」严格区分 ──────────────────────────────────────
# 把环境缺失说成「编译检查未通过」，就是把「不知道」当成「否定」——
# 本仓反复栽过的反模式。查不了就明说查不了，并且不拦提交：
# 一个坏掉的 hook 环境不该让整个仓库无法提交，但也绝不能假装检查通过。
if [ -z "$RUNNER" ]; then
  echo "⚠️  pre-commit-check: 找不到 pnpm/npm/npx，**编译检查没有执行**（不是检查失败）。" >&2
  echo "   PATH=$PATH" >&2
  echo "   本次 commit 放行，但请自行确认 \`pnpm typecheck\` 通过。" >&2
  exit 0
fi

cd "$WORKDIR" || exit 0
TSC_OUTPUT=$($RUNNER 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "编译检查未通过（$RUNNER），commit 被阻止。请修复以下错误：" >&2
  echo "$TSC_OUTPUT" >&2
  exit 2
fi

exit 0
