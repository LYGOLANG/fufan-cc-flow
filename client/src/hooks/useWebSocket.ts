import { useEffect } from "react";
import { wsService } from "../services/websocket";
import { useChatStore } from "../stores/chatStore";
import { useUIStore } from "../stores/uiStore";
import { useAgentStore } from "../stores/agentStore";
import { useConfigStore } from "../stores/configStore";
import { useAuditStore } from "../stores/auditStore";
import { inferContextMax } from "../utils/costCalculator";
import { permissionEventIds } from "../services/transport/permission";
import type { SubAgentNode } from "../types/agent";

/**
 * Map tool names to Chinese status descriptions (mimics Claude Code CLI status line).
 */
const TOOL_STATUS: Record<string, string> = {
  Bash: "正在执行命令...",
  Read: "正在读取文件...",
  Write: "正在写入文件...",
  Edit: "正在编辑文件...",
  Glob: "正在搜索文件...",
  Grep: "正在搜索内容...",
  WebFetch: "正在获取网页...",
  WebSearch: "正在搜索网络...",
  Agent: "正在执行子任务...",
  Task: "正在派发任务...",
  TodoWrite: "正在更新任务列表...",
  NotebookEdit: "正在编辑笔记本...",
};

/**
 * 供 openProject 在切走项目做快照前调用:把 60ms 节流中尚未落进 store 的
 * 流式增量立即刷进去,保证快照不缺最后一小段文本。由 effect 内赋值为当前
 * handler 的 flushStreaming。
 */
export const streamingFlush = { run: () => {} };

