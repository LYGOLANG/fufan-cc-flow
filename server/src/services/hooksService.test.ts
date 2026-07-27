import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import path from "node:path";
import { sanitizeHooksConfig, getSettingsPath } from "./hooksService.js";

/**
 * 回归锁:project scope 不得解析到用户全局 settings.json。
 *
 * 攻击构造极其简单——`PUT /api/hooks?scope=project&project=<用户主目录>`,
 * 目标就变成 ~/.claude/settings.json,而 hook 的 command 会在下次任何
 * Claude Code 会话启动时执行。等于用一个「项目级」接口做到用户级持久化 RCE。
 */
test("project scope 不能解析到用户全局 settings.json", () => {
  assert.throws(
    () => getSettingsPath("project", homedir()),
    (e: Error & { statusCode?: number }) => e.statusCode === 403,
    "把 project 指向主目录必须被拒绝"
  );
});

test("project 必须是绝对路径 —— 相对路径依赖进程 cwd,不可控", () => {
  assert.throws(
    () => getSettingsPath("project", "../../etc"),
    (e: Error & { statusCode?: number }) => e.statusCode === 400
  );
});

test("正常项目路径照常工作", () => {
  const proj = path.join(homedir(), "some-project");
  assert.equal(
    getSettingsPath("project", proj),
    path.resolve(path.join(proj, ".claude", "settings.json"))
  );
  assert.equal(
    getSettingsPath("project-local", proj),
    path.resolve(path.join(proj, ".claude", "settings.local.json"))
  );
});

test("user scope 正常指向全局设置", () => {
  assert.equal(
    getSettingsPath("user"),
    path.resolve(path.join(homedir(), ".claude", "settings.json"))
  );
});

/**
 * hooks 的 command 字段是一条 shell 命令,会在 Claude Code 会话启动时执行,
 * 而这个配置由 HTTP 接口写入 settings.json。所以这里的每一条校验都直接对应
 * 一条「持久化任意命令执行」的路径,不能只靠人工 review 守着。
 */

test("正常配置原样通过", () => {
  const input = {
    PreToolUse: [
      { matcher: "Edit|Write", hooks: [{ type: "command", command: "echo hi" }] },
    ],
  };
  assert.deepEqual(sanitizeHooksConfig(input), input);
});

test("空配置合法(用于清空所有 hooks)", () => {
  assert.deepEqual(sanitizeHooksConfig({}), {});
});

test("未知事件名拒绝 —— 防止把任意键灌进 settings.json", () => {
  assert.throws(
    () => sanitizeHooksConfig({ NotAnEvent: [] }),
    (e: Error & { statusCode?: number }) => e.statusCode === 400 && /NotAnEvent/.test(e.message)
  );
});

test("未知 handler 类型拒绝", () => {
  assert.throws(
    () =>
      sanitizeHooksConfig({
        Stop: [{ matcher: "*", hooks: [{ type: "eval", command: "x" }] }],
      }),
    (e: Error & { statusCode?: number }) => e.statusCode === 400
  );
});

test("结构错误一律拒绝,不落盘畸形 JSON", () => {
  const bad: unknown[] = [
    null,
    "string",
    [],
    { Stop: "not-an-array" },
    { Stop: [null] },
    { Stop: [{ matcher: 123, hooks: [] }] },
    { Stop: [{ matcher: "*", hooks: "not-an-array" }] },
    { Stop: [{ matcher: "*", hooks: [{}] }] },
  ];
  for (const input of bad) {
    assert.throws(
      () => sanitizeHooksConfig(input),
      (e: Error & { statusCode?: number }) => e.statusCode === 400,
      `${JSON.stringify(input)} 应当被拒绝`
    );
  }
});

test("合法的四种 handler 类型都放行", () => {
  for (const type of ["command", "http", "prompt", "agent"]) {
    const input = { SessionStart: [{ matcher: "*", hooks: [{ type }] }] };
    assert.doesNotThrow(() => sanitizeHooksConfig(input), `${type} 应当被放行`);
  }
});
