/**
 * Fetch the model list from the OpenAI API (`GET /v1/models`, Bearer auth).
 * Used to refresh the Codex provider's model list when the user logged in
 * with an API key (ChatGPT-subscription OAuth has no models endpoint).
 */
import https from "https";
import http from "http";
import { URL } from "url";
import { HttpsProxyAgent } from "https-proxy-agent";

export async function fetchOpenAiModels(opts: {
  apiKey: string;
  baseUrl?: string;
  proxy?: string;
  timeoutMs?: number;
}): Promise<string[]> {
  const baseUrl = (opts.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/v1/models`);
  const isHttps = url.protocol === "https:";
  const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;
  const timeout = opts.timeoutMs ?? 12_000;

  const agent = opts.proxy
    ? new HttpsProxyAgent(opts.proxy.includes("://") ? opts.proxy : `http://${opts.proxy}`)
    : undefined;

  const raw = await new Promise<string>((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        host: url.hostname,
        port,
        path: url.pathname,
        method: "GET",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          accept: "application/json",
        },
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

  const json = JSON.parse(raw) as { data?: Array<{ id?: string }> };
  const data = Array.isArray(json.data) ? json.data : [];
  return data.map((m) => m.id).filter((id): id is string => typeof id === "string");
}
