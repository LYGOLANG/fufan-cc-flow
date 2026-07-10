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

  loadClaudeInfo: () => Promise<void>;
  runDoctor: () => Promise<void>;
  runUpdate: () => Promise<void>;
  loadProxy: () => Promise<void>;
  saveProxy: (proxy: ProxySettings) => Promise<void>;
  setProxySettings: (proxy: ProxySettings) => void;

  loadAuthStatus: () => Promise<void>;
  testProxy: (host: string, port: number) => Promise<void>;
  testClaude: (opts: { apiKey?: string; baseUrl?: string; model?: string; httpProxy?: string; httpsProxy?: string }) => Promise<ClaudeTestResult>;
  loadClaudeSettings: () => Promise<void>;
  saveClaudeSettings: (env: Record<string, string | undefined>) => Promise<void>;

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
  loadCodexInfo: () => Promise<void>;
  loadCodexAuthStatus: () => Promise<void>;
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

export const useSystemStore = create<SystemState>((set) => ({
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

  loadClaudeInfo: async () => {
    set({ infoLoading: true });
    try {
      const info = await api.systemApi.getClaudeInfo();
      set({ claudeInfo: info });
    } catch {
      set({ claudeInfo: { installed: false, platform: "unknown" } });
    } finally {
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
    // Race against a 10-second timeout so the UI never hangs indefinitely
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("保存超时，请检查后端服务是否正常")), 30_000)
    );
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

  loadAuthStatus: async () => {
    set({ authStatusLoading: true });
    try {
      const status = await api.systemApi.getAuthStatus();
      set({ authStatus: status });
    } catch {
      set({ authStatus: { installed: false, authenticated: false, authMethod: "none" } });
    } finally {
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
  loadCodexInfo: async () => {
    set({ codexInfoLoading: true });
    try {
      const info = await api.systemApi.getCodexInfo();
      set({ codexInfo: info });
    } catch {
      set({ codexInfo: { installed: false, platform: "unknown" } });
    } finally {
      set({ codexInfoLoading: false });
    }
  },

  loadCodexAuthStatus: async () => {
    try {
      const status = await api.systemApi.getCodexAuthStatus();
      set({ codexAuthStatus: status });
    } catch {
      set({ codexAuthStatus: { installed: false, authenticated: false, authMethod: "none" } });
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
      await api.systemApi.codexLogout();
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
