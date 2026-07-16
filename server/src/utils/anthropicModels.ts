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

const OFFICIAL_ANTHROPIC_ORIGIN = "https://api.anthropic.com";

/** Subscription OAuth Bearer credentials must never be sent to custom hosts. */
export function assertOfficialAnthropicOAuthUrl(url: URL): void {
  if (url.origin !== OFFICIAL_ANTHROPIC_ORIGIN) {
    throw new Error("Claude subscription OAuth is restricted to api.anthropic.com");
  }
}

/**
 * Claude Code harness 不支持的旧代模型:claude-1/2/3 系与 instant 系。
 * 这些 id 仍会出现在 /v1/models 里(账号可调 API),但塞给 Agent SDK 的
 * query() 会直接报错,不应出现在 GUI 的可选列表中。
 */
function isLegacyModel(id: string): boolean {
  return /^claude-(instant|[123])([.-]|$)/.test(id) || /^claude-(opus|sonnet|haiku)-[123]([.-]|$)/.test(id);
}

/**
 * 原生默认 1M 上下文的当代 Claude 模型(2026-06 官方目录):
 * Fable 5 / Mythos 5 / Sonnet 5 / Opus 4.6~4.8 / Sonnet 4.6。
 * 这些模型在 Claude Code 里不带 "[1m]" 后缀就是 1M,不需要也不该生成
 * 200K 基础条目 + "[1m]" 变体的双条目;只有老一代靠 beta 解锁 1M 的
 * 模型(Sonnet 4 / 4.5 等)才走双条目逻辑。
 */
function isNative1M(id: string): boolean {
  return (
    /^claude-(fable|mythos|sonnet)-5([.-]|$)/i.test(id) ||
    /^claude-opus-4-[678]([.-]|$)/i.test(id) ||
    /^claude-sonnet-4-6([.-]|$)/i.test(id)
  );
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
  const usesOAuth = !opts.apiKey && !!opts.oauthToken;
  if (usesOAuth) assertOfficialAnthropicOAuthUrl(url);
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
    if (isNative1M(m.id)) {
      // 当代模型:原生默认 1M,单条目直出,不锁 200K、不生成 "[1m]" 变体
      out.push({ id: m.id, display_name: label, context_window: ctx ?? 1_000_000 });
      continue;
    }
    // 老一代模型:基础条目按标准 200K 窗口暴露(即使模型支持 1M,不带 [1m]
    // 后缀时 CLI 生效的也是 200K);1M 需通过独立的 "[1m]" 变体显式解锁。
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
