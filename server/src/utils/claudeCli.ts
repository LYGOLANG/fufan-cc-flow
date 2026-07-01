/**
 * 解析要传给 Agent SDK 的 `pathToClaudeCodeExecutable`。
 *
 * 说明:当前 @anthropic-ai/claude-agent-sdk(sdk.mjs)spawn 的是 Claude Code 的**原生二进制**
 * (不再是过去内置的 cli.js —— 这个版本的包里根本没有 cli.js)。若不显式指定,SDK 会尝试自己
 * 解析平台原生二进制,在 tsx / pnpm / Windows 下常失败并抛
 *   "Claude Code native binary not found ... specify a valid path with options.pathToClaudeCodeExecutable"。
 *
 * 因此这里直接复用健壮解析器(env → PATH → 已知安装位置)指向已安装的 claude(.exe),
 * 既消除旧的 "failed to resolve cli.js" 警告,又让 SDK 稳定使用正确的二进制、且不依赖进程 PATH。
 *
 * 重要:必须每次调用时现查(而不是模块加载时求值一次并缓存),否则若后端进程在
 * claude 安装/PATH 更新**之前**启动,解析结果会永久固化为 undefined —— 此后无论
 * 怎么重装/重新检测都无法恢复,只能重启后端进程。
 */
import { resolveClaudeBin } from "./claudeBin.js";
import { logger } from "./logger.js";

/** Absolute path to the Claude Code CLI executable (or undefined if not found). 每次现查。 */
export function resolveCliPath(): string | undefined {
  const bin = resolveClaudeBin();
  if (bin) {
    logger.info(`[claudeCli] using Claude Code executable: ${bin}`);
    return bin;
  }
  logger.warn(
    "[claudeCli] 未找到 claude 可执行文件;将回退到 SDK 自身解析(在 Windows/pnpm 下可能失败)。" +
      "可设置环境变量 CLAUDE_BIN 指向 claude 可执行文件。"
  );
  return undefined;
}
