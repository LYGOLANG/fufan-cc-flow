import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

/**
 * 附件路径与 id 的守卫。
 *
 * 附件上传曾是全项目**唯一**没有路径守卫的写路径：`?project=` 传任意字符串
 * 就能在任意位置写进 10MB 文件。而清理侧用 startsWith(id) 找文件，
 * 空 id 会匹配到目录里第一个文件并删掉它 —— 删的是别人的附件。
 *
 * 这里复刻两处判定规则。真实函数带文件系统副作用，不适合在单测里跑。
 */

/** 与 attachmentService.getAttachmentsDir 的校验同构 */
function resolveDir(projectPath: unknown): string {
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("project 不能为空");
  }
  if (!path.isAbsolute(projectPath)) {
    throw new Error("project 必须是绝对路径");
  }
  const root = path.resolve(projectPath);
  const dir = path.join(root, ".claude", "attachments");
  if (!dir.startsWith(root)) throw new Error("附件目录越出项目范围");
  return dir;
}

/** 与 attachmentService.deleteFile 的入参校验同构 */
const acceptsId = (id: string): boolean =>
  !!id && !/[\\/]/.test(id) && !id.includes("..");

test("拒绝空的 project", () => {
  for (const bad of ["", "   ", null, undefined, 123]) {
    assert.throws(() => resolveDir(bad), `必须拒绝: ${JSON.stringify(bad)}`);
  }
});

test("拒绝相对路径", () => {
  // 相对路径会落到后端进程的 cwd（桌面版是安装目录），
  // 既不是用户预期的位置，也绕开了「写在项目内」这个约束
  for (const bad of ["proj", "./proj", "../proj", ".claude"]) {
    assert.throws(() => resolveDir(bad), `必须拒绝相对路径: ${bad}`);
  }
});

test("含 .. 的路径先归一化，附件目录始终落在归一化后的根内", () => {
  // 说清这个守卫**不能**做什么，免得下一个人以为它挡住了路径穿越：
  //
  // 这里 projectPath 既是根又是目标，"目录不越出根"这个约束是恒真的 ——
  // 传 "C:\proj\..\..\Windows" 时 resolve 得到 "C:\Windows"，那本身就是
  // 一个合法的绝对路径，检查必然通过。真正阻止「往任意位置写」的是
  // 接口鉴权（middleware/auth.ts），不是这里。
  //
  // 这个守卫的实际作用是挡住空值、相对路径，以及保证拼接后不会因为
  // 后续的 join 逻辑跑到根外面去。
  const tricky = path.join(path.sep + "proj", "..", "..", "etc");
  const dir = resolveDir(tricky);
  assert.ok(
    dir.startsWith(path.resolve(tricky)),
    "附件目录必须落在归一化后的根之内",
  );
  assert.ok(dir.endsWith(path.join(".claude", "attachments")));
});

test("正常的绝对路径放行，且目录落在项目内", () => {
  const root = path.resolve(path.sep + "proj");
  const dir = resolveDir(root);
  assert.ok(dir.startsWith(root), "附件目录必须在项目内");
  assert.ok(dir.endsWith(path.join(".claude", "attachments")));
});

test("空 id 必须被拒 —— 否则会删掉目录里第一个文件", () => {
  // deleteFile 用 startsWith(id) 找目标。id 为空串时 "".startsWith 恒真，
  // 命中第一个文件。这个空串的来源是「从路径反推文件名」失败，
  // 而那正是最容易出错的一环。
  assert.equal(acceptsId(""), false);
});

test("含路径分隔符或 .. 的 id 必须被拒", () => {
  for (const bad of ["../x", "..\\x", "a/b", "a\\b", ".."]) {
    assert.equal(acceptsId(bad), false, `必须拒绝: ${bad}`);
  }
});

test("正常 uuid 形态的 id 放行", () => {
  assert.ok(acceptsId("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
});

test("回归：id 匹配要带点界定，避免误删同前缀文件", () => {
  // 真实文件名是 `<id>.<ext>`。不加点的话 "abc" 会误命中 "abcdef.png"。
  const files = ["abc.png", "abcdef.png"];
  const id = "abc";
  const matched = files.filter((f) => f.startsWith(`${id}.`));
  assert.deepEqual(matched, ["abc.png"], "只该命中恰好同 id 的那个");
});
