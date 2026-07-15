// (原 estimateCost/PRICING 已删:从未被调用,且只含 Claude 定价,回退会把
//  gpt/deepseek 等按 sonnet 单价误算。实际费用一律取 SDK task_complete.costUsd。)

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * 已知模型家族的上下文窗口目录(按前缀/关键词匹配,顺序即优先级)。
 * 数据来源:各家官方文档(2026-07 核对)。匹配不到的一律按 200K 兜底。
 */
const CONTEXT_CATALOG: Array<{ test: RegExp; window: number }> = [
  // OpenAI Codex 档位
  { test: /^gpt-5\.6/i, window: 1_000_000 }, // sol/terra/luna 三档统一 1M(2026-07-09 发布)
  { test: /^gpt-5\.3-codex-spark/i, window: 128_000 },
  { test: /^gpt-5\.4-mini/i, window: 200_000 },
  { test: /^gpt-5\.4/i, window: 272_000 },
  { test: /^gpt-5\.5/i, window: 400_000 },
  { test: /^(gpt-|codex|o[0-9])/i, window: 272_000 },
  // 国产 Anthropic 兼容端点
  { test: /^deepseek/i, window: 128_000 },
  { test: /^minimax/i, window: 200_000 },
  { test: /^kimi/i, window: 256_000 },
  { test: /^(glm|chatglm)/i, window: 200_000 },
  // Claude 当代模型默认 1M(2026-06 官方模型目录核对):
  // Fable 5 / Mythos 5 / Sonnet 5 / Opus 4.6~4.8 / Sonnet 4.6 上下文窗口均为 1M
  { test: /^claude-(fable|mythos|sonnet)-5/i, window: 1_000_000 },
  { test: /^claude-opus-4-[678]/i, window: 1_000_000 },
  { test: /^claude-sonnet-4-6/i, window: 1_000_000 },
  // Haiku 系列仍是 200K
  { test: /^(claude-haiku|claude-3.*haiku|haiku$)/i, window: 200_000 },
  // 裸别名 opus/sonnet 解析到最新代 → 1M
  { test: /^(opus|sonnet)$/i, window: 1_000_000 },
  // 旧 Claude(Opus 4.5/4.1、Sonnet 4.5 及更早)标准窗口 200K 兜底
  { test: /^claude-/i, window: 200_000 },
];

/**
 * Context window size for a model id. The "[1m]" suffix unlocks the 1M window in
 * the CLI; otherwise look the model up in the catalog (default 200K).
 */
export function inferContextMax(model: string): number {
  const id = model || "";
  if (/\[1m\]/i.test(id)) return 1_000_000;
  for (const entry of CONTEXT_CATALOG) {
    if (entry.test.test(id)) return entry.window;
  }
  return 200_000;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
