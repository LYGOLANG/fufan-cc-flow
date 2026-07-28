import assert from "node:assert/strict";
import test from "node:test";
import { decideFork, effortKeyOf } from "./forkDecision.js";

/**
 * 「要不要从历史分叉」的判定测试。
 *
 * 判错的两个方向都是静默的，用户看到的现象完全不同、但都很难联想到这里：
 *   - 该 fork 却没 fork → 换了模型没反应（resume 锁死了首轮模型）
 *   - 不该 fork 却 fork → 每轮都分叉，历史被切碎成一堆新会话
 */

const SID = "sess_1";

test("显式要求分叉：直接分叉，不看其它条件", () => {
  const d = decideFork({ sessionId: SID, effortKey: "high:0", explicitFork: true });
  assert.equal(d.fork, true);
  assert.equal(d.reason, "explicit");
});

test("显式分叉在全新会话上也成立（从 checkpoint 派生）", () => {
  const d = decideFork({ effortKey: "", explicitFork: true });
  assert.equal(d.fork, true);
});

test("全新会话（无 sessionId）不分叉 —— 没有历史可分", () => {
  const d = decideFork({ model: "opus", effortKey: "high:0" });
  assert.equal(d.fork, false);
  assert.equal(d.reason, null);
});

test("模型变了：分叉", () => {
  const d = decideFork({
    sessionId: SID,
    model: "sonnet",
    prevModel: "opus",
    effortKey: "high:0",
    prevEffort: "high:0",
  });
  assert.equal(d.fork, true);
  assert.equal(d.reason, "model-changed");
});

test("模型没变：不分叉", () => {
  const d = decideFork({
    sessionId: SID,
    model: "opus",
    prevModel: "opus",
    effortKey: "high:0",
    prevEffort: "high:0",
  });
  assert.equal(d.fork, false);
});

test("回归：该会话首轮（没有历史模型记录）不算「变了」", () => {
  // prevModel === undefined 意味着这个会话还没记录过模型。首轮本来就在设定
  // 模型，此时分叉毫无意义，只会白白多出一个空会话。
  const d = decideFork({ sessionId: SID, model: "opus", effortKey: "high:0" });
  assert.equal(d.fork, false, "首轮不该分叉");
});

test("推理力度变了：分叉", () => {
  const d = decideFork({
    sessionId: SID,
    model: "opus",
    prevModel: "opus",
    effortKey: "low:0",
    prevEffort: "high:0",
  });
  assert.equal(d.fork, true);
  assert.equal(d.reason, "effort-changed");
});

test("力度首轮（无记录）同样不算变", () => {
  const d = decideFork({ sessionId: SID, effortKey: "high:0" });
  assert.equal(d.fork, false);
});

test("ultracode 档切换算力度变化", () => {
  // ultracode 与 effort 共同决定行为，必须一起比 —— 只比 effort 会漏掉
  // 「同为 xhigh 但一个开了 ultracode」这种情况
  const prev = effortKeyOf("xhigh", false);
  const next = effortKeyOf("xhigh", true);
  assert.notEqual(prev, next);
  const d = decideFork({
    sessionId: SID,
    effortKey: next,
    prevEffort: prev,
  });
  assert.equal(d.fork, true);
  assert.equal(d.reason, "effort-changed");
});

test("模型与力度同时变：报模型（先判的那个），仍然分叉", () => {
  const d = decideFork({
    sessionId: SID,
    model: "sonnet",
    prevModel: "opus",
    effortKey: "low:0",
    prevEffort: "high:0",
  });
  assert.equal(d.fork, true);
  assert.equal(d.reason, "model-changed");
});

test("本轮没传 model 时不因此判为变化", () => {
  // 某些内部路径（如 /compact）不带 model，不能因为「没传」就当成换了模型
  const d = decideFork({
    sessionId: SID,
    prevModel: "opus",
    effortKey: "high:0",
    prevEffort: "high:0",
  });
  assert.equal(d.fork, false);
});

test("effortKeyOf 的缺省形态稳定", () => {
  assert.equal(effortKeyOf(undefined, undefined), ":0");
  assert.equal(effortKeyOf("high", false), "high:0");
  assert.equal(effortKeyOf("high", true), "high:1");
});
