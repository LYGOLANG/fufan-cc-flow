/**
 * providerStore — 模型供应商列表与配置操作
 *
 * 数据源是 server 的 /api/providers(Key 只在服务端本地存储,
 * 这里拿到的是掩码后的公开形态)。
 */
import { create } from "zustand";
import { api } from "../services/api";
import type { ProviderInfo, ProviderTestResult } from "../types/provider";

interface ProviderState {
  providers: ProviderInfo[];
  /** 被用户删除的内置供应商 id(可一键恢复) */
  hiddenBuiltins: string[];
  loading: boolean;
  loadError: string;

  loadProviders: () => Promise<void>;
  restoreDefaults: () => Promise<void>;
  updateProvider: (
    id: string,
    patch: { name?: string; apiKey?: string; baseUrl?: string; models?: string[]; defaultModel?: string }
  ) => Promise<void>;
  createProvider: (data: { name: string; baseUrl: string; apiKey?: string; models?: string[] }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (id: string) => Promise<ProviderTestResult>;
  refreshModels: (id: string) => Promise<string[]>;
}

export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: [],
  hiddenBuiltins: [],
  loading: false,
  loadError: "",

  loadProviders: async () => {
    set({ loading: true, loadError: "" });
    try {
      const { providers, hiddenBuiltins } = await api.getProviders();
      set({ providers, hiddenBuiltins: hiddenBuiltins ?? [], loading: false });
    } catch (err) {
      set({
        loading: false,
        loadError: err instanceof Error ? err.message : "加载供应商列表失败",
      });
    }
  },

  restoreDefaults: async () => {
    const { providers, hiddenBuiltins } = await api.restoreDefaultProviders();
    set({ providers, hiddenBuiltins: hiddenBuiltins ?? [] });
  },

  updateProvider: async (id, patch) => {
    const { provider } = await api.updateProvider(id, patch);
    set({ providers: get().providers.map((p) => (p.id === id ? provider : p)) });
  },

  createProvider: async (data) => {
    const { provider } = await api.createProvider(data);
    set({ providers: [...get().providers, provider] });
  },

  deleteProvider: async (id) => {
    await api.deleteProvider(id);
    set({ providers: get().providers.filter((p) => p.id !== id) });
  },

  testProvider: (id) => api.testProvider(id),

  refreshModels: async (id) => {
    const { models } = await api.refreshProviderModels(id);
    set({
      providers: get().providers.map((p) => (p.id === id ? { ...p, models } : p)),
    });
    return models;
  },
}));
