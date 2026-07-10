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
import fs from "fs/promises";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  Query,
  PermissionUpdate,
  SDKUserMessage,
  HookEvent,
  HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../utils/logger.js";
import { resolveCliPath } from "../utils/claudeCli.js";
import { findSessionJsonl } from "../utils/pathUtils.js";
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

/**
 * resume 前净化会话 JSONL 里的 assistant 消息 id。
 *
 * 背景:第三方 Anthropic 兼容端点(DeepSeek/GLM/Kimi 等)返回的 message id 不是
 * 官方的 `msg_` 前缀(常见 UUID)。CLI resume 会话时,会把历史里最后一条 assistant
 * 的 message.id 作为 `diagnostics.previous_message_id` 发给 API;官方端点校验该
 * 字段必须以 `msg_` 开头,于是「先用国产模型聊、再切回官方 Claude 续聊」必现:
 *   API Error: 400 diagnostics.previous_message_id: must be the `id` from a
 *   prior /v1/messages response (starts with `msg_`)
 *
 * 处理:给所有非 `msg_` 前缀的 assistant message.id 补上 `msg_` 前缀。只动
 * message.id 字段(仅用于诊断/遥测),uuid/parentUuid 线程链保持原样,不影响
 * CLI 回放历史。幂等,每次 resume 前调用即可;对兼容端点也无害(它们不校验)。
 *
 * 注意:仅在该会话没有活跃流时调用(chatHandler 对同连接的并发消息排队,
 * 排到时上一个流已结束,不存在与 CLI 并发写同一文件的情况)。
 */
/**
 * 流式输入队列:query() 的 prompt 传 AsyncIterable 后,CLI 进程在两轮之间保持存活,
 * 后续用户消息 push 进来即开始新一轮——这是"后台 sub-agent 不随回合结束被杀"的关键。
 * end() 后 CLI 收到输入结束信号,正常收尾退出(JSONL 落盘)。
 */
interface InputQueue {
  push: (m: SDKUserMessage) => void;
  end: () => void;
  iterable: AsyncIterable<SDKUserMessage>;
}

function createInputQueue(): InputQueue {
  const buffer: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let ended = false;
  const wake = () => { const n = notify; notify = null; n?.(); };
  return {
    push(m) { if (!ended) { buffer.push(m); wake(); } },
    end() { ended = true; wake(); },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (buffer.length > 0) yield buffer.shift()!;
          if (ended) return;
          await new Promise<void>((resolve) => { notify = resolve; });
        }
      },
    },
  };
}

/**
 * 只读/低风险工具:无需用户确认,服务层直接放行。
 *
 * 放在服务层(而非仅 chatHandler 的 permission_request 监听器里)是关键:WS 断开进入
 * 30s 寄存宽限期时,chatHandler 会 removeAllListeners(),此刻常驻 CLI 若发起权限请求,
 * 监听器已不在 → 请求 emit 到空、挂满 60s 后被自动拒绝(连 Read/Grep 这类安全工具也遭殃)。
 * 由服务层自行放行安全工具,寄存期间也不受影响。
 */
const AUTO_APPROVE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TodoRead", "Task", "Agent", "TodoWrite",
  "NotebookRead", "LS",
]);

/**
 * F1.13 审计时间线:经 SDK 进程内 hooks 只读订阅生命周期事件。
 * 回调恒返回 {}(继续执行),不改变任何工具行为;与 settings.json 的 shell hooks 共存。
 */
const AUDIT_HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionDenied",
  "FileChanged",
  "Stop",
];

/** 从 hook input 提取一句话摘要(只挑已知字段,不整包序列化以防超长) */
function summarizeHookInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.tool_name === "string") parts.push(input.tool_name);
  const ti = input.tool_input as Record<string, unknown> | undefined;
  if (ti) {
    const key = ["file_path", "path", "command", "pattern", "url", "description"].find(
      (k) => typeof ti[k] === "string"
    );
    if (key) parts.push(String(ti[key]).slice(0, 80));
  }
  if (typeof input.file_path === "string") parts.push(String(input.file_path).slice(0, 80));
  if (typeof input.agent_type === "string") parts.push(String(input.agent_type));
  if (typeof input.reason === "string") parts.push(String(input.reason).slice(0, 80));
  return parts.join(" · ");
}

