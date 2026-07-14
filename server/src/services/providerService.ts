/**
 * Provider Service — 多模型供应商配置
 *
 * 引擎分工:
 *   - anthropic-official : Anthropic 官方,走 Agent SDK(HIL/检查点/compact 全量能力)
 *   - codex              : OpenAI,走 Codex CLI(ChatGPT 订阅)
 *   - anthropic-compat   : 国产/第三方模型(DeepSeek/MiniMax/Kimi/GLM/自定义),
 *                          直连各家的 Anthropic 兼容端点(Base URL + API Key),
 *                          仍然跑 Claude Code harness,能力与官方一致
 *
 * (曾短暂改由 opencode CLI 接管第三方,2026-07-02 应用户要求撤回,恢复直连。)
 * API Key 仅存本地 ~/.fufan-cc-flow/providers.json,掩码返回,不写日志。
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fetchAnthropicModels } from "../utils/anthropicModels.js";
import { fetchOpenAiModels } from "../utils/openaiModels.js";
import { readClaudeSettings, readOAuthToken } from "./claudeSettingsService.js";
import { readProxy } from "./proxyConfig.js";
import { logger } from "../utils/logger.js";

const PROVIDERS_FILE = path.join(os.homedir(), ".fufan-cc-flow", "providers.json");

export type ProviderKind = "anthropic-official" | "anthropic-compat" | "codex";

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** anthropic-compat 必填;official/codex 留空 */
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  defaultModel?: string;
  builtin: boolean;
}

/** 列表接口对外形态:不含明文 Key */
export interface ProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  models: string[];
  defaultModel?: string;
  builtin: boolean;
  /** 是否已配置认证(compat: 有 Key;official/codex: 由各自 CLI 管理) */
  configured: boolean;
  /** Key 掩码提示,如 "sk-…9f3a" */
  apiKeyHint?: string;
  /** 认证由外部 CLI 管理(official → Claude Code 登录,codex → Codex CLI 登录) */
  authManagedByCli: boolean;
}

/**
 * 内置预设。国产模型直连各家官方的 Anthropic 兼容端点,填 API Key 即用;
 * models 为离线兜底,可在设置页「刷新模型列表」从 /v1/models 拉取。
 */
const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    kind: "anthropic-official",
    models: ["opus", "sonnet", "haiku"],
    defaultModel: "sonnet",
    builtin: true,
  },
  {
    id: "openai",
    name: "OpenAI (Codex)",
    kind: "codex",
    // 与 Codex CLI 实际可用档位对齐。注意:ChatGPT 订阅(OAuth)登录没有
    // /v1/models 接口,「刷新模型」只会返回这份内置列表——新档位发布后要手动更新这里
    // (gpt-5.6 三档 2026-07-09 发布:sol=深度/terra=日常/luna=高吞吐,均 1M 上下文)
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
    defaultModel: "gpt-5.6-terra",
    builtin: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "anthropic-compat",
    baseUrl: "https://api.deepseek.com/anthropic",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"],
    defaultModel: "deepseek-chat",
    builtin: true,
  },
  {
    id: "minimax",
    name: "MiniMax",
    kind: "anthropic-compat",
    baseUrl: "https://api.minimaxi.com/anthropic",
    models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2"],
    defaultModel: "MiniMax-M2.5",
    builtin: true,
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    kind: "anthropic-compat",
    baseUrl: "https://api.moonshot.cn/anthropic",
    models: ["kimi-k2.5"],
    defaultModel: "kimi-k2.5",
    builtin: true,
  },
  {
    id: "glm",
    name: "GLM (智谱)",
    kind: "anthropic-compat",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    models: ["glm-4.6"],
    defaultModel: "glm-4.6",
    builtin: true,
  },
];

/** 内置项在磁盘上只存 override 部分 */
type ProviderOverride = Partial<Pick<ProviderConfig, "apiKey" | "baseUrl" | "models" | "defaultModel">>;

