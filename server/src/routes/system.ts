import { Router, type Router as RouterType } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { SystemService } from "../services/systemService.js";
import { CodexService } from "../services/codexService.js";
import { readProxy, writeProxy } from "../services/proxyConfig.js";
import {
  readClaudeSettings,
  writeClaudeSettingsEnv,
  readOAuthToken,
} from "../services/claudeSettingsService.js";
import { testProxyPort, testProxyConnectivity, testClaudeConnection } from "../services/claudeTestService.js";
import { fetchAnthropicModels, type ModelInfo } from "../utils/anthropicModels.js";
import { fetchOAuthUsage } from "../utils/anthropicUsage.js";
import { fetchCodexUsage } from "../utils/codexUsage.js";
import { shutdownProjectSession, shutdownAllSessions } from "../websocket/chatHandler.js";
import { listInterrupted, clearInterrupted } from "../services/taskRegistry.js";
import { logger } from "../utils/logger.js";

/** Static fallback when /v1/models can't be reached (offline / no key yet). */
// 裸别名解析到当前最新代(2026-06):opus → Opus 4.8、sonnet → Sonnet 5,均原生 1M
const FALLBACK_MODELS: ModelInfo[] = [
  { id: "opus", display_name: "Claude Opus 4.8", context_window: 1_000_000 },
  { id: "sonnet", display_name: "Claude Sonnet 5", context_window: 1_000_000 },
  { id: "haiku", display_name: "Claude Haiku 4.5", context_window: 200_000 },
];
import { getClaudeHome } from "../utils/pathUtils.js";

const execAsync = promisify(exec);

const router: RouterType = Router();
const systemService = new SystemService();
const codexService = new CodexService();

