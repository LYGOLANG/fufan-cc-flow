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
 * 取父目录。已经是根(或没有父级)时原样返回。
 *
 * 前端此前在 FileTree 里手写 `p.substring(0, p.lastIndexOf("/"))` 取父目录。
 * 那行在 Windows 上**必然返回空字符串** —— 后端发来的路径是
 * `D:\proj\README.md`，里面一个 `/` 都没有，`lastIndexOf("/")` 得 -1，
 * 而 JS 的 `substring(0, -1)` 等同 `substring(0, 0)`，即空串。
 * 于是「右键一个文件 → 新建文件夹」拼出的是 `/新文件夹`，
 * 被后端的项目根校验挡下(403 path不在允许的目录内)，界面只说「操作失败」。
 * 右键目录时走的是另一分支，所以表现为「有时能建有时不能」。
 */
export function dirname(p: string, host: HostInfo = currentHost()): string {
  if (!p) return p;
  const sep = host.pathSep;
  const trimmed = p.replace(/[\\/]+$/, "") || p;
  // Windows 上两种分隔符都算;POSIX 上反斜杠是合法文件名字符,不能当分隔符
  const idx = sep === "\\"
    ? Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"))
    : trimmed.lastIndexOf("/");
  if (idx < 0) return trimmed;           // 没有分隔符:已经是最顶层，没有父级
  if (idx === 0) return sep === "\\" ? trimmed : "/"; // POSIX 根下的一级
  const parent = trimmed.slice(0, idx);
  // "C:" 是盘符而不是目录,补回分隔符才是根
  if (sep === "\\" && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
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
  if (!parent) return null; // 没有基准就没有"相对"，别把绝对路径当成在根之下
  const c = pathKey(child, host);
  const p = pathKey(parent, host);
  if (c === p) return "";
  if (!c.startsWith(p.endsWith("/") ? p : `${p}/`)) return null;

  // 用 key 判断包含关系，但**从原串切**。
  //
  // 原实现 `return c.slice(...)` 切的是 pathKey 的产物 —— 在 caseSensitive
  // 为 false 的平台（Windows / macOS）上那是个 toLowerCase 过的副本，于是
  // 文件树里引用 ChatPanel.tsx 会插入 @client/src/components/chat/chatpanel.tsx。
  // NTFS 大小写不敏感所以多半仍能读到，但输入框里显示的是错的路径，
  // 落到大小写敏感的卷或 WSL 挂载点上直接读不到。
  //
  // 分隔符仍归一成 /：@ 引用在提示词里用正斜杠更通用，且与旧实现一致。
  const unified = host.pathSep === "\\" ? child.replace(/\\/g, "/") : child;
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
  return trimmed.slice(p.endsWith("/") ? p.length : p.length + 1);
}

/** 是否绝对路径。Windows 认盘符与 UNC,POSIX 认前导 /。 */
export function isAbsolute(p: string, host: HostInfo = currentHost()): boolean {
  if (!p) return false;
  if (host.pathSep === "\\") return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
  return p.startsWith("/");
}
