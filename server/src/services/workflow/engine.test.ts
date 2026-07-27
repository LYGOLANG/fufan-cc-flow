import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowEngine, substituteVariables } from "./engine.js";
import type { StepRunner, StepRunInput, StepResult } from "./stepRunner.js";
import type { Workflow, RunState } from "./types.js";

/**
 * 编排引擎的分支覆盖测试。
 *
 * 全部用 fake 执行器驱动，不做任何真实模型调用 —— 编排的正确性是确定性逻辑，
 * 不该靠「跑一遍看看」验收，那样既慢又不可重复，还会因模型输出波动而假失败。
 */

/** 让出一轮事件循环，等待引擎推进到下一个可观察状态 */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** 记录调用顺序的 fake 执行器 */
class FakeRunner implements StepRunner {
  calls: StepRunInput[] = [];
  constructor(private readonly script: (input: StepRunInput, callNo: number) => StepResult) {}
  async runStep(input: StepRunInput): Promise<StepResult> {
    this.calls.push({ ...input });
    return this.script(input, this.calls.length);
  }
}

function wf(steps: Workflow["steps"], extra: Partial<Workflow> = {}): Workflow {
  return { id: "w1", name: "测试工作流", steps, variables: [], ...extra };
}

const ok = (output: string): StepResult => ({ ok: true, output });
const fail = (reason: string): StepResult => ({ ok: false, reason });

// ── 顺序执行 ──

test("三步按序执行，后一步在前一步返回之后才启动", async () => {
  const order: string[] = [];
  const runner: StepRunner = {
    async runStep(input) {
      order.push(`start${input.index}`);
      await tick(); // 制造异步间隙
      order.push(`end${input.index}`);
      return ok(`out${input.index}`);
    },
  };
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一" },
      { agent: null, prompt: "二" },
      { agent: null, prompt: "三" },
    ]),
    runner,
  });
  const state = await engine.run();

  assert.equal(state.status, "completed");
  // 关键:不能出现 start1 早于 end0 这类交错
  assert.deepEqual(order, ["start0", "end0", "start1", "end1", "start2", "end2"]);
});

test("空工作流直接完成，不报错", async () => {
  const engine = new WorkflowEngine({ workflow: wf([]), runner: new FakeRunner(() => ok("")) });
  const state = await engine.run();
  assert.equal(state.status, "completed");
  assert.equal(state.steps.length, 0);
});

// ── 数据传递 ──

test("上一步的产出通过 outputVar 注入下一步的提示词", async () => {
  const runner = new FakeRunner((_input, n) => ok(n === 1 ? "卖方结论A" : "buy"));
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "分析卖方", outputVar: "sell" },
      { agent: null, prompt: "基于 $sell 给出买方观点" },
    ]),
    runner,
  });
  await engine.run();

  assert.equal(runner.calls[1].prompt, "基于 卖方结论A 给出买方观点");
});

test("运行前填写的输入变量同样参与替换", async () => {
  const runner = new FakeRunner(() => ok("done"));
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "研究 $ticker" }], { variables: ["ticker"] }),
    inputs: { ticker: "600519" },
    runner,
  });
  await engine.run();
  assert.equal(runner.calls[0].prompt, "研究 600519");
});

test("未声明 outputVar 的步骤不产生变量", async () => {
  const runner = new FakeRunner(() => ok("产出"));
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner,
  });
  const state = await engine.run();
  assert.deepEqual(state.variables, {});
});

test("变量替换按长名优先，$ab 不会被 $a 截胡", () => {
  assert.equal(substituteVariables("$a|$ab", { a: "A", ab: "AB" }), "A|AB");
});

test("未定义的变量原样保留，不替换成 undefined", () => {
  assert.equal(substituteVariables("值是 $missing", {}), "值是 $missing");
});

// ── 失败处置 ──

