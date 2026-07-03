/**
 * Claude Agent Service — 基于 Agent SDK 的 Claude 通信层
 *
 * 使用 @anthropic-ai/claude-agent-sdk 的 V1 query() API。
 *
 * EventEmitter 事件接口:
 *   session_init, assistant_text, assistant_thinking,
 *   tool_use_start, tool_input_complete, tool_use_result, new_turn,
 *   context_compact, context_usage, task_complete,
 *   permission_request, close, error, process_stderr
 *
 * 核心能力:
 *   - HIL 权限确认 (canUseTool → permission_request → resolvePermission)
 *   - Checkpoint/Rewind (rewindFiles → SDK Query.rewindFiles)
 *   - Session Fork (forkSession: true)
 *   - 优雅中断 (AbortController)
 */

import { EventEmitter } from "events";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Query, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../utils/logger.js";
import { resolveCliPath } from "../utils/claudeCli.js";
import type { AgentServiceOptions, ContentBlock } from "../types/claude.js";
import type { PermissionRequest } from "../types/api.js";

// 关键：清除嵌套会话检测环境变量
// Claude Code CLI 检测到 CLAUDECODE 环境变量会拒绝启动（防止嵌套）
// 当 Fufan-CC Flow 的 server 由 Claude Code 会话启动时，需要清除此变量
delete process.env.CLAUDECODE;

/**
 * 每个会话「上次请求的模型」(短别名,如 opus/sonnet/kimi-k2.5),按真实 sessionId 记录。
 * resume 会锁定首轮模型,所以下一轮若请求了不同模型,就 forkSession(从历史分叉 + 应用新模型),
 * 让「换模型」对后续消息立即生效且保留上下文。
 * 注意:不能拿请求的短别名和 SDK 返回的完整 model id 比较(二者本就不同),只能比「请求 vs 上次请求」。
 *
 * 放在模块级(而非类实例字段)是因为每次 WebSocket 连接(含浏览器刷新/重连)都会
 * `new ClaudeAgentService()`,若挂在实例上,历史记录会随连接一起丢失,导致下一条消息
 * 里「模型已变更」误判为「未变更」,resume 沿用了旧模型却不触发 forkSession。
 */
const sessionModelCache = new Map<string, string>();
/** 每个会话「上次请求的推理力度」组合键，按真实 sessionId 记录，语义同 sessionModelCache。 */
const sessionEffortCache = new Map<string, string>();

