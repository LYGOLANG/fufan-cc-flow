import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflow, extractReferencedVars, assertValidWorkflow } from "./validate.js";
import type { Workflow } from "./types.js";

function wf(steps: Workflow["steps"], variables: string[] = []): Workflow {
  return { id: "w", name: "测试", steps, variables };
}
const messages = (w: Workflow) => validateWorkflow(w).map((i) => i.message);

// ── 变量提取 ──

test("提取提示词里引用的变量名", () => {
  assert.deepEqual(extractReferencedVars("基于 $sell 和 $buy 分析").sort(), ["buy", "sell"]);
});

test("变量名不以数字开头，$1 不算变量", () => {
  assert.deepEqual(extractReferencedVars("花了 $100 元"), []);
});

test("重复引用只算一次", () => {
  assert.deepEqual(extractReferencedVars("$a 和 $a"), ["a"]);
});

// ── 正常情况 ──

test("合法工作流无问题", () => {
  const w = wf([
    { agent: null, prompt: "分析卖方", outputVar: "sell" },
    { agent: null, prompt: "基于 $sell 给买方观点" },
  ]);
  assert.deepEqual(validateWorkflow(w), []);
});

test("输入变量在第一步即可引用", () => {
  const w = wf([{ agent: null, prompt: "研究 $ticker" }], ["ticker"]);
  assert.deepEqual(validateWorkflow(w), []);
});

test("旧工作流（无 outputVar / onFailure）照样合法", () => {
  const w = wf([
    { agent: null, prompt: "第一步" },
    { agent: "研究员", prompt: "第二步" },
  ]);
  assert.deepEqual(validateWorkflow(w), []);
});

// ── 引用顺序 ──

test("引用后面步骤产出的变量：明确指出它由第几步产出", () => {
  const w = wf([
    { agent: null, prompt: "先用 $later" },
    { agent: null, prompt: "产出它", outputVar: "later" },
  ]);
  const msgs = messages(w);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /第 1 步引用了 \$later/);
  assert.match(msgs[0], /由第 2 步产出/, "必须说清是顺序问题，而不是「不存在」");
});

test("引用根本不存在的变量：提示没有任何步骤产出它", () => {
  const w = wf([{ agent: null, prompt: "用 $ghost" }]);
  const msgs = messages(w);
  assert.match(msgs[0], /没有任何步骤产出它/);
});

test("引用自己这一步的输出变量也算顺序错误", () => {
  // 该步还没跑完，它的产出当然不能用在自己的提示词里
  const w = wf([{ agent: null, prompt: "用 $self", outputVar: "self" }]);
  assert.ok(messages(w).some((m) => /\$self/.test(m)));
});

// ── 变量名合法性 ──

test("非法变量名被拒绝", () => {
  for (const bad of ["1abc", "a-b", "a b", "中文名"]) {
    const w = wf([{ agent: null, prompt: "x", outputVar: bad }]);
    assert.ok(
      messages(w).some((m) => m.includes("不合法")),
      `${bad} 应被拒绝`
    );
  }
});

test("合法变量名放行", () => {
  for (const good of ["a", "_x", "sellSide", "step_1"]) {
    const w = wf([{ agent: null, prompt: "x", outputVar: good }]);
    assert.deepEqual(validateWorkflow(w), [], `${good} 应放行`);
  }
});

test("输出变量与输入变量重名：提示会覆盖", () => {
  const w = wf([{ agent: null, prompt: "x", outputVar: "dup" }], ["dup"]);
  assert.ok(messages(w).some((m) => /重名/.test(m)));
});

// ── 结构 ──

test("名称为空、步骤为空被拒绝", () => {
  assert.ok(validateWorkflow({ id: "w", name: "", steps: [], variables: [] }).length >= 2);
});

test("空提示词被拒绝", () => {
  const w = wf([{ agent: null, prompt: "   " }]);
  assert.ok(messages(w).some((m) => /提示词不能为空/.test(m)));
});

test("问题带上步骤序号，便于界面定位到具体那一步", () => {
  const w = wf([
    { agent: null, prompt: "ok" },
    { agent: null, prompt: "" },
  ]);
  const issues = validateWorkflow(w);
  assert.equal(issues[0].stepIndex, 1);
});

// ── 抛错版本 ──

test("assertValidWorkflow 合法时不抛，非法时抛 400", () => {
  assert.doesNotThrow(() => assertValidWorkflow(wf([{ agent: null, prompt: "x" }])));
  assert.throws(
    () => assertValidWorkflow(wf([{ agent: null, prompt: "用 $ghost" }])),
    (e: Error & { statusCode?: number }) => e.statusCode === 400
  );
});
