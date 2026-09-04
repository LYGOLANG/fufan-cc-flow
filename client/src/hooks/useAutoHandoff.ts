import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useConfigStore } from "../stores/configStore";
import { inferContextMax } from "../utils/costCalculator";
import { decideAutoHandoff } from "../utils/autoHandoff";
import { beginHandoff, finishHandoffIfPending, isHandoffPending } from "../utils/handoffRunner";

/**
 * 上下文用量达阈值时「交接到新会话」,取代原来的自动压缩。
 *
 * 本 hook 只负责**什么时候**触发,以及在流式结束的那一刻收尾;交接怎么做在
 * utils/handoffRunner.ts(手动按钮走同一份实现)。为什么不再压缩、触发时机
 * 为什么只能是「一轮对话刚结束」:见 utils/autoHandoff.ts。
 */
export function useAutoHandoff(): void {
  const contextTokens = useChatStore((s) => s.contextTokens);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const threshold = useConfigStore((s) => s.autoHandoffThreshold);
  const model = useConfigStore((s) => s.model);

  /** 是否「已武装」——只有武装状态下越过阈值才触发,触发后解除 */
  const armed = useRef(true);
  /** 上一次渲染时的流式状态,用于识别 true -> false 的那一刻 */
  const wasStreaming = useRef(false);
  /** 上一次见到的会话 id,用于识别换会话 */
  const lastSession = useRef<string | null>(null);

  useEffect(() => {
    // 换会话时解除武装:新会话是否需要交接,要等它自己聊完一轮再判断,
    // 不能沿用上个会话的武装状态。
    if (lastSession.current !== currentSessionId) {
      lastSession.current = currentSessionId;
      armed.current = false;
    }
  }, [currentSessionId]);

  useEffect(() => {
    const justFinishedStreaming = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;

    // 交接文档那一轮刚结束 → 开新会话把文档发过去。
    // 手动点「交接新会话」发起的那一次也在这里收尾。
    if (isHandoffPending()) {
      if (justFinishedStreaming) finishHandoffIfPending();
      return;
    }

    const decision = decideAutoHandoff({
      contextTokens,
      contextMax: inferContextMax(model),
      threshold,
      armed: armed.current,
      justFinishedStreaming,
    });

    if (decision.action === "rearm") {
      armed.current = true;
      return;
    }
    if (decision.action !== "handoff") return;

    armed.current = false;
    const result = beginHandoff(decision.pct);
    if (result !== "started") {
      // 没发出去(连接断了/没有会话):不该消耗掉这次机会,下一轮结束再试
      armed.current = true;
      if (result === "not-sent") {
        const chat = useChatStore.getState();
        chat.setStatusText("网络未连接，自动交接未执行");
        setTimeout(() => useChatStore.getState().setStatusText(""), 5000);
      }
    }
  }, [contextTokens, isStreaming, threshold, model]);
}