/** providers.json 磁盘结构:内置项只存 override,自定义项存完整对象 */
interface ProvidersFile {
  overrides?: Record<string, ProviderOverride>;
  custom?: ProviderConfig[];
  /** 用户删除的内置供应商 id(内置项不硬编码常驻,删了就从列表消失,可一键恢复) */
  hidden?: string[];
}

async function readFileData(): Promise<ProvidersFile> {
  try {
    const raw = await fs.readFile(PROVIDERS_FILE, "utf-8");
    return JSON.parse(raw) as ProvidersFile;
  } catch {
    return {};
  }
}

async function writeFileData(data: ProvidersFile): Promise<void> {
  await fs.mkdir(path.dirname(PROVIDERS_FILE), { recursive: true });
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function mergeBuiltin(base: ProviderConfig, ov?: ProviderOverride): ProviderConfig {
  if (!ov) return { ...base };
  return {
    ...base,
    apiKey: ov.apiKey ?? base.apiKey,
    baseUrl: ov.baseUrl ?? base.baseUrl,
    models: ov.models && ov.models.length > 0 ? ov.models : base.models,
    defaultModel: ov.defaultModel ?? base.defaultModel,
  };
}

/** 全量列表(含明文 Key,仅供服务端内部使用)。被用户删除的内置项不出现。 */
export async function listProvidersInternal(): Promise<ProviderConfig[]> {
  const data = await readFileData();
  const hidden = new Set(data.hidden ?? []);
  const builtins = BUILTIN_PROVIDERS.filter((b) => !hidden.has(b.id)).map((b) =>
    mergeBuiltin(b, data.overrides?.[b.id])
  );
  const custom = (data.custom ?? []).map((c) => ({ ...c, kind: "anthropic-compat" as const, builtin: false }));
  return [...builtins, ...custom];
}

/** 被删除(隐藏)的内置供应商 id 列表 */
export async function hiddenBuiltinIds(): Promise<string[]> {
  const data = await readFileData();
  return (data.hidden ?? []).filter((id) => BUILTIN_PROVIDERS.some((b) => b.id === id));
}

/** 恢复所有被删除的内置供应商 */
export async function restoreDefaultProviders(): Promise<void> {
  const data = await readFileData();
  data.hidden = [];
  await writeFileData(data);
  logger.info("[providers] restored hidden builtin providers");
}

export async function getProvider(id: string): Promise<ProviderConfig | null> {
  const all = await listProvidersInternal();
  return all.find((p) => p.id === id) ?? null;
}

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  return key.length <= 8 ? "已配置" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function toPublic(p: ProviderConfig): ProviderPublic {
  const authManagedByCli = p.kind !== "anthropic-compat";
  // official/codex 的认证由各自 CLI 管理;compat(直连端点)必须有 Key
  const configured = authManagedByCli ? true : !!p.apiKey;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    models: p.models,
    defaultModel: p.defaultModel,
    builtin: p.builtin,
    configured,
    apiKeyHint: maskKey(p.apiKey),
    authManagedByCli,
  };
}

export async function listProviders(): Promise<ProviderPublic[]> {
  return (await listProvidersInternal()).map(toPublic);
}

export interface ProviderPatch {
  name?: string;
  apiKey?: string;      // 传空字符串 = 清除
  baseUrl?: string;
  models?: string[];
  defaultModel?: string;
}

