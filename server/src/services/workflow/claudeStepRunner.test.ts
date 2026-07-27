import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { ClaudeStepRunner, type TurnController } from "./claudeStepRunner.js";

/**
 * 「事件流 → Promise」适配层的测试。
 *
 * 这一层是竞态与监听器泄漏的高发区：先发后订会漏掉事件（该步永远等不到完成）、
 * 解绑漏掉会让监听器随每步累积（后续步骤收到属于前面步骤的事件）。这些故障
 * 都不会立刻报错，只会表现为「偶尔卡住」或「串台」，靠手工点几下测不出来。
 */

/** 用真实 EventEmitter 驱动的 fake 控制器，便于断言监听器数量 */
function makeController(opts: { onStart?: () => void | Promise<void> } = {}) {
  const bus = new EventEmitter();
  // 裸 EventEmitter 在 "error" 无监听器时会直接抛（ERR_UNHANDLED_ERROR）。
  // 真实环境不会这样：chatHandler 自己一直挂着 error 监听，claudeAgentService
  // 也覆写了 emit 做降级。这里补一个常驻兜底监听，让 fake 与生产行为一致，
  // 否则测「解绑后迟到的 error」时会被 EventEmitter 自身的行为干扰。
  bus.on("error", () => {});
  const state = { started: 0, interrupted: 0, lastPrompt: "", lastAgent: null as string | null };

  const ctl: TurnController = {
    async startTurn(input) {
      state.started += 1;
      state.lastPrompt = input.prompt;
      state.lastAgent = input.agent;
      await opts.onStart?.();
    },
    interrupt() {
      state.interrupted += 1;
    },
    on(event: string, handler: (p: never) => void) {
      bus.on(event, handler as (...args: unknown[]) => void);
      return () => bus.off(event, handler as (...args: unknown[]) => void);
    },
  };
  return { ctl, bus, state };
}

const tick = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

// ── 正常完成 ──

test("收到 task_complete 即返回，result 作为该步产出", async () => {
  const { ctl, bus } = makeController();
  const runner = new ClaudeStepRunner(ctl);
  const p = runner.runStep({ prompt: "干活", agent: null, index: 0 });
  await tick();

  bus.emit("task_complete", { result: "  做完了  ", isError: false });
  const r = await p;

  assert.deepEqual(r, { ok: true, output: "做完了" }, "应去掉首尾空白");
});

test("result 为空时回退到累积的流式文本", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();

  bus.emit("assistant_text", { text: "第一段" });
  bus.emit("assistant_text", { text: "第二段" });
  bus.emit("task_complete", { result: "" });
  const r = await p;

  assert.equal(r.ok && r.output, "第一段第二段");
});

test("prompt 与 agent 原样传给底层", async () => {
  const { ctl, bus, state } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "研究 A", agent: "分析师", index: 2 });
  await tick();
  bus.emit("task_complete", { result: "ok" });
  await p;

  assert.equal(state.lastPrompt, "研究 A");
  assert.equal(state.lastAgent, "分析师");
});

// ── 失败路径 ──

test("isError 为真即判失败，不看文本内容", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();
  bus.emit("task_complete", { result: "出错了：额度不足", isError: true });
  const r = await p;

  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /额度不足/);
});

test("空产出按失败处理，避免把空字符串喂给下一步", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();
  bus.emit("task_complete", { result: "   " });
  const r = await p;

  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /没有产生任何输出/);
});

test("error 事件即失败，带上错误信息", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();
  bus.emit("error", { code: "PROCESS_ERROR", message: "CLI 崩溃" });
  const r = await p;

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "CLI 崩溃");
});

test("进程关闭却没等到 task_complete，判为该步未完成", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();
  bus.emit("close", { code: 1 });
  const r = await p;

  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /未能完成/);
});

test("发起失败（startTurn 抛错）即判该步失败", async () => {
  const { ctl } = makeController({
    onStart: () => {
      throw new Error("供应商未配置");
    },
  });
  const r = await new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "供应商未配置");
});

// ── 中断 ──

