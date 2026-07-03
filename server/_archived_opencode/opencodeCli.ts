/**
 * opencode CLI 工具函数 — 供应商/模型发现与凭证状态
 *
 * opencode 自己管理供应商凭证(~/.local/share/opencode/auth.json,由
 * `opencode auth login` 写入)。我们不碰凭证本身,只读:
 *   - `opencode models`  → 当前可用的 provider/model 列表(有凭证或免费的才会出现)
 *   - auth.json 的 key   → 哪些供应商配置了显式凭证
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawnOpencode } from "../utils/opencodeBin.js";
import { logger } from "../utils/logger.js";

const AUTH_FILE = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");

/** 常见 opencode 供应商 id → 展示名(id 与 models.dev 目录一致) */
const PROVIDER_LABELS: Record<string, string> = {
  opencode: "OpenCode 免费池",
  google: "Google (Gemini)",
  "minimax-cn": "MiniMax (国内)",
  minimax: "MiniMax (国际)",
  deepseek: "DeepSeek",
  openai: "OpenAI (API)",
  openrouter: "OpenRouter",
  moonshotai: "Kimi (国际)",
  "moonshotai-cn": "Kimi (国内)",
  zhipuai: "GLM (智谱)",
  zai: "GLM (Z.ai 国际)",
  alibaba: "通义千问 Qwen (国际)",
  "alibaba-cn": "通义千问 Qwen (国内)",
  "siliconflow-cn": "硅基流动 (国内)",
  siliconflow: "硅基流动 (国际)",
  anthropic: "Anthropic (via opencode)",
  xai: "xAI (Grok)",
  groq: "Groq",
  ollama: "Ollama (本地)",
};

export function opencodeProviderLabel(id: string): string {
  return PROVIDER_LABELS[id] || id;
}

/**
 * 常用但可能还没登录的供应商:即使 opencode 里没有凭证,也在设置页展示成
 * 「未配置」,让用户直接在 UI 里粘贴 API Key(等效 opencode auth login)。
 * id 必须与 models.dev 的 provider id 精确一致。
 */
export const WELL_KNOWN_PROVIDERS = [
  "deepseek",
  "moonshotai-cn",
  "zhipuai",
  "alibaba-cn",
  "siliconflow-cn",
  "openrouter",
  "xai",
  "groq",
];

/** 在 UI 里保存 API Key:直接写 opencode 的 auth.json(等效 opencode auth login) */
export async function setOpencodeCredential(providerId: string, apiKey: string): Promise<void> {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await fs.readFile(AUTH_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    /* 文件不存在则新建 */
  }
  if (apiKey) {
    data[providerId] = { type: "api", key: apiKey };
  } else {
    delete data[providerId];
  }
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify(data, null, 2), "utf-8");
  invalidateOpencodeCache();
  logger.info(`[opencode] credential ${apiKey ? "saved" : "removed"}: ${providerId}`);
}

/**
 * 运行 opencode 子命令并收集 stdout。
 * 必须用 opencodeBin 解析出的绝对路径二进制:桌面版 sidecar 的进程环境
 * 不一定带 npm 全局目录的 PATH,裸 spawn("opencode") 会 ENOENT,
 * 导致供应商列表静默降级成只剩 Anthropic/OpenAI。
 */
function runOpencode(args: string[], timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawnOpencode(args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!proc) {
      reject(new Error("未找到 opencode 可执行文件"));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`opencode ${args[0]} 超时(${timeoutMs}ms)`));
    }, timeoutMs);
    proc.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")));
    proc.stderr?.on("data", (c: Buffer) => (err += c.toString("utf-8")));
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`opencode ${args.join(" ")} 退出码 ${code}: ${err.slice(0, 200)}`));
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export interface OpencodeProvider {
  /** opencode 供应商 id,如 google / minimax-cn / opencode */
  id: string;
  name: string;
  /** 该供应商下的模型(去掉 provider/ 前缀) */
  models: string[];
  /** auth.json 里有显式凭证(免费池等无凭证也可用) */
  hasCredential: boolean;
}

let cache: { at: number; providers: OpencodeProvider[] } | null = null;
const CACHE_TTL = 60_000;

export function invalidateOpencodeCache(): void {
  cache = null;
}

/** opencode 是否安装(解析失败时由调用方降级) */
export async function listOpencodeProviders(force = false): Promise<OpencodeProvider[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) return cache.providers;

  // 1. 凭证 key(文件不存在 = 无凭证,不算错误)
  let credentialIds = new Set<string>();
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf-8");
    credentialIds = new Set(Object.keys(JSON.parse(raw) as Record<string, unknown>));
  } catch {
    /* no auth.json yet */
  }

  // 2. 可用模型(provider/model 每行一个)。扫描失败(opencode 缺失/超时/断网)
  //    时降级:仍返回有凭证的 + 常用的供应商(空模型列表),UI 可见可配置,
  //    且不写缓存,下次调用自动重试。
  let out: string;
  try {
    out = await runOpencode(["models"]);
  } catch (err) {
    logger.warn(`[opencode] models 扫描失败,降级为凭证/常用列表: ${err instanceof Error ? err.message : err}`);
    const fallback: OpencodeProvider[] = [];
    for (const cid of credentialIds) {
      fallback.push({ id: cid, name: opencodeProviderLabel(cid), models: [], hasCredential: true });
    }
    for (const wid of WELL_KNOWN_PROVIDERS) {
      if (!credentialIds.has(wid)) {
        fallback.push({ id: wid, name: opencodeProviderLabel(wid), models: [], hasCredential: false });
      }
    }
    fallback.sort((a, b) => a.id.localeCompare(b.id));
    return fallback;
  }
  const byProvider = new Map<string, string[]>();
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0) continue;
    const pid = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    if (!/^[a-z0-9][\w.-]*$/i.test(pid) || !model) continue;
    const arr = byProvider.get(pid) ?? [];
    arr.push(model);
    byProvider.set(pid, arr);
  }

  const providers: OpencodeProvider[] = [...byProvider.entries()].map(([id, models]) => ({
    id,
    name: opencodeProviderLabel(id),
    models,
    hasCredential: credentialIds.has(id),
  }));

  // 有凭证但(暂时)没列出模型的供应商也展示,避免"登录了却看不到"
  for (const cid of credentialIds) {
    if (!byProvider.has(cid)) {
      providers.push({ id: cid, name: opencodeProviderLabel(cid), models: [], hasCredential: true });
    }
  }

  // 常用供应商没登录也展示(未配置态),用户可在设置页直接填 Key
  for (const wid of WELL_KNOWN_PROVIDERS) {
    if (!byProvider.has(wid) && !credentialIds.has(wid)) {
      providers.push({ id: wid, name: opencodeProviderLabel(wid), models: [], hasCredential: false });
    }
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  cache = { at: Date.now(), providers };
  logger.info(`[opencode] providers: ${providers.map((p) => `${p.id}(${p.models.length})`).join(", ")}`);
  return providers;
}

export async function opencodeInstalled(): Promise<{ installed: boolean; version?: string }> {
  try {
    const v = (await runOpencode(["--version"], 10_000)).trim();
    return { installed: true, version: v };
  } catch {
    return { installed: false };
  }
}