export async function updateProvider(id: string, patch: ProviderPatch): Promise<ProviderPublic> {
  const data = await readFileData();
  const builtin = BUILTIN_PROVIDERS.find((b) => b.id === id);

  if (builtin) {
    const ov = { ...(data.overrides?.[id] ?? {}) };
    if (patch.apiKey !== undefined) ov.apiKey = patch.apiKey || undefined;
    if (patch.baseUrl !== undefined) ov.baseUrl = patch.baseUrl || undefined;
    if (patch.models !== undefined) ov.models = patch.models;
    if (patch.defaultModel !== undefined) ov.defaultModel = patch.defaultModel || undefined;
    const merged = mergeBuiltin(builtin, ov);
    if (merged.models.length > 0 && (!merged.defaultModel || !merged.models.includes(merged.defaultModel))) {
      ov.defaultModel = merged.models[0];
    }
    data.overrides = { ...(data.overrides ?? {}), [id]: ov };
    await writeFileData(data);
    logger.info(`[providers] updated builtin provider: ${id}`);
    return toPublic(mergeBuiltin(builtin, ov));
  }

  const custom = data.custom ?? [];
  const idx = custom.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`未知供应商: ${id}`);
  const cur = custom[idx];
  const next: ProviderConfig = {
    ...cur,
    name: patch.name ?? cur.name,
    apiKey: patch.apiKey !== undefined ? patch.apiKey || undefined : cur.apiKey,
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : cur.baseUrl,
    models: patch.models ?? cur.models,
    defaultModel: patch.defaultModel !== undefined ? patch.defaultModel || undefined : cur.defaultModel,
  };
  if (next.models.length > 0 && (!next.defaultModel || !next.models.includes(next.defaultModel))) {
    next.defaultModel = next.models[0];
  }
  custom[idx] = next;
  data.custom = custom;
  await writeFileData(data);
  logger.info(`[providers] updated custom provider: ${id}`);
  return toPublic(next);
}

export async function createCustomProvider(input: {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models?: string[];
}): Promise<ProviderPublic> {
  if (!input.name?.trim()) throw new Error("供应商名称不能为空");
  if (!input.baseUrl?.trim()) throw new Error("Base URL 不能为空(需为 Anthropic 兼容端点)");
  const data = await readFileData();
  const id = `custom-${Date.now().toString(36)}`;
  const models = (input.models ?? []).map((m) => m.trim()).filter(Boolean);
  const provider: ProviderConfig = {
    id,
    name: input.name.trim(),
    kind: "anthropic-compat",
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: input.apiKey || undefined,
    models,
    defaultModel: models[0],
    builtin: false,
  };
  data.custom = [...(data.custom ?? []), provider];
  await writeFileData(data);
  logger.info(`[providers] created custom provider: ${id} (${provider.name})`);
  return toPublic(provider);
}

export async function deleteProvider(id: string): Promise<void> {
  const data = await readFileData();
  const builtin = BUILTIN_PROVIDERS.find((b) => b.id === id);
  if (builtin) {
    // Anthropic/OpenAI 是引擎本体,保留;其余内置项(国产预置)可删,
    // 删除 = 加入隐藏名单 + 清掉已存的 Key,可通过「恢复默认」找回。
    if (builtin.kind !== "anthropic-compat") {
      throw new Error("Anthropic 与 OpenAI 是内置引擎,不可删除");
    }
    data.hidden = [...new Set([...(data.hidden ?? []), id])];
    if (data.overrides?.[id]) delete data.overrides[id];
    await writeFileData(data);
    logger.info(`[providers] hid builtin provider: ${id}`);
    return;
  }
  data.custom = (data.custom ?? []).filter((c) => c.id !== id);
  await writeFileData(data);
  logger.info(`[providers] deleted custom provider: ${id}`);
}

/**
 * Anthropic 官方的凭证解析(与 /api/system/models 一致):
 * settings.json 的 API Key → 订阅 OAuth token → 环境变量 Key。
 */
async function resolveOfficialAuth(): Promise<{
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
}> {
  const settings = await readClaudeSettings();
  const env = settings.env ?? {};
  const settingsKey = env.ANTHROPIC_API_KEY;
  const oauthToken = settingsKey ? undefined : await readOAuthToken();
  return {
    apiKey: settingsKey || (oauthToken ? undefined : process.env.ANTHROPIC_API_KEY),
    oauthToken,
    baseUrl: env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || undefined,
  };
}

/** 读 ~/.codex/auth.json 里的 OpenAI API Key(ChatGPT 订阅登录时为空) */
async function readCodexApiKey(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), ".codex", "auth.json"), "utf-8");
    const data = JSON.parse(raw) as { OPENAI_API_KEY?: string | null };
    return data.OPENAI_API_KEY || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Codex 档位过滤:OpenAI /v1/models 会返回大量非对话模型(tts/whisper/embedding 等),
 * 只保留 gpt-* / codex / o系列 的对话模型。
 */
