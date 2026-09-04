/**
 * 上下文用满时「交接到新会话」的决策与文案。
 *
 * 为什么不再自动压缩:压缩是把整段历史换成一份模型自己写的摘要,原文当场
 * 从上下文里消失,而摘要写成什么样不受控、也不给用户看。实测一次 1M 会话
 * 被压到 69K,四次累计丢弃 388 万 tokens,换模型后"第一眼看到的就是一份摘要",
 * 表现为模型突然变笨。
 *
 * 交接的做法相反:让**旧会话本人**在还记得全部细节时,显式写一份给接班人的
 * 交接文档(任务、已完成及证据、下一步、关键文件、死路、用户偏好),然后开一个
 * 干净的新会话,把这份文档当开场白发进去。差别是实质性的:
 *   - 文档是可见的、可审的,用户能当场看出接班人漏了什么;
 *   - 新会话的上下文是真的空的,不是"摘要 + 残留";
 *   - 两条引擎都能用 —— Codex 没有 /compact,但它照样能写文档、照样能开新会话。
 *
 * 抽成纯函数是为了能被测试覆盖:自动触发的动作一旦判错就会擅自结束用户的
 * 会话,这类逻辑不该只靠「跑一遍看着没问题」验收。
 */

/** 回差:用量回落到 阈值-5 个百分点 以下才重新武装,避免贴着阈值反复触发 */
export const AUTO_HANDOFF_HYSTERESIS = 5;

/**
 * 交接文档的最小可信长度。短于此视为模型没照做(拒绝、寒暄、一句话敷衍),不据此换会话。
 *
 * 门槛宁高勿低:漏判的代价只是「这次没交接成,会话原样留着」,用户自己再点一次即可;
 * 误判的代价是拿一句「好的,我明白了」当交接开了新会话——整段上下文就这么没了。
 * 按模板写出来的七段文档至少几百字,120 离真实文档的下限还很远。
 */
export const MIN_HANDOFF_DOC_CHARS = 120;

export interface AutoHandoffInput {
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
   * 这是最关键的一个条件。自动交接必须只由「用户在本会话聊完一轮、用量因此
   * 涨过阈值」触发,而不能由 contextTokens 的任意变化触发 —— 切换会话或开机
   * 恢复会话时,chatStore.loadHistoryMessages 会把 contextTokens 直接设成该
   * 历史会话的用量。若不加这个条件,点开一个 96% 的旧会话就会被立刻交接掉,
   * 而用户只是想看一眼记录。
   */
  justFinishedStreaming: boolean;
  /** 已有一次交接在进行中(旧会话正在写文档)时不再重复触发 */
  inProgress?: boolean;
}

export type AutoHandoffDecision =
  /** 让旧会话开始写交接文档 */
  | { action: "handoff"; pct: number }
  /** 用量已回落,重新武装 */
  | { action: "rearm" }
  /** 什么都不做 */
  | { action: "none" };

export function decideAutoHandoff(input: AutoHandoffInput): AutoHandoffDecision {
  const { contextTokens, contextMax, threshold, armed, justFinishedStreaming } = input;

  // 交接进行中:旧会话正在写文档,这一轮结束时用量必然还在阈值之上,
  // 不挡住就会在同一次交接里再触发一次。
  if (input.inProgress) return { action: "none" };

  // 阈值 >= 100(或非法值)= 用户明确关闭自动交接
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100) {
    return { action: "none" };
  }
  if (!(contextMax > 0) || !(contextTokens > 0)) {
    return { action: "none" };
  }

  const pct = (contextTokens / contextMax) * 100;

  // 回落判断放在最前:即使不是刚结束流式(例如切到一个低用量会话),
  // 也应该重新武装,否则下次真涨上去时反而不触发。
  if (pct < threshold - AUTO_HANDOFF_HYSTERESIS) {
    return { action: "rearm" };
  }

  // 只在一轮对话刚结束的那一刻评估,详见 justFinishedStreaming 的注释
  if (!justFinishedStreaming) return { action: "none" };

  if (pct < threshold) return { action: "none" };
  if (!armed) return { action: "none" };

  return { action: "handoff", pct };
}

/**
 * 从「写交接文档」那一轮的消息里取出文档正文。
 *
 * fromIndex 是发出交接请求前的消息条数 —— 只认这之后产生的助手回复,
 * 否则用户在交接期间插话、或那一轮失败时,会把上一轮无关的回复当成文档
 * 发进新会话(接班人拿到一份牛头不对马嘴的交接,比没有更糟)。
 */
export function extractHandoffDoc(
  messages: { role: string; content: string }[],
  fromIndex: number
): string | null {
  for (let i = messages.length - 1; i >= Math.max(fromIndex, 0); i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = (m.content || "").trim();
    if (text.length >= MIN_HANDOFF_DOC_CHARS) return text;
  }
  return null;
}

/** 发给旧会话的指令:趁还记得,写一份给接班人的交接文档。 */
export function buildHandoffRequestPrompt(pct: number): string {
  return [
    `【Agent Flow 自动交接】本会话上下文已用 ${Math.round(pct)}%,马上要换到一个全新会话。`,
    "",
    "请现在输出一份交接文档。读者是一个对这段工作一无所知的新助手,它只能看到这份文档,",
    "看不到我们之前的任何对话。目标是它能无缝接着干:不重做已完成的部分,不重走已排除的死路。",
    "",
    "硬要求:直接输出文档正文。不要调用任何工具、不要写文件、不要问我问题、不要寒暄和总结感想。",
    "只写事实和证据,不写「应该」「大概」。提到代码一律写 路径:行号。",
    "",
    "按这个结构写:",
    "1. 当前任务 —— 用户要什么,怎样算做完",
    "2. 已完成 —— 做了什么、结论是什么、证据在哪(命令、文件、实测输出)",
    "3. 下一步 —— 没做完的事,按优先级排,每条写清完成标准",
    "4. 关键文件与位置",
    "5. 死路与坑 —— 已被推翻的假设、踩过的错,避免重走",
    "6. 用户偏好与硬约束 —— 他明确说过的规矩",
    "7. 未决问题 —— 需要用户拍板的事",
  ].join("\n");
}

/** 发给新会话的开场白:装载交接文档并接着干。 */
export function buildHandoffOpeningPrompt(doc: string, pct: number): string {
  return [
    `【接手上一会话】上一个会话上下文已用到 ${Math.round(pct)}%,已自动结束并切到这个新会话。`,
    "下面是它留给你的交接文档 —— 关于之前的工作,你手上只有这些信息。",
    "",
    "--- 交接文档开始 ---",
    doc,
    "--- 交接文档结束 ---",
    "",
    "请先用一两句话说明你接手到了哪一步,然后从「下一步」的第一项继续执行,不要重做已完成的部分。",
    "文档里若有「未决问题」,先问我再动手。",
  ].join("\n");
}