// GET /api/system/claude-info
router.get("/claude-info", async (_req, res) => {
  try {
    const info = await systemService.getClaudeInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/shutdown-project — 关标签的显式收尾兜底
// 客户端关项目标签时本应发 WS "shutdown",但 WS 若正重连/未连会静默丢帧。前端并发打这个
// REST 端点,保证「用户显式关掉项目」一定能立刻收尾其常驻进程,而不是被寄存 30s 甚至复活。
router.post("/shutdown-project", (req, res) => {
  const projectPath = (req.body?.projectPath as string) || "";
  if (!projectPath) {
    res.status(400).json({ error: "projectPath required" });
    return;
  }
  const shut = shutdownProjectSession(projectPath);
  res.json({ shut });
});

// POST /api/system/shutdown-all — 整个应用关闭前的全局收尾(Tauri 退出时调用)。
// 中止所有运行中任务、把它们登记为 interrupted(同步落盘),下次启动前端会收到提醒。
router.post("/shutdown-all", (_req, res) => {
  const interrupted = shutdownAllSessions();
  res.json({ interrupted });
});

// GET /api/system/interrupted-tasks — 上次退出/崩溃时被中止的任务列表(重启提醒用)
router.get("/interrupted-tasks", (_req, res) => {
  res.json({ tasks: listInterrupted() });
});

// POST /api/system/interrupted-tasks/clear — 用户已阅,清除提醒
router.post("/interrupted-tasks/clear", (_req, res) => {
  clearInterrupted();
  res.json({ success: true });
});

// POST /api/system/claude-doctor
router.post("/claude-doctor", async (_req, res) => {
  try {
    const sections = await systemService.runDoctor();
    res.json({ sections });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/claude-update
router.post("/claude-update", async (_req, res) => {
  try {
    const result = await systemService.runUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/proxy — reads from dedicated proxy.json
router.get("/proxy", async (_req, res) => {
  try {
    const proxy = await readProxy();
    res.json(proxy);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/proxy-save?http=...&https=...&socks=...
router.get("/proxy-save", async (req, res) => {
  try {
    const httpProxy  = typeof req.query.http  === "string" ? req.query.http  : "";
    const httpsProxy = typeof req.query.https === "string" ? req.query.https : "";
    const socksProxy = typeof req.query.socks === "string" ? req.query.socks : "";
    await writeProxy({ httpProxy, httpsProxy, socksProxy });
    res.json({ success: true });
  } catch (err) {
    logger.error("writeProxy failed: " + String(err));
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/proxy — writes to dedicated proxy.json (not ~/.claude/settings.json)
// Using POST instead of PATCH to avoid Windows proxy/firewall PATCH-method blocking
router.post("/proxy", async (req, res) => {
  try {
    // Defensive parsing: req.body may be undefined if body-parser didn't run
    const body = (req.body ?? {}) as Record<string, unknown>;
    const httpProxy  = typeof body.httpProxy  === "string" ? body.httpProxy  : "";
    const httpsProxy = typeof body.httpsProxy === "string" ? body.httpsProxy : "";
    const socksProxy = typeof body.socksProxy === "string" ? body.socksProxy : "";
    await writeProxy({ httpProxy, httpsProxy, socksProxy });
    res.json({ success: true });
  } catch (err) {
    logger.error("writeProxy failed: " + String(err));
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/models — list models the configured account/CLI can use.
// Reads key/baseUrl from ~/.claude/settings.json env and proxy from proxy.json,
// calls /v1/models, and falls back to a static list on any failure.
router.get("/models", async (_req, res) => {
  try {
    const settings = await readClaudeSettings();
    const env = settings.env ?? {};
    // Auth priority: app-configured key (settings.json) → subscription OAuth token
    // → ambient env key (last resort). This ensures subscription users use their
    // Claude.ai token rather than an unrelated ANTHROPIC_API_KEY in the server env.
    const settingsKey = env.ANTHROPIC_API_KEY;
    const oauthToken = settingsKey ? undefined : await readOAuthToken();
    const apiKey = settingsKey || (oauthToken ? undefined : process.env.ANTHROPIC_API_KEY);
    const baseUrl = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL;
    const proxy = await readProxy();
    const models = await fetchAnthropicModels({
      apiKey,
      oauthToken,
      baseUrl,
      proxy: proxy.httpsProxy || proxy.httpProxy || undefined,
    });
    if (models.length === 0) {
      return res.json({ models: FALLBACK_MODELS, source: "fallback" });
    }
    res.json({ models, source: "live" });
  } catch (err) {
    logger.warn("[models] live fetch failed, using fallback: " + String(err));
    res.json({ models: FALLBACK_MODELS, source: "fallback", error: String(err) });
  }
});

// GET /api/system/usage?provider=anthropic|codex — subscription rate-limit usage
// (5h + weekly). Anthropic uses Claude.ai OAuth; Codex uses ChatGPT OAuth.
// Cached for 60s, and on upstream failure (e.g. 429) the last good value is
// served as `stale` so the UI keeps showing it instead of flickering away.
let usageCache: Record<string, { data: Record<string, unknown>; at: number } | undefined> = {};
const USAGE_TTL_MS = 60_000;
router.get("/usage", async (req, res) => {
  const provider = req.query.provider === "codex" ? "codex" : "anthropic";
  try {
    const cached = usageCache[provider];
    if (cached && Date.now() - cached.at < USAGE_TTL_MS) {
      return res.json(cached.data);
    }
    const proxy = await readProxy();

    let payload: Record<string, unknown>;
    if (provider === "codex") {
      const usage = await fetchCodexUsage({
        proxy: proxy.httpsProxy || proxy.httpProxy || undefined,
      });
      if (!usage) return res.json({ available: false, source: provider });
      payload = { available: true, source: provider, ...usage };
    } else {
      const token = await readOAuthToken();
      if (!token) return res.json({ available: false, source: provider });
      const usage = await fetchOAuthUsage({
        token,
        proxy: proxy.httpsProxy || proxy.httpProxy || undefined,
      });
      payload = { available: true, source: provider, ...usage };
    }

    usageCache[provider] = { data: payload, at: Date.now() };
    res.json(payload);
  } catch (err) {
    logger.warn(`[usage:${provider}] fetch failed: ` + String(err));
    // Serve last known good value (if any) so the UI doesn't flicker on a
    // transient 429/network blip.
    const cached = usageCache[provider];
    if (cached) return res.json({ ...cached.data, stale: true });
    res.json({ available: false, source: provider, error: String(err) });
  }
});

// GET /api/system/auth-status
router.get("/auth-status", async (_req, res) => {
  try {
    const status = await systemService.getAuthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/proxy-test?host=127.0.0.1&port=7890
// Tests whether the HTTP proxy at host:port can reach api.anthropic.com via CONNECT.
// Falls back to a plain TCP probe for SOCKS proxies (when ?mode=tcp).
router.get("/proxy-test", async (req, res) => {
  const host = typeof req.query.host === "string" ? req.query.host : "127.0.0.1";
  const port = parseInt(typeof req.query.port === "string" ? req.query.port : "0", 10);
  const mode = typeof req.query.mode === "string" ? req.query.mode : "connect";
  if (!port || port < 1 || port > 65535) {
    return res.status(400).json({ error: "无效端口" });
  }
  try {
    const result =
      mode === "tcp"
        ? await testProxyPort(host, port)
        : await testProxyConnectivity(host, port);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/claude-test
router.post("/claude-test", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const proxy = await readProxy();
    const result = await testClaudeConnection({
      apiKey:      typeof body.apiKey   === "string" ? body.apiKey   : undefined,
      baseUrl:     typeof body.baseUrl  === "string" ? body.baseUrl  : undefined,
      model:       typeof body.model    === "string" ? body.model    : undefined,
      httpProxy:   typeof body.httpProxy  === "string" ? body.httpProxy  : proxy.httpProxy  || undefined,
      httpsProxy:  typeof body.httpsProxy === "string" ? body.httpsProxy : proxy.httpsProxy || undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/claude-settings  — read env section
router.get("/claude-settings", async (_req, res) => {
  try {
    const settings = await readClaudeSettings();
    res.json({ env: settings.env ?? {} });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/claude-settings  — write/merge env section
router.post("/claude-settings", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const env = (body.env ?? {}) as Record<string, string | undefined>;
  try {
    await writeClaudeSettingsEnv(env);
    res.json({ success: true });
  } catch (err) {
    logger.error("writeClaudeSettingsEnv failed: " + String(err));
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/pick-folder — open native OS folder dialog, return selected path
// Server and client run on the same machine (local tool), so the dialog appears on the user's desktop.
router.get("/pick-folder", async (_req, res) => {
  try {
    let selectedPath: string | null = null;

    if (process.platform === "win32") {
      // Use PowerShell with -STA (Single-Threaded Apartment) so WinForms shows
      // the modern IFileDialog-based picker (Windows Vista+) instead of the
      // old SHBrowseForFolder tree dialog.
      // EnableVisualStyles() ensures native visual themes are applied.
      //
      // [Console]::OutputEncoding = UTF8: 中文 Windows 下 PowerShell 非交互/重定向
      // 场景默认按系统 OEM 代码页(GBK/936)编码 stdout,而 Node 的 execAsync 按 UTF-8
      // 解码——GBK 字节不是合法 UTF-8 序列,选中文文件夹时路径直接乱码(同 ptyService.ts
      // 里 cmd.exe 需要 chcp 65001 的道理一样,这里是 PowerShell 自己的输出编码开关)。
      const psScript = [
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
        "Add-Type -AssemblyName System.Windows.Forms;",
        "[System.Windows.Forms.Application]::EnableVisualStyles();",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog;",
        "$d.UseDescriptionForTitle = $true;",
        "$d.Description = 'Select Project Folder';",
        "$d.AutoUpgradeEnabled = $true;",
        "$null = $d.ShowDialog();",
        "Write-Output $d.SelectedPath",
      ].join(" ");
      const { stdout } = await execAsync(`powershell -NoProfile -STA -Command "${psScript}"`, {
        timeout: 120_000,
      });
      const p = stdout.trim();
      selectedPath = p || null;
    } else if (process.platform === "darwin") {
      // macOS: AppleScript choose folder
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select your project folder")'`,
        { timeout: 120_000 }
      );
      const p = stdout.trim().replace(/\/$/, ""); // strip trailing slash
      selectedPath = p || null;
    } else {
      // Linux: zenity (most desktop distros have it)
      const { stdout } = await execAsync(
        `zenity --file-selection --directory --title="Select Project Folder" 2>/dev/null`,
        { timeout: 120_000 }
      );
      const p = stdout.trim();
      selectedPath = p || null;
    }

    res.json({ path: selectedPath });
  } catch {
    // User cancelled the dialog, or the command failed — return null gracefully
    res.json({ path: null });
  }
});

// GET /api/system/debug-claude-home — dev diagnostic endpoint
// Returns Claude home directory info to help diagnose session listing issues
router.get("/debug-claude-home", async (_req, res) => {
  try {
    const claudeHome = getClaudeHome();
    const projectsDir = path.join(claudeHome, "projects");
    const projectsDirExists = await fs.access(projectsDir).then(() => true).catch(() => false);
    let projectDirs: string[] = [];
    let sessionCount = 0;

    if (projectsDirExists) {
      projectDirs = await fs.readdir(projectsDir).catch(() => []);
      for (const dir of projectDirs) {
        const files = await fs.readdir(path.join(projectsDir, dir)).catch(() => []);
        sessionCount += files.filter((f) => f.endsWith(".jsonl")).length;
      }
    }

    res.json({
      claudeHome,
      projectsDir,
      projectsDirExists,
      projectDirs,
      sessionCount,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── OpenAI Codex 引擎 ────────────────────────────────────────────────────────

// GET /api/system/codex-info — codex 安装/版本检测
router.get("/codex-info", async (_req, res) => {
  try {
    const info = await codexService.getCodexInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/system/codex-auth-status — 读 ~/.codex/auth.json 判断认证方式
router.get("/codex-auth-status", async (_req, res) => {
  try {
    const status = await codexService.getCodexAuthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/system/codex-login — 订阅登录(后端跑 codex login,自动开浏览器)。可能阻塞至多 180s。
router.post("/codex-login", async (_req, res) => {
  try {
    const result = await codexService.subscriptionLogin();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, output: String(err) });
  }
});

// POST /api/system/codex-login-apikey — { apiKey } 用 API Key 登录
router.post("/codex-login-apikey", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
  if (!apiKey.trim()) {
    return res.status(400).json({ success: false, output: "apiKey 不能为空" });
  }
  try {
    const result = await codexService.loginWithApiKey(apiKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, output: String(err) });
  }
});

// POST /api/system/codex-logout — 退出 codex 登录
router.post("/codex-logout", async (_req, res) => {
  try {
    const result = await codexService.logout();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/system/codex-test — { model? } 连通性测试(codex exec 跑一句)
router.post("/codex-test", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await codexService.testCodex({
      model: typeof body.model === "string" ? body.model : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, responseText: "", latency: 0, error: String(err) });
  }
});

export default router;
