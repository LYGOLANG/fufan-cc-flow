import path from "path";
import os from "os";
import fs from "fs/promises";

export function normalizePath(p: string): string {
  if (p.startsWith("~")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.normalize(p);
}

export function isSubPath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * `name` 是否可以安全地作为**单个**文件/目录名拼进路径。
 *
 * 用于所有「把外部传入的 name/filename/id 直接 path.join 到某个目录下」的位置。
 * 这些参数在业务上从来就只是一层名字(技能名、记忆文件名、Agent 名、工作流 id),
 * 不需要支持子路径,所以这里可以一律从严:任何分隔符、`..`、绝对路径形态、
 * 控制字符都拒绝。
 *
 * 注意与 isSubPath 的分工:isSubPath 判断「结果是否落在某个根内」,适合校验
 * 完整路径;本函数在更上游把「压根不该是路径」的输入挡掉,不依赖调用方还记得
 * 传对根目录。
 *
 * 控制字符(含 NUL/DEL)一并拒绝:它们能在日志里伪装名字,且在部分文件系统上
 * 会被截断成完全不同的路径。这里写成 \u 转义而不是字面控制字符,否则源码里
 * 根本看不见(此前就是字面写法,ESLint 的 no-control-regex 才把它揪出来)。
 */
// eslint-disable-next-line no-control-regex -- 匹配控制字符正是本函数的目的
const UNSAFE_NAME_RE = /[/\\]|^\.\.?$|^[A-Za-z]:|[\u0000-\u001f\u007f]/;

export function isSafeName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255) return false;
  // 用原值判断:两端空白本身也可能被用来伪造同名文件
  return name === trimmed && !UNSAFE_NAME_RE.test(name);
}

/** isSafeName 的抛错版本,给路由层直接用 */
export function assertSafeName(name: unknown, label = "名称"): string {
  if (!isSafeName(name)) {
    throw Object.assign(new Error(`${label}不合法(不能包含路径分隔符或 ..)`), {
      statusCode: 400,
    });
  }
  return name;
}

/**
 * 把 `child` 解析为绝对路径并断言它落在 `root` 内,返回规整后的绝对路径。
 *
 * 相比裸用 isSubPath 的两点改进:
 * 1. 两边都先 path.resolve —— isSubPath 内部的 path.relative 在收到相对路径时
 *    会拿 process.cwd() 当基准,结果取决于服务进程的工作目录,不可靠。
 * 2. 失败即抛,调用方不会因为「忘了处理返回的 false」而放行。
 */
export function assertWithinRoot(root: string, child: string, label = "路径"): string {
  const absRoot = path.resolve(normalizePath(root));
  const absChild = path.resolve(absRoot, normalizePath(child));
  if (absChild !== absRoot && !isSubPath(absRoot, absChild)) {
    throw Object.assign(new Error(`${label}不在允许的目录内`), { statusCode: 403 });
  }
  return absChild;
}

export function getClaudeHome(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? normalizePath(configured) : path.join(os.homedir(), ".claude");
}

/**
 * Encode a filesystem path to the hash Claude Code uses for project directories.
 * Claude Code replaces every non-alphanumeric character with '-'.
 * e.g. "E:\work\my project" → "E--work-my-project"
 */
export function pathToHash(p: string): string {
  return p.replace(/\\/g, "/").replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Claude Code / SDK 会话 id 的合法形式:UUID 或 `session_<ts>_<n>` 之类,
 * 只含字母数字、连字符、下划线。用于在把外部传入的 sessionId 拼进文件路径前做校验,
 * 拒绝含 `..`、路径分隔符等的值(防目录穿越)。
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
export function isValidSessionId(id: string | null | undefined): id is string {
  return !!id && SESSION_ID_RE.test(id);
}

/**
 * 按 sessionId 在 ~/.claude/projects 下逐目录查找其 JSONL 文件的绝对路径。
 *
 * 为什么不直接 join(projectsDir, pathToHash(projectPath), `${sid}.jsonl`):
 * CLI 是对它自己解析后的 process.cwd() 做哈希(会解析符号链接、规整尾分隔符/短路径名),
 * 与我们对客户端原样传入的 projectPath 做哈希可能得到不同目录名(macOS 上 /tmp→/private/tmp
 * 尤为常见)。扫描匹配对哈希差异免疫。同时 isValidSessionId 已挡掉目录穿越。
 * 找不到或 id 非法返回 null。
 */
export async function findSessionJsonl(sessionId: string): Promise<string | null> {
  if (!isValidSessionId(sessionId)) return null;
  const projectsDir = path.join(getClaudeHome(), "projects");
  try {
    const dirs = await fs.readdir(projectsDir);
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
      const exists = await fs.access(candidate).then(() => true).catch(() => false);
      if (exists) return candidate;
    }
  } catch { /* projects dir 不存在 */ }
  return null;
}
