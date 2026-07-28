import { currentHost, type HostInfo } from "../stores/connectionStore";

/**
 * 按**后端所在机器**的语义处理路径。
 *
 * 前端原先散落着一批猜测:
 *   - `currentPath.includes("\\") ? "\\" : "/"`  靠内容猜分隔符
 *   - `p.toLowerCase()` 归一化后再比较           假定大小写不敏感
 *   - `split(/[\\/]/)`                           两种分隔符都当分隔符
 *
 * 本机形态下这些碰巧总是对的。后端一旦搬到 Linux:
 *   - `/Src` 与 `/src` 会被判成同一个目录(Linux 上是两个)
 *   - 含反斜杠的合法 Linux 文件名会被切成两段
 *   - 新建目录时拼出混用分隔符的路径
 *
 * 所有函数都接受可选的 host 参数,默认取当前连接的后端信息 —— 这样单测
 * 可以直接构造两种平台,不必去摆弄全局 store。
 */

/** 用于**比较**的路径键。大小写敏感与否由目标平台决定。 */
export function pathKey(p: string, host: HostInfo = currentHost()): string {
  if (!p) return "";
  // 分隔符统一成 / 只是为了比较,不改变语义:Windows 上两种分隔符等价
  const unified = host.pathSep === "\\" ? p.replace(/\\/g, "/") : p;
  // 去掉末尾斜杠,否则 /a/b 与 /a/b/ 会被判成两个不同的项目
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
  return host.caseSensitive ? trimmed : trimmed.toLowerCase();
}

/** 两个路径是否指向同一位置 */
export function samePath(a: string, b: string, host: HostInfo = currentHost()): boolean {
  return pathKey(a, host) === pathKey(b, host);
}

/**
 * 按目标平台切分路径。
 *
 * Windows 上 `\` 与 `/` 都是分隔符;POSIX 上**只有** `/`,反斜杠是合法的
 * 文件名字符 —— 所以这里不能无脑用 `split(/[\\/]/)`。
 */
export function splitPath(p: string, host: HostInfo = currentHost()): string[] {
  if (!p) return [];
  const parts = host.pathSep === "\\" ? p.split(/[\\/]/) : p.split("/");
  return parts.filter(Boolean);
}

/** 取路径最后一段。POSIX 上含反斜杠的文件名不会被误切。 */
export function basename(p: string, host: HostInfo = currentHost()): string {
  const parts = splitPath(p, host);
  return parts.length ? parts[parts.length - 1] : p;
}

/** 用目标平台的分隔符把一段名字接到路径后面 */
export function joinPath(base: string, name: string, host: HostInfo = currentHost()): string {
  if (!base) return name;
  const sep = host.pathSep;
  const trimmed = base.replace(/[\\/]+$/, "");
  // Windows 盘符根("C:")后面必须补分隔符,否则 "C:" + "dir" = "C:dir"
  // ——那是"C 盘当前目录下的 dir",不是"C:\dir"
  if (sep === "\\" && /^[A-Za-z]:$/.test(trimmed)) return `${trimmed}${sep}${name}`;
  return `${trimmed}${sep}${name}`;
}

/**
 * 计算 child 相对 parent 的路径。不在 parent 之下时返回 null。
 *
 * 原实现用 `toLowerCase()` 做前缀比较,在 Linux 上会把 `/Src/a.ts` 误判成
 * 位于 `/src` 之下,继而算出一个根本不存在的相对路径塞进提示词。
 */
export function relativePath(
  child: string,
  parent: string,
  host: HostInfo = currentHost(),
): string | null {
  const c = pathKey(child, host);
  const p = pathKey(parent, host);
  if (c === p) return "";
  if (!c.startsWith(p.endsWith("/") ? p : `${p}/`)) return null;
  return c.slice(p.endsWith("/") ? p.length : p.length + 1);
}

/** 是否绝对路径。Windows 认盘符与 UNC,POSIX 认前导 /。 */
export function isAbsolute(p: string, host: HostInfo = currentHost()): boolean {
  if (!p) return false;
  if (host.pathSep === "\\") return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
  return p.startsWith("/");
}
