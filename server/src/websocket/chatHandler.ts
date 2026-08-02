import type { WebSocket } from "ws";
import { ClaudeAgentService } from "../services/claudeAgentService.js";
import { CodexAgentService } from "../services/codexAgentService.js";
import { registerAgent, unregisterAgent } from "../services/agentRegistry.js";
import { readProxy } from "../services/proxyConfig.js";
import { getProvider } from "../services/providerService.js";
import { getMcpConfigVersion } from "../services/mcpService.js";
import { cleanupFiles } from "../services/attachmentService.js";
import { WorkflowService } from "../services/workflowService.js";
import { WorkflowEngine } from "../services/workflow/engine.js";
import { ClaudeStepRunner } from "../services/workflow/claudeStepRunner.js";
import {
  registerRunning,
  markDone,
  updateSessionId,
  interruptProject,
  interruptAllRunning,
} from "../services/taskRegistry.js";
import { serverMsg } from "./protocol.js";
import { logger } from "../utils/logger.js";
import type { ClientMessage, PermissionRequest } from "../types/api.js";

/**
 * 每个项目的会话状态(引擎实例 + 当前会话游标)。一个项目全程最多一条,由
 * sessionsByProject 持有,和「哪个 WS 连接正在看它」解耦:
 *
 *   - 页面刷新 / vite 整页重载 / 网络闪断:WS 瞬断重连。若在 close 里直接 abort,
 *     常驻 CLI 进程连同后台任务(打包/扫描等)会被一起杀掉。改为:非显式关闭 →
 *     该 session 寄存 PARK_GRACE_MS,同项目新连接进来即接管,常驻进程无感存活;
 *     超时无人认领才真正收尾。关标签走显式 "shutdown" → 立即收尾。
 *   - 半开重连 / 双开标签页:旧 socket 的 close 可能晚于新 socket 的 open(服务端要靠
 *     30-60s 心跳才发现死连接)。若只认「寄存」,新连接会另建引擎,旧连接随后把持有
 *     运行任务的引擎寄存后 30s 杀掉。故新连接 open 时若发现同项目已有【活着的】 session,
 *     直接接管其引擎、并 detach 旧 socket 的监听器(让旧 socket 的 close 变成空操作),
 *     运行中的任务转交给新连接,不被误杀。
 *
 * 可变游标(activeSessionId 等)挂在本对象上、由当前绑定的 socket 监听器更新,接管时
 * 连同引擎一起转交,无需逐字段拷贝。
 */
interface ProjectSession {
  claude: ClaudeAgentService;
  codex: CodexAgentService;
  activeSessionId: string | null;
  activeEngine: "claude" | "codex" | null;
  activeCompat: { baseUrl: string; authToken?: string; model?: string } | null;
  /** 当前会话生效的模型(短别名):断线重连补发 session_init 时用于推断上下文窗口。 */
  activeModel: string | null;
  pendingAttachmentIds: string[];
  /**
   * 当前正在跑的工作流编排。同一项目同时只允许一个 —— 会话本身是串行的，
   * 两个编排交替往同一个会话发消息只会互相打断。
   */
  workflowRun: WorkflowEngine | null;
  /** 解除当前 socket 与本 session 的绑定(摘监听器 + 把该 socket 的 close 变空操作)。 */
  detach: () => void;
  /** 寄存宽限计时器;非 null 表示当前无 socket 绑定、正等待重连认领。 */
  parkTimer: ReturnType<typeof setTimeout> | null;
  /**
   * 断线期间被丢弃的最后一个终态事件，等重连认领时补发。
   * 没有它的话，闪断中结束的那一轮永远不会通知到前端。
   */
  missedTerminal: { event: string; data: Record<string, unknown>; at: number } | null;
}
const sessionsByProject = new Map<string, ProjectSession>();
const PARK_GRACE_MS = 30_000;

/**
 * 「一轮结束」类事件。断线期间丢掉它们，前端的 isStreaming 就永远落不下来，
 * 表现为停在「正在思考…」而任务其实早已结束。故这几个要记下来、重连时补发。
 *
 * 前端 `services/websocket.ts` 也有一个同名集合，但**语义不同**，
 * 不要"顺手对齐"：那里管的是何时熄灭「运行中」指示，这里管的是断线补发。
 * 内容当前恰好相同，纯属巧合。
 *
 * （历史教训：前端那份曾多包含一个 `error`，导致任务运行中的局部失败
 * 也把指示灯打灭，而任务还在这边跑着。两份定义各自演化正是根源。）
 */
const TERMINAL_EVENTS = new Set(["task_complete", "aborted", "process_close"]);

/**
 * 补发的时效上限。超过这个时间的终态没有补发价值 —— 用户多半已经重开过会话，
 * 此时冒出一条陈旧的任务结果卡片反而困惑。
 */
const MISSED_TERMINAL_TTL_MS = 10 * 60_000;

