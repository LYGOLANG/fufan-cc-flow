import { homedir } from "os";
import { join, resolve, isAbsolute } from "path";
import { promises as fs } from "fs";
import { logger } from "../utils/logger.js";

// ── Types matching Claude Code CLI format ──

export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
  async?: boolean;
}

export interface HttpHook {
  type: "http";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  timeout?: number;
  async?: boolean;
}

export interface PromptHook {
  type: "prompt";
  prompt: string;
  model?: string;
  timeout?: number;
  async?: boolean;
}

export interface AgentHook {
  type: "agent";
  prompt: string;
  model?: string;
  allowToolUse?: boolean;
  timeout?: number;
  async?: boolean;
}

export type HookHandler = CommandHook | HttpHook | PromptHook | AgentHook;

/**
 * A rule groups a matcher with one or more hook handlers.
 * CLI format: { "matcher": "Edit|Write", "hooks": [ { type, command, ... } ] }
 */
export interface HookRule {
  matcher: string;
  hooks: HookHandler[];
}

/**
 * Full hooks config: event name → array of rules.
 * This matches the Claude Code CLI settings.json format exactly.
 */
export type HooksConfig = Record<string, HookRule[]>;

type HooksScope = "user" | "project" | "project-local";

/** user scope 的目标文件——project scope 绝不允许解析到这里 */
function userSettingsPath(): string {
  return resolve(join(homedir(), ".claude", "settings.json"));
}

export function getSettingsPath(scope: HooksScope, projectPath?: string): string {
  if (scope === "user") return userSettingsPath();

  // project / project-local:projectPath 来自请求,必须当作不可信输入处理。
  //
  // 这里曾是本仓库最危险的一条路径:该参数零校验直接拼进 join(),传
  // `?scope=project&project=<用户主目录>` 就能把 hooks 写进**全局**
  // ~/.claude/settings.json —— 而 hook 的 command 字段就是一条 shell 命令,
  // 下次任何 Claude Code 会话启动即执行。等于用一个「项目级」接口完成了
  // 用户级提权 + 持久化任意命令执行。
  const base = projectPath?.trim() ? projectPath : process.cwd();
  if (!isAbsolute(base)) {
    throw Object.assign(new Error("project 必须是绝对路径"), { statusCode: 400 });
  }
  const file = resolve(
    join(base, ".claude", scope === "project-local" ? "settings.local.json" : "settings.json")
  );
  // 挡住 scope 提权:无论怎么构造 projectPath,project scope 都不得落到
  // user scope 的文件上(典型构造就是把 projectPath 指成主目录)。
  if (file === userSettingsPath()) {
    throw Object.assign(
      new Error("project scope 不能写入用户全局设置,请改用 scope=user"),
      { statusCode: 403 }
    );
  }
  return file;
}

/** 已知的 hook 事件名——写入前按白名单过滤,避免把畸形结构灌进 settings.json */
const KNOWN_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "Setup",
]);

const KNOWN_HANDLER_TYPES = new Set(["command", "http", "prompt", "agent"]);

/**
 * 校验并规整外部传入的 hooks 配置。
 *
 * settings.json 是 Claude Code 自己也要读的文件,写坏了会让 CLI 起不来;
 * 而这个接口的入参此前完全不校验(`req.body.hooks || {}` 原样落盘)。
 * 这里只做结构校验:事件名必须已知、规则形状必须正确、handler 类型必须已知。
 * 不校验 command 的内容——配 shell 命令本就是 hooks 的正当用途。
 */
export function sanitizeHooksConfig(input: unknown): HooksConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("hooks 必须是对象"), { statusCode: 400 });
  }
  const out: HooksConfig = {};
  for (const [event, rules] of Object.entries(input as Record<string, unknown>)) {
    if (!KNOWN_HOOK_EVENTS.has(event)) {
      throw Object.assign(new Error(`未知的 hook 事件:${event}`), { statusCode: 400 });
    }
    if (!Array.isArray(rules)) {
      throw Object.assign(new Error(`${event} 的值必须是数组`), { statusCode: 400 });
    }
    const cleanRules: HookRule[] = [];
    for (const rule of rules) {
      if (!rule || typeof rule !== "object") {
        throw Object.assign(new Error(`${event} 含非法规则`), { statusCode: 400 });
      }
      const r = rule as { matcher?: unknown; hooks?: unknown };
      if (r.matcher !== undefined && typeof r.matcher !== "string") {
        throw Object.assign(new Error(`${event} 的 matcher 必须是字符串`), { statusCode: 400 });
      }
      if (!Array.isArray(r.hooks)) {
        throw Object.assign(new Error(`${event} 的 hooks 必须是数组`), { statusCode: 400 });
      }
      for (const h of r.hooks) {
        const type = (h as { type?: unknown } | null)?.type;
        if (typeof type !== "string" || !KNOWN_HANDLER_TYPES.has(type)) {
          throw Object.assign(new Error(`${event} 含未知的 handler 类型`), { statusCode: 400 });
        }
      }
      cleanRules.push(rule as HookRule);
    }
    out[event] = cleanRules;
  }
  return out;
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Read hooks from settings file for the given scope.
 */
export async function listHooks(
  scope: HooksScope = "user",
  projectPath?: string,
): Promise<HooksConfig> {
  const settingsPath = getSettingsPath(scope, projectPath);
  const settings = await readSettings(settingsPath);
  return (settings.hooks as HooksConfig) || {};
}

/**
 * Write hooks to settings file for the given scope.
 * Preserves all other settings keys.
 */
export async function saveHooks(
  hooks: HooksConfig,
  scope: HooksScope = "user",
  projectPath?: string,
): Promise<void> {
  const settingsPath = getSettingsPath(scope, projectPath);
  const settings = await readSettings(settingsPath);

  // Clean empty rules
  const cleaned: HooksConfig = {};
  for (const [event, rules] of Object.entries(hooks)) {
    const validRules = rules.filter((r) => r.hooks && r.hooks.length > 0);
    if (validRules.length > 0) cleaned[event] = validRules;
  }

  if (Object.keys(cleaned).length > 0) {
    settings.hooks = cleaned;
  } else {
    delete settings.hooks;
  }

  const dir = join(settingsPath, "..");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  logger.info(`[hooksService] hooks updated (${scope}): ${Object.keys(cleaned).join(", ") || "(cleared)"}`);
}
