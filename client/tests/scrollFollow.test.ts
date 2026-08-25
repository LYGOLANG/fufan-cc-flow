import test from "node:test";
import assert from "node:assert/strict";
import {
  AT_BOTTOM_THRESHOLD,
  SUSPEND_MS,
  WHEEL_NOISE_PX,
  isAtBottom,
  onScroll,
  onWheel,
  shouldPin,
  type ScrollMetrics,
} from "../src/utils/scrollFollow";

/** 造一份 DOM 读数：视口 600px，内容 total，当前滚到 top */
const m = (top: number, total: number, client = 600): ScrollMetrics => ({
  scrollTop: top,
  scrollHeight: total,
  clientHeight: client,
});

const NOW = 1_000_000;

test("贴底判定按阈值生效", () => {
  assert.equal(isAtBottom(m(2400, 3000)), true);
  assert.equal(isAtBottom(m(2400 - AT_BOTTOM_THRESHOLD + 1, 3000)), true);
  assert.equal(isAtBottom(m(2400 - AT_BOTTOM_THRESHOLD, 3000)), false);
  assert.equal(isAtBottom(m(0, 3000)), false);
});

// ---------------------------------------------------------------------------
// 核心性质：不存在永久性的死状态
// 这一组直接对应用户实报的「无论发送还是接收都不滚到底」
// ---------------------------------------------------------------------------

test("【核心】任何暂停都会自动过期 —— 不存在永久关闭的状态", () => {
  const suspended = onWheel(-100, 0, NOW);
  assert.equal(shouldPin(suspended, NOW), false, "刚上翻，应暂停");
  assert.equal(shouldPin(suspended, NOW + SUSPEND_MS - 1), false, "暂停期内仍不跟随");
  assert.equal(
    shouldPin(suspended, NOW + SUSPEND_MS),
    true,
    "到点必须自动恢复 —— 这是「无死状态」的保证，改动时不要破坏它",
  );
});

test("【核心】回到底部立刻解除暂停，不必等过期", () => {
  const suspended = onWheel(-100, 0, NOW);
  const resumed = onScroll(m(2400, 3000), suspended); // 距底 0
  assert.equal(resumed, 0);
  assert.equal(shouldPin(resumed, NOW + 1), true);
});

test("回归：scroll 事件绝不因「位置不在底部」而暂停跟随", () => {
  // 历代死状态的来源：把「浏览器夹住 scrollTop / 橡皮筋回弹 / 内容回缩」
  // 当成用户上翻。onScroll 只负责解除暂停，永远不制造暂停。
  assert.equal(onScroll(m(0, 9000), 0), 0, "离底很远也不该暂停");
  assert.equal(onScroll(m(1000, 9000), 0), 0);
  const stillSuspended = onScroll(m(1000, 9000), NOW + 3000);
  assert.equal(stillSuspended, NOW + 3000, "不在底部时保持原样，不延长也不缩短");
});

// ---------------------------------------------------------------------------
// 滚轮噪声过滤：macOS 触控板惯性/回弹
// ---------------------------------------------------------------------------

test("回归：触控板惯性与橡皮筋的碎小向上增量不得暂停跟随", () => {
  for (const d of [-1, -3, -7, -(WHEEL_NOISE_PX - 1)]) {
    assert.equal(
      onWheel(d, 0, NOW),
      0,
      `deltaY=${d} 属于惯性/回弹噪声，一次正常的向下滚动就会夹带这种事件`,
    );
  }
});

test("明确的向上滚动才暂停跟随", () => {
  assert.equal(onWheel(-WHEEL_NOISE_PX, 0, NOW), NOW + SUSPEND_MS);
  assert.equal(onWheel(-500, 0, NOW), NOW + SUSPEND_MS);
});

test("向下滚动永不暂停跟随（用户是在追最新内容）", () => {
  assert.equal(onWheel(120, 0, NOW), 0);
  assert.equal(onWheel(1, 0, NOW), 0);
  assert.equal(onWheel(0, 0, NOW), 0);
});

test("持续上翻会续期 —— 用户还在读就别打扰", () => {
  let s = onWheel(-100, 0, NOW);
  s = onWheel(-100, s, NOW + 2000);
  assert.equal(s, NOW + 2000 + SUSPEND_MS, "每次上翻都把恢复时间往后推");
  assert.equal(shouldPin(s, NOW + SUSPEND_MS), false, "原本该恢复的时刻仍在暂停中");
});

test("续期只会往后推，不会把暂停提前结束", () => {
  const far = NOW + 60_000;
  assert.equal(onWheel(-100, far, NOW), far, "旧的更晚，保持不变");
});

// ---------------------------------------------------------------------------
// 端到端时序
// ---------------------------------------------------------------------------

test("端到端：上翻读历史 → 停手 → 自动恢复跟随", () => {
  let s = 0;
  assert.equal(shouldPin(s, NOW), true, "初始状态就该跟随");

  s = onWheel(-300, s, NOW); // 用户上翻
  assert.equal(shouldPin(s, NOW + 1000), false, "读的过程中不打扰");

  s = onWheel(-300, s, NOW + 1000); // 继续读
  assert.equal(shouldPin(s, NOW + 1000 + SUSPEND_MS - 1), false);

  // 停手后自动恢复
  assert.equal(shouldPin(s, NOW + 1000 + SUSPEND_MS), true);
});

test("端到端：误判也只影响 SUSPEND_MS —— 用户实报的永久失效不可能再发生", () => {
  // 假设某个事件被错误地当成上翻（历代 bug 的形状）
  const wrongly = onWheel(-1000, 0, NOW);
  // 无论后续发生什么，到点必然恢复
  assert.equal(shouldPin(wrongly, NOW + SUSPEND_MS), true);
  // 或者用户滚回底部，立刻恢复
  assert.equal(shouldPin(onScroll(m(2400, 3000), wrongly), NOW + 1), true);
});
