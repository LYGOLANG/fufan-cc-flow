const LEVEL_COLORS: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

const LEVEL_ORDER: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * 最低输出级别。
 *
 * 桌面版的 sidecar 由 Rust 外壳拉起，它的 stdout 被整个转发进应用日志
 * (`%LOCALAPPDATA%\com.fufan.ccflow\logs`)。而 debug 此前没有任何过滤，
 * 每条 SDK 消息都写一行 —— 实测约 5KB/分钟，长时间开着能涨到几十上百 MB，
 * 且每行都是一次同步文件写。
 *
 * 判据用专用环境变量而不是 NODE_ENV：`pnpm dev` 并不设置 NODE_ENV，
 * 拿它判断会让开发时也失去 debug。Rust 起 sidecar 时显式传 info；
 * 直接跑（开发、测试、手动起服务）默认保留 debug。
 *
 * 排障时想在桌面版拿到完整日志：设 CC_FLOW_LOG_LEVEL=debug 再启动。
 */
const MIN_LEVEL = LEVEL_ORDER[(process.env.CC_FLOW_LOG_LEVEL || "debug").toLowerCase()] ?? 10;

function log(level: string, msg: string, data?: unknown) {
  if ((LEVEL_ORDER[level] ?? 10) < MIN_LEVEL) return;
  const color = LEVEL_COLORS[level] || "";
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `${color}[${ts}] ${level.toUpperCase().padEnd(5)}${RESET}`;
  if (data !== undefined) {
    console.log(prefix, msg, data);
  } else {
    console.log(prefix, msg);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log("debug", msg, data),
  info: (msg: string, data?: unknown) => log("info", msg, data),
  warn: (msg: string, data?: unknown) => log("warn", msg, data),
  error: (msg: string, data?: unknown) => log("error", msg, data),
};
