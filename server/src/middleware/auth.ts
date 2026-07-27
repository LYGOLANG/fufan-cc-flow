import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";
import { logger } from "../utils/logger.js";

/**
 * 本机接口鉴权。
 *
 * 后端只绑 127.0.0.1,但本机上的**任何**进程都能往这个端口发请求 —— 而这套
 * 接口能读写文件、执行 CLI、开终端、读取存着 API Key 的配置。路径校验只能
 * 限制「能干成什么」,挡不住「谁能调」。这一层解决后者。
 *
 * 启用条件:环境变量 CC_FLOW_AUTH_TOKEN 非空。
 *   - 桌面版:Tauri 外壳启动 sidecar 时生成随机 token 并注入,前端通过
 *     Tauri command 取到同一个值 —— 其它进程拿不到,也就调不动接口。
 *   - `pnpm dev`:不设这个变量,鉴权整体关闭,开发流程不受影响。
 *
 * 这样设计的取舍:漏配环境变量会静默退回「无鉴权」。所以桌面侧由 Rust 负责
 * 必定注入,并在启动日志里明确打印当前处于哪种模式,便于发现配置漂移。
 */

const HEADER = "x-cc-flow-token";
/** WebSocket 无法自定义握手头,只能走 query。 */
const QUERY_KEY = "token";

function configuredToken(): string {
  return process.env.CC_FLOW_AUTH_TOKEN?.trim() ?? "";
}

export function isAuthEnabled(): boolean {
  return configuredToken().length > 0;
}

/** 定长比较,避免按字符提前返回泄漏 token 前缀 */
function tokenMatches(provided: string): boolean {
  const expected = configuredToken();
  if (!expected) return true;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual 要求等长,长度不同直接判否(长度本身不算敏感信息)
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 从请求里取 token:优先自定义头,其次 Bearer,最后 query(WS 用) */
function extractToken(req: IncomingMessage & { query?: unknown }): string {
  const headers = req.headers ?? {};
  const direct = headers[HEADER];
  if (typeof direct === "string" && direct) return direct;

  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  // Express 的 req.query 已解析;WS 升级请求走原始 url
  const q = (req as { query?: Record<string, unknown> }).query;
  if (q && typeof q[QUERY_KEY] === "string") return q[QUERY_KEY] as string;

  if (req.url) {
    const value = new URL(req.url, "http://127.0.0.1").searchParams.get(QUERY_KEY);
    if (value) return value;
  }
  return "";
}

/**
 * REST 鉴权中间件。
 *
 * 健康检查豁免:Tauri 外壳用它探测后端是否就绪,那时前端还没拿到 token。
 * 它只回一个时间戳,不含任何敏感信息。
 */
const EXEMPT_PATHS = new Set(["/health"]);

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();
  if (tokenMatches(extractToken(req))) return next();

  logger.warn(`[auth] 拒绝未授权请求 ${req.method} ${req.path}`);
  res.status(401).json({
    error: { code: "UNAUTHORIZED", message: "缺少或无效的访问令牌" },
  });
}

/** WebSocket 升级请求的鉴权判定(ws 库没有中间件机制,在 connection 回调里调用) */
export function isAuthorizedUpgrade(req: IncomingMessage): boolean {
  if (!isAuthEnabled()) return true;
  return tokenMatches(extractToken(req));
}