test("执行中收到中断信号：调用 interrupt 并标记 aborted", async () => {
  const { ctl, state } = makeController();
  const ac = new AbortController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 }, ac.signal);
  await tick();

  ac.abort();
  const r = await p;

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.aborted, true, "必须标记 aborted，引擎据此区分「出错」与「被叫停」");
  assert.equal(state.interrupted, 1, "应真的去中断底层任务，而不是只丢弃结果");
});

test("进来时信号已中断则直接返回，不发起任何轮次", async () => {
  const { ctl, state } = makeController();
  const ac = new AbortController();
  ac.abort();
  const r = await new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 }, ac.signal);

  assert.equal(r.ok === false && r.aborted, true);
  assert.equal(state.started, 0, "已中断就不该再发起新的一轮");
});

// ── 竞态与泄漏 ──

test("先注册监听再发起：startTurn 期间到达的事件不会漏", async () => {
  // 模拟极端情况:startTurn 的 await 还没返回，完成事件就到了。
  // 用对象持有回调而非裸变量——onStart 闭包要在 bus 创建之前就引用它。
  const trigger: { fire?: () => void } = {};
  const { ctl, bus } = makeController({
    onStart: async () => {
      trigger.fire?.();
      await tick();
    },
  });
  const runner = new ClaudeStepRunner(ctl);
  trigger.fire = () => bus.emit("task_complete", { result: "抢先完成" });

  const r = await runner.runStep({ prompt: "x", agent: null, index: 0 });
  assert.equal(r.ok && r.output, "抢先完成", "先发后订会导致这一步永远等不到完成");
});

test("结束后解绑全部监听器，多步连续执行不累积", async () => {
  const { ctl, bus } = makeController();
  const runner = new ClaudeStepRunner(ctl);

  const before = bus.eventNames().length;
  for (let i = 0; i < 5; i++) {
    const p = runner.runStep({ prompt: `第${i}步`, agent: null, index: i });
    await tick();
    bus.emit("task_complete", { result: `out${i}` });
    await p;
  }

  for (const name of ["task_complete", "assistant_text", "close"]) {
    assert.equal(
      bus.listenerCount(name),
      0,
      `${name} 的监听器未解绑 —— 连续执行会不断累积，最终串台或触发 MaxListenersExceeded`
    );
  }
  // error 上有 makeController 装的常驻兜底监听，故期望值是 1 而非 0
  assert.equal(bus.listenerCount("error"), 1, "error 监听器也应解绑，只剩兜底那一个");
  assert.ok(bus.eventNames().length >= before - 4);
});

test("重复事件只结算一次，后到的被忽略", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  await tick();

  bus.emit("task_complete", { result: "第一次" });
  bus.emit("task_complete", { result: "第二次" });
  bus.emit("error", { message: "迟到的错误" });
  const r = await p;

  assert.equal(r.ok && r.output, "第一次");
});

test("中断后再到达的完成事件不会翻案", async () => {
  const { ctl, bus } = makeController();
  const ac = new AbortController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 }, ac.signal);
  await tick();

  ac.abort();
  bus.emit("task_complete", { result: "其实我完成了" });
  const r = await p;

  assert.equal(r.ok, false, "已按中断结算，迟到的成功不应改写结果");
});

// ── 超时 ──

test("配置超时后未完成即失败，并中断底层任务", async () => {
  const { ctl, state } = makeController();
  const runner = new ClaudeStepRunner(ctl, { timeoutMs: 20 });
  const r = await runner.runStep({ prompt: "x", agent: null, index: 0 });

  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /未完成/);
  assert.equal(state.interrupted, 1, "超时必须真的中断，否则任务在后台继续烧钱");
});

test("默认不设超时：长任务不会被武断掐断", async () => {
  const { ctl, bus } = makeController();
  const p = new ClaudeStepRunner(ctl).runStep({ prompt: "x", agent: null, index: 0 });
  // 等待远超任何默认超时的时间
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 60);
  });
  bus.emit("task_complete", { result: "慢但成功" });
  const r = await p;

  assert.equal(r.ok && r.output, "慢但成功");
});
