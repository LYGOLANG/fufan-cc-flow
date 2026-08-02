import assert from "node:assert/strict";
import test from "node:test";
import { isValidSessionId, isSafeName } from "../utils/pathUtils.js";

/**
 * 会话相关的输入校验。
 *
 * sessionManager 里有 5 处把 sessionId 直接拼进文件路径，还有一处把 JSONL 里的
 * backupFileName 拼进 file-history 目录。它此前私有复制了一份 findSessionJsonl
 * 但**没带校验**，而 pathUtils 那份一直有 —— 于是同一个仓库里，一条路径安全、
 * 另一条能删任意文件。
 *
 * 这些用例锁住的是「什么形状的输入必须被拒」，而不是某个函数的实现细节。
 */

test("会话 ID 拒绝一切能改变路径层级的形状", () => {
  // DELETE /api/sessions/..%2F..%2Fx 经 Express 解码后就是这个形状，
  // 拼进 path.join(projectsDir, dir, `${id}.jsonl`) 会跳出 ~/.claude/projects
  for (const bad of [
    "../../x",
    "..\\..\\x",
    "a/b",
    "a\\b",
    "..",
    ".",
    "",
    "C:/tmp/x",
    "/etc/passwd",
  ]) {
    assert.equal(isValidSessionId(bad), false, `必须拒绝: ${JSON.stringify(bad)}`);
  }
});

test("会话 ID 接受真实的 UUID 形态", () => {
  // 别把守卫做得太紧，把正常会话也挡了
  assert.ok(isValidSessionId("31e5d54e-bd51-4a5b-aa77-4e6998321ff9"));
  assert.ok(isValidSessionId("63d4eb6e-1fd3-471b-b9f5-666f1c130891"));
});

test("会话 ID 拒绝 null / undefined", () => {
  assert.equal(isValidSessionId(null), false);
  assert.equal(isValidSessionId(undefined), false);
});

test("备份文件名只允许一层名字", () => {
  // backupFileName 来自 JSONL —— 用户可编辑的文件，属不可信输入。
  // 放行 "../../.credentials.json" 就等于「把凭据读出来写进项目」。
  for (const bad of [
    "../../.credentials.json",
    "..\\..\\secrets",
    "sub/dir.bak",
    "..",
    "",
    "C:\\x",
  ]) {
    assert.equal(isSafeName(bad), false, `必须拒绝: ${JSON.stringify(bad)}`);
  }
  assert.ok(isSafeName("abc123.bak"), "正常备份名要放行");
});

test("回归：非字符串的 backupFileName 不得进入 path.join", () => {
  // 历史上存在过「裸字符串」的旧格式，字段可能是 undefined。
  // 它既不是 null（走不到删除分支）也不是合法字符串，
  // path.join(dir, undefined) 会抛 TypeError —— 那个异常原先会逃出整个函数，
  // 让已经改过文件的这次回滚丢掉全部改动清单。
  for (const bad of [undefined, null, 123, {}, []]) {
    const isString = typeof bad === "string";
    assert.equal(
      isString && isSafeName(bad as string),
      false,
      `非字符串必须在拼路径前被挡下: ${JSON.stringify(bad)}`,
    );
  }
});
