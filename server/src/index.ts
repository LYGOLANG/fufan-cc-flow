import http from "http";
import app from "./app.js";
import { setupWebSocket } from "./websocket/index.js";
import { logger } from "./utils/logger.js";

const PORT = Number(process.env.PORT) || 3001;

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

server.listen(PORT, "0.0.0.0", () => {
  logger.info(`Agent Flow server running on http://0.0.0.0:${PORT}`);
  logger.info("WebSocket endpoints: /ws/chat");
});
