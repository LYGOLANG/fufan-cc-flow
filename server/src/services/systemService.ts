import { existsSync } from "fs";
import { logger } from "../utils/logger.js";
import { spawnClaude } from "../utils/claudeBin.js";
import {
  hasOAuthCredentials,
  readClaudeSettings,
} from "./claudeSettingsService.js";
import { probeClaudeAuth } from "./claudeAuthProbe.js";

export interface AuthStatus {
  installed: boolean;
  authenticated: boolean;
  authMethod: "oauth" | "apikey" | "none";
  version?: string;
}

export interface ClaudeInfo {
  installed: boolean;
  version?: string;
  platform: string;
  gitBashAvailable?: boolean;
}

export interface DoctorSection {
  line: string;
  status: "ok" | "error" | "info";
}

export class SystemService {
  async getClaudeInfo(): Promise<ClaudeInfo> {
    const platform = process.platform;

    return new Promise((resolve) => {
      const proc = spawnClaude(["--version"]);
      if (!proc) {
        logger.info("Claude not detected (可执行文件未解析到)");
        resolve({ installed: false, platform });
        return;
      }
      let output = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          logger.warn("getClaudeInfo timed out after 10s");
          resolve({ installed: false, platform });
        }
      }, 10_000);

      proc.stdout?.on("data", (data: Buffer) => {
        output += data.toString("utf-8");
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0 && output.trim()) {
          const versionMatch = output.trim().match(/\d+\.\d+\.\d+/);
          const version = versionMatch ? versionMatch[0] : output.trim().split("\n")[0];

          const info: ClaudeInfo = {
            installed: true,
            version,
            platform,
          };

          if (platform === "win32") {
            const gitBashCandidates = [
              process.env.CLAUDE_CODE_GIT_BASH_PATH,
              "C:\\Program Files\\Git\\bin\\bash.exe",
              "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
              `${process.env.LOCALAPPDATA || ""}\\Programs\\Git\\bin\\bash.exe`,
            ].filter(Boolean) as string[];
            info.gitBashAvailable = gitBashCandidates.some((p) => existsSync(p));
          }

          logger.info(`Claude detected: v${version}`);
          resolve(info);
        } else {
          logger.info("Claude not detected");
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

  async runDoctor(): Promise<DoctorSection[]> {
    return new Promise((resolve) => {
      const proc = spawnClaude(["doctor"]);
      if (!proc) {
        resolve([{ line: "未找到 claude 可执行文件（请先安装或设置 CLAUDE_BIN）", status: "error" }]);
        return;
      }
      let output = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          logger.warn("runDoctor timed out after 30s");
          resolve([{ line: "claude doctor 超时（30s）", status: "error" }]);
        }
      }, 30_000);

      proc.stdout?.on("data", (data: Buffer) => {
        output += data.toString("utf-8");
      });

      proc.stderr?.on("data", (data: Buffer) => {
        output += data.toString("utf-8");
      });

      proc.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const lines = output.split("\n").filter((l) => l.trim());
        const result: DoctorSection[] = lines.map((line) => {
          if (
            line.includes("✓") ||
            line.includes("✔") ||
            /\bok\b/i.test(line)
          ) {
            return { line, status: "ok" as const };
          } else if (
            line.includes("✗") ||
            line.includes("✘") ||
            /error|fail/i.test(line)
          ) {
            return { line, status: "error" as const };
          } else {
            return { line, status: "info" as const };
          }
        });
        resolve(result);
      });

      proc.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve([{ line: "无法运行 claude doctor", status: "error" }]);
      });
    });
  }

  async getAuthStatus(): Promise<AuthStatus> {
    const info = await this.getClaudeInfo();
    if (!info.installed) {
      return { installed: false, authenticated: false, authMethod: "none" };
    }

    // Ask Claude itself first. Current native builds store OAuth in the macOS
    // Keychain / OS credential store, so no portable credential file may exist.
    const cliProbe = await probeClaudeAuth();
    if (cliProbe.kind === "status") {
      return { installed: true, ...cliProbe.status, version: info.version };
    }
    if (cliProbe.kind === "failed") {
      return { installed: true, authenticated: false, authMethod: "none", version: info.version };
    }

    // Legacy fallbacks for older Claude builds that do not support auth status.
    if (hasOAuthCredentials()) {
      return { installed: true, authenticated: true, authMethod: "oauth", version: info.version };
    }
    // Check if API key is written in settings.json env
    const settings = await readClaudeSettings();
    if (settings.env?.ANTHROPIC_API_KEY) {
      return { installed: true, authenticated: true, authMethod: "apikey", version: info.version };
    }
    return { installed: true, authenticated: false, authMethod: "none", version: info.version };
  }

  async runUpdate(): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const proc = spawnClaude(["update"]);
      if (!proc) {
        resolve({ success: false, output: "未找到 claude 可执行文件（请先安装或设置 CLAUDE_BIN）" });
        return;
      }
      let output = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          logger.warn("runUpdate timed out after 120s");
          resolve({ success: false, output: "claude update 超时（120s）" });
        }
      }, 120_000);

      proc.stdout?.on("data", (data: Buffer) => {
        output += data.toString("utf-8");
      });

      proc.stderr?.on("data", (data: Buffer) => {
        output += data.toString("utf-8");
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: code === 0, output });
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, output: err.message });
      });
    });
  }
}
