/**
 * Codex Agent Service —— 基于 `codex exec` 子进程的 Codex CLI 通信层
 *
 * Codex CLI 没有类似 @anthropic-ai/claude-agent-sdk 的 SDK，这里直接 spawn
 * `codex exec --json`（首轮）/ `codex exec resume <threadId> --json`（续聊），
 * 逐行解析 JSONL 事件，映射到与 ClaudeAgentService 对称的 EventEmitter 接口：
 *   session_init, assistant_text, tool_use_start, tool_use_result,
 *   context_usage, task_complete, close, error, process_stderr
 *
 * 已验证的关键差异（相对 Claude）：
 *   - `codex exec` 是非交互模式，没有逐工具 HIL 审批（-a/--ask-for-approval
 *     在 exec 子命令下不存在），安全边界只能靠 -s 沙箱粒度控制。
 *   - `codex exec resume` 不接受 -C/-s/--color（cwd 和沙箱策略沿用首轮记录），
 *     只有首轮 `codex exec` 才需要这些参数。
 *   - Windows 上 read-only/workspace-write 沙箱会因 Windows Store 版 pwsh
 *     存根无法从非交互上下文启动而报 `CreateProcessAsUserW failed: 1312`
 *     （上游已知 bug），用 `-c windows.sandbox="unelevated"` 覆盖后规避。
 *   - Windows 上如果解析到的是 `codex.cmd`（npm 全局 shim），spawnCodex()
 *     会用 `cmd /c codex.cmd ...` 包一层 —— proc.kill() 只会杀掉外层 cmd.exe，
 *     真正的 codex 进程会成为孤儿继续跑。abort() 必须用 `taskkill /T /F`
 *     杀掉整棵进程树。官网安装器的 codex.exe 则会被优先直跑。
 */
import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import { spawnCodex } from "../utils/codexBin.js";
import { logger } from "../utils/logger.js";

export interface CodexAgentOptions {
  prompt: string;
  projectPath: string;
  /** 续聊时传入上一轮返回的 thread_id */
  sessionId?: string;
  model?: string;
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  /** 图片附件路径(相对 projectPath),经 `--image` 原生传入做多模态视觉 */
  images?: string[];
}

function sandboxForMode(
  mode: CodexAgentOptions["permissionMode"]
): "read-only" | "workspace-write" | "danger-full-access" {
  if (mode === "plan") return "read-only";
  if (mode === "bypassPermissions") return "danger-full-access";
  return "workspace-write"; // default / acceptEdits — Codex 没有逐工具 HIL，二者表现相同
}

function isMissingResumeThread(stderr: string): boolean {
  return (
    /thread\/resume failed/i.test(stderr) &&
    /no rollout found for thread id/i.test(stderr)
  );
}

export class CodexAgentService extends EventEmitter {
  /** 活跃子进程（真实 thread_id，首轮结果出来前用临时 id → ChildProcess） */
  private activeProcs = new Map<string, ChildProcess>();
  private idCounter = 0;

