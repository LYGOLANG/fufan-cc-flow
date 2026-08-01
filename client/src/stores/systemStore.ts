import { create } from "zustand";
import { api } from "../services/api";
import type { ModelOption, ModelId } from "../types/claude";
import { useConfigStore } from "./configStore";

/**
 * 把 ~/.claude/settings.json 里 env.ANTHROPIC_MODEL 回填到 configStore.model。
 *
 * 背景:对话实际用的是 configStore.model(每条消息显式传 --model),而它优先级高于
 * settings.json 的 env.ANTHROPIC_MODEL,导致用户在「国产基座替换」里设的模型(如 kimi)
 * 被默认的 opus 覆盖、从不生效。这里在加载/保存 settings 后做一次同步,让「设置的模型」
 * 成为「实际使用的模型」,ModelSelector 也会随之显示正确。
 */
function syncModelFromEnv(env: Record<string, string>): void {
  const envModel = env["ANTHROPIC_MODEL"]?.trim();
  if (envModel && useConfigStore.getState().model !== envModel) {
    useConfigStore.getState().setModel(envModel as ModelId);
  }
}

export interface AuthStatus {
  installed: boolean;
  authenticated: boolean;
  authMethod: "oauth" | "apikey" | "none";
  version?: string;
}

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

export interface ProxySettings {
  httpProxy: string;
  httpsProxy: string;
  socksProxy: string;
}

// ── OpenAI Codex 引擎 ──
export interface CodexInfo {
  installed: boolean;
  version?: string;
  platform: string;
}

export interface CodexAuthStatus {
  installed: boolean;
  authenticated: boolean;
  authMethod: "chatgpt" | "apikey" | "none";
  version?: string;
}

export interface CodexTestResult {
  success: boolean;
  responseText: string;
  latency: number;
  error?: string;
}

export interface CodexLogoutResult {
  success: boolean;
  output?: string;
  error?: string;
}

export function assertCodexLogoutSucceeded(result: CodexLogoutResult): void {
  if (!result.success) {
    throw new Error(result.error || result.output || "Codex CLI 未能退出登录");
  }
}

interface SystemState {
  claudeInfo: ClaudeInfo | null;
  infoLoading: boolean;
  doctorResult: DoctorSection[] | null;
  doctorLoading: boolean;
  updateOutput: string | null;
  updateLoading: boolean;
  proxySettings: ProxySettings;
  proxySaving: boolean;
  proxySaveError: string | null;

  // Auth status
  authStatus: AuthStatus | null;
  authStatusLoading: boolean;

  // Claude test (send "Hi" to verify full chain)
  claudeTestResult: ClaudeTestResult | null;
  claudeTesting: boolean;

  // Proxy port test
  proxyTestResult: ProxyTestResult | null;
  proxyTesting: boolean;

  // ~/.claude/settings.json env section (domestic model config)
  claudeSettingsEnv: Record<string, string>;
  claudeSettingsSaving: boolean;

  /** attempt 仅供内部重试递归使用，调用方不传 */
  loadClaudeInfo: (attempt?: number) => Promise<void>;
  runDoctor: () => Promise<void>;
  runUpdate: () => Promise<void>;
  loadProxy: () => Promise<void>;
  saveProxy: (proxy: ProxySettings) => Promise<void>;
  setProxySettings: (proxy: ProxySettings) => void;

  /** attempt 仅供内部重试递归使用，调用方不传 */
  loadAuthStatus: (attempt?: number) => Promise<void>;
  testProxy: (host: string, port: number) => Promise<void>;
  testClaude: (opts: { apiKey?: string; baseUrl?: string; model?: string; httpProxy?: string; httpsProxy?: string }) => Promise<ClaudeTestResult>;
  loadClaudeSettings: () => Promise<void>;
  saveClaudeSettings: (env: Record<string, string>) => Promise<void>;

