/**
 * OpenCode Agent Service —— 基于 `opencode run --format json` 子进程的通信层
 *
 * opencode 接管所有第三方供应商(Google/MiniMax/DeepSeek/Kimi/GLM/…):
 * 凭证由 `opencode auth login` 管理,模型以 provider/model 形式传入。
 * 事件接口与 CodexAgentService 对称:
 *   session_init, assistant_text, tool_use_start, tool_use_result,
 *   context_usage, task_complete, close, error, process_stderr
 *
 * `--format json` 每行一个事件(v1.2.25 实测):
 *   {"type":"step_start","timestamp":…,"sessionID":"ses_…","part":{type:"step-start",…}}
 *   {"type":"text",      …,"part":{type:"text",text:"…",time:{start,end},…}}
 *   {"type":"step_finish",…,"part":{type:"step-finish",reason:"stop",cost:0.0065,
 *        tokens:{total,input,output,reasoning,cache:{read,write}}}}
 *   工具调用为 part.type==="tool"(state.status: pending→running→completed|error)。
 * 一轮结束没有显式事件,以进程退出(code 0)为准。
 * 解析采取防御式写法:按 part.type 分发,未知事件一律忽略,字段缺失按空值处理。
 */
import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import { spawnOpencode } from "../utils/opencodeBin.js";
import { logger } from "../utils/logger.js";

export interface OpencodeAgentOptions {
  prompt: string;
  projectPath: string;
  /** 续聊时传入上一轮的 opencode session id */
  sessionId?: string;
  /** provider/model,如 "google/gemini-2.5-flash" */
  model: string;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  /** 附加环境变量(代理等) */
  env?: Record<string, string | undefined>;
}

/** opencode 工具名 → UI 认识的 Claude 风格工具名 */
const TOOL_NAME_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
  list: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  task: "Task",
  patch: "Edit",
};