export class ClaudeAgentService extends EventEmitter {
  // "error" 事件无监听器时 emit 会抛异常(WS 断开后迟到的错误事件曾炸掉整个
  // server),兜底降级为日志。
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "error" && this.listenerCount("error") === 0) {
      logger.warn(`[claude] dropped error event (no listeners): ${JSON.stringify(args[0]).slice(0, 300)}`);
      return false;
    }
    return super.emit(event, ...args);
  }

  /** 活跃的 query 流（sessionId → Query） */
  private activeStreams = new Map<string, Query>();
  /** 中断控制器（sessionId → AbortController） */
  private abortControllers = new Map<string, AbortController>();
  /** 启动参数（sessionId → options），用于 resume 失效时无感重启 */
  private startOptions = new Map<string, AgentServiceOptions>();
  /** 标记需在流结束后去掉 resume 重启的 session（防止坏 id 永久卡死） */
  private pendingRetry = new Set<string>();
  /** Dedup tool_use blocks across partial messages (reset per session) */
  private seenToolIds = new Set<string>();
  /** Track API message ID to detect new turns within a task */
  private lastMessageId: string | null = null;
  /** Internal session ID counter */
  private idCounter = 0;
  /** Pending HIL permission requests (requestId → Promise resolver) */
  private pendingPermissions = new Map<
    string,
    {
      resolve: (decision: { behavior: "allow"; updatedPermissions?: PermissionUpdate[] } | { behavior: "deny"; message: string }) => void;
      suggestions?: PermissionUpdate[];
    }
  >();
  /** Permission request ID counter */
  private permissionIdCounter = 0;

  async start(options: AgentServiceOptions): Promise<string> {
    if (!options.projectPath?.trim()) {
      throw new Error("projectPath 不能为空，请先选择项目文件夹");
    }

    // 生成临时 sessionId（真正的 CLI sessionId 从 system.init 消息获取）
    const sessionId =
      options.sessionId || `session_${Date.now()}_${++this.idCounter}`;

    const controller = new AbortController();

    // 构建环境变量
    // 关键：必须继承 process.env（PATH / SystemRoot 等），否则 SDK 用
    // 仅含 API Key 的环境去 spawn "node"，在 Windows 上会因找不到 PATH
    // 报 ENOENT，被 SDK 误报为 "Claude Code executable not found"。
    const env: Record<string, string | undefined> = { ...process.env };
    if (options.baseUrl) {
      // 第三方 Anthropic 兼容端点(DeepSeek/MiniMax/Kimi/GLM/自定义):
      // 各家文档统一约定用 ANTHROPIC_AUTH_TOKEN(Bearer)鉴权,必须清掉
      // ANTHROPIC_API_KEY 避免 CLI 用 x-api-key 撞官方鉴权逻辑。
      env["ANTHROPIC_BASE_URL"] = options.baseUrl;
      env["ANTHROPIC_AUTH_TOKEN"] = options.authToken || "";
      delete env["ANTHROPIC_API_KEY"];
      if (options.model) {
        // 兼容端点没有 haiku 系列,后台小任务(标题生成等)也必须指到同一模型,
        // 否则 CLI 默认调 haiku 直接 404。
        env["ANTHROPIC_MODEL"] = options.model;
        env["ANTHROPIC_SMALL_FAST_MODEL"] = options.model;
        env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = options.model;
      }
      // 屏蔽遥测/更新检查等对 api.anthropic.com 的非必要请求
      env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1";
    } else if (options.apiKey) {
      env["ANTHROPIC_API_KEY"] = options.apiKey;
      delete env["ANTHROPIC_AUTH_TOKEN"];
    } else {
      // OAuth/订阅模式：清除环境里残留的 ANTHROPIC_API_KEY（如系统级环境变量），
      // 否则 CLI 会优先用它鉴权而忽略 ~/.claude 订阅凭证，导致 exit code 1。
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
    }
    if (options.httpProxy) {
      env["HTTP_PROXY"] = options.httpProxy;
      env["http_proxy"] = options.httpProxy;
    }
    if (options.httpsProxy) {
      env["HTTPS_PROXY"] = options.httpsProxy;
      env["https_proxy"] = options.httpsProxy;
    }
    if (options.socksProxy) {
      env["ALL_PROXY"] = options.socksProxy;
    }
    if (options.effort) {
      env["CLAUDE_CODE_EFFORT_LEVEL"] = options.effort;
    }

    logger.info(`Starting SDK query [${sessionId}]`, {
      model: options.model,
      cwd: options.projectPath,
      promptLength: options.prompt.length,
      hasResume: !!options.sessionId,
    });
    logger.debug(
      `[${sessionId}] prompt: ${options.prompt.slice(0, 200)}${options.prompt.length > 200 ? "..." : ""}`
    );

    // resume 会锁定会话首轮的模型/推理力度。若本轮请求的值与该会话上次请求的不同,
    // 自动 forkSession:从原历史分叉出新会话并应用新设置,使「换模型/换力度」立即生效且保留上下文。
    const prevModel = options.sessionId ? sessionModelCache.get(options.sessionId) : undefined;
    const modelChanged =
      !!options.sessionId && !!options.model && prevModel !== undefined && prevModel !== options.model;

    const effortKey = `${options.effort ?? ""}:${options.ultracode ? 1 : 0}`;
    const prevEffort = options.sessionId ? sessionEffortCache.get(options.sessionId) : undefined;
    const effortChanged =
      !!options.sessionId && prevEffort !== undefined && prevEffort !== effortKey;

    if (modelChanged) {
      logger.info(
        `[${sessionId}] 模型变更(${prevModel} → ${options.model}),对 resume 会话启用 forkSession`
      );
    }
    if (effortChanged) {
      logger.info(
        `[${sessionId}] 推理力度变更(${prevEffort} → ${effortKey}),对 resume 会话启用 forkSession`
      );
    }
    const forkSession = options.forkSession || modelChanged || effortChanged;

    const stream = query({
      prompt: options.prompt,
      options: {
        pathToClaudeCodeExecutable: resolveCliPath(),
        cwd: options.projectPath,
        resume: options.sessionId || undefined,
        forkSession,
        model: options.model,
        effort: options.effort,
        maxBudgetUsd: options.maxBudget,
        // ultracode（effort 第六档）：xhigh + 动态多智能体工作流编排。
        // 通过 flag 层 settings 注入；effort 已在上游被置为 "xhigh"。
        ...(options.ultracode ? { settings: { ultracode: true } } : {}),
        enableFileCheckpointing: true,
        includePartialMessages: true,
        settingSources: ["user", "project"],
        abortController: controller,

        // Phase 2：HIL 权限确认 — 通过 canUseTool 回调暂停工具执行，
        // 等待前端用户确认后再继续。
        // permissionMode 来自前端运行模式（default / plan / acceptEdits / bypassPermissions），
        // 默认 default。仅在显式 bypassPermissions 时才跳过 CLI 内部权限提示。
        permissionMode: options.permissionMode ?? "default",
        allowDangerouslySkipPermissions:
          options.permissionMode === "bypassPermissions",
        canUseTool: async (toolName, toolInput, options) => {
          return this.requestPermission(sessionId, toolName, toolInput, {
            toolUseID: options.toolUseID,
            decisionReason: options.decisionReason,
            blockedPath: options.blockedPath,
            suggestions: options.suggestions,
          });
        },

        // 环境变量
        env,

        // 捕获 stderr
        stderr: (data: string) => {
          const text = data.trim();
          if (text) {
            logger.warn(`stderr [${sessionId}]: ${text}`);
            this.emit("process_stderr", { sessionId, text });
          }
        },
      },
    });

    this.activeStreams.set(sessionId, stream);
    this.abortControllers.set(sessionId, controller);
    this.startOptions.set(sessionId, options);
    this.seenToolIds.clear();
    this.lastMessageId = null;

    // 后台消费流，不阻塞 start() 返回
    this.consumeStream(sessionId, stream);

    return sessionId;
  }

  abort(sessionId: string): boolean {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(sessionId);
      this.abortControllers.delete(sessionId);
      logger.info(`Aborted [${sessionId}]`);
      return true;
    }
    return false;
  }

  isRunning(sessionId: string): boolean {
    return this.activeStreams.has(sessionId);
  }

  /**
   * 获取活跃的 Query 流（供 Phase 3 rewindFiles 使用）
   */
  getActiveStream(sessionId: string): Query | undefined {
    return this.activeStreams.get(sessionId);
  }

  // ── Checkpoint / Rewind ──

  /**
   * 使用 SDK 的 rewindFiles() 将文件恢复到指定用户消息时的状态。
   * 要求 enableFileCheckpointing: true 且 stream 仍然活跃。
   *
   * @throws 如果没有活跃的 stream（session 已结束）
   */
  async rewindFiles(
    sessionId: string,
    messageUuid: string,
    dryRun = false
  ): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }> {
    const stream = this.activeStreams.get(sessionId);
    if (!stream) {
      throw new Error(`No active stream for session ${sessionId}. Use fallback rollback.`);
    }
    logger.info(`rewindFiles [${sessionId}] messageUuid=${messageUuid} dryRun=${dryRun}`);
    const result = await stream.rewindFiles(messageUuid, { dryRun });
    logger.info(`rewindFiles result [${sessionId}]:`, result);
    return result;
  }

  // ── HIL 权限管理 ──

  /**
   * 外部（chatHandler）调用此方法来响应权限请求
   */
  resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
    reason?: string,
    alwaysAllow?: boolean
  ): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    logger.info(`Permission resolved: ${requestId} → ${decision}${alwaysAllow ? " (always)" : ""}`);
    if (decision === "allow") {
      pending.resolve({
        behavior: "allow",
        // Pass back SDK suggestions to persist "always allow" rules
        ...(alwaysAllow && pending.suggestions ? { updatedPermissions: pending.suggestions } : {}),
      });
    } else {
      pending.resolve({ behavior: "deny", message: reason || "User denied" });
    }
    return true;
  }

  /**
   * 内部：发起权限请求并等待响应
   *
   * 修复要点：
   * 1. 优先使用 SDK 提供的 toolUseID 作为 requestId（保持与 SDK 内部一致）
   * 2. pendingPermissions.set() 在 emit() 之前执行（防止同步 auto-approve 路径找不到 entry）
   * 3. 如果 SDK 因 sibling error 重新调度同一 toolUseID，复用已有 Promise
   */
  private requestPermission(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    opts?: {
      toolUseID?: string;
      decisionReason?: string;
      blockedPath?: string;
      suggestions?: PermissionUpdate[];
    }
  ): Promise<{ behavior: "allow"; updatedPermissions?: PermissionUpdate[] } | { behavior: "deny"; message: string }> {
    const requestId = opts?.toolUseID || `perm_${Date.now()}_${++this.permissionIdCounter}`;

    // Fix 3: SDK 重新调度同一个 toolUseID 时，链接到已有 Promise
    if (this.pendingPermissions.has(requestId)) {
      return new Promise((resolve) => {
        const existing = this.pendingPermissions.get(requestId)!;
        const orig = existing.resolve;
        existing.resolve = (d) => { orig(d); resolve(d); };
      });
    }

    return new Promise((resolve) => {
      // Fix 2: 先注册到 Map，再 emit（防止同步 resolvePermission 找不到 entry）
      this.pendingPermissions.set(requestId, { resolve, suggestions: opts?.suggestions });

      // 超时自动拒绝（60s）
      const timer = setTimeout(() => {
        if (this.pendingPermissions.has(requestId)) {
          this.pendingPermissions.delete(requestId);
          logger.warn(`Permission request timed out: ${requestId}`);
          this.emit("permission_timeout", { requestId, sessionId });
          resolve({ behavior: "deny", message: "Permission request timed out (60s)" });
        }
      }, 60_000);
      timer.unref();

      this.emit("permission_request", {
        requestId,
        sessionId,
        toolName,
        toolInput,
        decisionReason: opts?.decisionReason,
        blockedPath: opts?.blockedPath,
        suggestions: opts?.suggestions,
      } satisfies PermissionRequest);
    });
  }

  // ── 流消费 ──

  private async consumeStream(sessionId: string, stream: Query) {
    let exitCode: number | null = 0;

    try {
      for await (const msg of stream) {
        this.dispatch(sessionId, msg);
      }
      // 流正常结束
      logger.info(`Stream completed [${sessionId}]`);
    } catch (err: unknown) {
      const errObj = err as Error;
      const isAbort =
        errObj?.name === "AbortError" || String(err).includes("abort");

      if (isAbort) {
        exitCode = null;
        logger.info(`Stream aborted [${sessionId}]`);
      } else if (this.pendingRetry.has(sessionId)) {
        // Fix B：失效 resume 的进程退出（exit 1）是预期内的，抑制错误，稍后重启
        exitCode = null;
        logger.info(`Stream exited for stale-resume retry [${sessionId}]`);
      } else {
        // 提取退出码（如有）
        const codeMatch = String(err).match(/exited with code (\d+)/);
        exitCode = codeMatch ? parseInt(codeMatch[1], 10) : 1;

        this.emit("error", {
          sessionId,
          code: "PROCESS_ERROR",
          message: errObj?.message || String(err),
        });
        logger.error(`Stream error [${sessionId}]`, errObj?.message);
      }
    } finally {
      // Fix B：若标记了重试，去掉 resume 重新启动一次，对前端无感（不发 close）
      if (this.pendingRetry.has(sessionId)) {
        this.pendingRetry.delete(sessionId);
        const opts = this.startOptions.get(sessionId);
        this.cleanup(sessionId);
        this.startOptions.delete(sessionId);
        if (opts) {
          const { sessionId: _staleId, ...freshOpts } = opts;
          logger.info(`[${sessionId}] restarting without resume`);
          this.start(freshOpts).catch((e) => {
            this.emit("error", {
              sessionId,
              code: "RETRY_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
            this.emit("close", { sessionId, code: 1 });
          });
        }
        return;
      }
      // 始终清理并发出 close（和旧版 proc.on("close") 行为一致）
      this.cleanup(sessionId);
      this.startOptions.delete(sessionId);
      this.emit("close", { sessionId, code: exitCode });
    }
  }

  private cleanup(sessionId: string) {
    this.activeStreams.delete(sessionId);
    this.abortControllers.delete(sessionId);
    // 拒绝所有未决权限请求
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: "Session ended" });
    }
    this.pendingPermissions.clear();
  }

  // ── 消息分发（映射 SDK 消息到旧版 EventEmitter 事件） ──

  private dispatch(sessionId: string, msg: SDKMessage) {
    // 使用 Record 访问可能不在类型定义中的字段
    const raw = msg as Record<string, unknown>;

    // Debug: log message types to understand SDK output flow
    if (msg.type !== "stream_event") {
      logger.debug(`[${sessionId}] SDK msg type=${msg.type} subtype=${raw.subtype || "-"}`);
    }

    // ── system.init ──
    if (msg.type === "system" && raw.subtype === "init") {
      const realSessionId = (raw.session_id as string) || sessionId;

      // 如果 CLI 返回了不同的 sessionId，更新映射
      if (realSessionId !== sessionId) {
        const stream = this.activeStreams.get(sessionId);
        const controller = this.abortControllers.get(sessionId);
        if (stream) {
          this.activeStreams.delete(sessionId);
          this.activeStreams.set(realSessionId, stream);
        }
        if (controller) {
          this.abortControllers.delete(sessionId);
          this.abortControllers.set(realSessionId, controller);
        }
      }

      // 诊断：对比「本次请求的 model/effort」与「CLI 实际生效的 model + source」。
      // 若 source==="resume" 且 requestedModel !== actualModel，即证实 resume 会话锁定了模型/力度。
      const reqOpts = this.startOptions.get(sessionId);
      // 记录该(真实)会话本轮请求的模型短别名 / 推理力度组合键,供下一轮判断是否发生变更。
      if (reqOpts?.model) sessionModelCache.set(realSessionId, reqOpts.model);
      if (reqOpts) {
        sessionEffortCache.set(
          realSessionId,
          `${reqOpts.effort ?? ""}:${reqOpts.ultracode ? 1 : 0}`
        );
      }
      logger.info(`[${realSessionId}] session_init diagnostics`, {
        source: raw.source,
        requestedModel: reqOpts?.model,
        actualModel: raw.model,
        requestedEffort: reqOpts?.effort,
        ultracode: reqOpts?.ultracode,
        hasResume: !!reqOpts?.sessionId,
      });

      this.emit("session_init", {
        sessionId: realSessionId,
        model: raw.model as string,
      });
      return;
    }

    // ── system.compact_boundary（SDK 用 compact_boundary，旧版用 compact） ──
    if (msg.type === "system" && raw.subtype === "compact_boundary") {
      const meta = raw.compact_metadata as Record<string, unknown> | undefined;
      logger.info(`[${sessionId}] context_compact event (SDK compact_boundary):`, {
        trigger: meta?.trigger,
        preTokens: meta?.pre_tokens,
      });
      // 发送格式兼容旧版前端期望的字段名
      this.emit("context_compact", {
        sessionId,
        type: "system",
        subtype: "compact",
        compact_metadata: meta,
      });
      return;
    }

    // ── assistant 消息（完整的 Claude 回复） ──
    if (msg.type === "assistant" && raw.message) {
      const message = raw.message as Record<string, unknown>;
      const msgId = message.id as string;
      const content = (message.content as ContentBlock[]) || [];
      const isPartial = false; // SDKAssistantMessage = 完整消息

      // 检测新 turn
      if (msgId && msgId !== this.lastMessageId) {
        const hasTextOrTool = content.some(
          (b) =>
            b.type === "text" || b.type === "tool_use" || b.type === "thinking"
        );
        if (hasTextOrTool && this.lastMessageId !== null) {
          logger.debug(
            `[${sessionId}] new_turn: ${this.lastMessageId} → ${msgId}`
          );
          this.emit("new_turn", { sessionId });
        }
        this.lastMessageId = msgId;
      }

      // Usage 统计
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage) {
        logger.debug(
          `[${sessionId}] context_usage: input=${usage.input_tokens} output=${usage.output_tokens}`
        );
        this.emit("context_usage", { sessionId, usage });
      }

      // 分发内容块 — 区分已流式传输 vs 需要补全的内容
      for (const block of content) {
        if (block.type === "text" || block.type === "thinking") {
          // stream_event delta 已经发送过这些内容，跳过避免重复
          continue;
        }
        if (block.type === "tool_use") {
          // tool_use_start 已通过 content_block_start 发送（input 为空）
          // 现在补全完整 input
          if (this.seenToolIds.has(block.id)) {
            this.emit("tool_input_complete", {
              sessionId,
              toolCallId: block.id,
              toolInput: block.input,
            });
          } else {
            // 罕见情况：没有收到 stream_event 直接收到 complete message
            this.seenToolIds.add(block.id);
            this.emit("tool_use_start", {
              sessionId,
              toolCallId: block.id,
              toolName: block.name,
              toolInput: block.input,
            });
          }
          continue;
        }
        // tool_result 等其他类型正常分发
        this.dispatchContentBlock(sessionId, block, false);
      }
      return;
    }

    // ── stream_event（部分消息 — includePartialMessages: true 时） ──
    if (msg.type === "stream_event" as string) {
      this.handleStreamEvent(sessionId, raw);
      return;
    }

    // ── user 消息（tool_result） ──
    // SDK user messages contain tool results in message.content[] array
    if (msg.type === "user") {
      const message = raw.message as Record<string, unknown> | undefined;
      const content = (message?.content as ContentBlock[]) || [];
      for (const block of content) {
        if (block.type === "tool_result") {
          this.dispatchContentBlock(sessionId, block, false);
        }
      }
      return;
    }

    // ── result（任务完成 / 执行错误） ──
    if (msg.type === "result") {
      // SDK 用 total_cost_usd，旧版 stream-json 用 cost_usd
      const costUsd =
        (raw.total_cost_usd as number) ?? (raw.cost_usd as number) ?? 0;
      const usage = raw.usage as Record<string, unknown> | undefined;
      const subtype = raw.subtype as string;
      const numTurns = (raw.num_turns as number) ?? 0;
      const isExecError = raw.is_error === true || subtype === "error_during_execution";

      // ── Fix B：resume 失效（会话不存在）→ 去掉 resume 无感重启 ──
      // 典型特征：带着 resume id 启动，却在 0 turn 时执行错误。
      // 只重试一次（重启后的 options 无 sessionId，再失败将走正常错误路径）。
      const opts = this.startOptions.get(sessionId);
      if (isExecError && numTurns === 0 && opts?.sessionId) {
        logger.warn(
          `[${sessionId}] resume failed (subtype=${subtype}); will restart without resume`
        );
        this.pendingRetry.add(sessionId);
        return;
      }

      // ── Fix A：真正的执行错误不再伪装成 task_complete ──
      if (isExecError) {
        const message =
          (raw.result as string) ||
          `Claude 执行失败 (${subtype || "error"})`;
        logger.error(`[${sessionId}] execution error: ${message}`);
        this.emit("error", {
          sessionId,
          code: "EXECUTION_ERROR",
          message,
        });
        return;
      }

      logger.info(
        `[${sessionId}] task_complete: cost=$${costUsd.toFixed(4)} input=${usage?.input_tokens} output=${usage?.output_tokens} turns=${raw.num_turns}`
      );
      this.emit("task_complete", {
        sessionId,
        result: raw.result as string,
        usage,
        costUsd,
        durationMs: raw.duration_ms as number,
        numTurns: raw.num_turns as number,
        isError: raw.is_error as boolean,
        subtype: raw.subtype as string,
      });
      return;
    }

    // 其余 SDK 消息类型暂不处理（auth_status, tool_progress, task_notification 等）
    // 可在后续 Phase 中按需添加
  }

  /**
   * 处理 stream_event（SDK 的 includePartialMessages 输出）
   *
   * stream_event 包含 Anthropic API 的原始流事件（content_block_delta 等），
   * 我们从中提取文本和 thinking 的增量更新，以实现 token 级流式输出。
   */
  private handleStreamEvent(
    sessionId: string,
    raw: Record<string, unknown>
  ) {
    const event = raw.event as Record<string, unknown> | undefined;
    if (!event) return;

    const eventType = event.type as string;

    // content_block_delta — token 级增量
    if (eventType === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return;

      if (delta.type === "text_delta" && delta.text) {
        this.emit("assistant_text", {
          sessionId,
          text: delta.text as string,
          isPartial: true,
        });
      }
      if (delta.type === "thinking_delta" && delta.thinking) {
        this.emit("assistant_thinking", {
          sessionId,
          thinking: delta.thinking as string,
          isPartial: true,
        });
      }
    }

    // content_block_start — 检测 tool_use 开始
    if (eventType === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        const toolId = block.id as string;
        if (!this.seenToolIds.has(toolId)) {
          this.seenToolIds.add(toolId);
          this.emit("tool_use_start", {
            sessionId,
            toolCallId: toolId,
            toolName: block.name as string,
            toolInput: (block.input as Record<string, unknown>) || {},
          });
        }
      }
    }

    // message_start — 可提取 usage
    if (eventType === "message_start") {
      const message = event.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (usage) {
        this.emit("context_usage", { sessionId, usage });
      }
    }

    // message_delta — 结束时的 usage 更新
    if (eventType === "message_delta") {
      const usage = event.usage as Record<string, unknown> | undefined;
      if (usage) {
        this.emit("context_usage", { sessionId, usage });
      }
    }
  }

  private dispatchContentBlock(
    sessionId: string,
    block: ContentBlock,
    isPartial: boolean
  ) {
    switch (block.type) {
      case "text":
        this.emit("assistant_text", {
          sessionId,
          text: block.text,
          isPartial,
        });
        break;
      case "thinking":
        this.emit("assistant_thinking", {
          sessionId,
          thinking: block.thinking,
          isPartial,
        });
        break;
      case "tool_use":
        // Dedup: partial messages re-emit the same tool_use block on every update
        if (this.seenToolIds.has(block.id)) break;
        this.seenToolIds.add(block.id);
        this.emit("tool_use_start", {
          sessionId,
          toolCallId: block.id,
          toolName: block.name,
          toolInput: block.input,
        });
        break;
      case "tool_result": {
        // MCP 工具可能返回内容块数组（含 image 等），需序列化为 JSON 字符串
        const resultContent = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content);
        this.emit("tool_use_result", {
          sessionId,
          toolCallId: block.tool_use_id,
          result: resultContent,
          isError: block.is_error || false,
        });
        break;
      }
    }
  }
}
