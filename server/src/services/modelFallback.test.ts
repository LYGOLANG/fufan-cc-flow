import assert from "node:assert/strict";
import test from "node:test";

import { deriveFallbackModel } from "./modelFallback.js";

test("fable 有降级目标 —— 回归:它曾经落进「未知」一档,撞限流直接把任务打死", () => {
  assert.equal(deriveFallbackModel("fable", false), "sonnet");
  assert.equal(deriveFallbackModel("claude-fable-5-1", false), "sonnet");
  assert.equal(deriveFallbackModel("claude-mythos-5", false), "sonnet");
});

test("opus 系降到 sonnet", () => {
  assert.equal(deriveFallbackModel("opus", false), "sonnet");
  assert.equal(deriveFallbackModel("opusplan", false), "sonnet");
  assert.equal(deriveFallbackModel("claude-opus-5", false), "sonnet");
  assert.equal(deriveFallbackModel("claude-opus-4-8", false), "sonnet");
});

test("sonnet 系降到 haiku", () => {
  assert.equal(deriveFallbackModel("sonnet", false), "haiku");
  assert.equal(deriveFallbackModel("claude-sonnet-5", false), "haiku");
});

test("haiku 是链尾,不再降级", () => {
  assert.equal(deriveFallbackModel("haiku", false), undefined);
  assert.equal(deriveFallbackModel("claude-haiku-4-5", false), undefined);
});

test("[1m] 后缀不影响家族归属", () => {
  assert.equal(deriveFallbackModel("opus[1m]", false), "sonnet");
  assert.equal(deriveFallbackModel("sonnet[1m]", false), "haiku");
});

test("第三方兼容端点一律不降级 —— 那边不一定有 sonnet/haiku", () => {
  assert.equal(deriveFallbackModel("opus", true), undefined);
  assert.equal(deriveFallbackModel("claude-fable-5-1", true), undefined);
  assert.equal(deriveFallbackModel("glm-4-plus", true), undefined);
});

test("未知模型与空值不降级", () => {
  assert.equal(deriveFallbackModel(undefined, false), undefined);
  assert.equal(deriveFallbackModel("", false), undefined);
  assert.equal(deriveFallbackModel("deepseek-chat", false), undefined);
});

test("降级目标本身必须能再降或到链尾,不能形成环", () => {
  // fable → sonnet → haiku → 停。任何一步指回自己或指回上游都会死循环。
  const seen = new Set<string>();
  let cur: string | undefined = "fable";
  while (cur) {
    assert.ok(!seen.has(cur), `降级链出现环:${cur}`);
    seen.add(cur);
    cur = deriveFallbackModel(cur, false);
  }
  assert.deepEqual([...seen], ["fable", "sonnet", "haiku"]);
});