function mapToolName(name: string): string {
  return TOOL_NAME_MAP[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

export class OpencodeAgentService extends EventEmitter {
  private activeProcs = new Map<string, ChildProcess>();
  private idCounter = 0;

  // 同 CodexAgentService:WS 断开后迟到的 error 事件没有监听器会抛
  // ERR_UNHANDLED_ERROR 炸掉 server,兜底降级为日志。
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "error" && this.listenerCount("error") === 0) {
      logger.warn(`[opencode] dropped error event (no listeners): ${JSON.stringify(args[0]).slice(0, 300)}`);
      return false;
    }
    return super.emit(event, ...args);
  }

  async start(options: OpencodeAgentOptions): Promise<string> {
    if (!options.projectPath?.trim()) {
      throw new Error("projectPath 不能为空,请先选择项目文件夹");
    }
    if (!options.model?.includes("/")) {
      throw new Error(`opencode 模型需为 provider/model 格式,收到: ${options.model}`);
    }

    const tempId =
      options.sessionId || `opencode_pending_${Date.now()}_${++this.idCounter}`;

    const args: string[] = ["run", "--format", "json", "-m", options.model];
    if (options.sessionId) args.push("--session", options.sessionId);
    // plan 模式映射到 opencode 内置的只读 plan agent;其余模式 opencode run
    // 非交互执行(无逐工具 HIL,与 codex exec 同一安全模型)。
    if (options.permissionMode === "plan") args.push("--agent", "plan");
    args.push(options.prompt);

    logger.info(`Starting opencode run [${tempId}]`, {
      model: options.model,
      cwd: options.projectPath,
      resume: !!options.sessionId,
      promptLength: options.prompt.length,
    });

    const proc = spawnOpencode(args, {
      cwd: options.projectPath,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    });
    if (!proc) {
      throw new Error("未找到 opencode 可执行文件(npm i -g opencode-ai 安装)");
    }

    this.activeProcs.set(tempId, proc);
    this.consumeProcess(tempId, proc);
    return tempId;
  }

  abort(sessionId: string): boolean {
    const proc = this.activeProcs.get(sessionId);
    if (proc) {
      if (process.platform === "win32" && proc.pid) {
        // 与 codex 相同:杀整棵进程树,避免孤儿进程
        spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
          shell: false,
        });
      } else {
        proc.kill();
      }
      this.activeProcs.delete(sessionId);
      logger.info(`Aborted opencode [${sessionId}]`);
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

  // ── JSON 行事件消费 ──

  private consumeProcess(tempId: string, proc: ChildProcess) {
    let currentId = tempId;
    let announcedSession = false;
    let buf = "";
    let sawComplete = false;
    let sawAnyEvent = false;

    /** text part id → 最新快照文本(part.updated 是全量快照,不是增量) */
    const textParts = new Map<string, string>();
    /** 已发出 tool_use_start / result 的 part id */
    const toolStarted = new Set<string>();
    const toolDone = new Set<string>();

    let usage: Record<string, unknown> | undefined;
    let costUsd = 0;

    const announceSession = (id?: string) => {
      if (id && id !== currentId) {
        this.remapId(currentId, id);
        currentId = id;
      }
      if (!announcedSession && (id || currentId)) {
        announcedSession = true;
        this.emit("session_init", { sessionId: currentId });
      }
    };

    const finishTurn = (isError: boolean, errMsg?: string) => {
      if (sawComplete) return;
      sawComplete = true;
      const finalText = [...textParts.values()].join("\n").trim();
      if (finalText) {
        this.emit("assistant_text", { sessionId: currentId, text: finalText, isPartial: false });
      }
      if (usage) {
        this.emit("context_usage", { sessionId: currentId, usage });
      }
      logger.info(`[${currentId}] task_complete (opencode)`);
      this.emit("task_complete", {
        sessionId: currentId,
        result: isError ? errMsg || "opencode 执行失败" : finalText,
        usage,
        costUsd,
        numTurns: 1,
        isError,
      });
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      sawAnyEvent = true;
      const type = (ev.type as string) || "";
      const part = ev.part as Record<string, unknown> | undefined;

      // 会话 id 在每行的顶层 sessionID(实测 ses_xxx)
      const sid = (ev.sessionID as string) ?? (part?.sessionID as string) ?? undefined;
      if (sid || !announcedSession) announceSession(sid);

      // 错误事件(无 part)
      if (!part) {
        if (type === "error" || type === "session_error") {
          const errObj = (ev.error as Record<string, unknown>) ?? {};
          const data = errObj.data as Record<string, unknown> | undefined;
          const message =
            (data?.message as string) ||
            (errObj.message as string) ||
            (ev.message as string) ||
            "opencode 执行失败";
          logger.error(`[${currentId}] opencode error: ${message}`);
          this.emit("error", { sessionId: currentId, code: "EXECUTION_ERROR", message });
        }
        return;
      }

      const partType = (part.type as string) || type;
      const partId = (part.id as string) || "part";

      if (partType === "text") {
        // part 事件是全量快照,同一 part 多次出现时以最新为准
        textParts.set(partId, (part.text as string) || "");
        return;
      }

      if (partType === "tool") {
        const state = (part.state as Record<string, unknown>) ?? {};
        const status = (state.status as string) || (ev.type === "tool" ? "completed" : "");
        const toolName = mapToolName((part.tool as string) || "tool");

        if ((status === "running" || status === "pending") && !toolStarted.has(partId)) {
          toolStarted.add(partId);
          this.emit("tool_use_start", {
            sessionId: currentId,
            toolCallId: partId,
            toolName,
            toolInput: (state.input as Record<string, unknown>) ?? {},
          });
          return;
        }
        if ((status === "completed" || status === "error") && !toolDone.has(partId)) {
          toolDone.add(partId);
          if (!toolStarted.has(partId)) {
            // 事件流里可能只出现一次已完成快照:补发 start
            toolStarted.add(partId);
            this.emit("tool_use_start", {
              sessionId: currentId,
              toolCallId: partId,
              toolName,
              toolInput: (state.input as Record<string, unknown>) ?? {},
            });
          }
          this.emit("tool_use_result", {
            sessionId: currentId,
            toolCallId: partId,
            result:
              (state.output as string) ||
              (state.error as string) ||
              (typeof state.metadata === "object" ? JSON.stringify(state.metadata) : ""),
            isError: status === "error",
          });
        }
        return;
      }

      if (partType === "step-finish") {
        // 每个 step 结束时带这一步的费用与 token 统计,跨 step 累加
        if (typeof part.cost === "number") costUsd += part.cost;
        const tokens = part.tokens as Record<string, unknown> | undefined;
        if (tokens) {
          const cache = tokens.cache as Record<string, unknown> | undefined;
          const prev = usage as { input_tokens?: number; output_tokens?: number } | undefined;
          usage = {
            input_tokens: ((prev?.input_tokens as number) ?? 0) + ((tokens.input as number) ?? 0),
            output_tokens: ((prev?.output_tokens as number) ?? 0) + ((tokens.output as number) ?? 0),
            cache_read_input_tokens: (cache?.read as number) ?? 0,
            cache_creation_input_tokens: (cache?.write as number) ?? 0,
          };
        }
        return;
      }
      // step-start / reasoning / file 等其余 part 类型暂不处理
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
        logger.warn(`opencode stderr [${currentId}]: ${text.slice(0, 500)}`);
        this.emit("process_stderr", { sessionId: currentId, text });
      }
    });

    proc.on("close", (code) => {
      if (buf.trim()) handleLine(buf);
      this.activeProcs.delete(currentId);
      // run 进程正常退出即一轮结束(可能没有显式 session.idle 事件)
      if (!sawComplete && code === 0 && !sawAnyEvent) {
        // 一行事件都没有:多半是无效的 --session id 或凭证/网络问题,不要静默吞掉
        this.emit("error", {
          sessionId: currentId,
          code: "EMPTY_RUN",
          message: "opencode 没有产生任何输出(会话 id 无效或供应商暂不可用),请重试或新开会话",
        });
      } else if (!sawComplete && code === 0) {
        finishTurn(false);
      } else if (!sawComplete && code !== 0 && code !== null) {
        this.emit("error", {
          sessionId: currentId,
          code: "PROCESS_ERROR",
          message: `opencode run 退出码 ${code}`,
        });
      }
      logger.info(`opencode run closed [${currentId}] code=${code}`);
      this.emit("close", { sessionId: currentId, code });
    });

    proc.on("error", (err) => {
      logger.error(`opencode spawn error [${currentId}]: ${err.message}`);
      this.emit("error", { sessionId: currentId, code: "SPAWN_ERROR", message: err.message });
    });
  }
}
