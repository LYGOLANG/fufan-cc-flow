/**
 * CodexService —— OpenAI Codex CLI 引擎的信息 / 认证 / 连通性封装。
 *
 * 与 Claude 引擎(systemService + claudeSettingsService)完全对称,但底层能力全部来自
 * `codex` CLI 子进程:
 *   - 安装/版本       codex --version
 *   - 认证状态        读 ~/.codex/auth.json 的 auth_mode(chatgpt=订阅 / apikey)
 *   - 订阅登录        codex login          (前后端同机,自动打开浏览器完成 ChatGPT 授权)
 *   - API Key 登录    codex login --with-api-key  (key 从 stdin 读入,不落日志/命令行)
 *   - 退出登录        codex logout
 *   - 连通性测试      codex exec --json    (解析末尾 agent_message 作为回复)
 *
 * 跨平台:所有子进程都经 spawnCodex()(mac/linux 直跑、Windows 用 .cmd → cmd /c)。
 */
import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawnCodex } from "../utils/codexBin.js";
import { logger } from "../utils/logger.js";

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const AUTH_PATH = join(CODEX_HOME, "auth.json");

export interface CodexInfo {
  installed: boolean;
  version?: string;
  platform: string;
}

export interface CodexAuthStatus {
  installed: boolean;
  authenticated: boolean;
  /** chatgpt = 订阅登录; apikey = API Key; none = 未认证 */
  authMethod: "chatgpt" | "apikey" | "none";
  version?: string;
}

export interface CodexTestResult {
  success: boolean;
  responseText: string;
  latency: number;
  error?: string;
}

