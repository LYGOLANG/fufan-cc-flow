import assert from "node:assert/strict";
import test from "node:test";
import { spawnFingerprint } from "./claudeAgentService.js";
import type { AgentServiceOptions } from "../types/claude.js";

/**
 * 常驻进程指纹的契约测试。
 *
 * 这是对话主链路里最容易出**静默** bug 的一处：新增一个影响 query 行为的选项
 * 却忘了加进指纹，不会有任何报错，只会表现为「设置改了不生效，要重开会话
 * 才行」。本轮就踩过两次（maxBudget、thinking）。
 *
 * 反过来，里面有两处**刻意的例外**看着像遗漏 —— 被后来者"顺手修复"会架空
 * 进程复用、连带杀掉正在跑的后台 sub-agent。这些同样必须锁住。
 *
 * ⚠️ 往 AgentServiceOptions 加影响行为的字段时，请同步在这里加一条用例。
 */

const base: AgentServiceOptions = {
  prompt: "hi",
  projectPath: "C:/proj",
};

/** 改一个字段后指纹是否变化 */
function changes(patch: Partial<AgentServiceOptions>): boolean {
  return spawnFingerprint(base) !== spawnFingerprint({ ...base, ...patch });
}

test("相同参数得到相同指纹（否则每条消息都会换进程）", () => {
  assert.equal(spawnFingerprint(base), spawnFingerprint({ ...base }));
  // prompt 不该影响指纹 —— 它每条消息都不同，入了指纹就等于永不复用
  assert.equal(changes({ prompt: "完全不同的一句话" }), false);
});

test("这些字段一变就必须换进程", () => {
  const mustChange: [string, Partial<AgentServiceOptions>][] = [
    ["projectPath", { projectPath: "D:/other" }],
    ["baseUrl（换端点）", { baseUrl: "https://api.example.com" }],
    ["authToken", { authToken: "tok" }],
    ["apiKey", { apiKey: "sk-x" }],
    ["effort（推理力度）", { effort: "high" }],
    ["ultracode", { ultracode: true }],
    ["maxBudget（费用上限）", { maxBudget: 5 }],
    ["thinking（扩展思考开关）", { thinking: false }],
    ["thinkingBudget（思考预算）", { thinkingBudget: 8000 }],
    ["mcpVersion（MCP 配置版本）", { mcpVersion: 2 }],
    ["httpProxy", { httpProxy: "http://127.0.0.1:7890" }],
    ["httpsProxy", { httpsProxy: "http://127.0.0.1:7890" }],
  ];
  for (const [label, patch] of mustChange) {
    assert.equal(changes(patch), true, `${label} 变了却没换进程 → 设置改了不生效`);
  }
});

test("刻意例外一：fallbackModel 不入指纹", () => {
  // 它由 model 家族派生。若入指纹，官方端点跨家族换模型（opus↔sonnet）会因
  // 指纹变化走杀进程重启，架空 tryReuseLive 的热切并连带杀掉后台 sub-agent。
  // 代价只是热切后本进程的 fallback 链略陈旧（仅过载时触发、且指向同族）。
  assert.equal(
    changes({ fallbackModel: "claude-sonnet-5" }),
    false,
    "fallbackModel 入了指纹会架空模型热切"
  );
});

test("刻意例外二：官方端点下换 model 不换进程，第三方端点下换 model 要换", () => {
  // 官方端点靠 SDK 的 setModel 热切，不必重启；第三方兼容端点没有这条路，
  // 模型是启动参数的一部分，必须换进程。
  assert.equal(changes({ model: "opus" }), false, "官方端点换模型应走热切");

  const compat = { ...base, baseUrl: "https://third.party/v1" };
  assert.notEqual(
    spawnFingerprint(compat),
    spawnFingerprint({ ...compat, model: "opus" }),
    "第三方端点换模型必须换进程"
  );
});

test("缺省值与显式等价值应产生相同指纹（避免无谓重启）", () => {
  // 前端有时传 undefined、有时传 0/""，两者语义相同，不该因此换进程
  assert.equal(spawnFingerprint(base), spawnFingerprint({ ...base, thinkingBudget: 0 }));
  assert.equal(spawnFingerprint(base), spawnFingerprint({ ...base, maxBudget: 0 }));
  assert.equal(spawnFingerprint(base), spawnFingerprint({ ...base, apiKey: "" }));
  assert.equal(spawnFingerprint(base), spawnFingerprint({ ...base, mcpVersion: 0 }));
});

test("thinking 的三态在指纹上要能区分「关」与「开」", () => {
  // 关闭注入 thinking:{type:"disabled"}，与开启是不同的 query 参数
  const off = spawnFingerprint({ ...base, thinking: false });
  const on = spawnFingerprint({ ...base, thinking: true });
  assert.notEqual(off, on);
  // 未传视为开启（缺省不擅自关闭）
  assert.equal(spawnFingerprint(base), on);
});

test("指纹是稳定字符串，可直接比较", () => {
  const fp = spawnFingerprint(base);
  assert.equal(typeof fp, "string");
  assert.ok(fp.length > 0);
});
