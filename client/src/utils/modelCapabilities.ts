/**
 * 按模型判定「扩展思考」这组开关到底管不管用。
 *
 * 为什么需要它:Claude 5 代起(Fable 5/5.1、Sonnet 5、Opus 5)思考**关不掉**,
 * 官方文档原话:
 *
 *   "Thinking cannot be turned off on Fable 5.1 or Fable 5. The session toggle,
 *    `alwaysThinkingEnabled`, and `MAX_THINKING_TOKENS=0` have no effect there,
 *    and the model decides per step how much to think based on the effort level."
 *
 * 也就是说这些模型上,我们的「扩展思考」开关和「思考预算」档位是**纯空操作**:
 * 用户把开关拨到关,模型照样思考。界面显示一个拨了没用的开关,就是「界面说谎」
 * ——这个项目已经为同一类问题付过好几次学费(媒体加载失败被静默隐藏、
 * 加载失败被渲染成「本来就是空的」)。正确做法是把它藏起来并说明原因,
 * 而不是留着让用户以为自己控制得了。
 *
 * 判定按**代次开区间**写,不逐个列举型号 —— 与 costCalculator 的 CONTEXT_CATALOG
 * 同样的理由:逐个列举必然漏掉下一个发布的型号,而漏掉的后果是静默的。
 */

/** 未知模型的兜底。 */
const DEFAULT_MODE: ThinkingMode = "configurable";

export type ThinkingMode =
  /** 思考量由模型按推理力度自行决定;开关与预算都无效,UI 应隐藏。 */
  | "adaptive"
  /** 开关与预算真实生效(Opus 4.x、Sonnet 4.6、Haiku 4.5 及更早)。 */
  | "configurable";

const ADAPTIVE_PATTERNS: RegExp[] = [
  // Fable / Mythos 全代自适应
  /^claude-(fable|mythos)-/i,
  // Sonnet / Opus 第 5 代及以后(sonnet-5、opus-5、sonnet-6、opus-12…)
  /^claude-(sonnet|opus)-(?:[5-9]|\d{2,})/i,
  // 裸别名:fable/opus/sonnet 都解析到当代(2026-09 官方模型目录:
  // fable→Fable 5.1、opus→Opus 5、sonnet→Sonnet 5),三者均自适应。
  // best = "Latest Fable or Opus";opusplan = Opus 规划 + Sonnet 执行;
  // default 随订阅档位变化,但当代各档默认模型都已是 5 代。
  // haiku 刻意不在此列 —— 它是唯一明确「可以关掉思考」的别名。
  /^(fable|opus|sonnet|best|default|opusplan)$/i,
];

/**
 * 该模型上「扩展思考」开关与预算档位是否真实生效。
 *
 * 兜底取 "configurable":宁可多显示一个开关,也不要对第三方兼容端点的模型
 * 擅自砍掉能力 —— 那是把「我不认识它」当成了「它不支持」,又一次
 * 「把不知道当成否定」。
 */
export function thinkingMode(model: string): ThinkingMode {
  // "[1m]" 只是上下文窗口后缀,不改变模型代次
  const id = (model || "").replace(/\[1m\]$/i, "").trim();
  if (!id) return DEFAULT_MODE;
  return ADAPTIVE_PATTERNS.some((re) => re.test(id)) ? "adaptive" : DEFAULT_MODE;
}

/** 便捷判定:该模型是否应隐藏扩展思考开关与预算档位。 */
export function isAdaptiveThinking(model: string): boolean {
  return thinkingMode(model) === "adaptive";
}
