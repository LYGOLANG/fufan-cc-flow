/**
 * Fetch ChatGPT/Codex subscription usage from the same account endpoint used by
 * the Codex app. The response contains account PII, so this module only returns
 * sanitized rate-limit windows.
 */
import fs from "fs/promises";
import https from "https";
import os from "os";
import path from "path";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface CodexUsageWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface CodexUsage {
  fiveHour: CodexUsageWindow | null;
  sevenDay: CodexUsageWindow | null;
  planType?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface WhamRateLimitWindow {
  used_percent?: number;
  reset_at?: number;
}

interface WhamUsageResponse {
  plan_type?: string;
  rate_limit?: {
    primary_window?: WhamRateLimitWindow | null;
    secondary_window?: WhamRateLimitWindow | null;
  };
}

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const AUTH_PATH = path.join(CODEX_HOME, "auth.json");

async function readCodexOAuth(): Promise<{ token: string; accountId?: string } | null> {
  try {
    const raw = await fs.readFile(AUTH_PATH, "utf-8");
    const data = JSON.parse(raw) as CodexAuthFile;
    const token = data.tokens?.access_token;
    if (!token) return null;
    return { token, accountId: data.tokens?.account_id };
  } catch {
    return null;
  }
}

function toWindow(win?: WhamRateLimitWindow | null): CodexUsageWindow | null {
  if (!win || typeof win.used_percent !== "number") return null;
  return {
    utilization: win.used_percent,
    resetsAt: typeof win.reset_at === "number"
      ? new Date(win.reset_at * 1000).toISOString()
      : null,
  };
}

export async function fetchCodexUsage(opts: {
  proxy?: string;
  timeoutMs?: number;
}): Promise<CodexUsage | null> {
  const auth = await readCodexOAuth();
  if (!auth) return null;

  const agent = opts.proxy
    ? new HttpsProxyAgent(opts.proxy.includes("://") ? opts.proxy : `http://${opts.proxy}`)
    : undefined;

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: "chatgpt.com",
        path: "/backend-api/wham/usage",
        method: "GET",
        headers: {
          authorization: `Bearer ${auth.token}`,
          ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
          accept: "application/json",
          "user-agent": "codex-cli",
        },
        agent,
        timeout: opts.timeoutMs ?? 12_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(body);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("codex usage request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const json = JSON.parse(raw) as WhamUsageResponse;
  return {
    fiveHour: toWindow(json.rate_limit?.primary_window),
    sevenDay: toWindow(json.rate_limit?.secondary_window),
    planType: json.plan_type,
  };
}
