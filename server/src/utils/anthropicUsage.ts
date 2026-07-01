/**
 * Fetch Claude.ai subscription usage (rate-limit utilization) via the OAuth
 * token — the same data Claude Code's /usage shows: a 5-hour session window and
 * a 7-day weekly window, each with a utilization % and a reset timestamp.
 */
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface UsageWindow {
  utilization: number; // 0..100
  resetsAt: string | null; // ISO timestamp
}

export interface OAuthUsage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

export async function fetchOAuthUsage(opts: {
  token: string;
  proxy?: string;
  timeoutMs?: number;
}): Promise<OAuthUsage> {
  const agent = opts.proxy
    ? new HttpsProxyAgent(opts.proxy.includes("://") ? opts.proxy : `http://${opts.proxy}`)
    : undefined;

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          authorization: `Bearer ${opts.token}`,
          "anthropic-beta": "oauth-2025-04-20",
          accept: "application/json",
        },
        agent,
        timeout: opts.timeoutMs ?? 12_000,
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) reject(new Error(`HTTP ${res.statusCode}: ${b.slice(0, 200)}`));
          else resolve(b);
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("usage request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const j = JSON.parse(raw) as Record<string, { utilization?: number; resets_at?: string } | null>;
  const win = (o: { utilization?: number; resets_at?: string } | null): UsageWindow | null =>
    o && typeof o.utilization === "number"
      ? { utilization: o.utilization, resetsAt: o.resets_at ?? null }
      : null;
  return { fiveHour: win(j.five_hour), sevenDay: win(j.seven_day) };
}