function userMessageOf(prompt: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
  };
}

/**
 * 常驻进程的"spawn 期指纹":这些选项经环境变量/启动参数在进程生命周期内锁死,
 * 任何一项变化都必须换进程(经 resume 保留上下文)。模型与 permissionMode 不在
 * 此列——官方端点可通过 setModel/setPermissionMode 热切;但第三方兼容端点的模型
 * 经 ANTHROPIC_MODEL env 钉死,故 baseUrl 存在时模型并入指纹。
 */
function spawnFingerprint(o: AgentServiceOptions): string {
  return JSON.stringify([
    o.projectPath,
    o.baseUrl ?? "",
    o.authToken ?? "",
    o.apiKey ?? "",
    o.effort ?? "",
    !!o.ultracode,
    o.maxBudget ?? 0,
    // 注意:fallbackModel 刻意【不】入指纹——它由 model 家族派生,若入指纹,
    // 官方端点跨家族换模型(opus↔sonnet)会因指纹变化走杀进程重启,
    // 架空 tryReuseLive 的 setModel 热切并连带杀掉后台 sub-agent。
    // 代价:热切后本进程的 fallback 链略陈旧(仅过载时触发、且指向同族,无害)。
    o.thinkingBudget ?? 0,
    o.mcpVersion ?? 0,
    o.baseUrl ? (o.model ?? "") : "",
    o.httpProxy ?? "",
    o.httpsProxy ?? "",
    o.socksProxy ?? "",
  ]);
}

