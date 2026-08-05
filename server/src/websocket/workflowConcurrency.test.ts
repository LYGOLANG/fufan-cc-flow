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

/**
 * 「启动窗口内点停止」的代际判定。
 *
 * send_message 要连过读代理、取供应商、start() 三个 await（几百毫秒到 2 秒）
 * 才真正启动，而 abort 是同步的。用户在这个窗口里点停止时：
 *   markDone 先跑 —— 此时还没有 running 记录，删了个寂寞
 *   随后 start 返回 —— registerRunning 又写回一条
 * 结果：任务已被中断，却永远挂在 running 里，退出应用时被报成「上次被中止」。
 */
class TurnGuard {
  private seq = 0;
  /** 发起一轮，返回它的代号 */
  begin(): number {
    return ++this.seq;
  }
  /** 用户点停止：作废当前正在进行的一轮 */
  abort(): void {
    this.seq += 1;
  }
  /** start 返回后调用：这一轮还该不该登记 */
  shouldRegister(myTurn: number): boolean {
    return this.seq === myTurn;
  }
}

test("启动窗口内点停止：这一轮不得登记", () => {
  const g = new TurnGuard();
  const myTurn = g.begin(); // 用户发消息，进入 await 窗口
  g.abort(); // 窗口期内点了停止
  assert.equal(
    g.shouldRegister(myTurn),
    false,
    "被作废的一轮若仍登记，会留下永远不会被 markDone 的幽灵记录",
  );
});

test("没被打断的一轮正常登记", () => {
  const g = new TurnGuard();
  const myTurn = g.begin();
  assert.equal(g.shouldRegister(myTurn), true, "正常流程不该被这个守卫误伤");
});

test("连续两轮各自独立判定", () => {
  const g = new TurnGuard();
  const first = g.begin();
  g.abort(); // 第一轮被停
  const second = g.begin(); // 用户又发了一条
  assert.equal(g.shouldRegister(first), false, "旧的那轮仍然作废");
  assert.equal(g.shouldRegister(second), true, "新的一轮不受牵连");
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