/**
 * F1.10:按模型家族推导自动降级链(opus→sonnet→haiku;haiku/未知不降级)。
 * 仅官方端点注入——第三方兼容端点不一定有对应模型,降级反而把任务打死。
 */
function deriveFallbackModel(
  model: string | undefined,
  isCompat: boolean,
): string | undefined {
  if (isCompat || !model) return undefined;
  const base = model.replace(/\[1m\]$/i, "");
  if (base === "opus" || /^claude-opus/i.test(base)) return "sonnet";
  if (base === "sonnet" || /^claude-sonnet/i.test(base)) return "haiku";
  return undefined;
}

/** 收尾一个项目的会话:中断引擎、清附件、注销 agent、从注册表移除。幂等。 */
function teardownSession(projectPath: string, session: ProjectSession) {
  if (session.parkTimer) {
    clearTimeout(session.parkTimer);
    session.parkTimer = null;
  }
  // 会话都要拆了,编排不能继续往里发消息。放在这里而不是 close 回调里,
  // 是因为收尾有多条路径(关标签、寄存超时无人认领、进程退出),
  // teardownSession 是它们唯一的汇合点 —— 漏一条就会留下一个对着已死会话
  // 空转的编排,还在按步骤计费。
  if (session.workflowRun) {
    session.workflowRun.abort("会话已结束");
    session.workflowRun = null;
  }
  if (session.activeSessionId) {
    if (session.activeEngine === "codex") {
      session.codex.abort(session.activeSessionId);
    } else {
      session.claude.abort(session.activeSessionId);
    }
    unregisterAgent(session.activeSessionId);
  }
  if (session.pendingAttachmentIds.length > 0) {
    cleanupFiles(session.pendingAttachmentIds, projectPath);
    session.pendingAttachmentIds = [];
  }
  if (projectPath && sessionsByProject.get(projectPath) === session) {
    sessionsByProject.delete(projectPath);
  }
  // 监听器在这里摘，而不是在 ws close 里。
  //
  // 之前是 close 一触发就无条件 removeAllListeners，导致 30 秒寄存宽限期内
  // 引擎发的一切都无人接收（详见 close 回调里的说明）。现在寄存期保留监听器，
  // 清理统一收到这个唯一汇合点上 —— 重连认领走的是 detach() 那条路，
  // 不经过这里，两边不会互相干扰。
  //
  // 放在最后：上面的 abort 会触发引擎事件，那些还需要被正常处理掉。
  session.claude.removeAllListeners();
  session.codex.removeAllListeners();
}

/**
 * 显式收尾某项目的会话(关标签时的 REST 兜底)。
 *
 * 客户端关标签本应发 WS "shutdown",但若此刻 WS 正处于重连/未连状态,send() 会静默丢帧,
 * 服务端便把引擎寄存 30s、任务多跑一截甚至被后开的连接复活。前端在关标签时并发打这个
 * REST 端点兜底,保证「用户显式关掉」一定能立刻收尾。返回是否命中一个会话。
 */
export function shutdownProjectSession(projectPath: string): boolean {
  const session = projectPath ? sessionsByProject.get(projectPath) : undefined;
  if (!session) return false;
  session.detach(); // 摘掉当前绑定 socket 的监听器(若有),其 close 变空操作
  markDone(projectPath); // 用户显式关标签 = 主动放弃,不算"被中止"
  teardownSession(projectPath, session);
  logger.info(`Project session shut down via REST (${projectPath})`);
  return true;
}

/**
 * 整个应用关闭时的全局收尾(SIGINT/SIGTERM 或 Tauri 退出前的 /shutdown-all):
 * 先把仍在运行的任务登记为 interrupted(同步落盘,供下次启动提醒),
 * 再逐项目收尾引擎(中断 CLI 进程、清附件、注销 agent)。返回被中止的任务数。
 */
export function shutdownAllSessions(): number {
  const interrupted = interruptAllRunning();
  for (const [projectPath, session] of [...sessionsByProject]) {
    session.detach();
    teardownSession(projectPath, session);
  }
  if (interrupted > 0) {
    logger.info(`[shutdown] ${interrupted} 个运行中任务被中止并已记录`);
  }
  return interrupted;
}

