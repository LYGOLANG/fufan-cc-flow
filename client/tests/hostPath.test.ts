import assert from "node:assert/strict";
import test from "node:test";
import {
  basename,
  isAbsolute,
  joinPath,
  pathKey,
  relativePath,
  samePath,
  splitPath,
} from "../src/utils/hostPath";
import type { HostInfo } from "../src/stores/connectionStore";

/**
 * 路径处理的跨平台语义。
 *
 * 每一条都对应前端里一处原有的猜测。本机(Windows)形态下那些猜测碰巧总是对的,
 * 所以这些 bug 至今没暴露过 —— 后端一搬到 Linux 就会集中爆发,而症状
 * (「项目打不开」「文件读不到」)离真实原因很远。
 */

const WIN: HostInfo = { platform: "win32", pathSep: "\\", caseSensitive: false, homedir: "C:\\Users\\me" };
const LINUX: HostInfo = { platform: "linux", pathSep: "/", caseSensitive: true, homedir: "/home/me" };

test("Linux 上大小写不同就是不同的目录", () => {
  // 这是最要命的一条:原实现一律 toLowerCase() 后比较,于是 Linux 上
  // 两个真实存在且互不相同的目录会被当成同一个项目。
  assert.equal(samePath("/home/Src", "/home/src", LINUX), false);
  assert.equal(pathKey("/home/Src", LINUX), "/home/Src", "不得改写大小写");

  // Windows 上则确实等价
  assert.equal(samePath("C:\\Proj\\Src", "c:\\proj\\src", WIN), true);
});

test("Windows 上两种分隔符等价，POSIX 上反斜杠是普通字符", () => {
  assert.equal(samePath("C:\\a\\b", "C:/a/b", WIN), true);

  // Linux 上 `a\b` 是一个名字叫 "a\b" 的文件,不是 a 目录下的 b
  assert.deepEqual(splitPath("/data/a\\b", LINUX), ["data", "a\\b"]);
  assert.equal(basename("/data/a\\b", LINUX), "a\\b");

  // Windows 上同样的串应被切开
  assert.deepEqual(splitPath("C:\\data\\a", WIN), ["C:", "data", "a"]);
});

test("末尾斜杠不影响判等", () => {
  // 否则「已打开的项目」列表里同一个项目会出现两次
  assert.equal(samePath("/home/proj/", "/home/proj", LINUX), true);
  assert.equal(samePath("C:\\proj\\", "C:\\proj", WIN), true);
});

test("拼接使用目标平台的分隔符", () => {
  assert.equal(joinPath("/opt/app", "src", LINUX), "/opt/app/src");
  assert.equal(joinPath("C:\\app", "src", WIN), "C:\\app\\src");
  // 已有尾随分隔符时不重复
  assert.equal(joinPath("/opt/app/", "src", LINUX), "/opt/app/src");
});

test("Windows 盘符根拼接不能丢分隔符", () => {
  // "C:" + "dir" 若拼成 "C:dir",含义是「C 盘当前目录下的 dir」,
  // 与 "C:\dir" 是两个不同的位置 —— 新建文件夹时会建到意想不到的地方
  assert.equal(joinPath("C:", "dir", WIN), "C:\\dir");
});

test("相对路径:Linux 上不得因大小写而误判包含关系", () => {
  // 原实现用小写前缀比较,会认为 /Src/a.ts 在 /src 之下,
  // 算出一个不存在的相对路径塞进提示词交给模型
  assert.equal(relativePath("/proj/Src/a.ts", "/proj/src", LINUX), null);
  assert.equal(relativePath("/proj/src/a.ts", "/proj/src", LINUX), "a.ts");
  assert.equal(relativePath("/proj/src/deep/a.ts", "/proj/src", LINUX), "deep/a.ts");

  // Windows 上大小写无关,应当匹配
  assert.equal(relativePath("C:\\Proj\\Src\\a.ts", "C:\\proj\\src", WIN), "a.ts");
});

test("相对路径:同名前缀不算包含", () => {
  // /proj/src2 不在 /proj/src 之下,但朴素的 startsWith 会判成在
  assert.equal(relativePath("/proj/src2/a.ts", "/proj/src", LINUX), null);
});

test("绝对路径判定按目标平台", () => {
  // 这条正是 contract.rs 踩过的坑:Windows 上 Path::is_absolute("/home/u")
  // 返回 false(缺盘符),于是远程 Linux 项目被判为「非法项目路径」
  assert.equal(isAbsolute("/home/u/proj", LINUX), true);
  assert.equal(isAbsolute("C:\\proj", WIN), true);
  assert.equal(isAbsolute("\\\\server\\share", WIN), true, "UNC 路径也是绝对路径");
  assert.equal(isAbsolute("proj/sub", LINUX), false);
});

test("空值不炸", () => {
  assert.equal(pathKey("", LINUX), "");
  assert.deepEqual(splitPath("", LINUX), []);
  assert.equal(joinPath("", "x", LINUX), "x");
  assert.equal(isAbsolute("", LINUX), false);
});

test("根目录不被吃掉", () => {
  // pathKey 去尾随斜杠时,"/" 本身必须保留,否则根目录变成空串
  assert.equal(pathKey("/", LINUX), "/");
});