  // Available models (live from /v1/models, or static fallback)
  availableModels: ModelOption[];
  modelsSource: "live" | "fallback" | null;
  modelsLoading: boolean;
  loadModels: () => Promise<void>;

  // Subscription usage (5h + weekly); only available for OAuth/订阅 logins
  usage: { source: UsageSource; fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; planType?: string } | null;
  usageAvailable: boolean;
  loadUsage: (source?: UsageSource) => Promise<void>;

  // ── OpenAI Codex 引擎 ──
  codexInfo: CodexInfo | null;
  codexInfoLoading: boolean;
  codexAuthStatus: CodexAuthStatus | null;
  codexLoggingIn: boolean;
  codexTestResult: CodexTestResult | null;
  codexTesting: boolean;
  /** attempt 仅供内部重试递归使用，调用方不传 */
  loadCodexInfo: (attempt?: number) => Promise<void>;
  /** attempt 仅供内部重试递归使用，调用方不传 */
  loadCodexAuthStatus: (attempt?: number) => Promise<void>;
  codexSubscriptionLogin: () => Promise<{ success: boolean; output: string; alreadyLoggedIn?: boolean }>;
  codexLoginApiKey: (apiKey: string) => Promise<{ success: boolean; output: string }>;
  codexLogout: () => Promise<void>;
  testCodex: (opts?: { model?: string }) => Promise<CodexTestResult>;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}
export type UsageSource = "anthropic" | "codex";

/**
 * CLI 探测失败后的重试次数与间隔。
 *
 * 应用启动时 AppLayout 一 mount 就发探测请求，而那时 Rust 刚 spawn 完
 * sidecar，Node 后端往往还没开始监听。600/1200/1800/2400ms 累计约 6 秒，
 * 足够覆盖冷启动，又不至于在真的没装 CLI 时让用户等太久。
 */
const CLI_PROBE_RETRIES = 4;
const cliProbeDelay = (attempt: number) => 600 * (attempt + 1);

