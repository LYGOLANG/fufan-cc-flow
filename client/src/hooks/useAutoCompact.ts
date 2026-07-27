import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useConfigStore } from "../stores/configStore";
import { wsService } from "../services/websocket";
import { inferContextMax } from "../utils/costCalculator";
import { decideAutoCompact } from "../utils/autoCompact";

/**
 * 上下文用量达阈值时自动压缩。
 *
 * 此前 autoCompactThreshold 是个「死配置」——类型、存储、setter 都齐,
 * 但没有任何代码消费它。这里补上触发逻辑,并与手动压缩走**同一条专用通道**
 * (compact action,见 ContextBar.handleCompact),保证两条路行为一致。
 *
 * 注意不是把 "/compact" 当普通消息发:专用通道会优先把指令推入现有常驻进程
 * 的输入队列(不重启、不打断后台 sub-agent),且带引擎能力检测。
 *
 * 触发时机只有一个:**一轮流式对话刚刚结束**。判定逻辑见 utils/autoCompact.ts,
 * 那里有为什么必须这样限定的说明(简言之:切会话/开机恢复会话时 contextTokens
 * 会被直接设成历史用量,不限定时机就会「点开旧会话即被压缩」)。
 */
export function useAutoCompact(): void {
  const contextTokens = useChatStore((s) => s.contextTokens);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const threshold = useConfigStore((s) => s.autoCompactThreshold);
  const model = useConfigStore((s) => s.model);
  const engine = useConfigStore((s) => s.engine);

  /** 是否「已武装」——只有武装状态下越过阈值才触发,触发后解除 */
  const armed = useRef(true);
  /** 上一次渲染时的流式状态,用于识别 true -> false 的那一刻 */
  const wasStreaming = useRef(false);
  /** 本 hook 自己发起的压缩所在的会话,避免对同一会话重复自动压缩 */
  const lastSession = useRef<string | null>(null);

  useEffect(() => {
    // 换会话时解除武装:新会话是否需要压缩,要等它自己聊完一轮再判断,
    // 不能沿用上个会话的武装状态。
    if (lastSession.current !== currentSessionId) {
      lastSession.current = currentSessionId;
      armed.current = false;
    }
  }, [currentSessionId]);

  useEffect(() => {
    const justFinishedStreaming = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;

    const decision = decideAutoCompact({
      contextTokens,
      contextMax: inferContextMax(model),
      threshold,
      armed: armed.current,
      justFinishedStreaming,
      // Codex 没有 /compact —— 在这里判掉，否则每轮结束都会重发一次并报一次错
      compactSupported: engine !== "codex",
    });

    if (decision.action === "rearm") {
      armed.current = true;
      return;
    }
    if (decision.action !== "compact") return;

    // ── 触发压缩:与手动 /compact 同一条发送路径 ──
    armed.current = false;

    const chat = useChatStore.getState();

    chat.addUserMessage("/compact");
    // 与手动压缩走同一条专用通道:优先推入现有常驻进程的输入队列(不重启、
    // 不打断后台 sub-agent),并带 Codex 能力检测。
    // 此前当普通消息发,在 Codex 引擎下等于把 "/compact" 当提问问了一遍 ——
    // 上下文纹丝不动,状态栏却显示「正在压缩」。
    wsService.send("compact", {
      sessionId: chat.currentSessionId || undefined,
    });
    chat.startStreaming();
    chat.setStatusText(`上下文已达 ${Math.round(decision.pct)}%,正在自动压缩...`);
  }, [contextTokens, isStreaming, threshold, model, engine]);
}
