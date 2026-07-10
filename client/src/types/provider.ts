/** 模型供应商(与 server/src/services/providerService.ts 的 ProviderPublic 对齐) */

export type ProviderKind = "anthropic-official" | "anthropic-compat" | "codex";

export interface ProviderInfo {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  models: string[];
  defaultModel?: string;
  builtin: boolean;
  /** 是否已配置认证(compat: 有 Key;official/codex: 由各自 CLI 管理,恒为 true) */
  configured: boolean;
  /** Key 掩码提示,如 "sk-…9f3a" */
  apiKeyHint?: string;
  /** 认证由外部 CLI 管理(official → Claude Code 登录,codex → Codex CLI 登录) */
  authManagedByCli: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  modelCount?: number;
}
