import assert from "node:assert/strict";
import test from "node:test";
import { classifyCodexAuthProbe, parseCodexLoginStatus } from "./codexAuthProbe.js";

test("parseCodexLoginStatus 识别三种状态", () => {
  assert.equal(parseCodexLoginStatus("Logged in using ChatGPT"), "chatgpt");
  assert.equal(parseCodexLoginStatus("Logged in using an API key"), "apikey");
  assert.equal(parseCodexLoginStatus("Logged in using API key"), "apikey");
  assert.equal(parseCodexLoginStatus("Not logged in"), "none");
  assert.equal(parseCodexLoginStatus(""), null);
  assert.equal(parseCodexLoginStatus("something unrelated"), null);
});

// 回归锁定:此前用 /^logged in using/ 锚整串,CLI 在状态行前打印任何提示
// (升级通知/弃用告警)都会导致漏判 → 已登录被误报成未登录,直接违反
// Spec §7.1「已登录不得要求重复登录」。逐行锚定后不受前置噪声影响。
test("状态行前有噪声时仍能识别已登录(M1 回归)", () => {
  const withNotice = [
    "A new version of codex is available: 0.145.0",
    "Run `npm i -g @openai/codex` to update.",
    "Logged in using ChatGPT",
  ].join("\n");
  assert.equal(parseCodexLoginStatus(withNotice), "chatgpt");

  const withBlankLines = "\n\n  Logged in using an API key  \n";
  assert.equal(parseCodexLoginStatus(withBlankLines), "apikey");
});

test("行首严格性保留:句中出现该短语不算数", () => {
  // 避免把说明文字误判成状态(例如帮助文本里引用这句话)
  assert.equal(
    parseCodexLoginStatus("If you were logged in using ChatGPT, run codex login"),
    null
  );
});

test("classifyCodexAuthProbe: 退出码与状态组合", () => {
  assert.deepEqual(classifyCodexAuthProbe("Logged in using ChatGPT", 0), {
    kind: "status",
    method: "chatgpt",
  });
  // 未登录即便退出码非 0 也是确定结论
  assert.deepEqual(classifyCodexAuthProbe("Not logged in", 1), {
    kind: "status",
    method: "none",
  });
  // 无法解析且非「不支持」→ failed,不冒充任何结论
  assert.deepEqual(classifyCodexAuthProbe("weird output", 1), { kind: "failed" });
});

// 回归锁定:不支持该子命令的旧 CLI 常把错误打到 stderr,而判定只看 stdout,
// 故 unsupported 检测必须同时查 stderr,否则会退化成 failed。
test("unsupported 提示走 stderr 时也能识别", () => {
  assert.deepEqual(
    classifyCodexAuthProbe("", 1, "error: unrecognized subcommand 'login'"),
    { kind: "unsupported" }
  );
  assert.deepEqual(classifyCodexAuthProbe("unknown command: login", 1), {
    kind: "unsupported",
  });
});