export function handleChatConnection(ws: WebSocket, projectPath: string) {
  // ── 解析/创建本项目的 ProjectSession ──
  const existing = projectPath ? sessionsByProject.get(projectPath) : undefined;
  let adopted = false;
  if (existing) {
    if (existing.parkTimer) {
      // 寄存中(上一个 socket 已断):认领,常驻进程与后台任务原样接管
      clearTimeout(existing.parkTimer);
      existing.parkTimer = null;
      logger.info(
        `认领寄存会话 (${projectPath}) activeSessionId=${existing.activeSessionId}`,
      );
    } else {
      // 仍活着(半开重连 / 双开标签页):接管其引擎,并 detach 旧 socket 的监听器,
      // 让旧 socket 的 close 成为空操作,运行中的任务转交给本连接不被误杀。
      logger.info(
        `接管活跃会话 (${projectPath}) activeSessionId=${existing.activeSessionId}`,
      );
      existing.detach();
    }
    adopted = true;
  }

  const session: ProjectSession = existing ?? {
    claude: new ClaudeAgentService(),
    codex: new CodexAgentService(),
    activeSessionId: null,
    activeEngine: null,
    activeCompat: null,
    activeModel: null,
    pendingAttachmentIds: [],
    workflowRun: null,
    detach: () => {},
    parkTimer: null,
    missedTerminal: null,
  };
  const { claude, codex } = session;

  /** 本次连接是否已被更新的连接接管(接管后本 socket 的 close 不应收尾/寄存)。 */
  let superseded = false;
  /** 关标签时客户端先发 "shutdown":标记显式关闭,close 时立即收尾不寄存。 */
  let explicitShutdown = false;

  const forward = (event: string, data: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(serverMsg(event, data));
      return;
    }
    // socket 不在时事件只能丢。但**终态事件丢不得**:前端的 isStreaming 要靠
    // 它才能落下来。典型场景是网络闪断(非页面刷新,前端 isStreaming 仍为 true),
    // 断开期间这一轮跑完了 —— task_complete 被丢弃、claude.turnActive 随之变 false,
    // 于是重连时下面那段以 isTurnActive() 为条件的重同步也不触发,
    // 结果前端永远停在「正在思考…」,而任务其实早就结束了。
    // 记下最后一个被丢弃的终态,重连认领时补发。
    if (TERMINAL_EVENTS.has(event)) {
      session.missedTerminal = { event, data, at: Date.now() };
    }
    logger.warn(
      `[forward] Socket not open (state=${ws.readyState}), dropping event: ${event}`,
    );
  };

  // ── Claude 引擎事件转发 ──
  claude.on("session_init", (d) => {
    session.activeSessionId = d.sessionId;
    if (d.model) session.activeModel = d.model as string;
    // 新一轮开始，上一轮遗留的待补发终态作废 —— 否则重连时会冒出一条属于
    // 上一轮的任务结果卡片，看起来像刚发的消息瞬间就结束了。
    session.missedTerminal = null;
    registerAgent(d.sessionId, claude);
    updateSessionId(projectPath, d.sessionId);
    forward("session_init", d);
  });

  claude.on("assistant_text", (d) => forward("assistant_text", d));
  claude.on("assistant_thinking", (d) => forward("assistant_thinking", d));
  claude.on("new_turn", (d) => forward("new_turn", d));
  claude.on("tool_use_start", (d) => forward("tool_use_start", d));
  claude.on("tool_input_complete", (d) => forward("tool_input_complete", d));
  claude.on("tool_use_result", (d) => forward("tool_use_result", d));
  claude.on("context_compact", (d) => forward("context_compact", d));
  claude.on("context_usage", (d) => forward("context_usage", d));

  claude.on("task_complete", (d) => {
    markDone(projectPath, d.sessionId as string); // 本轮任务正常收官,撤销"运行中"登记
    forward("task_complete", d);
    // Do NOT reset activeSessionId here — it breaks session resume for the next
    // message. The session stays valid until the process closes.
  });

  claude.on("close", (d) => {
    markDone(projectPath, (d.sessionId as string) || session.activeSessionId);
    forward("process_close", d);
    // Cleanup attachment temp files only after process fully exits,
    // giving Claude enough time to read them via its Read tool.
    if (session.pendingAttachmentIds.length > 0) {
      cleanupFiles(session.pendingAttachmentIds, projectPath);
      session.pendingAttachmentIds = [];
    }
    if (session.activeSessionId) {
      unregisterAgent(session.activeSessionId);
    }
    session.activeSessionId = null;
  });

  claude.on("error", (d) => forward("error", d));
  claude.on("process_stderr", (d) => forward("process_stderr", d));
  // F1.13:审计时间线事件(SDK 进程内 hooks 只读观察)
  claude.on("hook_event", (d) => forward("hook_event", d));
  // workflow/后台 agent 生命周期(task_started / task_notification / background_tasks_changed)
  claude.on("background_task_event", (d) =>
    forward("background_task_event", d),
  );

  // ── HIL 权限请求 ──
  // 安全工具(Read/Grep/… )已在服务层自动放行、不会到达这里(见 claudeAgentService
  // 的 AUTO_APPROVE_TOOLS);能到这里的都是需用户确认的危险工具,直接转发前端。
  claude.on("permission_request", (d: PermissionRequest) => {
    forward("permission_request", d as unknown as Record<string, unknown>);
    logger.info(`Permission requested for ${d.toolName} (${d.requestId})`);
  });

  // 60s 超时后服务层已自动拒绝并放行流程,必须同步告诉前端,否则权限卡会永远
  // 停在「等待确认」:后续到达的 tool_use_result 也救不回来(前端那个 handler
  // 只处理 status === "running" 的卡片,而超时卡片仍是 awaiting_permission),
  // 用户此时再点「允许」,requestId 早已失效,只会在服务端留一条 unknown request。
  // 前端 useWebSocket 的 permission_timeout 分支一直是写好的,只差这条转发。
  claude.on("permission_timeout", (d) => forward("permission_timeout", d));

  // ── Codex 引擎事件转发（无 assistant_thinking/new_turn/context_compact/
  //    permission_request —— codex exec 非交互模式不产出这些事件） ──
  codex.on("session_init", (d) => {
    session.activeSessionId = d.sessionId;
    updateSessionId(projectPath, d.sessionId);
    forward("session_init", d);
  });
  codex.on("assistant_text", (d) => forward("assistant_text", d));
  codex.on("tool_use_start", (d) => forward("tool_use_start", d));
  codex.on("tool_use_result", (d) => forward("tool_use_result", d));
  codex.on("context_usage", (d) => forward("context_usage", d));

  codex.on("task_complete", (d) => {
    markDone(projectPath, d.sessionId as string);
    forward("task_complete", d);
    // 同 Claude：不在这里重置 activeSessionId，保持可 resume。
  });

  codex.on("close", (d) => {
    markDone(projectPath, (d.sessionId as string) || session.activeSessionId);
    forward("process_close", d);
    if (session.pendingAttachmentIds.length > 0) {
      cleanupFiles(session.pendingAttachmentIds, projectPath);
      session.pendingAttachmentIds = [];
    }
    session.activeSessionId = null;
  });

  codex.on("error", (d) => forward("error", d));
  codex.on("process_stderr", (d) => forward("process_stderr", d));

  // 绑定「解绑当前 socket」的钩子:被更新连接接管时调用——摘掉本 socket 的所有监听器,
  // 并把 superseded 置真让本 socket 的 close 成为空操作(不收尾、不寄存)。
  session.detach = () => {
    superseded = true;
    claude.removeAllListeners();
    codex.removeAllListeners();
  };

  if (projectPath) sessionsByProject.set(projectPath, session);

  // ── 断线重连/接管后的状态重同步 ──
  // 新客户端(尤其页面刷新后)本地 isStreaming=false、currentAssistantId=null,若此刻正有
  // 一轮任务在跑,它收到的 assistant_text 会被丢弃、且无停止按钮/运行指示。补发一个
  // session_init 让它重新进入流式态;并把尚未决断的权限请求重放出来,不让危险工具确认
  // 卡在无人看的缓冲里直到 60s 超时。
  // 先补发断线期间丢掉的终态。它处理的正是下面那段覆盖不到的情况:
  // 闪断中这一轮跑完了 → turnActive 已变 false → 以 isTurnActive() 为条件的
  // 重同步不触发 → 前端永远停在「正在思考…」。
  if (adopted && session.missedTerminal) {
    const missed = session.missedTerminal;
    session.missedTerminal = null;
    if (Date.now() - missed.at <= MISSED_TERMINAL_TTL_MS) {
      logger.info(`[resync] 补发断线期间丢失的终态: ${missed.event}`);
      forward(missed.event, missed.data);
    } else {
      logger.info(`[resync] 丢弃过期的终态(${missed.event}),不再补发`);
    }
  }

  if (adopted && session.activeEngine === "claude" && claude.isTurnActive()) {
    const sid = claude.getActiveSessionId() ?? session.activeSessionId;
    if (sid) {
      forward("session_init", {
        sessionId: sid,
        model: session.activeModel ?? undefined,
        resumed: true,
      });
      for (const req of claude.getPendingRequests()) {
        forward(
          "permission_request",
          req as unknown as Record<string, unknown>,
        );
      }
    }
  }

  // 工作流在断线期间会继续跑(与运行中任务的寄存语义一致),但期间推送的状态
  // 都被丢弃了。重连时补发一次当前状态,否则用户看到的是一个永远停在旧进度、
  // 或干脆空白的面板 —— 而后台其实正跑着。
  if (adopted && session.workflowRun) {
    forward(
      "workflow_state",
      session.workflowRun.getState() as unknown as Record<string, unknown>,
    );
  }

  /**
   * 处理一条客户端消息。
   *
   * 提取成命名函数是为了让工作流编排能**走完全相同的入口**执行每一步 ——
   * send_message 分支里那两百行(代理、供应商解析、附件、进程指纹、resume 判定)
   * 一旦被复制一份出来，两边就会各自漂移；而漏带任何一个字段都会让常驻进程
   * 指纹对不上，白白杀进程重启。所以编排不复制它，直接复用。
   */
  const handleClientMessage = async (msg: ClientMessage): Promise<void> => {
    logger.info(`WS action: ${msg.action}`);

    switch (msg.action) {
      case "send_message": {
        const p = msg.payload;
        if (!projectPath || !projectPath.trim()) {
          forward("error", {
            code: "NO_PROJECT",
            message: "请先在侧栏选择项目文件夹，再开始对话",
          });
          break;
        }
        try {
          const proxy = await readProxy();
          let prompt = p.prompt as string;
          // 前端运行模式 id 已与 SDK 原生 permissionMode 一一对应：
          //   default           → 工具走 HIL 确认（询问权限）
          //   acceptEdits       → 自动接受文件编辑
          //   plan              → 规划模式，禁止修改文件/执行命令
          //   bypassPermissions → 全自动放行
          const runMode = (p.runMode as string) || "default";
          const permissionMode = (
            ["default", "acceptEdits", "plan", "bypassPermissions"].includes(
              runMode,
            )
              ? runMode
              : "default"
          ) as "default" | "acceptEdits" | "plan" | "bypassPermissions";

          // Handle attachments — paths are relative to projectPath (the spawn
          // cwd), using UUID filenames with no spaces to avoid cmd.exe
          // truncation. 拼 prompt 的方式按引擎分流(见下方各引擎分支):
          //   - Claude:全部路径拼进 prompt,由 Read 工具读取(图片自动 base64 视觉)
          //   - Codex:图片走 `--image` 原生多模态,其余路径拼 prompt 由 shell 读
          const attachmentPaths = (p.attachmentPaths as string[]) || [];
          const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
          if (attachmentPaths.length > 0) {
            // Extract IDs from relative path for cleanup later
            session.pendingAttachmentIds = attachmentPaths.map((fp) => {
              const basename = fp.split("/").pop() || "";
              return basename.replace(/\.[^.]+$/, "");
            });
          }

          // ── 供应商解析 ──
          // 新客户端传 providerId(anthropic/openai/deepseek/minimax/kimi/glm/custom-*);
          // 旧客户端只传 engine("claude"|"codex"),向后兼容。
          const providerId = (p.providerId as string) || "";
          const provider = providerId ? await getProvider(providerId) : null;
          if (providerId && !provider) {
            forward("error", {
              code: "UNKNOWN_PROVIDER",
              message: `未知供应商: ${providerId}`,
            });
            break;
          }
          const isCompat = provider?.kind === "anthropic-compat";
          if (isCompat && !provider?.apiKey) {
            forward("error", {
              code: "PROVIDER_NOT_CONFIGURED",
              message: `${provider?.name ?? providerId} 尚未配置 API Key,请到「设置 → 模型供应商」填写`,
            });
            break;
          }
          const engine: "claude" | "codex" = provider
            ? provider.kind === "codex"
              ? "codex"
              : "claude"
            : (p.engine as string) === "codex"
              ? "codex"
              : "claude";
          // 用户中途切换了引擎：Claude 的 session id 传给 codex exec resume 会
          // 直接报错（反之亦然），丢弃客户端带来的 sessionId/forkSession，开新会话。
          const crossEngineSwitch =
            session.activeEngine !== null && session.activeEngine !== engine;
          // 历史遗留防护:opencode 时期产生的 "ses_" 前缀会话 id 对 Claude/Codex 无效,丢弃
          let clientSessionId = crossEngineSwitch
            ? undefined
            : (p.sessionId as string) || undefined;
          if (clientSessionId?.startsWith("ses_")) clientSessionId = undefined;
          // 客户端发送时正处于流式中 = 这条是对当前活跃会话的续发(哪怕 session_init 还没
          // 回传、拿不到 sessionId)。带此标记让服务层排队复用常驻进程,而不是误杀正在跑的任务。
          const continueActive = !crossEngineSwitch && !!p.continueActive;

          if (engine === "codex") {
            const codexEffort = (p.codexEffort as string) || undefined;
            // 新客户端(带 providerId)统一用 model 字段;旧客户端仍用 codexModel,
            // 此时 p.model 是 Claude 侧别名(opus/sonnet),不能误传给 Codex。
            const codexModel = provider
              ? (p.model as string) || provider.defaultModel || undefined
              : (p.codexModel as string) || undefined;
            // 图片附件走 `--image` 原生多模态;Spark 是纯文本模型,回退为路径文本。
            const sparkTextOnly = /spark/i.test(codexModel ?? "");
            const imagePaths = sparkTextOnly
              ? []
              : attachmentPaths.filter((fp) => IMAGE_EXT_RE.test(fp));
            const promptRefs = attachmentPaths.filter(
              (fp) => !imagePaths.includes(fp),
            );
            let codexPrompt = prompt;
            if (promptRefs.length > 0)
              codexPrompt += " (附件：" + promptRefs.join(" ") + ")";
            const sid = await codex.start({
              prompt: codexPrompt,
              projectPath,
              sessionId: clientSessionId,
              model: codexModel,
              effort: ["minimal", "low", "medium", "high", "xhigh"].includes(
                codexEffort ?? "",
              )
                ? (codexEffort as
                    "minimal" | "low" | "medium" | "high" | "xhigh")
                : undefined,
              permissionMode,
              images: imagePaths.length > 0 ? imagePaths : undefined,
            });
            session.activeSessionId = sid;
            session.activeEngine = "codex";
            session.activeCompat = null;
            registerRunning({
              projectPath,
              engine: "codex",
              sessionId: sid,
              promptSnippet: (p.prompt as string).slice(0, 120),
              startedAt: Date.now(),
            });
          } else {
            // 推理力度：前端可能传六档之一。第六档 "ultracode" 不是 API 真实 effort 值，
            // 需翻译为 effort:"xhigh" + ultracode:true（= xhigh + 动态工作流编排）。
            const rawEffort = (p.effort as string) || undefined;
            const ultracode = rawEffort === "ultracode";
            const effort = ultracode
              ? ("xhigh" as const)
              : ["low", "medium", "high", "xhigh", "max"].includes(
                    rawEffort ?? "",
                  )
                ? (rawEffort as "low" | "medium" | "high" | "xhigh" | "max")
                : undefined;

            const model =
              (p.model as string) ||
              (isCompat ? provider?.defaultModel : undefined) ||
              undefined;
            // Claude:全部附件路径拼进 prompt,由 Read 工具读取(图片自动 base64 视觉)
            if (attachmentPaths.length > 0) {
              prompt += " (附件：" + attachmentPaths.join(" ") + ")";
            }
            const sid = await claude.start({
              prompt,
              projectPath,
              sessionId: clientSessionId,
              continueActive: continueActive || undefined,
              forkSession: crossEngineSwitch
                ? undefined
                : (p.forkSession as boolean) || undefined,
              model,
              effort,
              ultracode: ultracode || undefined,
              permissionMode,
              maxBudget: (p.maxBudget as number) || undefined,
              // F1.10:自动降级备用模型(仅官方端点)
              fallbackModel: deriveFallbackModel(model, isCompat),
              // F1.11:扩展思考开关。只有前端显式传 false 才算「关」——
              // 缺省(旧客户端/内部调用)保持原行为,不因为没传就把思考关掉。
              thinking: p.thinking === false ? false : undefined,
              // 扩展思考预算(>0 才注入,0/缺省 = SDK adaptive)
              thinkingBudget:
                typeof p.thinkingBudget === "number" && p.thinkingBudget > 0
                  ? p.thinkingBudget
                  : undefined,
              // F1.12:MCP 配置版本,变化即换进程使新配置生效
              mcpVersion: getMcpConfigVersion(),
              // 第三方兼容供应商:注入 baseUrl + authToken,不再使用官方 apiKey
              baseUrl: isCompat ? provider?.baseUrl : undefined,
              authToken: isCompat ? provider?.apiKey : undefined,
              apiKey: isCompat ? undefined : (p.apiKey as string) || undefined,
              httpProxy: proxy.httpProxy || undefined,
              httpsProxy: proxy.httpsProxy || undefined,
            });
            session.activeSessionId = sid;
            session.activeEngine = "claude";
            session.activeModel = model ?? null;
            registerRunning({
              projectPath,
              engine: "claude",
              sessionId: sid,
              promptSnippet: (p.prompt as string).slice(0, 120),
              startedAt: Date.now(),
            });
            session.activeCompat =
              isCompat && provider?.baseUrl
                ? {
                    baseUrl: provider.baseUrl,
                    authToken: provider.apiKey,
                    model,
                  }
                : null;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          forward("error", { code: "START_FAILED", message });
        }
        break;
      }

      case "abort": {
        // 新会话的第一条消息发出后、session_init 回来之前,session.activeSessionId
        // 还是 null —— 而 send_message 分支要连过读代理、取供应商、claude.start()
        // 三个 await(几百毫秒到 2 秒),abort 却是同步的。用户「误发了立刻点停止」
        // 恰好落在这个窗口里,原先整个分支空转,连 aborted 都不发,任务照常跑起来,
        // 用户得点第二次才有效。
        // 服务层自己知道当前活跃会话,拿它兜底即可闭合这个窗口。
        if (!session.activeSessionId) {
          const liveId = claude.getActiveSessionId();
          if (liveId) session.activeSessionId = liveId;
        }
        markDone(projectPath, session.activeSessionId); // 用户主动中止,不算"被中止"
        if (session.activeSessionId) {
          if (session.activeEngine === "codex") {
            codex.abort(session.activeSessionId);
            forward("aborted", { sessionId: session.activeSessionId });
            session.activeSessionId = null;
          } else {
            // 常驻进程模型:只中断当前轮,进程与后台 sub-agent 保留,会话可继续。
            // 不清 activeSessionId——进程还活着,ws 关闭时仍需按它收尾。
            claude.interrupt(session.activeSessionId);
            forward("aborted", { sessionId: session.activeSessionId });
          }
        }
        break;
      }

      case "permission_response": {
        const reqId = msg.payload.requestId as string;
        const decision = msg.payload.decision as "allow" | "deny";
        const reason = msg.payload.reason as string | undefined;
        const alwaysAllow = msg.payload.alwaysAllow as boolean | undefined;
        if (reqId) {
          const resolved = claude.resolvePermission(
            reqId,
            decision,
            reason,
            !!alwaysAllow,
          );
          if (!resolved) {
            logger.warn(`Permission response for unknown request: ${reqId}`);
          }
        }
        break;
      }

      case "compact": {
        if (session.activeEngine === "codex") {
          forward("error", {
            code: "UNSUPPORTED",
            message: "Codex 暂不支持 /compact",
          });
          break;
        }
        const instructions = (msg.payload.instructions as string) || "";
        // Prefer client-provided sessionId (survives server-side activeSessionId resets)
        const clientSessionId = (msg.payload.sessionId as string) || undefined;
        const compactPrompt = instructions
          ? `/compact ${instructions}`
          : "/compact";
        // 会话有常驻进程时直接把 /compact 推入其输入队列(不重启、不打断后台任务)
        if (
          claude.sendMessage(
            clientSessionId || session.activeSessionId,
            compactPrompt,
          )
        ) {
          break;
        }
        try {
          const proxy = await readProxy();
          await claude.start({
            prompt: compactPrompt,
            projectPath,
            sessionId: clientSessionId || session.activeSessionId || undefined,
            // 会话在第三方端点上跑时,压缩请求也必须发往同一端点
            baseUrl: session.activeCompat?.baseUrl,
            authToken: session.activeCompat?.authToken,
            model: session.activeCompat?.model,
            // 与主发送路径对齐,避免此路径新建的常驻进程指纹"单薄"、
            // 下一条正常消息因指纹不符再多换一次进程
            mcpVersion: getMcpConfigVersion(),
            fallbackModel: deriveFallbackModel(
              session.activeCompat?.model ?? session.activeModel ?? undefined,
              !!session.activeCompat,
            ),
            httpProxy: proxy.httpProxy || undefined,
            httpsProxy: proxy.httpsProxy || undefined,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          forward("error", { code: "COMPACT_FAILED", message });
        }
        break;
      }

      case "shutdown": {
        // 关标签的显式收尾信号:close 时立即杀任务,不进入寄存宽限期
        explicitShutdown = true;
        break;
      }

      // ── 工作流编排 ──

      case "workflow_start": {
        const p = msg.payload as Record<string, unknown>;
        if (!projectPath?.trim()) {
          forward("error", { code: "NO_PROJECT", message: "请先选择项目" });
          break;
        }
        if (session.workflowRun) {
          forward("error", {
            code: "WORKFLOW_BUSY",
            message: "已有工作流在运行，请先停止它",
          });
          break;
        }

        const workflowId = typeof p.workflowId === "string" ? p.workflowId : "";
        if (!workflowId) {
          forward("error", { code: "INVALID_REQUEST", message: "缺少 workflowId" });
          break;
        }

        const workflow = await new WorkflowService().getWorkflow(projectPath, workflowId);
        if (!workflow) {
          forward("error", { code: "NOT_FOUND", message: "工作流不存在" });
          break;
        }

        // 引擎参数由前端按 buildEngineParams() 传来，与手动发消息完全同源。
        // 每一步都用这同一组参数，避免中途换参数导致常驻进程指纹变化、白白重启。
        const engineParams = (p.engineParams ?? {}) as Record<string, unknown>;
        const inputs = (p.inputs ?? {}) as Record<string, string>;

        const runner = new ClaudeStepRunner({
          startTurn: async ({ prompt, agent }) => {
            // 关键:走 handleClientMessage 而不是自己拼 claude.start ——
            // send_message 分支里的代理/供应商/指纹逻辑一个字都不必复制。
            await handleClientMessage({
              action: "send_message",
              payload: {
                ...engineParams,
                // ⚠️ 这是「点名」不是「分派」:只是把 Agent 名字写进提示词，
                // 模型完全可以无视它自己把活干了，填一个不存在的 Agent 名也
                // 不会报错(已实测确认)。真正的强制分派要在 SDK 的 agents
                // (AgentDefinition)层面声明并约束调用,属后续改进。
                // 改这里之前先读 REQUIREMENTS.md F5.3 那条已知限制。
                prompt: agent ? `请使用 ${agent} 这个 Agent 完成：${prompt}` : prompt,
                sessionId: session.activeSessionId ?? undefined,
                // 工作流的后续步骤是同一会话的连续轮次
                continueActive: undefined,
              },
            } as ClientMessage);
          },
          interrupt: () => {
            if (session.activeSessionId) claude.interrupt(session.activeSessionId);
          },
          on: (event: string, handler: (p: never) => void) => {
            const h = handler as (...args: unknown[]) => void;
            claude.on(event, h);
            return () => claude.off(event, h);
          },
        });

        const engine = new WorkflowEngine({
          workflow,
          inputs,
          runner,
          onChange: (state) => forward("workflow_state", state as unknown as Record<string, unknown>),
        });
        session.workflowRun = engine;
        logger.info(`[workflow] 开始运行「${workflow.name}」共 ${workflow.steps.length} 步`);

        // 不 await:编排是长任务，await 会把这条 WS 消息的处理堵死。
        // 状态经 onChange 持续推送，结束后清空 workflowRun 释放占用。
        void engine
          .run()
          .catch((err) => {
            logger.error(`[workflow] 运行异常`, err instanceof Error ? err.stack : String(err));
            forward("error", {
              code: "WORKFLOW_ERROR",
              message: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => {
            if (session.workflowRun === engine) session.workflowRun = null;
          });
        break;
      }

      case "workflow_resolve": {
        const p = msg.payload as Record<string, unknown>;
        const decision = p.resolution;
        if (decision !== "retry" && decision !== "skip" && decision !== "abort") {
          forward("error", { code: "INVALID_REQUEST", message: "无效的处置指令" });
          break;
        }
        if (!session.workflowRun?.resolve(decision)) {
          // 没有待处置项:多半是用户点了两次，或运行已结束。不算错误。
          logger.info(`[workflow] 忽略处置指令 ${decision}(当前无待处置步骤)`);
        }
        break;
      }

      case "workflow_abort": {
        session.workflowRun?.abort();
        break;
      }

      default:
        forward("error", {
          code: "UNKNOWN_ACTION",
          message: `Unknown action: ${msg.action}`,
        });
    }
  };

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      forward("error", { code: "INVALID_JSON", message: "Invalid JSON" });
      return;
    }
    await handleClientMessage(msg);
  });

  ws.on("close", () => {
    // 已被更新的连接接管:本 socket 的监听器早已被 detach 摘除,不收尾也不寄存。
    if (superseded) {
      logger.info(`WS chat connection closed (superseded by newer connection)`);
      return;
    }

    // 关标签(显式 shutdown)或没有项目路径:立即收尾,此时才该摘监听器
    if (explicitShutdown || !projectPath) {
      claude.removeAllListeners();
      codex.removeAllListeners();
      teardownSession(projectPath, session);
      logger.info("WS chat connection closed (explicit shutdown)");
      return;
    }

    // 寄存路径**不能**摘监听器。
    //
    // 原先这两行在最前面无条件执行，于是 30 秒宽限期内引擎发的一切都无人接收，
    // 一连串后果全被这一行制造出来：
    //   1. task_complete / close 走不到 forward → missedTerminal 永远记不上
    //      → 「重连补发终态」那套机制**从来没有可达过**（它的单测测的是复刻出来
    //         的规则函数，不是这条接线，所以全绿也说明不了问题）
    //   2. markDone 不执行 → taskRegistry 里 running 记录留着 → 寄存超时
    //      interruptProject 把一个**已正常完成**的任务记成"被中止"，
    //      下次启动弹出假提醒
    //   3. 附件清理不执行 → 临时文件永久堆积
    //   4. 工作流的 step runner 监听器一并被清空 → runStep 的 Promise 永不 settle
    //      → 断线一次工作流就永久卡住，且 session.workflowRun 不释放，
    //        此后 workflow_start 恒返回 WORKFLOW_BUSY
    // 而注释里一直宣称"工作流在断线期间会继续跑" —— 实际是断线即死。
    //
    // 监听器留着即可：forward 在 socket 不 OPEN 时会走 missedTerminal 分支，
    // 本来就是为这个场景写的。真正的清理在 teardownSession（寄存超时或被认领）。

    // 页面刷新/重载/网络闪断:session 寄存等待同项目新连接认领,常驻进程与后台任务存活。
    // (注册表每项目仅一条 session,双开/半开重连已由 open 时的接管路径处理,此处必是唯一。)
    session.parkTimer = setTimeout(() => {
      session.parkTimer = null;
      interruptProject(projectPath); // 无人认领即被杀:若有任务在跑,记为被中止供重启提醒
      teardownSession(projectPath, session);
      logger.info(`寄存超时无人认领,收尾引擎 (${projectPath})`);
    }, PARK_GRACE_MS);
    session.parkTimer.unref();
    logger.info(
      `WS 断开,会话寄存 ${PARK_GRACE_MS / 1000}s 等待重连 (${projectPath})`,
    );
  });
}
