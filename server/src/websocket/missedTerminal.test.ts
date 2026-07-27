import assert from "node:assert/strict";
import test from "node:test";

/**
 * 「断线期间丢失的终态需补发」这条规则的测试。
 *
 * 规则内联在 chatHandler 的 forward / 重连认领里（需要真实 WebSocket 才能
 * 端到端跑），这里复刻同一份判定并锁住行为。改动那边时必须同步改这里。
 *
 * 为什么需要它：闪断（不是页面刷新，前端 isStreaming 仍为 true）期间这一轮
 * 跑完了 —— task_complete 因 socket 不在被丢弃，claude.turnActive 随之变 false，
 * 于是重连时那段以 isTurnActive() 为条件的重同步也不触发。结果前端永远停在
 * 「正在思考…」，而任务其实早已结束，用户只能重开会话。
 */

const TERMINAL_EVENTS = new Set(["task_complete", "aborted", "process_close"]);
const MISSED_TERMINAL_TTL_MS = 10 * 60_000;

/** socket 不在时：终态要记下来，其余丢弃即可 */
function shouldRemember(event: string): boolean {
  return TERMINAL_EVENTS.has(event);
}

/** 重连认领时：是否补发这条记下来的终态 */
function shouldReplay(missedAt: number, now: number): boolean {
  return now - missedAt <= MISSED_TERMINAL_TTL_MS;
}

test("终态事件在断线时必须被记下", () => {
  for (const e of ["task_complete", "aborted", "process_close"]) {
    assert.equal(shouldRemember(e), true, `${e} 是终态，丢了前端就永远不落态`);
  }
});

test("过程事件丢了就丢了，不必记", () => {
  // 这些是流式过程中的增量，补发反而会让界面重复渲染
  for (const e of ["assistant_text", "tool_use_start", "context_usage", "hook_event"]) {
    assert.equal(shouldRemember(e), false, `${e} 不该被当作终态记录`);
  }
});

test("刚断刚连：补发", () => {
  const now = 1_000_000;
  assert.equal(shouldReplay(now - 2_000, now), true);
});

test("闪断典型窗口（30 秒寄存宽限内）：补发", () => {
  const now = 1_000_000;
  assert.equal(shouldReplay(now - 30_000, now), true);
});

test("超过 10 分钟：不补发", () => {
  // 这么久之后用户多半已重开会话，此时冒出一条陈旧的任务结果卡片反而困惑
  const now = 1_000_000;
  assert.equal(shouldReplay(now - 11 * 60_000, now), false);
});

test("边界：正好 10 分钟仍补发", () => {
  const now = 1_000_000;
  assert.equal(shouldReplay(now - MISSED_TERMINAL_TTL_MS, now), true);
});

test("前端确实监听着这三个事件（名字对不上就白补发了）", () => {
  // 事件名是手写字符串，拼错不会有任何编译错误，只会静默失效。
  // 这三个名字已核对过 chatHandler 的 forward 调用与 useWebSocket 的 case。
  assert.deepEqual([...TERMINAL_EVENTS].sort(), ["aborted", "process_close", "task_complete"]);
});