export const useSystemStore = create<SystemState>((set, get) => ({
  claudeInfo: null,
  infoLoading: false,
  doctorResult: null,
  doctorLoading: false,
  updateOutput: null,
  updateLoading: false,
  proxySettings: { httpProxy: "", httpsProxy: "", socksProxy: "" },
  proxySaving: false,
  proxySaveError: null,
  authStatus: null,
  authStatusLoading: false,
  claudeTestResult: null,
  claudeTesting: false,
  proxyTestResult: null,
  proxyTesting: false,
  claudeSettingsEnv: {},
  claudeSettingsSaving: false,
  availableModels: [],
  modelsSource: null,
  modelsLoading: false,
  usage: null,
  usageAvailable: false,
  codexInfo: null,
  codexInfoLoading: false,
  codexAuthStatus: null,
  codexLoggingIn: false,
  codexTestResult: null,
  codexTesting: false,

  loadClaudeInfo: async (attempt = 0) => {
    set({ infoLoading: true });
    try {
      const info = await api.systemApi.getClaudeInfo();
      set({ claudeInfo: info, infoLoading: false });
    } catch {
      // 探测失败 ≠ 未安装。
      //
      // 这里原先写死 { installed: false }，于是每次启动都误报"未安装 CLI"——
      // 因为 AppLayout 一 mount 就探测，而那时 Node sidecar 常常还没监听，
      // 请求必然失败。用户进一趟设置页触发重新探测，提示才消失。
      //
      // claudeInfo 保持 null（未知）：InputBar 用的是 `installed === false`，
      // null 不会触发提示。宁可暂时不显示状态，也不能报一个错的结论。
      if (attempt < CLI_PROBE_RETRIES) {
        // 不清 infoLoading：重试期间仍属"检测中"，清了会让 UI 闪一下
        setTimeout(() => void get().loadClaudeInfo(attempt + 1), cliProbeDelay(attempt));
        return;
      }
      // 重试耗尽仍不下"未安装"的结论：此时更可能是后端不可用，
      // 那是另一回事，由连接状态指示器负责表达。
      set({ infoLoading: false });
    }
  },

  runDoctor: async () => {
    set({ doctorLoading: true, doctorResult: null });
    try {
      const { sections } = await api.systemApi.runDoctor();
      set({ doctorResult: sections });
    } finally {
      set({ doctorLoading: false });
    }
  },

  runUpdate: async () => {
    set({ updateLoading: true, updateOutput: null });
    try {
      const { output } = await api.systemApi.runUpdate();
      set({ updateOutput: output || "更新完成" });
    } catch (err) {
      set({ updateOutput: String(err) });
    } finally {
      set({ updateLoading: false });
    }
  },

  loadProxy: async () => {
    try {
      const proxy = await api.systemApi.getProxy();
      set({ proxySettings: proxy });
    } catch {
      // ignore
    }
  },

  saveProxy: async (proxy) => {
    set({ proxySaving: true, proxySaveError: null });
    // Race against a 30-second timeout so the UI never hangs indefinitely
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("保存超时，请检查后端服务是否正常")), 30_000);
    });
    try {
      await Promise.race([api.systemApi.saveProxy(proxy), timeout]);
      set({ proxySettings: proxy });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ proxySaveError: msg });
      throw err; // re-throw so callers can react
    } finally {
      set({ proxySaving: false });
    }
  },

  setProxySettings: (proxy) => set({ proxySettings: proxy }),

  loadAuthStatus: async (attempt = 0) => {
    set({ authStatusLoading: true });
    try {
      const status = await api.systemApi.getAuthStatus();
      set({ authStatus: status, authStatusLoading: false });
    } catch {
      // 与 loadClaudeInfo 同一个问题，且**优先级更高**：useClaudeStatus.ts 里
      //   installed = authStatus?.installed ?? claudeInfo?.installed ?? true
      // authStatus 排在前面。这里写死 false 会直接盖掉 claudeInfo 保持的"未知"，
      // 让那边的修复完全失效——症状从"未安装"变成"未登录 + 红点"而已。
      // 两处必须同步：探测失败保持 null，并重试。
      if (attempt < CLI_PROBE_RETRIES) {
        setTimeout(() => void get().loadAuthStatus(attempt + 1), cliProbeDelay(attempt));
        return;
      }
      set({ authStatusLoading: false });
    }
  },

  testProxy: async (host, port) => {
    set({ proxyTesting: true, proxyTestResult: null });
    try {
      const result = await api.systemApi.testProxy(host, port);
      set({ proxyTestResult: result });
    } catch (err) {
      set({ proxyTestResult: { success: false, latency: 0, error: String(err) } });
    } finally {
      set({ proxyTesting: false });
    }
  },

  testClaude: async (opts) => {
    set({ claudeTesting: true, claudeTestResult: null });
    try {
      const result = await api.systemApi.testClaude(opts);
      set({ claudeTestResult: result });
      return result;
    } catch (err) {
      const r: ClaudeTestResult = { success: false, responseText: "", latency: 0, error: String(err) };
      set({ claudeTestResult: r });
      return r;
    } finally {
      set({ claudeTesting: false });
    }
  },

  loadClaudeSettings: async () => {
    try {
      const data = await api.systemApi.getClaudeSettings();
      const env = data.env ?? {};
      set({ claudeSettingsEnv: env });
      syncModelFromEnv(env); // 让 settings 里设的模型成为实际使用的模型
    } catch { /* ignore */ }
  },

  saveClaudeSettings: async (env) => {
    set({ claudeSettingsSaving: true });
    try {
      await api.systemApi.saveClaudeSettings(env);
      // Refresh
      const data = await api.systemApi.getClaudeSettings();
      const fresh = data.env ?? {};
      set({ claudeSettingsEnv: fresh });
      syncModelFromEnv(fresh); // 保存(如国产基座替换)后立即同步模型
    } finally {
      set({ claudeSettingsSaving: false });
    }
  },

  loadModels: async () => {
    set({ modelsLoading: true });
    try {
      const data = await api.systemApi.getModels();
      const models: ModelOption[] = (data.models ?? []).map((m) => ({
        id: m.id,
        label: m.display_name || m.id,
        contextWindow: m.context_window,
      }));
      set({ availableModels: models, modelsSource: data.source });
    } catch {
      set({ availableModels: [], modelsSource: null });
    } finally {
      set({ modelsLoading: false });
    }
  },

  loadUsage: async (source = "anthropic") => {
    try {
      const data = await api.systemApi.getUsage(source);
      if (data.available) {
        set({
          usageAvailable: true,
          usage: {
            source: data.source ?? source,
            fiveHour: data.fiveHour ?? null,
            sevenDay: data.sevenDay ?? null,
            planType: data.planType,
          },
        });
      } else {
        set((s) => (
          s.usage?.source === source
            ? { usageAvailable: false, usage: null }
            : { usageAvailable: false }
        ));
      }
      // If unavailable on a transient failure, keep the last known value so the
      // bar doesn't flicker in and out. It only stays hidden if never loaded.
    } catch {
      /* keep previous usage value */
    }
  },

  // ── OpenAI Codex 引擎 ──
  loadCodexInfo: async (attempt = 0) => {
    set({ codexInfoLoading: true });
    try {
      const info = await api.systemApi.getCodexInfo();
      set({ codexInfo: info, codexInfoLoading: false });
    } catch {
      // 与 loadClaudeInfo 同一个问题：探测失败不等于未安装。详见那里的说明。
      if (attempt < CLI_PROBE_RETRIES) {
        setTimeout(() => void get().loadCodexInfo(attempt + 1), cliProbeDelay(attempt));
        return;
      }
      set({ codexInfoLoading: false });
    }
  },

  loadCodexAuthStatus: async (attempt = 0) => {
    try {
      const status = await api.systemApi.getCodexAuthStatus();
      set({ codexAuthStatus: status });
    } catch {
      // 同 loadAuthStatus：探测失败不等于未登录。冷启动时后端还没监听，
      // 写死 false 会让界面报「Codex 未登录」而真实状态未知。
      if (attempt < CLI_PROBE_RETRIES) {
        setTimeout(() => void get().loadCodexAuthStatus(attempt + 1), cliProbeDelay(attempt));
      }
    }
  },

  codexSubscriptionLogin: async () => {
    set({ codexLoggingIn: true });
    try {
      const result = await api.systemApi.codexLogin();
      await api.systemApi.getCodexAuthStatus().then((s) => set({ codexAuthStatus: s })).catch(() => {});
      return result;
    } catch (err) {
      return { success: false, output: String(err) };
    } finally {
      set({ codexLoggingIn: false });
    }
  },

  codexLoginApiKey: async (apiKey) => {
    set({ codexLoggingIn: true });
    try {
      const result = await api.systemApi.codexLoginApiKey(apiKey);
      await api.systemApi.getCodexAuthStatus().then((s) => set({ codexAuthStatus: s })).catch(() => {});
      return result;
    } catch (err) {
      return { success: false, output: String(err) };
    } finally {
      set({ codexLoggingIn: false });
    }
  },

  codexLogout: async () => {
    try {
      const result = await api.systemApi.codexLogout();
      assertCodexLogoutSucceeded(result);
    } finally {
      await api.systemApi.getCodexAuthStatus().then((s) => set({ codexAuthStatus: s })).catch(() => {});
    }
  },

  testCodex: async (opts) => {
    set({ codexTesting: true, codexTestResult: null });
    try {
      const result = await api.systemApi.testCodex(opts);
      set({ codexTestResult: result });
      return result;
    } catch (err) {
      const r: CodexTestResult = { success: false, responseText: "", latency: 0, error: String(err) };
      set({ codexTestResult: r });
      return r;
    } finally {
      set({ codexTesting: false });
    }
  },
}));
