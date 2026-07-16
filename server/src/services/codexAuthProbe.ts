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
  if (/^logged in using (?:an? )?api[ _-]?key\b/.test(normalized)) return "apikey";
  if (/^logged in using chatgpt\b/.test(normalized)) return "chatgpt";
  return null;
}

export function classifyCodexAuthProbe(output: string, exitCode: number | null): CodexAuthProbe {
  const method = parseCodexLoginStatus(output);
  if (method === "none") return { kind: "status", method };
  if (exitCode === 0 && method) return { kind: "status", method };
  if (UNSUPPORTED_CLI_PATTERN.test(output)) return { kind: "unsupported" };
  return { kind: "failed" };
}

async function probeCodexAuth(): Promise<CodexAuthProbe> {
  return new Promise((resolve) => {
    const proc = spawnCodex(["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    if (!proc) return resolve({ kind: "failed" });
    let output = "";
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
    const onData = (data: Buffer) => { output += data.toString("utf-8"); };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("close", (code) => finish(classifyCodexAuthProbe(output, code)));
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
