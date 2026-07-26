/**
 * 自动压缩的决策逻辑。
 *
 * 抽成纯函数是为了能被测试覆盖 —— 自动触发的动作一旦判错就会
 * 擅自压掉用户的会话记录,这类逻辑不该只靠「跑一遍看着没问题」验收。
 */

/** 回差:用量回落到 阈值-5 个百分点 以下才重新武装,避免贴着阈值反复触发 */
export const AUTO_COMPACT_HYSTERESIS = 5;

export interface AutoCompactInput {
  /** 当前上下文已用 token */
  contextTokens: number;
  /** 当前模型的上下文窗口上限 */
  contextMax: number;
  /** 用户设定的阈值百分比;>= 100 表示关闭 */
  threshold: number;
  /** 是否处于「已武装」状态 —— 只有武装时越过阈值才触发 */
  armed: boolean;
  /**
   * 是否「刚刚结束一轮流式对话」。
   *
   * 这是最关键的一个条件。自动压缩必须只由「用户在本会话聊完一轮、
   * 用量因此涨过阈值」触发,而不能由 contextTokens 的任意变化触发 ——
   * 切换会话或开机恢复会话时,chatStore.loadHistoryMessages 会把
   * contextTokens 直接设成该历史会话的用量。若不加这个条件,
   * 点开一个 96% 的旧会话就会被立刻自动压缩,用户只是想看一眼记录。
   */
  justFinishedStreaming: boolean;
}

export type AutoCompactDecision =
  /** 触发压缩 */
  | { action: "compact"; pct: number }
  /** 用量已回落,重新武装 */
  | { action: "rearm" }
  /** 什么都不做 */
  | { action: "none" };

export function decideAutoCompact(input: AutoCompactInput): AutoCompactDecision {
  const { contextTokens, contextMax, threshold, armed, justFinishedStreaming } = input;

  // 阈值 >= 100(或非法值)= 用户明确关闭自动压缩
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100) {
    return { action: "none" };
  }
  if (!(contextMax > 0) || !(contextTokens > 0)) {
    return { action: "none" };
  }

  const pct = (contextTokens / contextMax) * 100;

  // 回落判断放在最前:即使不是刚结束流式(例如切到一个低用量会话),
  // 也应该重新武装,否则下次真涨上去时反而不触发。
  if (pct < threshold - AUTO_COMPACT_HYSTERESIS) {
    return { action: "rearm" };
  }

  // 只在一轮对话刚结束的那一刻评估,详见 justFinishedStreaming 的注释
  if (!justFinishedStreaming) return { action: "none" };

  if (pct < threshold) return { action: "none" };
  if (!armed) return { action: "none" };

  return { action: "compact", pct };
}
