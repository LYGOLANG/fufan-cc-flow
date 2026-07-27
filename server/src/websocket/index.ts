import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "http";
import { handleChatConnection } from "./chatHandler.js";
import { handleTerminalConnection } from "./terminalHandler.js";
import { logger } from "../utils/logger.js";
import { isAuthorizedUpgrade } from "../middleware/auth.js";
import url from "url";

// Track liveness per socket without mutating the WebSocket object
const aliveMap = new WeakMap<WebSocket, boolean>();

const PING_INTERVAL = 30_000; // 30 s — keeps idle connections alive

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    /**
     * 在 HTTP 升级阶段就拒绝未授权连接,而不是等握手完成后再 close。
     *
     * 差别是实质性的:后者会先返回 101 完成握手,客户端拿到一个短暂可用的
     * 连接;前者直接回 401,连接从未建立。WebSocket 这条通道承载对话流和
     * 终端 I/O(可执行任意命令),不该给出任何握手成功的窗口。
     *
     * verifyClient 在 ws 的类型里被标注为 deprecated,但它是这个库当前唯一
     * 能在升级前否决的钩子(替代方案是自己接管 server 的 upgrade 事件,
     * 那样要手写握手响应,代价更大且更易出错)。
     */
    verifyClient: (info, done) => {
      if (isAuthorizedUpgrade(info.req)) return done(true);
      logger.warn(`[auth] 拒绝未授权的 WS 升级请求: ${info.req.url}`);
      done(false, 401, "Unauthorized");
    },
  });

  // ── Heartbeat: ping every 30 s, terminate if no pong received ──
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (aliveMap.get(ws) === false) {
        ws.terminate();
        return;
      }
      aliveMap.set(ws, false);
      ws.ping();
    });
  }, PING_INTERVAL);

  wss.on("close", () => clearInterval(heartbeatTimer));

  // Prevent unhandled 'error' event from crashing the process when the HTTP
  // server fails to bind (e.g. EADDRINUSE). The real error is handled in index.ts.
  wss.on("error", (err) => {
    logger.error(`WebSocket server error: ${err.message}`);
  });

  wss.on("connection", (ws: WebSocket, req) => {
    // 双保险:正常情况下 verifyClient 已在升级阶段挡住未授权连接,能走到这里
    // 说明配置出了问题(例如 verifyClient 被误删),此时立刻断开而不是继续服务。
    if (!isAuthorizedUpgrade(req)) {
      logger.error(`[auth] verifyClient 未生效,连接已建立后才拦下: ${req.url}`);
      ws.close(4401, "Unauthorized");
      return;
    }

    // Mark as alive; pong handler refreshes it
    aliveMap.set(ws, true);
    ws.on("pong", () => aliveMap.set(ws, true));

    const parsed = url.parse(req.url || "", true);
    const pathname = parsed.pathname || "";
    const query = parsed.query;

    logger.info(`WS connection: ${pathname}`);

    if (pathname === "/ws/chat") {
      const project = (query.project as string) || "";
      handleChatConnection(ws, project);
    } else if (pathname === "/ws/terminal") {
      const id = (query.id as string) || `term_${Date.now()}`;
      const cwd = (query.cwd as string) || process.cwd();
      handleTerminalConnection(ws, id, cwd);
    } else {
      ws.close(4004, "Unknown endpoint");
    }
  });

  logger.info("WebSocket server ready");
  return wss;
}
