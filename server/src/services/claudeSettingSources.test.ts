import assert from "node:assert/strict";
import test from "node:test";
import { CLAUDE_SETTING_SOURCES } from "./claudeAgentService.js";

/**
 * 这组测试锁的是一个「安静地少干活」型缺陷:settingSources 一旦显式传值就是
 * 白名单,漏一项不会报错,只会让某一份设置文件从此不被加载。曾经漏掉 "local",
 * 用户的表现是「每次重开应用,同一批权限又要重新确认一遍」——很难联想到根因。
 */

test("settingSources 必须包含 local,否则「始终允许」重启后失效", () => {
  // Claude Code 的「不再询问 / 始终允许」默认写入 .claude/settings.local.json
  // (SDK 的 PermissionUpdateDestination 含 'localSettings')。不加载这个源,
  // 规则就是写得进、读不回。
  assert.ok(
    CLAUDE_SETTING_SOURCES.includes("local"),
    "缺少 'local':用户每次重启都要重新确认权限,「项目本地」scope 的 hooks 也永不触发"
  );
});

test("settingSources 覆盖 SDK 支持的全部三个源", () => {
  // SDK 的 SettingSource = 'user' | 'project' | 'local'。
  // 语义是「省略该字段 = 加载全部」,所以显式传值时必须与之等价,否则就是降级。
  assert.deepEqual([...CLAUDE_SETTING_SOURCES].sort(), ["local", "project", "user"]);
});

test("settingSources 含 project —— 少了它连 CLAUDE.md 都不会加载", () => {
  // SDK 文档明确:Must include 'project' to load CLAUDE.md files.
  assert.ok(CLAUDE_SETTING_SOURCES.includes("project"));
});