test("默认失败即暂停，停在该步等待处置", async () => {
  const runner = new FakeRunner(() => fail("模型报错"));
  const states: RunState[] = [];
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一" },
      { agent: null, prompt: "二" },
    ]),
    runner,
    onChange: (s) => states.push(s),
  });
  const done = engine.run();
  await tick();

  const cur = engine.getState();
  assert.equal(cur.status, "awaiting", "应停下来等用户处置");
  assert.equal(cur.steps[0].status, "failed");
  assert.equal(cur.steps[0].error, "模型报错");
  assert.equal(cur.steps[1].status, "pending", "后续步骤不得自动继续");

  engine.resolve("abort");
  await done;
  assert.equal(runner.calls.length, 1, "中止后不应再执行任何步骤");
});

test("处置为重试：重跑同一步，成功后继续", async () => {
  let firstTry = true;
  const runner = new FakeRunner(() => {
    if (firstTry) {
      firstTry = false;
      return fail("超时");
    }
    return ok("成功了");
  });
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner,
  });
  const done = engine.run();
  await tick();
  assert.equal(engine.getState().status, "awaiting");

  engine.resolve("retry");
  const state = await done;

  assert.equal(state.status, "completed");
  assert.equal(state.steps[0].status, "succeeded");
  assert.equal(state.steps[0].attempts, 2, "应记录两次尝试");
  assert.equal(runner.calls.length, 2);
});

test("处置为跳过：该步标记 skipped，后续步骤照常执行", async () => {
  const runner = new FakeRunner((_i, n) => (n === 1 ? fail("挂了") : ok("ok2")));
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一" },
      { agent: null, prompt: "二" },
    ]),
    runner,
  });
  const done = engine.run();
  await tick();
  engine.resolve("skip");
  const state = await done;

  assert.equal(state.status, "completed");
  assert.equal(state.steps[0].status, "skipped");
  assert.equal(state.steps[1].status, "succeeded");
});

test("处置为中止：整个运行结束，剩余步骤标记 aborted", async () => {
  const runner = new FakeRunner(() => fail("挂了"));
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一" },
      { agent: null, prompt: "二" },
    ]),
    runner,
  });
  const done = engine.run();
  await tick();
  engine.resolve("abort");
  const state = await done;

  assert.equal(state.status, "aborted");
  assert.equal(state.steps[1].status, "aborted", "未执行的步骤不应停留在 pending");
  assert.ok(state.message, "应说明中止原因");
});

test("步骤策略 skip：失败后自动跳过，不打扰用户", async () => {
  const runner = new FakeRunner((_i, n) => (n === 1 ? fail("忽略我") : ok("ok")));
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一", onFailure: "skip" },
      { agent: null, prompt: "二" },
    ]),
    runner,
  });
  const state = await engine.run();
  assert.equal(state.status, "completed");
  assert.equal(state.steps[0].status, "skipped");
});

test("步骤策略 abort：失败即中止整个运行", async () => {
  const runner = new FakeRunner(() => fail("致命"));
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一", onFailure: "abort" },
      { agent: null, prompt: "二" },
    ]),
    runner,
  });
  const state = await engine.run();
  assert.equal(state.status, "aborted");
  assert.match(state.message ?? "", /第 1 步/);
});

test("步骤策略 retry：自动重试一次，仍失败则转为询问", async () => {
  const runner = new FakeRunner(() => fail("一直失败"));
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一", onFailure: "retry" }]),
    runner,
  });
  const done = engine.run();
  await tick();

  // 自动重试一次后仍失败 → 不该无限空转，应停下来问人
  assert.equal(engine.getState().status, "awaiting");
  assert.equal(runner.calls.length, 2, "应自动重试过一次");

  engine.resolve("abort");
  await done;
});

test("执行器抛异常等同于失败，不会炸掉整个运行", async () => {
  const runner: StepRunner = {
    async runStep() {
      throw new Error("网络断了");
    },
  };
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner,
  });
  const done = engine.run();
  await tick();

  assert.equal(engine.getState().steps[0].error, "网络断了");
  engine.resolve("abort");
  await done;
});

// ── 中断 ──

/**
 * 可挂起的执行器：让某一步停在执行中，以便精确模拟「用户在某步跑到一半时
 * 点了停止」。真实场景里一步要跑几秒到几分钟，中止必然发生在步骤执行期间，
 * 用同步返回的 fake 测不出这个时序。
 */