export class CodexService {
  /** codex --version → { installed, version }。10s 超时。 */
  async getCodexInfo(): Promise<CodexInfo> {
    const platform = process.platform;
    return new Promise((resolve) => {
      const proc = spawnCodex(["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      if (!proc) {
        logger.info("Codex not detected (可执行文件未解析到)");
        resolve({ installed: false, platform });
        return;
      }
      let output = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        logger.warn("getCodexInfo timed out after 10s");
        resolve({ installed: false, platform });
      }, 10_000);

      proc.stdout?.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0 && output.trim()) {
          // "codex-cli 0.132.0" → 0.132.0
          const m = output.trim().match(/\d+\.\d+\.\d+/);
          const version = m ? m[0] : output.trim().split("\n")[0];
          logger.info(`Codex detected: v${version}`);
          resolve({ installed: true, version, platform });
        } else {
          resolve({ installed: false, platform });
        }
      });
      proc.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ installed: false, platform });
      });
    });
  }

  /** 读 ~/.codex/auth.json 判断认证方式。 */
  private async readAuthMode(): Promise<"chatgpt" | "apikey" | "none"> {
    try {
      const raw = await fs.readFile(AUTH_PATH, "utf-8");
      const data = JSON.parse(raw) as { auth_mode?: string; OPENAI_API_KEY?: string | null; tokens?: unknown };
      const mode = (data.auth_mode || "").toLowerCase();
      if (mode === "chatgpt" || data.tokens) return "chatgpt";
      if (mode === "apikey" || data.OPENAI_API_KEY) return "apikey";
      return "none";
    } catch {
      return "none";
    }
  }

  async getCodexAuthStatus(): Promise<CodexAuthStatus> {
    const info = await this.getCodexInfo();
    if (!info.installed) {
      return { installed: false, authenticated: false, authMethod: "none" };
    }
    const method = await this.readAuthMode();
    return {
      installed: true,
      authenticated: method !== "none",
      authMethod: method,
      version: info.version,
    };
  }

  /**
   * 订阅登录:后端直接运行 `codex login`。前后端同机(与原生文件夹对话框同理),
   * codex 会自动打开浏览器完成 ChatGPT 授权,授权成功后进程退出 0 并写好 auth.json。
   * 若浏览器未自动弹出,返回捕获到的 stdout(含登录 URL)供前端展示。180s 超时。
   */
  async subscriptionLogin(): Promise<{ success: boolean; output: string; alreadyLoggedIn?: boolean }> {
    return new Promise((resolve) => {
      const proc = spawnCodex(["login"], { stdio: ["ignore", "pipe", "pipe"] });
      if (!proc) {
        resolve({ success: false, output: "未找到 codex 可执行文件（请先安装或设置 CODEX_BIN）" });
        return;
      }
      let output = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        resolve({ success: false, output: output || "登录超时（180s）。请在浏览器完成授权后点击「检测登录状态」。" });
      }, 180_000);

      const onData = (d: Buffer) => (output += d.toString("utf-8"));
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const already = /already logged in|already authenticated/i.test(output);
        resolve({ success: code === 0 || already, output: output.trim(), alreadyLoggedIn: already });
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, output: err.message });
      });
    });
  }

  /**
   * API Key 登录:`codex login --with-api-key`,key 从 stdin 读入(不进命令行、不落日志)。
   */
  async loginWithApiKey(apiKey: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const proc = spawnCodex(["login", "--with-api-key"], { stdio: ["pipe", "pipe", "pipe"] });
      if (!proc) {
        resolve({ success: false, output: "未找到 codex 可执行文件（请先安装或设置 CODEX_BIN）" });
        return;
      }
      let output = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        resolve({ success: false, output: "登录超时（30s）" });
      }, 30_000);

      const onData = (d: Buffer) => (output += d.toString("utf-8"));
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0, output: output.trim() });
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, output: err.message });
      });

      // 把 key 写入 stdin 后关闭,避免落到进程参数/日志里
      proc.stdin?.write(apiKey.trim() + "\n");
      proc.stdin?.end();
    });
  }

  async logout(): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      const proc = spawnCodex(["logout"], { stdio: ["ignore", "pipe", "pipe"] });
      if (!proc) {
        resolve({ success: false });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        resolve({ success: false });
      }, 15_000);
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0 });
      });
      proc.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false });
      });
    });
  }

  /**
   * 连通性测试:`codex exec --json` 跑一句,解析末尾 agent_message。只读 sandbox、跳过
   * git 检查、禁用颜色,stdin 关闭以免它等待额外输入。60s 超时。
   */
  async testCodex(opts?: { model?: string }): Promise<CodexTestResult> {
    const start = Date.now();
    const args = [
      "exec",
      "--ignore-user-config",
      "--json",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "--color",
      "never",
    ];
    if (process.platform === "win32") {
      args.push("-c", 'windows.sandbox="unelevated"');
    }
    if (opts?.model) args.push("-m", opts.model);
    args.push("reply with exactly: PONG");

    return new Promise((resolve) => {
      const proc = spawnCodex(args, { stdio: ["ignore", "pipe", "pipe"] });
      if (!proc) {
        resolve({ success: false, responseText: "", latency: 0, error: "未找到 codex 可执行文件（请先安装或设置 CODEX_BIN）" });
        return;
      }
      let out = "";
      let err = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        resolve({ success: false, responseText: "", latency: Date.now() - start, error: "测试超时（60s）" });
      }, 60_000);

      proc.stdout?.on("data", (d: Buffer) => (out += d.toString("utf-8")));
      proc.stderr?.on("data", (d: Buffer) => (err += d.toString("utf-8")));

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const latency = Date.now() - start;
        // 逐行解析 JSONL,取最后一条 agent_message 文本
        let text = "";
        for (const line of out.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try {
            const ev = JSON.parse(t) as { type?: string; item?: { type?: string; text?: string } };
            if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) {
              text = ev.item.text;
            }
          } catch { /* 忽略非 JSON 行 */ }
        }
        if (code === 0 && text) {
          resolve({ success: true, responseText: text, latency });
        } else {
          resolve({
            success: false,
            responseText: text,
            latency,
            error: (err.trim().split("\n").pop() || out.trim().split("\n").pop() || `codex exec 退出码 ${code}`),
          });
        }
      });
      proc.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, responseText: "", latency: Date.now() - start, error: e.message });
      });
    });
  }
}
