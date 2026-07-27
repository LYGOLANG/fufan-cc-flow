import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { isSafeName, assertSafeName, assertWithinRoot, isSubPath } from "./pathUtils.js";

/**
 * 这两个原语用来堵「外部传入的名字被直接 path.join 进目录」这一类问题:
 * 记忆文件名、技能名、Agent 名、工作流 id、团队名都属于此类,业务上从来只是
 * 一层名字,却能被写成 `../../..` 一路穿出去(有的 sink 是 fs.rm recursive)。
 */

test("正常的名字全部放行", () => {
  for (const ok of ["notes.md", "my-skill", "agent_1", "工作流-2", "a.b.c", "CLAUDE.md"]) {
    assert.ok(isSafeName(ok), `${ok} 应当被放行`);
  }
});

test("路径穿越形态一律拒绝", () => {
  for (const bad of [
    "..",
    ".",
    "../evil",
    "../../etc/passwd",
    "a/b",
    "a\\b",
    "/abs/path",
    "\\\\server\\share",
    "C:\\Windows",
    "c:/windows",
  ]) {
    assert.equal(isSafeName(bad), false, `${bad} 应当被拒绝`);
  }
});

test("空值、非字符串、超长、控制字符拒绝", () => {
  for (const bad of ["", "   ", null, undefined, 42, {}, "a".repeat(256), "a\0b", "a\nb"]) {
    assert.equal(isSafeName(bad), false, `${JSON.stringify(bad)} 应当被拒绝`);
  }
});

test("两端空白拒绝 —— 可被用来伪造视觉同名文件", () => {
  assert.equal(isSafeName(" notes.md"), false);
  assert.equal(isSafeName("notes.md "), false);
});

test("assertSafeName 抛带 400 的错误,合法值原样返回", () => {
  assert.equal(assertSafeName("ok.md"), "ok.md");
  assert.throws(
    () => assertSafeName("../escape", "技能名"),
    (e: Error & { statusCode?: number }) => e.statusCode === 400 && /技能名/.test(e.message)
  );
});

test("assertWithinRoot 放行根内路径,返回规整后的绝对路径", () => {
  const root = path.join(os.tmpdir(), "af-root");
  const inside = path.join(root, "sub", "file.md");
  assert.equal(assertWithinRoot(root, inside), path.resolve(inside));
  // 根自身也算合法
  assert.equal(assertWithinRoot(root, root), path.resolve(root));
});

test("assertWithinRoot 拦截穿越,抛 403", () => {
  const root = path.join(os.tmpdir(), "af-root");
  assert.throws(
    () => assertWithinRoot(root, path.join(root, "..", "elsewhere", "x")),
    (e: Error & { statusCode?: number }) => e.statusCode === 403
  );
});

test("回归:同前缀的兄弟目录不能被当成子目录", () => {
  // teamService 曾用 dir.startsWith(teamsDir) 做守卫,`../teams-evil` 归一化后
  // 仍以 teamsDir 开头,守卫形同虚设。isSubPath/assertWithinRoot 基于
  // path.relative,不吃这一套。
  const root = path.join(os.tmpdir(), "teams");
  const sibling = path.join(os.tmpdir(), "teams-evil");
  assert.equal(isSubPath(root, sibling), false);
  assert.throws(
    () => assertWithinRoot(root, sibling),
    (e: Error & { statusCode?: number }) => e.statusCode === 403
  );
});

test("assertWithinRoot 对相对路径按 root 解析,不依赖进程工作目录", () => {
  const root = path.join(os.tmpdir(), "af-root");
  assert.equal(assertWithinRoot(root, "sub/file.md"), path.resolve(root, "sub/file.md"));
  assert.throws(
    () => assertWithinRoot(root, "../outside.md"),
    (e: Error & { statusCode?: number }) => e.statusCode === 403
  );
});
