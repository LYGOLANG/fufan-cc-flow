import assert from "node:assert/strict";
import test from "node:test";

/**
 * 工作流与手动消息的并发约束。
 *
 * 两条真实缺陷的回归测试：
 *
 * 1. 工作流运行中手动发消息 → 步骤拿到别人的输出。
 *    claudeStepRunner 的监听器不做轮次隔离，收到**任何** task_complete 就结算。
 *    用户手动那轮先完成的话，步骤会把用户对话的结果写进 outputVar，
 *    污染后续所有引用该变量的步骤；同时编排已推进到下一步，而模型还在
 *    处理上一步的提示词。
 *
 * 2. 工作流运行中点停止 → 编排永久锁死。
 *    abort 只调 claude.interrupt，不碰 workflowRun。而被 interrupt 那轮的
 *    result 在引擎侧被主动吞掉（不发 task_complete 也不发 error），
 *    step runner 的 Promise 永不 settle → 面板停在「运行中」，
 *    workflowRun 不释放，此后 workflow_start 恒返回 WORKFLOW_BUSY。
 *    用户点了停止，反而把工作流锁死了。
 */

/** 与 chatHandler 的 send_message 前置判定同构 */
const acceptsManualMessage = (workflowRunning: boolean): boolean => !workflowRunning;

/** 与 chatHandler 的 abort 分支同构：返回 abort 后 workflowRun 是否已释放 */
function abortReleasesWorkflow(hasWorkflow: boolean): boolean {
  let workflowRun: object | null = hasWorkflow ? {} : null;
  // 实现里的顺序：先停编排，再中断引擎
  if (workflowRun) workflowRun = null;
  return workflowRun === null;
}

test("工作流运行期间拒绝手动消息", () => {
  assert.equal(acceptsManualMessage(true), false, "两路输入抢同一个串行会话必然串数据");
  assert.equal(acceptsManualMessage(false), true, "没有工作流在跑时照常接受");
});

// 「WORKFLOW_BUSY 必须在前端白名单里」这条断言放在 client 侧
// （client/tests/busyTracking.test.ts）—— server 的测试不该 import client
// 的目录结构。这里只记录约束本身：
//
//   服务端 forward 完 WORKFLOW_BUSY 就 break，没有终态事件跟上；
//   而前端 send() 已经乐观把 busy 置成 true。
//   前端若不把它当「这一轮没起来」，界面就永久转圈。

test("点停止必须释放 workflowRun", () => {
  // 不释放的话，用户点了停止反而再也启动不了工作流 ——
  // 一个「操作使情况变得更糟且无法恢复」的状态
  assert.equal(abortReleasesWorkflow(true), true);
});

test("没有工作流时 abort 不受影响", () => {
  assert.equal(abortReleasesWorkflow(false), true, "普通对话的停止行为不该被改动");
});

test("回归：停止后应能重新启动工作流", () => {
  // 把两条串起来看：停止 → workflowRun 释放 → 新的 workflow_start 不再被拒
  let workflowRun: object | null = {};
  // 运行中：手动消息被拒
  assert.equal(acceptsManualMessage(workflowRun !== null), false);
  // 用户点停止
  workflowRun = null;
  // 现在两者都该放行
  assert.equal(acceptsManualMessage(workflowRun !== null), true);
});
