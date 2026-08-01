import assert from "node:assert/strict";
import test from "node:test";

/**
 * 项目标签「运行中」指示的状态判定。
 *
 * 原实现把 `error` 整个当成终态,于是任务运行中的任何局部失败都会把指示灯
 * 打灭 —— 而任务还在服务端跑着。用户看到的是「明明有一个在跑,但闪烁没有了」。
 *
 * 界面说"没在跑"而实际在跑,比没有指示更糟:用户会重复发送,或以为可以
 * 直接关掉应用。
 *
 * 这里复刻 websocket.ts 的 trackBusy 规则。
 */

// 直接引生产值，不再抄一份。
//
// 此前这里复刻了一份集合，结果漏掉 UNKNOWN_PROVIDER / PROVIDER_NOT_CONFIGURED
// 时测试照样全绿 —— 测的是抄件不是生产值，等于没有保护。
import { TASK_NEVER_STARTED_CODES, TERMINAL_EVENTS } from "../src/services/taskErrorCodes";

/** 与 websocket.ts:trackBusy 同构 */
function nextBusy(
  current: boolean,
  event: string,
  payload?: Record<string, unknown>,
): boolean {
  if (event === "session_init") return true;
  if (TERMINAL_EVENTS.has(event)) return false;
  if (event === "error") {
    const code = payload?.code;
    if (typeof code === "string" && TASK_NEVER_STARTED_CODES.has(code)) return false;
    return current; // 运行中的局部失败：不动
  }
  return current;
}

test("运行中的局部失败不得熄灭指示灯", () => {
  // 压缩失败：会话完好，这一轮照常继续
  assert.equal(nextBusy(true, "error", { code: "COMPACT_FAILED" }), true);

  // 闪断时发消息超时：服务端有 30 秒寄存，任务照常在跑、照常计费
  assert.equal(nextBusy(true, "error", { code: "BACKEND_NOT_CONNECTED" }), true);

  // SDK 运行时错误（工具失败之类）：真正终结时另有 process_close
  assert.equal(nextBusy(true, "error", { message: "tool failed" }), true);
});

test("「这一轮没起来」的错误才清掉指示灯", () => {
  // 这些发生时 busy 刚被 send() 乐观地设为 true，必须清掉，
  // 否则指示灯会一直亮着而根本没有任务在跑
  for (const code of TASK_NEVER_STARTED_CODES) {
    assert.equal(nextBusy(true, "error", { code }), false, `${code} 应清除 busy`);
  }
});

test("真正的终态照常清除", () => {
  for (const e of TERMINAL_EVENTS) {
    assert.equal(nextBusy(true, e), false, `${e} 应清除 busy`);
  }
});

test("session_init 点亮指示灯", () => {
  assert.equal(nextBusy(false, "session_init"), true);
});

test("无关事件不影响状态", () => {
  // 流式增量事件很密集，任何一个误改状态都会导致指示灯闪烁不定
  for (const e of ["assistant_text", "tool_use_start", "context_usage", "new_turn"]) {
    assert.equal(nextBusy(true, e), true, `${e} 不该熄灭`);
    assert.equal(nextBusy(false, e), false, `${e} 不该点亮`);
  }
});

test("回归：error 不在终态集合里", () => {
  // 这是本次修复的核心。若有人"顺手"把 error 加回 TERMINAL_EVENTS，
  // 上面那些用例会失败，但这条断言让原因一目了然。
  assert.ok(!TERMINAL_EVENTS.has("error"), "error 不是终态：任务可能仍在运行");
});

test("回归：不发终态事件的错误码必须在白名单里", () => {
  // 服务端这几条走的都是「发完 error 直接 break」的路径，后面**没有**
  // task_complete / process_close / aborted 跟上。漏掉任何一个，界面就会
  // 永久停在「正在思考…」，且输入框受限、后续消息带 continueActive。
  //
  // 这条曾经真的漏过：把 error 移出终态集合时只想到了参数校验类错误，
  // 忘了「选了第三方供应商但没配 Key」也走同一条路。
  for (const code of [
    "UNKNOWN_PROVIDER", // chatHandler.ts:442
    "PROVIDER_NOT_CONFIGURED", // chatHandler.ts:450
    "WORKFLOW_ERROR", // chatHandler.ts:777
  ]) {
    assert.ok(
      TASK_NEVER_STARTED_CODES.has(code),
      `${code} 不发终态事件，必须列入白名单，否则界面永久卡在「运行中」`,
    );
  }
});