function filterCodexModels(ids: string[]): string[] {
  return ids
    .filter((id) => /^(gpt-|codex|o[0-9])/.test(id))
    .filter((id) => !/audio|realtime|tts|transcribe|image|embed|moderation|search/.test(id))
    .sort()
    .reverse();
}

/** 连通性测试:调 /v1/models,成功即认证有效 */
export async function testProvider(id: string): Promise<{ ok: boolean; message: string; modelCount?: number }> {
  const p = await getProvider(id);
  if (!p) return { ok: false, message: `未知供应商: ${id}` };
  if (p.kind === "codex") {
    return { ok: true, message: "OpenAI 走 Codex CLI,认证由 codex login 管理" };
  }
  if (p.kind === "anthropic-compat" && !p.apiKey) {
    return { ok: false, message: "尚未配置 API Key" };
  }
  try {
    const proxy = await readProxy();
    // 官方供应商没有本地存 Key(认证归 CLI 管),用与 /system/models 相同的凭证链
    const official = p.kind === "anthropic-official" ? await resolveOfficialAuth() : null;
    const models = await fetchAnthropicModels({
      baseUrl: official ? official.baseUrl : p.baseUrl,
      apiKey: official ? official.apiKey : p.apiKey,
      oauthToken: official?.oauthToken,
      proxy: proxy.httpsProxy || proxy.httpProxy || undefined,
      timeoutMs: 10_000,
    });
    return { ok: true, message: `连接成功,可用模型 ${models.length} 个`, modelCount: models.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 部分兼容端点未实现 /v1/models,但鉴权失败一定是 401/403
    if (/HTTP 40[13]/.test(msg)) return { ok: false, message: "认证失败,请检查 API Key" };
    if (/HTTP 404/.test(msg)) {
      return p.models.length > 0
        ? { ok: true, message: "端点可达(该供应商未实现模型列表接口,使用预置模型)" }
        : { ok: true, message: "端点可达(未实现模型列表接口,请在下方手动填写模型列表)" };
    }
    return { ok: false, message: `连接失败: ${msg.slice(0, 200)}` };
  }
}

/** 从供应商端点拉取可用模型并保存 */
export async function refreshProviderModels(id: string): Promise<string[]> {
  const p = await getProvider(id);
  if (!p) throw new Error(`未知供应商: ${id}`);
  const proxy = await readProxy();
  const proxyUrl = proxy.httpsProxy || proxy.httpProxy || undefined;

  // OpenAI (Codex):API Key 登录时可直接问 OpenAI /v1/models;
  // ChatGPT 订阅(OAuth)没有模型列表接口,保留内置档位。
  if (p.kind === "codex") {
    const apiKey = await readCodexApiKey();
    if (!apiKey) return p.models;
    const ids = filterCodexModels(await fetchOpenAiModels({ apiKey, proxy: proxyUrl, timeoutMs: 12_000 }));
    if (ids.length > 0) {
      await updateProvider(id, { models: ids });
      return ids;
    }
    return p.models;
  }

  // Anthropic 官方:凭证归 CLI 管,按 settings Key → OAuth → 环境变量解析
  const official = p.kind === "anthropic-official" ? await resolveOfficialAuth() : null;

  try {
    const models = await fetchAnthropicModels({
      baseUrl: official ? official.baseUrl : p.baseUrl,
      apiKey: official ? official.apiKey : p.apiKey,
      oauthToken: official?.oauthToken,
      proxy: proxyUrl,
      timeoutMs: 12_000,
    });
    const ids = models.map((m) => m.id);
    if (ids.length > 0) {
      await updateProvider(id, { models: ids });
      return ids;
    }
    return p.models;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 部分兼容端点(如 DeepSeek /anthropic)未实现 /v1/models:
    // 404 不算失败,保留现有列表;列表为空(自定义供应商)时提示手动填写
    if (/HTTP 404/.test(msg)) {
      if (p.models.length > 0) return p.models;
      throw new Error("该端点未实现模型列表接口(/v1/models),请手动填写模型列表");
    }
    throw err;
  }
}
