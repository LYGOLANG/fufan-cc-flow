import assert from "node:assert/strict";
import test from "node:test";
import { decideAutoCompact, type AutoCompactInput } from "../src/utils/autoCompact";

const MAX = 200_000;

/** 默认:阈值 95%、已武装、刚聊完一轮 */
function input(over: Partial<AutoCompactInput> = {}): AutoCompactInput {
  return {
    contextTokens: 0,
    contextMax: MAX,
    threshold: 95,
    armed: true,
    justFinishedStreaming: true,
    ...over,
  };
}

/** 按百分比换算 token,让用例读起来就是「用量百分之几」 */
const at = (pct: number) => Math.round((pct / 100) * MAX);

test("聊完一轮后用量越过阈值 -> 压缩", () => {
  const d = decideAutoCompact(input({ contextTokens: at(96) }));
  assert.equal(d.action, "compact");
});

test("阈值 100 表示关闭,再满也不压", () => {
  const d = decideAutoCompact(input({ contextTokens: at(99.9), threshold: 100 }));
  assert.equal(d.action, "none");
});

test("用量未到阈值 -> 不压", () => {
  const d = decideAutoCompact(input({ contextTokens: at(94) }));
  assert.equal(d.action, "none");
});

test("回归:打开一个本来就快满的旧会话,不能自动压缩", () => {
  // 切换会话/开机恢复会话时 chatStore.loadHistoryMessages 会把 contextTokens
  // 直接设成该历史会话的用量,此时并没有「刚聊完一轮」。
  const d = decideAutoCompact(input({ contextTokens: at(98), justFinishedStreaming: false }));
  assert.equal(d.action, "none");
});

test("已解除武装时不重复压缩(防止贴着阈值反复触发)", () => {
  const d = decideAutoCompact(input({ contextTokens: at(97), armed: false }));
  assert.equal(d.action, "none");
});

test("压缩后用量掉到回差以下 -> 重新武装", () => {
  const d = decideAutoCompact(input({ contextTokens: at(30), armed: false }));
  assert.equal(d.action, "rearm");
});

test("回差区间内(阈值下方但不足 5 个百分点)不重新武装", () => {
  // 阈值 95、回差 5 => 只有低于 90% 才重新武装
  const d = decideAutoCompact(input({ contextTokens: at(92), armed: false }));
  assert.equal(d.action, "none");
});

test("回落判断不依赖「刚结束流式」——切到低用量会话也应重新武装", () => {
  const d = decideAutoCompact(
    input({ contextTokens: at(10), armed: false, justFinishedStreaming: false })
  );
  assert.equal(d.action, "rearm");
});

test("上下文用量为 0 或窗口未知时不做任何决策", () => {
  assert.equal(decideAutoCompact(input({ contextTokens: 0 })).action, "none");
  assert.equal(decideAutoCompact(input({ contextTokens: at(96), contextMax: 0 })).action, "none");
});

test("压缩决策带回真实百分比,用于状态提示文案", () => {
  const d = decideAutoCompact(input({ contextTokens: at(96) }));
  assert.equal(d.action, "compact");
  if (d.action === "compact") assert.ok(Math.abs(d.pct - 96) < 0.5);
});

test("1M 窗口下按比例判断,而非绝对 token 数", () => {
  // 96 万 / 100 万 = 96% > 95% -> 压;同样的 96 万在 200K 窗口早就超了,
  // 说明判断必须走比例,这条锁住换模型后阈值语义不变。
  const d = decideAutoCompact(input({ contextTokens: 960_000, contextMax: 1_000_000 }));
  assert.equal(d.action, "compact");
});

test("非法阈值(0 或负数)按关闭处理", () => {
  assert.equal(decideAutoCompact(input({ contextTokens: at(99), threshold: 0 })).action, "none");
  assert.equal(decideAutoCompact(input({ contextTokens: at(99), threshold: -1 })).action, "none");
});

test("引擎不支持压缩时(Codex)一律不触发", () => {
  // Codex 没有 /compact。必须在触发前判掉,而不是发出去让后端拒绝 ——
  // 自动压缩在每轮对话结束时都会评估,越过阈值后会轮轮重发、轮轮报错。
  const d = decideAutoCompact(input({ contextTokens: at(99), compactSupported: false }));
  assert.equal(d.action, "none");
});

test("compactSupported 未指定时按支持处理(不因缺省而静默失效)", () => {
  const d = decideAutoCompact(input({ contextTokens: at(96) }));
  assert.equal(d.action, "compact");
});

test("不支持压缩时连回落重新武装也不做(整体停用)", () => {
  const d = decideAutoCompact(
    input({ contextTokens: at(10), armed: false, compactSupported: false })
  );
  assert.equal(d.action, "none");
});