  // EventEmitter 的 "error" 事件在无监听器时会抛异常。WS 断开时 chatHandler 会
  // removeAllListeners,而子进程可能之后才退出并发射 error —— 曾因此炸掉整个
  // server 进程(ERR_UNHANDLED_ERROR)。这里兜底:无监听器时降级为日志。
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "error" && this.listenerCount("error") === 0) {
      logger.warn(`[codex] dropped error event (no listeners): ${JSON.stringify(args[0]).slice(0, 300)}`);
      return false;
    }
    return super.emit(event, ...args);
  }

  async start(options: CodexAgentOptions): Promise<string> {
    if (!options.projectPath?.trim()) {
      throw new Error("projectPath 不能为空，请先选择项目文件夹");
    }

    const isResume = !!options.sessionId;
    const tempId =
      options.sessionId || `codex_pending_${Date.now()}_${++this.idCounter}`;

    const args: string[] = ["exec", "--ignore-user-config"];
    if (isResume) {
      args.push("resume", options.sessionId!);
      args.push("--json", "--skip-git-repo-check");
    } else {
      args.push("--json", "--skip-git-repo-check", "--color", "never");
      args.push("-C", options.projectPath);
      args.push("-s", sandboxForMode(options.permissionMode));
    }
    if (options.permissionMode === "bypassPermissions") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    if (options.model) args.push("-m", options.model);
    if (options.effort) {
      args.push("-c", `model_reasoning_effort="${options.effort}"`);
    }
    // 图片附件:`-i` 可重复,首轮与 resume 均支持(路径相对 spawn cwd = projectPath)
    for (const img of options.images ?? []) {
      args.push("-i", img);
    }
    if (process.platform === "win32") {
      // 规避 Windows Store 版 pwsh 存根在非交互上下文下的 CreateProcessAsUserW 1312 bug
      args.push("-c", 'windows.sandbox="unelevated"');
    }
    args.push(options.prompt);

    logger.info(`Starting codex exec [${tempId}]`, {
      model: options.model,
      effort: options.effort,
      cwd: options.projectPath,
      resume: isResume,
      promptLength: options.prompt.length,
    });

    const proc = spawnCodex(args, {
      cwd: options.projectPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!proc) {
      throw new Error("未找到 codex 可执行文件（请先在 Settings 安装/登录 Codex CLI）");
    }

    this.activeProcs.set(tempId, proc);
    this.consumeProcess(tempId, proc, options);

    return tempId;
  }

  abort(sessionId: string): boolean {
    const proc = this.activeProcs.get(sessionId);
    if (proc) {
      if (process.platform === "win32" && proc.pid) {
        // proc 是 cmd.exe（codex.cmd 的包装层），plain kill() 杀不到真正的
        // codex 子进程；用 taskkill /T 连同整棵进程树一起杀掉。
        spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
          shell: false,
        });
      } else {
        proc.kill();
      }
      this.activeProcs.delete(sessionId);
      logger.info(`Aborted codex [${sessionId}]`);
      return true;
    }
    return false;
  }

  isRunning(sessionId: string): boolean {
    return this.activeProcs.has(sessionId);
  }

  private remapId(oldId: string, newId: string) {
    if (oldId === newId) return;
    const proc = this.activeProcs.get(oldId);
    if (proc) {
      this.activeProcs.delete(oldId);
      this.activeProcs.set(newId, proc);
    }
  }

  // ── 子进程输出消费（JSONL 逐行解析） ──

  private consumeProcess(
    tempId: string,
    proc: ChildProcess,
    options: CodexAgentOptions
  ) {
    let currentId = tempId;
    let buf = "";
    let lastAgentText = "";
    let sawTaskComplete = false;
    let stderrTail = "";
    let missingResumeThread = false;
    const resumeRequested = !!options.sessionId;

    const rememberStderr = (text: string) => {
      stderrTail = `${stderrTail}\n${text}`.trim().slice(-2000);
      if (isMissingResumeThread(stderrTail)) {
        missingResumeThread = true;
      }
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      // 跳过非 JSON 诊断行（如 rmcp::transport 的 MCP 鉴权报错）
      if (!trimmed.startsWith("{")) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      const type = ev.type as string;

      if (type !== "item.started") {
        logger.debug(`[${currentId}] codex event type=${type}`);
      }

      if (type === "thread.started") {
        const realId = ev.thread_id as string;
        if (realId && realId !== currentId) {
          this.remapId(currentId, realId);
          currentId = realId;
        }
        this.emit("session_init", { sessionId: currentId });
        return;
      }

      if (type === "item.started" || type === "item.completed") {
        const item = ev.item as Record<string, unknown> | undefined;
        if (!item) return;
        const itemType = item.type as string;
        const itemId = item.id as string;

        if (itemType === "command_execution") {
          if (type === "item.started") {
            this.emit("tool_use_start", {
              sessionId: currentId,
              toolCallId: itemId,
              toolName: "Bash",
              toolInput: { command: item.command },
            });
          } else {
            this.emit("tool_use_result", {
              sessionId: currentId,
              toolCallId: itemId,
              result: (item.aggregated_output as string) || "",
              isError: item.status === "failed",
            });
          }
          return;
        }

        if (itemType === "mcp_tool_call") {
          const toolName = `mcp__${item.server}__${item.tool}`;
          if (type === "item.started") {
            this.emit("tool_use_start", {
              sessionId: currentId,
              toolCallId: itemId,
              toolName,
              toolInput: (item.arguments as Record<string, unknown>) || {},
            });
          } else {
            const result = item.result as { content?: unknown[] } | null;
            const resultText = result?.content
              ? JSON.stringify(result.content)
              : (item.error as string) || "";
            this.emit("tool_use_result", {
              sessionId: currentId,
              toolCallId: itemId,
              result: resultText,
              isError: !!item.error,
            });
          }
          return;
        }

        if (itemType === "agent_message" && type === "item.completed") {
          const text = (item.text as string) || "";
          lastAgentText = text;
          this.emit("assistant_text", {
            sessionId: currentId,
            text,
            isPartial: false,
          });
          return;
        }
        // 其余 item 类型（reasoning / file_change 等）暂不处理
        return;
      }

      if (type === "turn.completed") {
        sawTaskComplete = true;
        const usage = ev.usage as Record<string, unknown> | undefined;
        if (usage) {
          this.emit("context_usage", { sessionId: currentId, usage });
        }
        logger.info(`[${currentId}] task_complete (codex): turns=1`);
        this.emit("task_complete", {
          sessionId: currentId,
          result: lastAgentText,
          usage,
          costUsd: 0, // OpenAI 计价方式与 Anthropic 不同，暂不计算美元成本
          numTurns: 1,
          isError: false,
        });
        return;
      }

      if (type === "turn.failed" || type === "error") {
        const message =
          (ev.message as string) || (ev.error as string) || "Codex 执行失败";
        logger.error(`[${currentId}] codex error: ${message}`);
        this.emit("error", {
          sessionId: currentId,
          code: "EXECUTION_ERROR",
          message,
        });
      }
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) {
        rememberStderr(text);
        logger.warn(`codex stderr [${currentId}]: ${text}`);
        if (!missingResumeThread) {
          this.emit("process_stderr", { sessionId: currentId, text });
        }
      }
    });

    proc.on("close", (code) => {
      if (buf.trim()) handleLine(buf); // flush 最后一行(可能没有结尾换行符)
      this.activeProcs.delete(currentId);
      if (!sawTaskComplete && code !== 0 && code !== null) {
        if (resumeRequested && missingResumeThread) {
          logger.warn(
            `[${currentId}] codex resume thread missing; restarting without resume`
          );
          this.emit("process_stderr", {
            sessionId: currentId,
            text: "历史 Codex 会话已失效，已自动新建会话继续执行。",
          });
          const { sessionId: _staleSessionId, ...freshOptions } = options;
          this.start(freshOptions).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.emit("error", {
              sessionId: currentId,
              code: "RETRY_FAILED",
              message,
            });
            this.emit("close", { sessionId: currentId, code: 1 });
          });
          logger.info(`codex exec closed [${currentId}] code=${code}`);
          return;
        }
        this.emit("error", {
          sessionId: currentId,
          code: "PROCESS_ERROR",
          message: stderrTail
            ? `codex exec 退出码 ${code}: ${stderrTail}`
            : `codex exec 退出码 ${code}`,
        });
      }
      logger.info(`codex exec closed [${currentId}] code=${code}`);
      this.emit("close", { sessionId: currentId, code });
    });

    proc.on("error", (err) => {
      logger.error(`codex exec spawn error [${currentId}]: ${err.message}`);
      this.emit("error", {
        sessionId: currentId,
        code: "SPAWN_ERROR",
        message: err.message,
      });
    });
  }
}
