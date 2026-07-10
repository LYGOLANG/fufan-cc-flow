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

export function getClaudeHome(): string {
  return path.join(os.homedir(), ".claude");
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
