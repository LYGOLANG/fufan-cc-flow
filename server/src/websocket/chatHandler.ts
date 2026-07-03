import type { WebSocket } from "ws";
import { ClaudeAgentService } from "../services/claudeAgentService.js";
import { CodexAgentService } from "../services/codexAgentService.js";
import { registerAgent, unregisterAgent } from "../services/agentRegistry.js";
import { readProxy } from "../services/proxyConfig.js";
import { getProvider } from "../services/providerService.js";
import { cleanupFiles } from "../services/attachmentService.js";
import { serverMsg } from "./protocol.js";
import { logger } from "../utils/logger.js";
import type { ClientMessage, PermissionRequest } from "../types/api.js";

/** Tools that are auto-approved (read-only / low-risk) */
const AUTO_APPROVE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TodoRead", "Task", "Agent", "TodoWrite",
  "NotebookRead", "LS",
]);

export function handleChatConnection(ws: WebSocket, projectPath: string) {
  const claude = new ClaudeAgentService();
  const codex = new CodexAgentService();
  let activeSessionId: string | null = null;
  // 记录当前会话由哪个引擎发起的最近一轮消息 —— send_message 时若客户端切换了
  // 引擎，需要丢弃跨引擎的 sessionId（Claude 的 session id 传给 codex exec resume
  // 会直接报错，反之亦然），改为开一个全新会话。
  let activeEngine: "claude" | "codex" | null = null;
  // 当前会话使用的 Anthropic 兼容端点(第三方供应商)。/compact 等后续请求
  // 必须复用同一端点,否则 resume 会把请求发回官方 API。
  let activeCompat: { baseUrl: string; authToken?: string; model?: string } | null = null;

  const forward = (event: string, data: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(serverMsg(event, data));
    } else {
      logger.warn(`[forward] Socket not open (state=${ws.readyState}), dropping event: ${event}`);
    }
  };

  claude.on("session_init", (d) => {
    activeSessionId = d.sessionId;
    registerAgent(d.sessionId, claude);
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

  // Track attachment IDs per message for cleanup
  let pendingAttachmentIds: string[] = [];

  claude.on("task_complete", (d) => {
    forward("task_complete", d);
    // Do NOT reset activeSessionId here — it breaks session resume for
    // the next message.  The session stays valid until the process closes.
  });

  claude.on("close", (d) => {
    forward("process_close", d);
    // Cleanup attachment temp files only after process fully exits,
    // giving Claude enough time to read them via its Read tool.
    if (pendingAttachmentIds.length > 0) {
      cleanupFiles(pendingAttachmentIds, projectPath);
      pendingAttachmentIds = [];
    }
    if (activeSessionId) {
      unregisterAgent(activeSessionId);
    }
    activeSessionId = null;
  });

  claude.on("error", (d) => forward("error", d));
  claude.on("process_stderr", (d) => forward("process_stderr", d));

  // ── HIL 权限请求处理 ──
  claude.on("permission_request", (d: PermissionRequest) => {
    if (AUTO_APPROVE_TOOLS.has(d.toolName)) {
      // 安全工具自动批准
      claude.resolvePermission(d.requestId, "allow");
      logger.debug(`Auto-approved tool: ${d.toolName} (${d.requestId})`);
    } else {
      // 危险工具转发给前端等待用户确认
      forward("permission_request", d as unknown as Record<string, unknown>);
      logger.info(`Permission requested for ${d.toolName} (${d.requestId})`);
    }
  });

  // ── Codex 引擎事件转发（无 assistant_thinking/new_turn/context_compact/
  //    permission_request —— codex exec 非交互模式不产出这些事件） ──
  codex.on("session_init", (d) => {
    activeSessionId = d.sessionId;
    forward("session_init", d);
  });
  codex.on("assistant_text", (d) => forward("assistant_text", d));
  codex.on("tool_use_start", (d) => forward("tool_use_start", d));
  codex.on("tool_use_result", (d) => forward("tool_use_result", d));
  codex.on("context_usage", (d) => forward("context_usage", d));

  codex.on("task_complete", (d) => {
    forward("task_complete", d);
    // 同 Claude：不在这里重置 activeSessionId，保持可 resume。
  });

  codex.on("close", (d) => {
    forward("process_close", d);
    if (pendingAttachmentIds.length > 0) {
      cleanupFiles(pendingAttachmentIds, projectPath);
      pendingAttachmentIds = [];
    }
    activeSessionId = null;
  });

  codex.on("error", (d) => forward("error", d));
  codex.on("process_stderr", (d) => forward("process_stderr", d));

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      forward("error", { code: "INVALID_JSON", message: "Invalid JSON" });
      return;
    }

    logger.info(`WS action: ${msg.action}`);

    switch (msg.action) {
      case "send_message": {
        const p = msg.payload;
        if (!projectPath || !projectPath.trim()) {
          forward("error", { code: "NO_PROJECT", message: "请先在侧栏选择项目文件夹，再开始对话" });
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
            ["default", "acceptEdits", "plan", "bypassPermissions"].includes(runMode)
              ? runMode
              : "default"
          ) as "default" | "acceptEdits" | "plan" | "bypassPermissions";

          // Handle attachments — append relative file paths to the prompt.
          // Claude/Codex will use their shell/Read tool to read these files
          // (images are auto-base64-encoded for vision analysis, Claude-only).
          // Paths are relative to projectPath (the spawn cwd), using UUID
          // filenames with no spaces to avoid cmd.exe truncation.
          const attachmentPaths = (p.attachmentPaths as string[]) || [];
          if (attachmentPaths.length > 0) {
            // Extract IDs from relative path for cleanup later
            pendingAttachmentIds = attachmentPaths.map((fp) => {
              const basename = fp.split("/").pop() || "";
              return basename.replace(/\.[^.]+$/, "");
            });
            const refs = attachmentPaths.join(" ");
            prompt += " (附件：" + refs + ")";
          }

          // ── 供应商解析 ──
          // 新客户端传 providerId(anthropic/openai/deepseek/minimax/kimi/glm/custom-*);
          // 旧客户端只传 engine("claude"|"codex"),向后兼容。
          const providerId = (p.providerId as string) || "";
          const provider = providerId ? await getProvider(providerId) : null;
          if (providerId && !provider) {
            forward("error", { code: "UNKNOWN_PROVIDER", message: `未知供应商: ${providerId}` });
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
            ? (provider.kind === "codex" ? "codex" : "claude")
            : ((p.engine as string) === "codex" ? "codex" : "claude");
          // 用户中途切换了引擎：Claude 的 session id 传给 codex exec resume 会
          // 直接报错（反之亦然），丢弃客户端带来的 sessionId/forkSession，开新会话。
          const crossEngineSwitch = activeEngine !== null && activeEngine !== engine;
          // 历史遗留防护:opencode 时期产生的 "ses_" 前缀会话 id 对 Claude/Codex 无效,丢弃
          let clientSessionId = crossEngineSwitch ? undefined : (p.sessionId as string) || undefined;
          if (clientSessionId?.startsWith("ses_")) clientSessionId = undefined;

          if (engine === "codex") {
            const codexEffort = (p.codexEffort as string) || undefined;
            const sid = await codex.start({
              prompt,
              projectPath,
              sessionId: clientSessionId,
              // 新客户端(带 providerId)统一用 model 字段;旧客户端仍用 codexModel,
              // 此时 p.model 是 Claude 侧别名(opus/sonnet),不能误传给 Codex。
              model: provider
                ? ((p.model as string) || provider.defaultModel || undefined)
                : ((p.codexModel as string) || undefined),
              effort: ["low", "medium", "high", "xhigh"].includes(codexEffort ?? "")
                ? (codexEffort as "low" | "medium" | "high" | "xhigh")
                : undefined,
              permissionMode,
            });
            activeSessionId = sid;
            activeEngine = "codex";
            activeCompat = null;
          } else {
            // 推理力度：前端可能传六档之一。第六档 "ultracode" 不是 API 真实 effort 值，
            // 需翻译为 effort:"xhigh" + ultracode:true（= xhigh + 动态工作流编排）。
            const rawEffort = (p.effort as string) || undefined;
            const ultracode = rawEffort === "ultracode";
            const effort = ultracode
              ? ("xhigh" as const)
              : (["low", "medium", "high", "xhigh", "max"].includes(rawEffort ?? "")
                  ? (rawEffort as "low" | "medium" | "high" | "xhigh" | "max")
                  : undefined);

            const model = (p.model as string) || (isCompat ? provider?.defaultModel : undefined) || undefined;
            const sid = await claude.start({
              prompt,
              projectPath,
              sessionId: clientSessionId,
              forkSession: crossEngineSwitch ? undefined : (p.forkSession as boolean) || undefined,
              model,
              effort,
              ultracode: ultracode || undefined,
              permissionMode,
              maxBudget: (p.maxBudget as number) || undefined,
              // 第三方兼容供应商:注入 baseUrl + authToken,不再使用官方 apiKey
              baseUrl: isCompat ? provider?.baseUrl : undefined,
              authToken: isCompat ? provider?.apiKey : undefined,
              apiKey: isCompat ? undefined : (p.apiKey as string) || undefined,
              httpProxy: proxy.httpProxy || undefined,
              httpsProxy: proxy.httpsProxy || undefined,
              socksProxy: proxy.socksProxy || undefined,
            });
            activeSessionId = sid;
            activeEngine = "claude";
            activeCompat = isCompat && provider?.baseUrl
              ? { baseUrl: provider.baseUrl, authToken: provider.apiKey, model }
              : null;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          forward("error", { code: "START_FAILED", message });
        }
        break;
      }

      case "abort": {
        if (activeSessionId) {
          if (activeEngine === "codex") {
            codex.abort(activeSessionId);
          } else {
            claude.abort(activeSessionId);
          }
          forward("aborted", { sessionId: activeSessionId });
          activeSessionId = null;
        }
        break;
      }

      case "permission_response": {
        const reqId = msg.payload.requestId as string;
        const decision = msg.payload.decision as "allow" | "deny";
        const reason = msg.payload.reason as string | undefined;
        const alwaysAllow = msg.payload.alwaysAllow as boolean | undefined;
        if (reqId) {
          const resolved = claude.resolvePermission(reqId, decision, reason, !!alwaysAllow);
          if (!resolved) {
            logger.warn(`Permission response for unknown request: ${reqId}`);
          }
        }
        break;
      }

      case "compact": {
        if (activeEngine === "codex") {
          forward("error", { code: "UNSUPPORTED", message: "Codex 暂不支持 /compact" });
          break;
        }
        const instructions = (msg.payload.instructions as string) || "";
        // Prefer client-provided sessionId (survives server-side activeSessionId resets)
        const clientSessionId = (msg.payload.sessionId as string) || undefined;
        const compactPrompt = instructions
          ? `/compact ${instructions}`
          : "/compact";
        try {
          const proxy = await readProxy();
          await claude.start({
            prompt: compactPrompt,
            projectPath,
            sessionId: clientSessionId || activeSessionId || undefined,
            // 会话在第三方端点上跑时,压缩请求也必须发往同一端点
            baseUrl: activeCompat?.baseUrl,
            authToken: activeCompat?.authToken,
            model: activeCompat?.model,
            httpProxy: proxy.httpProxy || undefined,
            httpsProxy: proxy.httpsProxy || undefined,
            socksProxy: proxy.socksProxy || undefined,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          forward("error", { code: "COMPACT_FAILED", message });
        }
        break;
      }

      default:
        forward("error", {
          code: "UNKNOWN_ACTION",
          message: `Unknown action: ${msg.action}`,
        });
    }
  });

  ws.on("close", () => {
    if (activeSessionId) {
      if (activeEngine === "codex") {
        codex.abort(activeSessionId);
      } else {
        claude.abort(activeSessionId);
      }
    }
    claude.removeAllListeners();
    codex.removeAllListeners();
    logger.info("WS chat connection closed");
  });
}