export function useWebSocket() {
  const projectPath = useUIStore((s) => s.projectPath);
  const setWsConnected = useUIStore((s) => s.setWsConnected);

  useEffect(() => {
    // ── Per-task mutable state ──
    // 切回后台项目时 openProject 已先恢复其聊天快照:若恢复出的状态正在流式中,
    // 把未提交的文本/思考种子进累加器,这样重放/后续的增量会接在切走前的内容
    // 后面,而不是把它顶掉。
    const restored = useChatStore.getState();
    let accumulatedText = restored.isStreaming ? restored.streamingText : "";
    let accumulatedThinking =
      (restored.isStreaming &&
        restored.messages.find((m) => m.id === restored.currentAssistantId)?.thinking) ||
      "";
    /** Stores the post-compact token count to protect it from being overwritten. */
    let postCompactTokens: number | null = null;
    /** When true, the next context_usage event should update the compact divider's tokensAfter */
    let pendingCompactAfterUpdate = false;
    /**
     * Track latest per-call usage from context_usage events.
     * Used for accurate TaskResult (instead of cumulative result.usage).
     */
    let latestUsage: Record<string, number> | null = null;

    const store = useChatStore;

    // ── Throttled streaming UI updates ──
    // Markdown parsing on every token is expensive; batch updates at ~60ms intervals.
    let textDirty = false;
    let thinkingDirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushStreaming() {
      flushTimer = null;
      if (textDirty) {
        store.setState({ streamingText: accumulatedText, statusText: "正在生成回复..." });
        textDirty = false;
      }
      if (thinkingDirty) {
        store.getState().updateAssistantThinking(accumulatedThinking);
        thinkingDirty = false;
      }
    }

    function scheduleFlush() {
      if (!flushTimer) {
        flushTimer = setTimeout(flushStreaming, 60);
      }
    }

    const unsub = wsService.subscribe((event, payload) => {
      switch (event) {
        case "_connected":
          setWsConnected(true);
          break;

        case "_disconnected":
          setWsConnected(false);
          break;

        case "session_init": {
          const newSessionId = payload.sessionId as string;
          store.getState().setSessionId(newSessionId);
          // Clear pendingFork — fork has been realized with the new session ID
          if (store.getState().pendingFork) {
            store.getState().clearPendingFork();
          }
          // Infer context window from the model id (catalog-based: [1m] → 1M,
          // gpt-5.5 → 400K, kimi → 256K, …). Codex 的 session_init 不带 model,
          // 退回当前选中的模型。
          // 注意:CLI 回传的是规范 id(不含 "[1m]" 后缀)。若用户选中的是同一模型的
          // 1M 变体,以选中项为准,否则 1M 窗口会被低报成 200K。
          const selected = useConfigStore.getState().model || "";
          const reported = (payload.model as string) || "";
          const selectedBase = selected.replace(/\[1m\]/i, "");
          const is1mVariantOfReported =
            /\[1m\]/i.test(selected) &&
            (!reported ||
              reported.startsWith(selectedBase) ||
              selectedBase.startsWith(reported));
          const modelName = is1mVariantOfReported ? selected : reported || selected;
          store.getState().updateContextMax(inferContextMax(modelName));
          // Start streaming if not already started (InputBar may have called startStreaming early)
          if (!store.getState().isStreaming) {
            store.getState().startStreaming();
          }
          accumulatedText = "";
          accumulatedThinking = "";
          latestUsage = null;
          postCompactTokens = null;
          break;
        }

        // ── New turn within the same task ──
        // Backend detects a new API message ID (different assistant turn).
        // Commit current text to the current message, then create a new bubble.
        case "new_turn": {
          // Cancel pending throttled flush — we're committing now
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          textDirty = false; thinkingDirty = false;
          // Mark any still-running tools as done (new turn = previous tools completed)
          store.getState().finishRunningTools();
          // Commit any accumulated text/thinking to the current assistant message
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }
          // Create a new assistant message bubble for the new turn.
          // 服务端常驻进程模式下,同会话的后续轮次不再发 session_init——
          // 若此刻不在流式状态(上一轮已 task_complete),由这里重新进入。
          if (!store.getState().isStreaming) {
            store.getState().startStreaming();
          } else {
            store.getState().addAssistantTurn();
          }
          store.getState().setStatusText("正在思考...");
          break;
        }

        case "assistant_thinking": {
          // 未在流式中时丢弃:停止(aborted)后 CLI 中断是异步的,仍会有迟到的增量到达;
          // 若不拦,会重新灌满 accumulatedThinking,拼进下一轮回复变成"幽灵内容"。
          if (!store.getState().isStreaming) break;
          accumulatedThinking += payload.thinking as string;
          thinkingDirty = true;
          scheduleFlush();
          break;
        }

        case "assistant_text": {
          // 同上:停止后迟到的 text 增量丢弃,避免混入下一轮回复。
          if (!store.getState().isStreaming) break;
          accumulatedText += payload.text as string;
          textDirty = true;
          scheduleFlush();
          break;
        }

        case "tool_use_start": {
          // Cancel pending throttled flush — we're committing now
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          textDirty = false; thinkingDirty = false;
          // Mark previous running tools as done (new tool = previous one completed)
          store.getState().finishRunningTools();
          // Commit accumulated text to the current assistant message
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }
          const toolName = payload.toolName as string;
          const realId = payload.toolCallId as string;

          // Bidirectional dedup: check if a perm_ placeholder already exists
          // (permission_request can arrive before OR after tool_use_start)
          const state = store.getState();
          const currentMsg = state.messages.find((m) => m.id === state.currentAssistantId);
          const permPlaceholder = currentMsg?.toolCalls?.find(
            (tc) => tc.id.startsWith("perm_") && tc.toolName === toolName &&
              (tc.status === "awaiting_permission" || tc.status === "running" || tc.status === "done" || tc.status === "error")
          );
          if (permPlaceholder) {
            // Merge: replace placeholder ID with real SDK ID, preserve status/permissionRequestId
            store.getState().replaceToolCallId(permPlaceholder.id, realId);
          } else {
            // No placeholder — add as new tool call
            store.getState().addToolCallToCurrent({
              id: realId,
              toolName,
              toolInput: payload.toolInput as Record<string, unknown>,
            });
          }
          // Update status line with what Claude is doing
          const status = TOOL_STATUS[toolName] || `正在调用 ${toolName}...`;
          store.getState().setStatusText(status);

          // Track Agent/Task tool calls for Sub-Agent tree & background tasks
          if (toolName === "Agent" || toolName === "Task") {
            const input = (payload.toolInput as Record<string, unknown>) || {};
            const node: SubAgentNode = {
              id: realId,
              agentType: String(input.subagent_type || input.description || "unknown"),
              description: String(input.description || input.prompt || "").slice(0, 120),
              model: input.model as string | undefined,
              status: "started",
              startedAt: Date.now(),
              isBackground: !!input.run_in_background,
              worktree: input.isolation === "worktree" ? "(pending)" : undefined,
              children: [],
              toolCalls: [],
            };
            useAgentStore.getState().addSubAgent(node);
            // Also add to background tasks if it's a background agent
            if (input.run_in_background) {
              useAgentStore.getState().addBackgroundTask({
                id: realId,
                agentName: String(input.subagent_type || "Agent"),
                description: String(input.description || ""),
                status: "running",
                startedAt: Date.now(),
                worktree: input.isolation === "worktree" ? "(pending)" : undefined,
              });
            }
          }
          break;
        }

        case "tool_input_complete": {
          // Complete message arrived — backfill the full toolInput for the tool call
          const completeId = payload.toolCallId as string;
          const completeInput = payload.toolInput as Record<string, unknown>;
          store.getState().updateToolCall(completeId, {
            toolInput: completeInput,
          });

          // Update Sub-Agent tree with real data (tool_use_start arrives with empty input)
          const completeTc = store.getState().messages
            .flatMap((m) => m.toolCalls ?? [])
            .find((tc) => tc.id === completeId);
          if (completeTc && (completeTc.toolName === "Agent" || completeTc.toolName === "Task")) {
            const agentType = String(completeInput.subagent_type || completeInput.description || "unknown");
            useAgentStore.getState().updateSubAgent(completeId, {
              agentType,
              description: String(completeInput.description || completeInput.prompt || "").slice(0, 120),
              model: completeInput.model as string | undefined,
              isBackground: !!completeInput.run_in_background,
              worktree: completeInput.isolation === "worktree" ? "(pending)" : undefined,
            });
            // Update background task name too
            if (completeInput.run_in_background) {
              useAgentStore.getState().updateBackgroundTask(completeId, {
                agentName: agentType,
                description: String(completeInput.description || ""),
              });
            }
          }
          break;
        }

        case "tool_use_result": {
          // SDK user messages contain tool_result blocks.
          // Skip if the tool call was already resolved by HIL permission flow
          // (deny → status already "error", allow → status already "running"/"done")
          const toolCallId = payload.toolCallId as string;
          const existingTc = store.getState().messages
            .flatMap((m) => m.toolCalls ?? [])
            .find((tc) => tc.id === toolCallId);
          // Only update if the tool exists and is still in running state
          // (skip error results from permission denials — the placeholder already shows the error)
          if (existingTc && existingTc.status === "running") {
            store.getState().updateToolCall(toolCallId, {
              result: payload.result as string,
              isError: payload.isError as boolean,
              status: (payload.isError as boolean) ? "error" : "done",
            });
          }
          // Update Sub-Agent tree & background tasks on completion
          const isAgentTool = existingTc && (existingTc.toolName === "Agent" || existingTc.toolName === "Task");
          if (isAgentTool) {
            const isErr = payload.isError as boolean;
            const now = Date.now();
            const subNode = useAgentStore.getState().subAgentTree.find((n) => n.id === toolCallId);
            const duration = subNode ? now - subNode.startedAt : undefined;
            useAgentStore.getState().updateSubAgent(toolCallId, {
              status: isErr ? "error" : "completed",
              completedAt: now,
              durationMs: duration,
              result: String(payload.result || "").slice(0, 200),
            });
            useAgentStore.getState().updateBackgroundTask(toolCallId, {
              status: isErr ? "error" : "completed",
              completedAt: now,
              durationMs: duration,
              ...(isErr ? { error: String(payload.result || "") } : { result: String(payload.result || "").slice(0, 200) }),
            });
          }
          store.getState().setStatusText("正在继续...");
          break;
        }

        // ── F1.13 审计时间线:SDK hooks 只读观察到的生命周期事件 ──
        case "hook_event": {
          useAuditStore.getState().addEvent({
            sessionId: (payload.sessionId as string) || "",
            event: (payload.event as string) || "unknown",
            toolName: payload.toolName as string | undefined,
            detail: payload.detail as string | undefined,
            ts: (payload.ts as number) || Date.now(),
          });
          break;
        }

        // ── workflow/后台 agent 生命周期(task_started 等) ──
        // payload 结构随 CLI 版本演进,防御性取字段;同时进审计时间线保证至少可见。
        case "background_task_event": {
          const subtype = (payload.subtype as string) || "";
          const p = (payload.payload as Record<string, unknown>) || {};
          const taskId =
            (p.task_id as string) || (p.taskId as string) || (p.id as string) || "";
          const desc =
            (p.description as string) || (p.title as string) || (p.prompt as string)?.slice(0, 80) || "";
          const agentStore = useAgentStore.getState();

          if (subtype === "task_started" && taskId) {
            const exists = agentStore.backgroundTasks.some((t) => t.id === taskId);
            if (!exists) {
              agentStore.addBackgroundTask({
                id: taskId,
                agentName: (p.agent_type as string) || (p.agentName as string) || "workflow",
                description: desc || "后台任务",
                status: "running",
                startedAt: Date.now(),
              });
            }
          } else if (subtype === "task_notification" && taskId) {
            const status = (p.status as string) || "";
            agentStore.updateBackgroundTask(taskId, {
              status: status === "failed" || status === "error" ? "error" : "completed",
              completedAt: Date.now(),
              result: (p.summary as string) || (p.message as string) || undefined,
            });
          } else if (subtype === "background_tasks_changed" && Array.isArray(p.tasks)) {
            // 全量同步:CLI 报的任务列表为准,更新已知任务状态
            for (const t of p.tasks as Record<string, unknown>[]) {
              const id = (t.task_id as string) || (t.id as string) || "";
              if (!id) continue;
              const status = (t.status as string) || "";
              const known = agentStore.backgroundTasks.some((bt) => bt.id === id);
              if (!known) {
                agentStore.addBackgroundTask({
                  id,
                  agentName: (t.agent_type as string) || "workflow",
                  description: (t.description as string) || "后台任务",
                  status: status === "completed" ? "completed" : status === "failed" ? "error" : "running",
                  startedAt: Date.now(),
                });
              } else if (status) {
                agentStore.updateBackgroundTask(id, {
                  status: status === "completed" ? "completed" : status === "failed" ? "error" : "running",
                });
              }
            }
          }

          // 无论负载形态如何,审计时间线里保证可见
          useAuditStore.getState().addEvent({
            sessionId: (payload.sessionId as string) || "",
            event: subtype || "background_task_event",
            detail: [taskId, desc].filter(Boolean).join(" · "),
            ts: Date.now(),
          });
          break;
        }

        case "context_usage": {
          const u = payload.usage as Record<string, number> | undefined;
          if (u) {
            // Save the latest per-call usage for accurate TaskResult
            latestUsage = u;
            // Total context = input + cache_creation + cache_read
            const total = (u.input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0);
            if (pendingCompactAfterUpdate && total > 0) {
              // Post-compact: accept this as the real post-compact token count
              store.getState().updateContextTokens(total);
              store.getState().updateLatestCompactAfter(total);
              postCompactTokens = total;
              pendingCompactAfterUpdate = false;
            } else if (postCompactTokens !== null) {
              // Compact happened but task_complete hasn't fired yet —
              // don't let pre-compact usage overwrite the post-compact value
            } else {
              store.getState().updateContextTokens(total);
            }
          }
          break;
        }

        case "context_compact": {
          // Backend sends compact_metadata from SDK's compact_boundary event
          // SDK uses camelCase (preTokens), old CLI format uses context_before/context_after
          const meta = payload.compact_metadata as Record<string, unknown> | undefined;
          const before = Number(meta?.preTokens ?? meta?.pre_tokens ?? 0)
            || (payload.context_before as Record<string, number> | undefined)?.used_tokens
            || 0;
          const after = Number(meta?.postTokens ?? meta?.post_tokens ?? 0)
            || (payload.context_after as Record<string, number> | undefined)?.used_tokens
            || 0;
          // The summary text is the assistant's streamed content generated during compact
          const summary = accumulatedText.trim() || undefined;
          // 方案A: persist summary to localStorage so it survives page refresh
          // (JSONL compact_boundary doesn't store summary, but isCompactSummary does —
          //  this is a fallback in case JSONL parsing misses it)
          if (summary) {
            try {
              const sid = store.getState().currentSessionId;
              if (sid) {
                const key = `compact_summary_${sid}_${Date.now()}`;
                localStorage.setItem(key, summary);
              }
            } catch { /* ignore */ }
          }
          store.getState().addCompactEvent(before, after, summary);
          if (after > 0) {
            store.getState().updateContextTokens(after);
            postCompactTokens = after;
          } else {
            // SDK doesn't provide post_tokens — estimate as ~50% of pre-compact,
            // and protect this estimate from being overwritten by task_complete.
            // The next real context_usage event will set the accurate value.
            const estimated = before > 0 ? Math.round(before * 0.5) : 0;
            if (estimated > 0) {
              store.getState().updateContextTokens(estimated);
              postCompactTokens = estimated;
            }
            pendingCompactAfterUpdate = true;
          }
          break;
        }

        case "task_complete": {
          // Cancel pending throttled flush — final commit
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          textDirty = false; thinkingDirty = false;
          // Commit any remaining text/thinking
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }

          // Use per-call usage from the LATEST context_usage event (matches JSONL behavior)
          // instead of the cumulative result.usage which sums ALL API calls.
          const resultUsage = payload.usage as Record<string, number> | undefined;
          const u = latestUsage || resultUsage;
          const totalInput = u
            ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
            : undefined;

          // Finalize: mark running tools done, attach taskResult, stop streaming
          store.getState().stopStreaming({
            costUsd:         payload.costUsd as number | undefined,
            durationMs:      payload.durationMs as number | undefined,
            numTurns:        payload.numTurns as number | undefined,
            inputTokens:     totalInput,
            outputTokens:    u?.output_tokens,
            cacheReadTokens: u?.cache_read_input_tokens,
          });
          // Update context window gauge
          if (u) {
            const total = (u.input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0);
            if (postCompactTokens !== null) {
              // Compact happened — use the post-compact value, don't let task_complete overwrite
              store.getState().updateContextTokens(postCompactTokens);
            } else if (total > 0) {
              store.getState().updateContextTokens(total);
            }
            // Note: if pendingCompactAfterUpdate is still true here, it means
            // the real post-compact usage hasn't arrived yet. Do NOT use the
            // compact task's own usage as post-compact value — it's pre-compact.
            // The next conversation's context_usage will provide the real value.
          }
          break;
        }

        case "process_close":
          // Cancel pending throttled flush — final commit
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          textDirty = false; thinkingDirty = false;
          // Commit any remaining text
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }

          // Ensure streaming is stopped (in case task_complete was never received)
          if (store.getState().isStreaming) {
            store.getState().stopStreaming();
          }

          // After compact, restore the correct post-compact token count
          // (task_complete or process_close may have overwritten it with pre-compact values)
          if (postCompactTokens !== null) {
            store.getState().updateContextTokens(postCompactTokens);
          }
          // Reset postCompactTokens (value is committed to store),
          // but keep pendingCompactAfterUpdate so next context_usage provides real post-compact value
          postCompactTokens = null;
          break;

        // 用户点了停止:服务端 interrupt 当前轮(常驻进程保留)。新架构下进程
        // 不退出,不会再有 process_close,必须在这里主动复位流式状态——
        // 否则"正在思考..."会永远转下去,看起来停止不了。
        case "aborted": {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          textDirty = false; thinkingDirty = false;
          // 已生成的文本/思考保留下来(提交进当前气泡),不白费
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }
          if (store.getState().isStreaming) {
            store.getState().stopStreaming();
          }
          break;
        }

        case "error": {
          const msg = (payload.message as string) || "未知错误";
          // Show error in the current assistant message
          const errorText = `⚠️ **错误**: ${msg}`;
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText + "\n\n" + errorText);
          } else {
            store.getState().updateAssistantContent(errorText);
          }
          accumulatedText = "";
          accumulatedThinking = "";
          store.getState().stopStreaming();
          break;
        }

        case "permission_request": {
          // HIL: SDK 要求用户确认工具使用权限
          const permissionIds = permissionEventIds(payload);
          const permReq = {
            ...permissionIds,
            sessionId: payload.sessionId as string,
            toolName: payload.toolName as string,
            toolInput: payload.toolInput as Record<string, unknown>,
            decisionReason: payload.decisionReason as string | undefined,
            blockedPath: payload.blockedPath as string | undefined,
            hasSuggestions:
              payload.hasSuggestions === true ||
              (Array.isArray(payload.suggestions) && payload.suggestions.length > 0),
          };
          store.getState().addPermissionRequest(permReq);

          // Flush accumulated text
          if (accumulatedText) {
            store.getState().updateAssistantContent(accumulatedText);
            accumulatedText = "";
          }
          if (accumulatedThinking) {
            store.getState().updateAssistantThinking(accumulatedThinking);
            accumulatedThinking = "";
          }

          // Bidirectional dedup: tool_use_start may have ALREADY created a card
          // with the real SDK tool-call ID. The permission control request ID is
          // intentionally separate and is only used when replying to the backend.
          // instead of creating a duplicate perm_ placeholder.
          const permState = store.getState();
          const permMsg = permState.messages.find((m) => m.id === permState.currentAssistantId);
          const existingCard = permMsg?.toolCalls?.find((tc) => tc.id === permReq.toolCallId);

          if (existingCard) {
            // tool_use_start arrived first — update existing card to awaiting_permission
            store.getState().updateToolCall(permReq.toolCallId, {
              status: "awaiting_permission",
              permissionRequestId: permReq.requestId,
              toolInput: permReq.toolInput, // backfill input (may have been empty from stream)
            });
          } else {
            // permission_request arrived first (rare) — create perm_ placeholder
            store.getState().addToolCallToCurrent({
              id: `perm_${permReq.toolCallId}`,
              toolName: permReq.toolName,
              toolInput: permReq.toolInput,
            });
            store.getState().updateToolCall(`perm_${permReq.toolCallId}`, {
              status: "awaiting_permission",
              permissionRequestId: permReq.requestId,
            });
          }

          store.getState().setStatusText(`等待确认: ${permReq.toolName}...`);
          break;
        }

        case "permission_timeout": {
          const timedOutId = payload.requestId as string;
          store.getState().removePermissionRequest(timedOutId);
          // 把对应的权限卡片本身也标成"已超时/拒绝",而不是只从 pending map 删除——
          // 否则后台项目切回时缓冲重放出的权限卡会一直停在"等待确认"的活跃态,误导用户。
          const staleTc = store.getState().messages
            .flatMap((m) => m.toolCalls ?? [])
            .find((tc) => tc.permissionRequestId === timedOutId || tc.id === `perm_${timedOutId}`);
          if (staleTc) {
            store.getState().updateToolCall(staleTc.id, {
              status: "error",
              result: "权限请求超时（60s），已自动拒绝",
            });
          }
          store.getState().setStatusText("权限请求已超时（60s），已自动拒绝");
          break;
        }

        case "process_stderr": {
          const text = payload.text as string;
          if (text?.trim()) {
            console.debug("[claude stderr]", text.trim());
          }
          break;
        }
      }
    });

    streamingFlush.run = flushStreaming;

    // 绑定该项目为活动连接(连接不存在则创建;已存在则复用,不断开其它项目)。
    // 放在 subscribe 之后,让 setActiveProject 补发的连接态能被上面的 handler 收到。
    wsService.setActiveProject(projectPath);
    // 重放该项目在后台期间积压的事件(若有),然后恢复实时转发——
    // 配合上面的快照恢复,切回来能看到任务还在跑、内容无缝续上。
    wsService.attach();

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      streamingFlush.run = () => {};
      // 只解绑本次的事件处理器;不断开连接——后台项目的任务需要继续在服务端运行。
      unsub();
    };
  }, [projectPath]);
}
