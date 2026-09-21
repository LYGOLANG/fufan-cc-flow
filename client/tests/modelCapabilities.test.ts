import assert from "node:assert/strict";
import test from "node:test";

import { thinkingMode, isAdaptiveThinking } from "../src/utils/modelCapabilities";

test("Fable 全代自适应 —— 官方点名思考关不掉的就是它", () => {
  assert.equal(thinkingMode("claude-fable-5-1"), "adaptive");
  assert.equal(thinkingMode("claude-fable-5"), "adaptive");
  assert.equal(thinkingMode("claude-fable-5-1-20260815"), "adaptive");
  assert.equal(thinkingMode("fable"), "adaptive");
});

test("Sonnet / Opus 第 5 代及以后自适应", () => {
  assert.equal(thinkingMode("claude-sonnet-5"), "adaptive");
  assert.equal(thinkingMode("claude-opus-5"), "adaptive");
  assert.equal(thinkingMode("claude-opus-5-20260710"), "adaptive");
});

test("代次判定是开区间,未来型号不会掉回可配置", () => {
  // 逐个列举型号必然漏掉下一个发布的,而漏掉是静默的 ——
  // 用户会在新模型上看到一个拨了没用的开关。
  assert.equal(thinkingMode("claude-sonnet-6"), "adaptive");
  assert.equal(thinkingMode("claude-opus-9"), "adaptive");
  assert.equal(thinkingMode("claude-sonnet-12"), "adaptive");
});

test("Opus 4.x / Sonnet 4.6 是固定预算,开关与预算仍然生效", () => {
  assert.equal(thinkingMode("claude-opus-4-8"), "configurable");
  assert.equal(thinkingMode("claude-opus-4-7"), "configurable");
  assert.equal(thinkingMode("claude-opus-4-6"), "configurable");
  assert.equal(thinkingMode("claude-sonnet-4-6"), "configurable");
});

test("haiku 是唯一明确可以关掉思考的别名,不能被藏起来", () => {
  assert.equal(thinkingMode("haiku"), "configurable");
  assert.equal(thinkingMode("claude-haiku-4-5"), "configurable");
});

test("[1m] 只是窗口后缀,不改变代次判定", () => {
  assert.equal(thinkingMode("opus[1m]"), "adaptive");
  assert.equal(thinkingMode("sonnet[1m]"), "adaptive");
  assert.equal(thinkingMode("claude-opus-4-8[1m]"), "configurable");
});

test("best / opusplan / default 走当代模型,按自适应处理", () => {
  assert.equal(thinkingMode("best"), "adaptive");
  assert.equal(thinkingMode("opusplan"), "adaptive");
  assert.equal(thinkingMode("default"), "adaptive");
});

test("不认识的模型保留开关,不把「不知道」当成「不支持」", () => {
  // 第三方兼容端点的模型 id 千奇百怪,擅自砍掉它们的开关
  // 就是把自己的无知当成对方的缺陷。
  assert.equal(thinkingMode("glm-4-plus"), "configurable");
  assert.equal(thinkingMode("deepseek-chat"), "configurable");
  assert.equal(thinkingMode(""), "configurable");
  assert.equal(thinkingMode("claude-3-5-sonnet-20241022"), "configurable");
});

test("别名前缀不会误伤同名开头的完整 id", () => {
  // 裸别名规则用了 ^…$ 锚定,"opus-something" 不该被它命中,
  // 而应落到代次规则或兜底上。
  assert.equal(thinkingMode("opusx"), "configurable");
  assert.equal(thinkingMode("fable-lite"), "configurable");
});

test("isAdaptiveThinking 与 thinkingMode 一致", () => {
  assert.equal(isAdaptiveThinking("claude-fable-5-1"), true);
  assert.equal(isAdaptiveThinking("claude-opus-4-8"), false);
});
