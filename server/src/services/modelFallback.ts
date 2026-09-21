/**
 * F1.10:按模型家族推导自动降级链。
 *
 * 从 chatHandler 抽出来是为了能测 —— 它原先内联在 websocket 处理器里,
 * 导入它就得把整个 ws 模块连带的副作用一起拉起来,于是一条分支都没测过,
 * 而「fable 落进未知一档、撞限流直接把任务打死」正是这样漏出去的。
 */

/** 顶格档模型的降级目标。fable 与 opus 同属顶格,降到同一档。 */
const FLAGSHIP_FALLBACK = "sonnet";

/**
 * 降级链:fable/opus → sonnet → haiku;haiku 与未知模型不降级。
 *
 * 只对官方端点注入 —— 第三方兼容端点不一定有 sonnet/haiku 这些模型,
 * 降过去反而把本来还能跑的任务打死。
 */
export function deriveFallbackModel(
  model: string | undefined,
  isCompat: boolean,
): string | undefined {
  if (isCompat || !model) return undefined;
  // "[1m]" 只是窗口后缀,不改变家族归属
  const base = model.replace(/\[1m\]$/i, "").trim();
  if (base === "fable" || /^claude-(fable|mythos)/i.test(base)) return FLAGSHIP_FALLBACK;
  if (base === "opus" || base === "opusplan" || /^claude-opus/i.test(base)) {
    return FLAGSHIP_FALLBACK;
  }
  if (base === "sonnet" || /^claude-sonnet/i.test(base)) return "haiku";
  return undefined;
}
