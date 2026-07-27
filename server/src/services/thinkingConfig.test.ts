import assert from "node:assert/strict";
import test from "node:test";

/**
 * 扩展思考的三态取值。
 *
 * 这段逻辑内联在 claudeAgentService 的 query options 里（不便直接调用），
 * 这里复刻同一份判定并锁住行为。改动那边时必须同步改这里 —— 两边不一致
 * 会被测试用例的语义描述暴露出来。
 *
 * 为什么必须是三态：此前只有「有没有 budget」两种情况，于是「关掉扩展思考」
 * 和「开着但用自适应档位」产生的 payload 完全相同 —— 用户把开关拨到关，
 * 模型该思考还是思考。那个开关实际只是预算档位选择器的显示开关。
 */
function resolveThinking(opts: { thinking?: boolean; thinkingBudget?: number }) {
  if (opts.thinking === false) return { thinking: { type: "disabled" as const } };
  if (opts.thinkingBudget) {
    return { thinking: { type: "enabled" as const, budgetTokens: opts.thinkingBudget } };
  }
  return {};
}

test("关闭扩展思考 → 显式 disabled", () => {
  assert.deepEqual(resolveThinking({ thinking: false }), {
    thinking: { type: "disabled" },
  });
});

test("关闭时即使带着预算也按关闭处理", () => {
  // 用户先选了 16K 档，之后把开关拨到关 —— 此时预算值还留在 store 里，
  // 不能因为它非零就当成「开」。
  assert.deepEqual(resolveThinking({ thinking: false, thinkingBudget: 16000 }), {
    thinking: { type: "disabled" },
  });
});

test("开启 + 指定预算 → enabled + budgetTokens", () => {
  assert.deepEqual(resolveThinking({ thinking: true, thinkingBudget: 8000 }), {
    thinking: { type: "enabled", budgetTokens: 8000 },
  });
});

test("开启 + 自适应（预算 0）→ 不传，交给 SDK 默认", () => {
  assert.deepEqual(resolveThinking({ thinking: true, thinkingBudget: 0 }), {});
});

test("回归：关闭 与 开启+自适应 必须产生不同的 payload", () => {
  const off = resolveThinking({ thinking: false });
  const adaptive = resolveThinking({ thinking: true, thinkingBudget: 0 });
  assert.notDeepEqual(off, adaptive, "两者相同就意味着开关是摆设");
});

test("完全不传 thinking（旧客户端/内部调用）保持原行为，不擅自关闭", () => {
  assert.deepEqual(resolveThinking({}), {});
  assert.deepEqual(resolveThinking({ thinkingBudget: 32000 }), {
    thinking: { type: "enabled", budgetTokens: 32000 },
  });
});
