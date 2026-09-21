import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "../src/utils/hostPath";
import type { HostInfo } from "../src/stores/connectionStore";

/**
 * 取父目录的跨平台语义。
 *
 * 用户实报「文件浏览器里面不能创建文件夹」。根因在 FileTree 手写的
 * `nodePath.substring(0, nodePath.lastIndexOf("/"))`：后端发来的路径是
 * `D:\proj\README.md`，一个 `/` 都没有 → `lastIndexOf("/")` 得 -1，
 * 而 JS 的 `substring(0, -1)` 等同 `substring(0, 0)` —— 得到**空字符串**。
 * 于是拼出 `/新文件夹`，后端项目根校验返回
 * 403「path不在允许的目录内」，界面只报一句「操作失败」。
 *
 * 右键目录时走的是 isDir 分支、不经过这段，所以表现成「有时能建有时不能」，
 * 离真正的原因很远。这些用例把每种形态都钉死。
 */

const WIN: HostInfo = {
  platform: "win32",
  pathSep: "\\",
  caseSensitive: false,
  homedir: "C:\\Users\\me",
};
const LINUX: HostInfo = {
  platform: "linux",
  pathSep: "/",
  caseSensitive: true,
  homedir: "/home/me",
};

test("Windows 路径取父目录（旧实现在这里恒为空串）", () => {
  assert.equal(dirname("D:\\proj\\README.md", WIN), "D:\\proj");
  assert.equal(dirname("D:\\proj\\sub\\a.txt", WIN), "D:\\proj\\sub");
  // Windows 上正斜杠同样是合法分隔符
  assert.equal(dirname("D:/proj/a.txt", WIN), "D:/proj");
  // 混用也要认，后端 normalize 前前端就可能拼出这种
  assert.equal(dirname("D:\\proj/sub\\a.txt", WIN), "D:\\proj/sub");
});

test("盘符根不能退化成 'C:'——那是「C盘当前目录」，不是根", () => {
  assert.equal(dirname("C:\\a.txt", WIN), "C:\\");
});

test("POSIX 下反斜杠是普通文件名字符，不得当分隔符", () => {
  assert.equal(dirname("/home/u/a.txt", LINUX), "/home/u");
  assert.equal(dirname("/home/u/we\\ird.txt", LINUX), "/home/u");
  assert.equal(dirname("/a.txt", LINUX), "/");
});

test("没有父级时原样返回，绝不吐空串", () => {
  // 空串是这个 bug 的全部杀伤力来源：它会让调用方拼出一个指向别处的绝对路径
  assert.equal(dirname("README.md", WIN), "README.md");
  assert.equal(dirname("README.md", LINUX), "README.md");
  assert.equal(dirname("", WIN), "");
});

test("末尾分隔符不影响父目录", () => {
  assert.equal(dirname("D:\\proj\\sub\\", WIN), "D:\\proj");
  assert.equal(dirname("/home/u/sub/", LINUX), "/home/u");
});

/**
 * 源码层守卫：这类路径拼装必须走 hostPath，不能再各自手写。
 * 父目录一旦算错，后面无从补救，而失败信息（「操作失败」）离原因极远。
 */
test("FileTree 不得再手写 lastIndexOf 取父目录", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/ide/FileTree.tsx", "utf8");
  assert.ok(
    !src.includes('lastIndexOf("/")'),
    'FileTree 又出现手写的 lastIndexOf("/") —— Windows 路径上它恒为 -1'
  );
  assert.ok(src.includes("dirname("), "FileTree 应当用 hostPath.dirname 取父目录");
  assert.ok(src.includes("joinPath("), "FileTree 应当用 hostPath.joinPath 拼路径");
});

test("项目浏览器头部要有新建文件夹入口", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/ide/FileTree.tsx", "utf8");
  // 此前头部只有「新建文件」，想建目录只能右键已有节点，
  // 而右键文件那条路正好是坏的 —— 两件事叠起来就是「建不了文件夹」。
  assert.ok(
    src.includes('title="新建文件夹"'),
    "头部缺少新建文件夹按钮，用户只能靠右键，撞上坏分支就建不了"
  );
});
