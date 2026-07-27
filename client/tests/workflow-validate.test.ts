import assert from "node:assert/strict";
import test from "node:test";
import {
  validateWorkflowDraft,
  extractReferencedVars,
} from "../src/utils/workflowValidate";
import type { Workflow } from "../src/types/workflow";

/**
 * 前端校验规则的测试。
 *
 * 这份实现与 server/src/services/workflow/validate.ts 是同一套规则的两份代码
 * （前端不能 import 服务端代码）。两边的测试用例刻意保持对应：任何一边改了
 * 规则却忘了同步另一边，就会出现「界面放行但保存被拒」或反过来的割裂体验，
 * 而那种 bug 靠人工点是很难稳定复现的。
 */

function wf(steps: Workflow["steps"], variables: string[] = []): Workflow {
  return { id: "w", name: "测试", steps, variables };
}
const messages = (w: Workflow) => validateWorkflowDraft(w).map((i) => i.message);

test("提取引用的变量名", () => {
  assert.deepEqual(extractReferencedVars("基于 $sell 和 $buy").sort(), ["buy", "sell"]);
});

test("$100 不算变量（变量名不以数字开头）", () => {
  assert.deepEqual(extractReferencedVars("花了 $100 元"), []);
});

test("合法工作流无问题", () => {
  const w = wf([
    { agent: null, prompt: "分析卖方", outputVar: "sell" },
    { agent: null, prompt: "基于 $sell 给买方观点" },
  ]);
  assert.deepEqual(validateWorkflowDraft(w), []);
});

test("旧工作流（无新字段）照样合法", () => {
  assert.deepEqual(
    validateWorkflowDraft(wf([{ agent: null, prompt: "一" }, { agent: "研究员", prompt: "二" }])),
    []
  );
});

test("引用后面步骤的产出：指出它由第几步产出", () => {
  const w = wf([
    { agent: null, prompt: "先用 $later" },
    { agent: null, prompt: "产出", outputVar: "later" },
  ]);
  assert.match(messages(w)[0], /由第 2 步产出/);
});

test("引用不存在的变量：提示无人产出", () => {
  assert.match(messages(wf([{ agent: null, prompt: "用 $ghost" }]))[0], /没有任何步骤产出它/);
});

test("输入变量在第一步即可引用", () => {
  assert.deepEqual(validateWorkflowDraft(wf([{ agent: null, prompt: "研究 $t" }], ["t"])), []);
});

test("非法变量名被拒绝", () => {
  for (const bad of ["1abc", "a-b", "a b"]) {
    assert.ok(
      messages(wf([{ agent: null, prompt: "x", outputVar: bad }])).some((m) => m.includes("不合法")),
      `${bad} 应被拒绝`
    );
  }
});

test("输出变量与输入变量重名会提示覆盖", () => {
  assert.ok(messages(wf([{ agent: null, prompt: "x", outputVar: "dup" }], ["dup"])).some((m) => /重名/.test(m)));
});

test("空名称、空步骤、空提示词都被拒绝", () => {
  assert.ok(validateWorkflowDraft({ id: "w", name: "", steps: [], variables: [] }).length >= 2);
  assert.ok(messages(wf([{ agent: null, prompt: "  " }])).some((m) => /提示词不能为空/.test(m)));
});

test("问题带步骤序号，便于界面定位", () => {
  const issues = validateWorkflowDraft(
    wf([{ agent: null, prompt: "ok" }, { agent: null, prompt: "" }])
  );
  assert.equal(issues[0].stepIndex, 1);
});