async function sanitizeSessionJsonlForResume(sessionId: string): Promise<void> {
  // 按 sessionId 扫描定位真实 JSONL(对 CLI 的 cwd 哈希差异免疫,且 findSessionJsonl
  // 内部已校验 id 合法性、挡掉目录穿越),不再用 projectPath 手拼路径。
  const file = await findSessionJsonl(sessionId);
  if (!file) return; // 会话文件不存在(全新会话)或 id 非法,让 CLI 自行处理
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    return;
  }
  let changed = 0;
  const lines = raw.split("\n").map((line) => {
    if (!line.includes('"assistant"')) return line; // 快速跳过非 assistant 行
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { id?: unknown } };
      const msg = rec?.message;
      if (rec?.type === "assistant" && typeof msg?.id === "string" && msg.id && !msg.id.startsWith("msg_")) {
        msg.id = `msg_${msg.id}`;
        changed++;
        return JSON.stringify(rec);
      }
    } catch { /* 非法 JSON 行原样保留 */ }
    return line;
  });
  if (changed > 0) {
    await fs.writeFile(file, lines.join("\n"), "utf-8");
    logger.info(`[${sessionId}] resume 净化:已为 ${changed} 条 assistant 消息 id 补上 msg_ 前缀(第三方端点历史)`);
  }
}

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
  /** 原始启动 id → CLI 真实 sessionId(init 重映射),供流结束时把两套键都清干净 */
  private idRemap = new Map<string, string>();
  /** Dedup tool_use blocks across partial messages (reset per session) */
  private seenToolIds = new Set<string>();
  /** Track API message ID to detect new turns within a task */
  private lastMessageId: string | null = null;
  /** Internal session ID counter */
  private idCounter = 0;
  /**
   * 常驻会话进程(每连接最多一个)。流式输入模式下 CLI 在两轮之间保持存活,
   * 后台 sub-agent(run_in_background 的 Task/Agent)得以跨轮继续运行——
   * 旧的"一条消息一个进程"模型会在回合结束时随进程退出把它们杀掉。
   */
  private live: {
    /** 初始为临时 id,system.init 后更新为 CLI 真实 sessionId */
    sessionId: string;
    /** consumeStream/dispatch 全程使用的原始 id(init 重映射不改它) */
    consumeId: string;
    queue: InputQueue;
    stream: Query;
    controller: AbortController;
    /** spawn 期锁定的选项指纹,变化即需换进程 */
    fingerprint: string;
    /** 当前生效的请求模型别名(官方端点可 setModel 热切) */
    model?: string;
    permissionMode: string;
    /** 第三方兼容端点:模型经 env 钉死,不能热切 */
    compat: boolean;
    /** consumeStream 结束(进程退出)的信号 */
    done: Promise<void>;
  } | null = null;
  /** 被用户主动 interrupt 的会话:吞掉其本轮的 error result,不当执行错误上报 */
  private interrupted = new Set<string>();
  /**
   * 主动收尾(endLive)的会话:其进程退出的 close 是我方有意为之(新会话/换进程),
   * 不该转成 process_close 发给客户端——否则会把客户端刚为新一轮建立的流式状态打断。
   */
  private silentClose = new Set<string>();
  /** 当前是否有一轮任务在进行中(供断线重连/收养时判断要不要让客户端重回流式态)。 */
  private turnActive = false;
  /** start() 串行锁:同连接内两条消息毫秒级并发时,避免各自 spawn 出一个常驻进程互相顶掉。 */
  private startLock: Promise<unknown> = Promise.resolve();

  /** Pending HIL permission requests (requestId → Promise resolver + 原始请求负载) */
  private pendingPermissions = new Map<
    string,
    {
      resolve: (decision: { behavior: "allow"; updatedPermissions?: PermissionUpdate[] } | { behavior: "deny"; message: string }) => void;
      suggestions?: PermissionUpdate[];
      /** 原始请求负载:断线重连收养后重放给新客户端,不让危险工具确认卡在无人看的缓冲里 */
      request: PermissionRequest;
    }
  >();
  /** Permission request ID counter */
  private permissionIdCounter = 0;

  /**
   * F1.13:构建审计 hooks——每个关注事件注册一个只读回调,把事件转成
   * "hook_event" 发射(chatHandler 转发前端时间线)。恒返回 {} 不干预执行。
   */
  private buildAuditHooks(sessionId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const entries = AUDIT_HOOK_EVENTS.map((event) => [
      event,
      [
        {
          hooks: [
            async (input: unknown) => {
              try {
                const data = (input ?? {}) as Record<string, unknown>;
                this.emit("hook_event", {
                  sessionId,
                  event: (data.hook_event_name as string) || event,
                  toolName: (data.tool_name as string) || undefined,
                  detail: summarizeHookInput(data),
                  ts: Date.now(),
                });
              } catch {
                /* 审计失败不影响执行 */
              }
              return {};
            },
          ],
        },
      ],
    ]);
    return Object.fromEntries(entries) as Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  }

  /**
   * 串行化 start():同一连接内两条消息毫秒级并发时,若不串行,二者会在
   * tryReuseLive/endLive 的 await 窗口里都看到 this.live 尚未赋值,各自 query() 出
   * 一个常驻进程,第二个把 this.live 顶掉,第一个成为 abort/interrupt 都够不着、
   * 输入队列永不 end() 的僵尸进程。用 promise 链把每次 start 排队执行(每连接一个实例,
   * 锁天然是每连接粒度)。
   */
  async start(options: AgentServiceOptions): Promise<string> {
    const run = this.startLock.then(
      () => this._start(options),
      () => this._start(options)
    );
    // 吞掉本次结果/异常仅用于串联下一次,真正的结果/异常仍由 run 抛给调用方
    this.startLock = run.catch(() => {});
    return run;
  }

  private async _start(options: AgentServiceOptions): Promise<string> {
    if (!options.projectPath?.trim()) {
      throw new Error("projectPath 不能为空，请先选择项目文件夹");
    }

    // ── 常驻进程复用:同一会话且 spawn 期选项未变 → 消息直接入队,
    //    进程不重启,正在跑的后台 sub-agent 不会被中断 ──
    const reusedId = await this.tryReuseLive(options);
    if (reusedId) return reusedId;

    // 新会话 / fork / spawn 期选项变化:先收尾旧常驻进程(输入收口→正常退出),
    // 再带着 resume 重启,上下文不丢(但旧进程里的后台任务无法跨进程存活)
    await this.endLive();

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

    // resume 前净化历史里第三方端点写入的非 msg_ 消息 id,避免官方 API 400
    if (options.sessionId) {
      await sanitizeSessionJsonlForResume(options.sessionId).catch((e) =>
        logger.warn(`[${sessionId}] resume 净化失败(忽略,继续启动): ${e}`)
      );
    }

    // 流式输入模式:prompt 传 AsyncIterable,进程跨轮存活;首条消息先入队
    const inputQueue = createInputQueue();
    inputQueue.push(userMessageOf(options.prompt));

    const stream = query({
      prompt: inputQueue.iterable,
      options: {
        pathToClaudeCodeExecutable: resolveCliPath(),
        cwd: options.projectPath,
        resume: options.sessionId || undefined,
        forkSession,
        model: options.model,
        effort: options.effort,
        maxBudgetUsd: options.maxBudget,
        // F1.10:主模型过载/限流时自动降级备用模型(仅官方端点,由 chatHandler 推导)
        fallbackModel: options.fallbackModel,
        // F1.11:扩展思考预算。未设 = SDK 默认 adaptive
        ...(options.thinkingBudget
          ? { thinking: { type: "enabled" as const, budgetTokens: options.thinkingBudget } }
          : {}),
        // ultracode（effort 第六档）：xhigh + 动态多智能体工作流编排。
        // 通过 flag 层 settings 注入；effort 已在上游被置为 "xhigh"。
        ...(options.ultracode ? { settings: { ultracode: true } } : {}),
        enableFileCheckpointing: true,
        includePartialMessages: true,
        settingSources: ["user", "project"],
        abortController: controller,
        // F1.13:审计时间线 hooks(只读观察者)
        hooks: this.buildAuditHooks(sessionId),

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
    const done = this.consumeStream(sessionId, stream);

    this.live = {
      sessionId,
      consumeId: sessionId,
      queue: inputQueue,
      stream,
      controller,
      fingerprint: spawnFingerprint(options),
      model: options.model,
      permissionMode: options.permissionMode ?? "default",
      compat: !!options.baseUrl,
      done,
    };
    this.turnActive = true;

    return sessionId;
  }

  /**
   * 尝试把本条消息推入常驻进程的输入队列(免重启)。
   * 条件:客户端指回的 sessionId 正是活着的会话、非 fork、spawn 期指纹未变。
   * 模型/permissionMode 变化通过 setModel/setPermissionMode 热切,失败则退回换进程。
   * 返回 sessionId 表示已入队;返回 null 表示需走完整 spawn 流程。
   */
  private async tryReuseLive(options: AgentServiceOptions): Promise<string | null> {
    const live = this.live;
    if (!live) return null;
    // 复用判定:①客户端指回的 sessionId 正是活着的会话;或 ②客户端在流式中续发
    //  (continueActive)但 session_init 还没回传、拿不到 sessionId——此时也是对当前活跃
    //  会话的续发,必须排队而不是另起进程把正在跑的任务杀掉。
    const sameSession = !!options.sessionId && options.sessionId === live.sessionId;
    const continueActive = !options.sessionId && !!options.continueActive;
    if (!sameSession && !continueActive) return null;
    if (options.forkSession) return null;
    if (spawnFingerprint(options) !== live.fingerprint) return null;

    // 模型热切换(仅官方端点;第三方端点模型经 env 钉死,指纹不同已被上面拦下)
    if (options.model && options.model !== live.model) {
      if (live.compat) return null;
      try {
        await live.stream.setModel(options.model);
        live.model = options.model;
        logger.info(`[${live.sessionId}] setModel 热切换 → ${options.model}(进程保留)`);
      } catch (e) {
        logger.warn(`[${live.sessionId}] setModel 失败,退回换进程: ${e}`);
        return null;
      }
    }
    const pm = options.permissionMode ?? "default";
    if (pm !== live.permissionMode) {
      try {
        await live.stream.setPermissionMode(pm);
        live.permissionMode = pm;
      } catch (e) {
        logger.warn(`[${live.sessionId}] setPermissionMode 失败,退回换进程: ${e}`);
        return null;
      }
    }

    // 每轮记录:供 session 诊断与下一轮变更判定。
    // 注意不清 seenToolIds——它是进程级去重状态(清了会导致排队消息期间工具卡重复);
    // 但 lastMessageId 要复位:实测常驻进程每一轮都会重新收到 system.init(客户端据此
    // 重进流式态、渲染回复),复位可避免其后首条完整回复再多触发一次 new_turn(拆出一个空气泡)。
    this.lastMessageId = null;
    this.startOptions.set(live.sessionId, options);
    if (options.model) sessionModelCache.set(live.sessionId, options.model);
    sessionEffortCache.set(live.sessionId, `${options.effort ?? ""}:${options.ultracode ? 1 : 0}`);
    // 【不再】在这里清 interrupted:停止请求发出后紧接着发新消息时,若此刻清掉标记,
    // 被中断那一轮迟到的 is_error result 会失去抑制、被当成真错误上报给刚开始的新一轮。
    // 该标记由被中断轮次自己的 result 处理器消费(dispatch 中 interrupted.delete),
    // CLI 顺序执行保证被中断轮的 result 先于新一轮抵达,新一轮不会误吞。

    this.turnActive = true;
    live.queue.push(userMessageOf(options.prompt));
    logger.info(`[${live.sessionId}] 常驻进程复用:消息已入队(后台 sub-agent 不中断)`);
    return live.sessionId;
  }

  /**
   * 把一条消息直接推入活着的会话(供 /compact 等内部请求复用进程)。
   * 返回 false 表示该会话没有常驻进程,调用方应走 start() 全流程。
   */
  sendMessage(sessionId: string | null | undefined, prompt: string): boolean {
    const live = this.live;
    if (!live || !sessionId || live.sessionId !== sessionId) return false;
    live.queue.push(userMessageOf(prompt));
    logger.info(`[${live.sessionId}] 消息入队(常驻进程): ${prompt.slice(0, 60)}`);
    return true;
  }

  /**
   * 中断当前轮但保留进程(停止按钮/同会话新建任务)——后台 sub-agent 继续存活。
   * 无常驻进程或 interrupt 失败时退回 abort(杀进程)。
   */
  interrupt(sessionId: string): boolean {
    const live = this.live;
    if (live && live.sessionId === sessionId) {
      // 上一次 interrupt 还没被 result 消费掉 = 没生效(CLI 卡住/未响应控制请求)。
      // 用户第二次点停止:升级为杀进程,保证一定停得下来。
      if (this.interrupted.has(live.consumeId)) {
        logger.warn(`[${sessionId}] interrupt 未生效,第二次停止升级为杀进程`);
        return this.abort(sessionId);
      }
      // 用 consumeId 登记:dispatch/result 全程以它为 sessionId(init 重映射不影响)
      this.interrupted.add(live.consumeId);
      this.turnActive = false;
      live.stream.interrupt().then(
        () => logger.info(`Interrupted [${sessionId}](进程保留,后台任务不受影响)`),
        (e) => {
          logger.warn(`interrupt 失败,退回杀进程 [${sessionId}]: ${e}`);
          this.abort(sessionId);
        }
      );
      return true;
    }
    return this.abort(sessionId);
  }

  /**
   * 收尾常驻进程:输入收口让 CLI 正常退出(JSONL 落盘);超时兜底强杀。
   * 幂等,无常驻进程时立即返回。
   */
  private async endLive(): Promise<void> {
    const live = this.live;
    if (!live) return;
    this.live = null;
    this.turnActive = false;
    // 标记为「有意收尾」:consumeStream 里其 close 不再转成 process_close 发给客户端,
    // 否则会打断客户端刚为新一轮建立的流式状态(残留空气泡/指示灯闪断)。
    this.silentClose.add(live.consumeId);
    logger.info(`[${live.sessionId}] 收尾常驻进程(新会话/fork/spawn 选项变化)`);
    live.queue.end();
    const killTimer = setTimeout(() => {
      logger.warn(`[${live.sessionId}] 常驻进程收尾超时,强制终止`);
      live.controller.abort();
    }, 2000);
    killTimer.unref?.();
    await live.done.catch(() => { /* 流错误已在 consumeStream 内处理 */ });
    clearTimeout(killTimer);
  }

  abort(sessionId: string): boolean {
    if (this.live && this.live.sessionId === sessionId) {
      this.live.queue.end();
      this.live = null;
    }
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
   * 是否有一轮任务正在进行中(常驻进程存活且当前轮未收尾)。
   * 断线重连/收养后,chatHandler 据此决定要不要给新客户端补一个 session_init 让其重回流式态。
   */
  isTurnActive(): boolean {
    return this.turnActive && this.live !== null;
  }

  /** 当前活跃常驻会话的真实 id(供收养后补发 session_init 用),无则 null。 */
  getActiveSessionId(): string | null {
    return this.live?.sessionId ?? null;
  }

  /** 尚未决断的权限请求负载列表:断线重连收养后重放给新客户端(不让危险工具确认卡在无人看的缓冲里)。 */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingPermissions.values()).map((p) => p.request);
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
    // 安全工具在服务层直接放行(见 AUTO_APPROVE_TOOLS 注释):不 emit、不入 pending,
    // 这样断线寄存期(监听器已摘)里的只读工具也不会挂满 60s 才被拒。
    if (AUTO_APPROVE_TOOLS.has(toolName)) {
      logger.debug(`Auto-approved tool (service): ${toolName}`);
      return Promise.resolve({ behavior: "allow" });
    }

    const requestId = opts?.toolUseID || `perm_${Date.now()}_${++this.permissionIdCounter}`;

    // Fix 3: SDK 重新调度同一个 toolUseID 时，链接到已有 Promise
    if (this.pendingPermissions.has(requestId)) {
      return new Promise((resolve) => {
        const existing = this.pendingPermissions.get(requestId)!;
        const orig = existing.resolve;
        existing.resolve = (d) => { orig(d); resolve(d); };
      });
    }

    const request: PermissionRequest = {
      requestId,
      sessionId,
      toolName,
      toolInput,
      decisionReason: opts?.decisionReason,
      blockedPath: opts?.blockedPath,
      suggestions: opts?.suggestions,
    };

    return new Promise((resolve) => {
      // Fix 2: 先注册到 Map，再 emit（防止同步 resolvePermission 找不到 entry）
      // request 一并存下:断线重连收养后可重放给新客户端(getPendingRequests)。
      this.pendingPermissions.set(requestId, { resolve, suggestions: opts?.suggestions, request });

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

      this.emit("permission_request", request);
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
      // 常驻进程随流结束而消亡:清除 live 指针(按 stream 实例比对,不受 id 重映射影响)
      if (this.live?.stream === stream) {
        this.live = null;
      }
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
      // 清理;若是 endLive 有意收尾的会话,吞掉 close 不发 process_close(见 silentClose)。
      const silent = this.silentClose.delete(sessionId);
      this.turnActive = false;
      this.cleanup(sessionId);
      this.startOptions.delete(sessionId);
      if (!silent) {
        this.emit("close", { sessionId, code: exitCode });
      }
    }
  }

  private cleanup(sessionId: string) {
    this.activeStreams.delete(sessionId);
    this.abortControllers.delete(sessionId);
    this.interrupted.delete(sessionId);
    this.silentClose.delete(sessionId);
    // init 重映射过的真实 id 表项也要清,否则 isRunning/getActiveStream 会拿到已死的流
    const realId = this.idRemap.get(sessionId);
    if (realId) {
      this.idRemap.delete(sessionId);
      this.activeStreams.delete(realId);
      this.abortControllers.delete(realId);
    }
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
        // 常驻进程指针同步到真实 id,后续消息才能按 sessionId 匹配入队
        if (this.live && this.live.sessionId === sessionId) {
          this.live.sessionId = realSessionId;
        }
        this.idRemap.set(sessionId, realSessionId);
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

    // ── system.task_started / task_notification / background_tasks_changed ──
    // workflow(ultracode)/后台 agent 的生命周期消息。此前被静默丢弃,导致
    // 「工作流正在跑但 GUI 什么都看不到」。原样转发 payload,前端防御性解析;
    // debug 日志记录完整负载,供后续按真实字段迭代展示。
    if (
      msg.type === "system" &&
      (raw.subtype === "task_started" ||
        raw.subtype === "task_notification" ||
        raw.subtype === "background_tasks_changed")
    ) {
      logger.debug(
        `[${sessionId}] background_task_event ${raw.subtype}: ${JSON.stringify(raw).slice(0, 800)}`
      );
      this.emit("background_task_event", {
        sessionId,
        subtype: raw.subtype as string,
        payload: raw,
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

      // ── 用户主动 interrupt 的轮次:its result 不是执行错误,吞掉不上报 ──
      // (前端在发出 abort 动作时已收到 "aborted" 事件并复位了流式状态)
      if (this.interrupted.delete(sessionId) && isExecError) {
        logger.info(`[${sessionId}] 本轮已被用户中断(进程保留),忽略其 error result`);
        return;
      }

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
        this.turnActive = false;
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
      // 常驻进程模式:本轮结束但进程存活。清 turnActive,使断线重连时不会误判为「仍在跑」。
      this.turnActive = false;
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
