import { spawnClaude } from "../utils/claudeBin.js";
import { logger } from "../utils/logger.js";

export interface ClaudeCliAuthStatus {
  authenticated: boolean;
  authMethod: "oauth" | "apikey" | "none";
}

export type ClaudeAuthProbe =
  | { kind: "status"; status: ClaudeCliAuthStatus }
  | { kind: "unsupported" }
  | { kind: "failed" };

const UNSUPPORTED_CLI_PATTERN = /unknown (?:command|option)|unrecognized|not supported|invalid option/i;

export function parseClaudeCliAuthStatus(raw: string): ClaudeCliAuthStatus | null {
  try {
    const data = JSON.parse(raw) as { loggedIn?: unknown; authMethod?: unknown };
    if (typeof data.loggedIn !== "boolean") return null;
    if (!data.loggedIn) return { authenticated: false, authMethod: "none" };
    const method = typeof data.authMethod === "string" ? data.authMethod.toLowerCase() : "";
    return {
      authenticated: true,
      authMethod: method.includes("api") || method.includes("key") ? "apikey" : "oauth",
    };
  } catch {
    return null;
  }
}

export function classifyClaudeAuthProbe(stdout: string, stderr: string, exitCode: number | null): ClaudeAuthProbe {
  const status = parseClaudeCliAuthStatus(stdout.trim());
  if (status && (exitCode === 0 || !status.authenticated)) return { kind: "status", status };
  if (UNSUPPORTED_CLI_PATTERN.test(`${stdout}\n${stderr}`)) return { kind: "unsupported" };
  return { kind: "failed" };
}

export async function probeClaudeAuth(): Promise<ClaudeAuthProbe> {
  return new Promise((resolve) => {
    const proc = spawnClaude(["auth", "status", "--json"]);
    if (!proc) return resolve({ kind: "failed" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (probe: ClaudeAuthProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(probe);
    };
    const timer = setTimeout(() => {
      proc.kill();
      logger.warn("probeClaudeAuth timed out after 10s");
      finish({ kind: "failed" });
    }, 10_000);
    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString("utf-8"); });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString("utf-8"); });
    proc.on("close", (code) => finish(classifyClaudeAuthProbe(stdout, stderr, code)));
    proc.on("error", () => finish({ kind: "failed" }));
  });
}
