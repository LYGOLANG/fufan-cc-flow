import http from "http";
import app from "./app.js";
import { setupWebSocket } from "./websocket/index.js";
import { shutdownAllSessions } from "./websocket/chatHandler.js";
import { initTaskRegistry } from "./services/taskRegistry.js";
import { logger } from "./utils/logger.js";

const PORT = Number(process.env.PORT) || 3001;

// 启动即恢复任务登记表:上次退出时残留的 running 记录归入 interrupted,供前端提醒
initTaskRegistry();

// 优雅关闭:收到终止信号先中止所有运行中任务并同步落盘登记,再退出。
// (Tauri 桌面壳退出走 POST /api/system/shutdown-all,同一收尾函数。)
let shuttingDown = false;
function gracefulExit(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[${signal}] graceful shutdown...`);
  try {
    shutdownAllSessions();
  } catch (err) {
    logger.error(`[${signal}] shutdown error: ${String(err)}`);
  }
  // 给引擎中断/taskkill 一点点时间起效,再退出进程
  setTimeout(() => process.exit(0), 300).unref();
}
process.on("SIGINT", () => gracefulExit("SIGINT"));
process.on("SIGTERM", () => gracefulExit("SIGTERM"));

// 兜底防线:任何漏网的异常/未处理 rejection 只记日志,不允许放倒整个后端
// (后端一死,前端所有探测接口失败,会误显示"未安装 Claude Code")。
process.on("uncaughtException", (err) => {
  logger.error(`[uncaughtException] ${err.stack || err.message}`);
});
process.on("unhandledRejection", (reason) => {
  logger.error(`[unhandledRejection] ${reason instanceof Error ? reason.stack : String(reason)}`);
});

const server = http.createServer(app);
setupWebSocket(server);

// Handle startup errors gracefully — prevents unhandled 'error' event crash
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${PORT} is already in use.`);
    logger.error(`To free it on Windows: netstat -ano | findstr :${PORT}  then: taskkill /F /PID <pid>`);
    logger.error(`Or restart with: pnpm dev  (dev script auto-kills the port)`);
    process.exit(1);
  } else {
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  }
});

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  logger.info(`Agent Flow server running on http://${HOST}:${PORT}`);
  logger.info("WebSocket endpoints: /ws/chat");
});
