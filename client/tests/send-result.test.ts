import assert from "node:assert/strict";
import test from "node:test";
import { HttpChatConnection } from "../src/services/transport/http-chat";

/**
 * 「发送是否真的送出去了」这一契约的测试。
 *
 * 背景：连接断开时，除 send_message 外的动作会被**直接丢弃**（send_message
 * 有排队重试，其余没有）。而调用方此前不看返回值就更新 UI：
 *   - 点「停止」→ 帧被丢，但「运行中」指示灯灭了。服务端有 30 秒寄存宽限，
 *     任务照常在跑、照常计费，用户却以为停住了。
 *   - 点「允许」→ 帧被丢，但权限卡被乐观改成「运行中」且 requestId 被清掉，
 *     用户再也点不了；60 秒后服务端自动拒绝，工具莫名失败。
 *
 * 界面说谎比界面没反应更糟，所以 send 必须如实回报，调用方必须据此决定
 * 要不要动 UI。这几条锁住的就是这个契约。
 */

/** 未 connect() 的连接：内部 ws 为 null，等价于「断开」状态 */
function disconnected() {
  return new HttpChatConnection("C:/some/project");
}

test("连接断开时 abort 返回 false（不能让调用方以为停住了）", () => {
  assert.equal(disconnected().send("abort", {}), false);
});

test("连接断开时 permission_response 返回 false", () => {
  assert.equal(
    disconnected().send("permission_response", { requestId: "r1", decision: "allow" }),
    false
  );
});

test("连接断开时 shutdown / 工作流指令同样返回 false", () => {
  const c = disconnected();
  for (const action of ["shutdown", "workflow_start", "workflow_resolve", "workflow_abort"]) {
    assert.equal(c.send(action, {}), false, `${action} 应如实回报未送达`);
  }
});

test("send_message 是唯一例外：进队列等重连，返回 true", () => {
  // 它有 15 秒排队窗口 + 超时后的明确报错，所以可以先回 true。
  // 其余动作没有这套机制，不能照搬。
  const c = disconnected();
  assert.equal(c.send("send_message", { prompt: "hi" }), true);
  c.close(); // 清掉排队定时器，避免测试进程挂住
});

test("connected 在未连接时为 false", () => {
  assert.equal(disconnected().connected, false);
});
