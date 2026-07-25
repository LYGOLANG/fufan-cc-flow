import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useConfigStore } from "../stores/configStore";
import { useUIStore } from "../stores/uiStore";
import { wsService } from "../services/websocket";
import { inferContextMax } from "../utils/costCalculator";

/**
 * 上下文用量达阈值时自动压缩。
 *
 * 此前 autoCompactThreshold 是个「死配置」——类型、存储、setter 都齐,
 * 但没有任何代码消费它,设了也永远不生效。这里补上真正的触发逻辑:
 * 复用与手动 /compact 完全相同的发送路径(见 ContextBar.handleCompact),
 * 保证两条路走出来的行为一致。
 *
 * 触发纪律(自动动作必须比手动更克制,否则会打断用户):
 * - 流式进行中不触发:正在出话时插一条 /compact 会打断当前回答
 * - 每次「越过阈值」只触发一次:用 armed 标志防抖,回落到阈值下方才重新武装,
 *   否则用量长期贴着阈值会反复压缩、陷入死循环
 * - 换会话/新会话时重置:新会话用量从零开始,旧的触发状态不该延续
 * - 阈值 >= 100 视为关闭:给用户一个明确的「不自动压缩」选项
 */
export function useAutoCompact(): void {
  const contextTokens = useChatStore((s) => s.contextTokens);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const threshold = useConfigStore((s) => s.autoCompactThreshold);
  const model = useConfigStore((s) => s.model);

  /** 是否「已武装」——只有武装状态下越过阈值才触发,触发后解除 */
  const armed = useRef(true);
  /** 记录上次会话,换会话时重新武装 */
  const lastSession = useRef<string | null>(null);

  useEffect(() => {
    if (lastSession.current !== currentSessionId) {
      lastSession.current = currentSessionId;
      armed.current = true;
    }
  }, [currentSessionId]);

  useEffect(() => {
    // 阈值 >= 100 = 用户明确关闭
    if (!threshold || threshold >= 100) return;
    if (isStreaming) return;

    const max = inferContextMax(model);
    if (max <= 0 || contextTokens <= 0) return;
    const pct = (contextTokens / max) * 100;

    // 回落到阈值下方(留 5 个百分点回差,避免在阈值附近抖动反复触发)
    if (pct < threshold - 5) {
      armed.current = true;
      return;
    }

    if (pct < threshold || !armed.current) return;

    // ── 触发压缩:与手动 /compact 同一条发送路径 ──
    armed.current = false;

    const chat = useChatStore.getState();
    const cfg = useConfigStore.getState();
    const { runMode } = useUIStore.getState();
    const prompt = "/compact";

    chat.addUserMessage(prompt);
    wsService.send("send_message", {
      prompt,
      model: cfg.model,
      effort: cfg.effort,
      runMode,
      engine: cfg.engine,
      codexModel: cfg.codexModel,
      codexEffort: cfg.codexEffort,
      providerId: cfg.providerId,
      apiKey: cfg.apiKey || undefined,
      sessionId: chat.currentSessionId || undefined,
    });
    chat.startStreaming();
    chat.setStatusText(`上下文已达 ${Math.round(pct)}%,正在自动压缩...`);
  }, [contextTokens, isStreaming, threshold, model]);
}