function suspendableRunner(suspendAtIndex: number) {
  let release!: () => void;
  const started: number[] = [];
  const runner: StepRunner = {
    async runStep(input) {
      started.push(input.index);
      if (input.index === suspendAtIndex) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return ok(`out${input.index}`);
    },
  };
  return { runner, started, release: () => release() };
}

test("运行中中止：当前步骤跑完后不再启动新步骤", async () => {
  const { runner, started, release } = suspendableRunner(0);
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一" },
      { agent: null, prompt: "二" },
      { agent: null, prompt: "三" },
    ]),
    runner,
  });

  const p = engine.run();
  await tick(); // 等第一步开始并挂住
  assert.deepEqual(started, [0], "此刻应只有第一步在跑");

  engine.abort(); // 用户在第一步执行途中点了停止
  release(); // 第一步随后返回
  const state = await p;

  assert.equal(state.status, "aborted");
  assert.deepEqual(started, [0], "中止后不得再启动第二、三步");
  assert.equal(state.steps[1].status, "aborted");
  assert.equal(state.steps[2].status, "aborted");
});

test("中止后已完成步骤的产出仍然保留", async () => {
  const { runner, release } = suspendableRunner(1);
  const engine = new WorkflowEngine({
    workflow: wf([
      { agent: null, prompt: "一", outputVar: "a" },
      { agent: null, prompt: "二" },
    ]),
    runner,
  });

  const p = engine.run();
  await tick(); // 第一步已完成，第二步挂住
  engine.abort();
  release();
  const state = await p;

  assert.equal(state.status, "aborted");
  assert.equal(state.steps[0].status, "succeeded");
  assert.equal(state.steps[0].output, "out0");
  assert.equal(state.variables.a, "out0", "已产出的变量不应因中止而丢失");
});

test("中止已结束的运行是空操作，不改变终态", async () => {
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner: new FakeRunner(() => ok("x")),
  });
  const state = await engine.run();
  assert.equal(state.status, "completed");
  engine.abort();
  assert.equal(engine.getState().status, "completed", "不应把已完成改写成已中止");
});

test("非等待态下的 resolve 被忽略，返回 false", async () => {
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner: new FakeRunner(() => ok("x")),
  });
  assert.equal(engine.resolve("retry"), false);
});

// ── 状态推送与快照 ──

test("每次状态变化都会回调，且回调拿到的是快照", async () => {
  const seen: RunState[] = [];
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner: new FakeRunner(() => ok("x")),
    onChange: (s) => seen.push(s),
  });
  await engine.run();

  assert.ok(seen.length >= 2, "至少应有「开始执行」和「完成」两次推送");
  // 快照隔离:改回调里拿到的对象，不应影响引擎内部状态
  seen[0].steps[0].status = "failed";
  assert.notEqual(engine.getState().steps[0].status, "failed");
});

test("步骤记录开始与结束时间", async () => {
  let t = 1000;
  const engine = new WorkflowEngine({
    workflow: wf([{ agent: null, prompt: "一" }]),
    runner: new FakeRunner(() => ok("x")),
    now: () => (t += 10),
  });
  const state = await engine.run();
  assert.ok(state.steps[0].startedAt! > 0);
  assert.ok(state.steps[0].finishedAt! > state.steps[0].startedAt!);
});

// ── 旧数据兼容 ──

test("回归:编排引擎上线前创建的工作流原样可跑", async () => {
  // 旧文件没有 version / outputVar / onFailure 字段
  const legacy = {
    id: "old",
    name: "旧工作流",
    steps: [
      { agent: null, prompt: "第一步" },
      { agent: "研究员", prompt: "第二步" },
    ],
    variables: [],
  } as Workflow;

  const runner = new FakeRunner(() => ok("ok"));
  const state = await new WorkflowEngine({ workflow: legacy, runner }).run();

  assert.equal(state.status, "completed");
  assert.equal(runner.calls.length, 2);
  assert.equal(runner.calls[1].agent, "研究员", "指定的 Agent 应原样传给执行器");
});
