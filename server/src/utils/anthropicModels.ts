/**
 * Fetch the list of models the current account/CLI can actually use, by calling
 * the Anthropic-compatible `/v1/models` endpoint with the configured API key,
 * base URL and (optional) HTTP proxy.
 *
 * Works for both the official API and 国产基座 relays that implement the same
 * `/v1/models` shape. Falls back to an empty list on any failure (the caller
 * supplies a static default).
 */
import https from "https";
import http from "http";
import { URL } from "url";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface ModelInfo {
  id: string;
  display_name: string;
  /** 上下文窗口(输入 token 上限),来自 /v1/models 的 max_input_tokens;未知时缺省 */
  context_window?: number;
}

/**
 * Claude Code harness 不支持的旧代模型:claude-1/2/3 系与 instant 系。
 * 这些 id 仍会出现在 /v1/models 里(账号可调 API),但塞给 Agent SDK 的
 * query() 会直接报错,不应出现在 GUI 的可选列表中。
 */
function isLegacyModel(id: string): boolean {
  return /^claude-(instant|[123])([.-]|$)/.test(id) || /^claude-(opus|sonnet|haiku)-[123]([.-]|$)/.test(id);
}

export async function fetchAnthropicModels(opts: {
  baseUrl?: string;
  apiKey?: string;
  /** Claude.ai subscription OAuth access token (used when there is no API key). */
  oauthToken?: string;
  proxy?: string;
  timeoutMs?: number;
}): Promise<ModelInfo[]> {
  const baseUrl = (opts.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/models?limit=1000`);
  const isHttps = url.protocol === "https:";
  const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;
  const timeout = opts.timeoutMs ?? 12_000;

  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    accept: "application/json",
  };
  // Prefer an explicit API key; otherwise fall back to the subscription OAuth token.
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey;
  } else if (opts.oauthToken) {
    headers["authorization"] = `Bearer ${opts.oauthToken}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  }

  const agent = opts.proxy
    ? new HttpsProxyAgent(opts.proxy.includes("://") ? opts.proxy : `http://${opts.proxy}`)
    : undefined;

  const raw = await new Promise<string>((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        host: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent,
        timeout,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          } else {
            resolve(body);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("models request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const json = JSON.parse(raw) as {
    data?: Array<{ id?: string; display_name?: string; max_input_tokens?: number }>;
  };
  const data = Array.isArray(json.data) ? json.data : [];

  // For each model expose the base id, and — when the model advertises a 1M input
  // window — an additional "[1m]" variant that unlocks the 1M context in the CLI.
  // Legacy families (claude-1/2/3, instant) are filtered out — the Claude Code
  // harness can't run them, so listing them just produces "选中即报错" entries.
  const out: ModelInfo[] = [];
  for (const m of data) {
    if (typeof m.id !== "string") continue;
    if (isLegacyModel(m.id)) continue;
    const label = m.display_name || m.id;
    const ctx = typeof m.max_input_tokens === "number" ? m.max_input_tokens : undefined;
    // 基础条目按标准 200K 窗口暴露(即使模型支持 1M,不带 [1m] 后缀时 CLI 生效的
    // 也是 200K);1M 需通过独立的 "[1m]" 变体显式解锁。
    out.push({
      id: m.id,
      display_name: label,
      context_window: ctx !== undefined ? Math.min(ctx, 200_000) : undefined,
    });
    if (ctx !== undefined && ctx >= 1_000_000) {
      out.push({ id: `${m.id}[1m]`, display_name: `${label} (1M context)`, context_window: 1_000_000 });
    }
  }
  return out;
}
