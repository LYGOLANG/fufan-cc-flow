import type { Buffer } from "node:buffer";
import { spawnClaude } from "./claudeBin.js";
import { logger } from "./logger.js";

/**
 * 跑一条 `claude ...` 子命令并拿到 stdout。
 *
 * 抽出来是因为 mcpService / pluginService / marketplaceService 各自抄了一份
 * 完全相同的实现，且**三份都漏了超时** —— 而同仓库的 codexService、
 * systemService 里每一个 spawn 都老老实实带了 timer。这是遗漏，不是设计。
 *
 * 漏超时的后果不是「慢」，是**永远不结束**：比如在插件市场里添加一个不可达的
 * 仓库地址，`claude plugin install` 内部会去 git clone，卡住之后这个 Promise
 * 永不 settle → Express 请求永不响应 → 子进程泄漏。用户多点几次就是一堆
 * 僵尸进程，而界面只是一直转圈。
 */

/** 默认 60 秒。这些子命令都涉及网络（拉取市场清单、安装插件），给足余量但必须有上限。 */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunClaudeOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
  /** 出现在超时日志里，便于定位是哪个功能卡住 */
  label?: string;
}

export function runClaudeCommand(
  args: string[],
  opts: RunClaudeOptions = {}
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label ?? args[0] ?? "claude";

  return new Promise((resolve, reject) => {
    // 必须 shell:false + 绝对路径 + 数组 argv：args 由请求体拼装（MCP server 名、
    // url、command、env 值），shell:true 会把 argv 拼成单条 shell 字符串，其中的
    // `;` `&&` 反引号会被执行 → 命令注入。spawnClaude 内部对 .cmd/.bat 用
    // cmd /c + 数组参数包装，同样不经 shell 解析。
    const proc = spawnClaude(args, { env: opts.env || { ...process.env } });
    if (!proc) {
      reject(new Error("未找到 claude 可执行文件"));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      // 必须真的杀掉进程：只 reject 会让子进程在后台继续跑（git clone 之类
      // 可能挂很久），并继续持有文件句柄。
      proc.kill();
      finish(() =>
        reject(new Error(`${label} 超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已中止`))
      );
    }, timeoutMs);

    proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("close", (code: number | null) => {
      finish(() => {
        if (code !== 0) {
          logger.warn(`claude ${label} command failed: ${stderr}`);
          reject(new Error(stderr || `Exit code ${code}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    proc.on("error", (err: Error) => finish(() => reject(err)));
  });
}
