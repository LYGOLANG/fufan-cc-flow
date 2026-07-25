import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawnCodex } from "../utils/codexBin.js";
import { logger } from "../utils/logger.js";

export type CodexAuthMethod = "chatgpt" | "apikey" | "none";
export type CodexAuthProbe =
  | { kind: "status"; method: CodexAuthMethod }
  | { kind: "unsupported" }
  | { kind: "failed" };

const AUTH_PATH = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
const UNSUPPORTED_CLI_PATTERN = /unknown (?:command|option)|unrecognized|not supported|invalid (?:command|option)/i;

export function parseCodexLoginStatus(raw: string): CodexAuthMethod | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (/not logged in|not authenticated|logged out/.test(normalized)) return "none";
  // 按行锚定而非整串锚定:CLI 常在状态行之前先打印升级提示、弃用告警等噪声,
  // 用 /^.../ 锚整串会因为开头是噪声而漏判,把「已登录」误报成「未登录」
  // (Spec §7.1 验收明确要求已登录不得要求重复登录)。
  // 逐行扫描既保留「行首必须是 logged in using」的严格性,又不受前置噪声影响。
  const lines = normalized.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => /^logged in using (?:an? )?api[ _-]?key\b/.test(l))) return "apikey";
  if (lines.some((l) => /^logged in using chatgpt\b/.test(l))) return "chatgpt";
  return null;
}

export function classifyCodexAuthProbe(
  output: string,
  exitCode: number | null,
  stderr = ""
): CodexAuthProbe {
  const method = parseCodexLoginStatus(output);
  if (method === "none") return { kind: "status", method };
  if (exitCode === 0 && method) return { kind: "status", method };
  // 「CLI 版本不支持此子命令」的提示既可能走 stdout 也可能走 stderr,两边都查
  if (UNSUPPORTED_CLI_PATTERN.test(output) || UNSUPPORTED_CLI_PATTERN.test(stderr)) {
    return { kind: "unsupported" };
  }
  return { kind: "failed" };
}

async function probeCodexAuth(): Promise<CodexAuthProbe> {
  return new Promise((resolve) => {
    const proc = spawnCodex(["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    if (!proc) return resolve({ kind: "failed" });
    // stdout/stderr 分开收:登录状态是 stdout 的正经输出,stderr 多是升级提示等噪声。
    // 此前两者合流进同一 buffer,先到的 stderr 会污染状态解析。
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (probe: CodexAuthProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(probe);
    };
    const timer = setTimeout(() => {
      proc.kill();
      logger.warn("probeCodexAuth timed out after 10s");
      finish({ kind: "failed" });
    }, 10_000);
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString("utf-8"); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });
    // 状态判定只看 stdout;stderr 仅在识别「此 CLI 版本不支持该子命令」时参考
    proc.on("close", (code) => finish(classifyCodexAuthProbe(stdout, code, stderr)));
    proc.on("error", () => finish({ kind: "failed" }));
  });
}

async function readLegacyAuthMode(): Promise<CodexAuthMethod> {
  try {
    const raw = await fs.readFile(AUTH_PATH, "utf-8");
    const data = JSON.parse(raw) as { auth_mode?: string; OPENAI_API_KEY?: string | null; tokens?: unknown };
    const mode = (data.auth_mode || "").toLowerCase();
    if (mode === "chatgpt" || data.tokens) return "chatgpt";
    if (mode === "apikey" || data.OPENAI_API_KEY) return "apikey";
  } catch {
    // Old CLI without an auth file is simply logged out.
  }
  return "none";
}

export async function resolveCodexAuthMethod(): Promise<CodexAuthMethod> {
  const probe = await probeCodexAuth();
  if (probe.kind === "status") return probe.method;
  if (probe.kind === "unsupported") return readLegacyAuthMode();
  return "none";
}
