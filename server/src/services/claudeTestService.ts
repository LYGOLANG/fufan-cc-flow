import { query } from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import net from "net";
import http from "http";
import { logger } from "../utils/logger.js";
import { resolveCliPath } from "../utils/claudeCli.js";

export interface ClaudeTestResult {
  success: boolean;
  responseText: string;
  latency: number;
  error?: string;
}

export interface ProxyTestResult {
  success: boolean;
  latency: number;
  error?: string;
}

/** TCP-only probe: can we reach host:port within 5 s? */
export function testProxyPort(host: string, port: number): Promise<ProxyTestResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, latency: Date.now() - start, error: "连接超时（5秒）" });
    }, 5_000);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: true, latency: Date.now() - start });
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, latency: Date.now() - start, error: err.message });
    });
  });
}

/**
 * Full connectivity test: send HTTP CONNECT through the proxy to api.anthropic.com:443.
 * This verifies the proxy can actually reach Anthropic's servers, not just that the
 * proxy port itself is open.
 */
export function testProxyConnectivity(
  proxyHost: string,
  proxyPort: number
): Promise<ProxyTestResult> {
  const start = Date.now();
  const target = "api.anthropic.com:443";

  return new Promise((resolve) => {
    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: target,
      headers: {
        Host: target,
        "Proxy-Connection": "keep-alive",
      },
    });

    const timer = setTimeout(() => {
      req.destroy();
      resolve({ success: false, latency: Date.now() - start, error: "连接超时（10秒）" });
    }, 10_000);

    req.on("connect", (res, socket) => {
      clearTimeout(timer);
      socket.destroy();
      req.destroy();
      if (res.statusCode === 200) {
        resolve({ success: true, latency: Date.now() - start });
      } else {
        resolve({
          success: false,
          latency: Date.now() - start,
          error: `代理返回状态码 ${res.statusCode}`,
        });
      }
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, latency: Date.now() - start, error: err.message });
    });

    req.end();
  });
}

/**
 * Test Claude connection using Agent SDK query().
 * Sends a minimal prompt and checks for a valid response.
 */
export async function testClaudeConnection(opts: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  httpProxy?: string;
  httpsProxy?: string;
}): Promise<ClaudeTestResult> {
  const start = Date.now();
  const testCwd = join(tmpdir(), "fufan-cc-sdk-test");
  // spawn() 的 cwd 必须存在，否则在 Windows 上抛 ENOENT，
  // 被 SDK 误报为 "Claude Code executable not found"。
  try { mkdirSync(testCwd, { recursive: true }); } catch { /* ignore */ }

  let stderrOutput = "";
  let responseText = "";
  try {
    // 必须继承 process.env（PATH / SystemRoot 等），否则 SDK 在 Windows 上
    // spawn "node" 会 ENOENT，被误报为 "Claude Code executable not found"。
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDECODE; // 防止 CLI 嵌套会话检测拒绝启动
    if (opts.apiKey) {
      env["ANTHROPIC_API_KEY"] = opts.apiKey;
    } else {
      // OAuth/订阅模式：清除环境里残留的 ANTHROPIC_API_KEY（如系统级 ANTHROPIC_API_KEY），
      // 否则 CLI 会优先用它鉴权而忽略 ~/.claude 的订阅凭证，导致 exit code 1。
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
    }
    if (opts.baseUrl)    env["ANTHROPIC_BASE_URL"] = opts.baseUrl;
    else                 delete env["ANTHROPIC_BASE_URL"]; // OAuth 走官方端点
    if (opts.httpProxy)  { env["HTTP_PROXY"]  = opts.httpProxy;  env["http_proxy"]  = opts.httpProxy; }
    if (opts.httpsProxy) { env["HTTPS_PROXY"] = opts.httpsProxy; env["https_proxy"] = opts.httpsProxy; }

    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 30_000);

    const stream = query({
      prompt: "Hi! Reply with exactly one word: OK",
      options: {
        pathToClaudeCodeExecutable: resolveCliPath(),
        cwd: testCwd,
        model: opts.model || "haiku",
        maxTurns: 1,
        // 大模型（Opus/Fable）单次会话仅初始化系统提示就远超 5 美分，0.05 会让
        // 测试必然报 "Reached maximum budget"。这里只作失控兜底，放宽到 1 美元。
        maxBudgetUsd: 1,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController: controller,
        env,
        stderr: (data: string) => { stderrOutput += data; },
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        const raw = msg as Record<string, unknown>;
        const message = raw.message as Record<string, unknown>;
        const content = message?.content as { type: string; text?: string }[];
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) responseText += block.text;
          }
        }
      }
    }

    clearTimeout(hardTimeout);
    const text = responseText.trim();
    return { success: !!text, responseText: text, latency: Date.now() - start };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 模型已回话后才在收尾阶段报错（如预算截断）→ 连接本身是通的，按成功处理。
    const answered = responseText.trim();
    if (answered) {
      logger.warn(`[claudeTest] non-fatal error after response: ${errMsg}`);
      return { success: true, responseText: answered, latency: Date.now() - start };
    }
    const isAbort = errMsg.includes("abort") || (err as Error)?.name === "AbortError";
    // CLI 真正的失败原因通常在 stderr（如代理 ECONNREFUSED、鉴权失败等），
    // 否则只会看到无意义的 "exited with code 1"。
    const detail = stderrOutput.trim();
    logger.warn(`[claudeTest] connection test failed: ${errMsg}${detail ? ` | stderr: ${detail}` : ""}`);
    return {
      success: false,
      responseText: "",
      latency: Date.now() - start,
      error: isAbort
        ? "连接超时（30秒），请检查网络和代理配置"
        : detail
          ? `${errMsg}\n${detail}`
          : errMsg,
    };
  }
}
