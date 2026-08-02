import http from "http";
import app from "./app.js";
import { setupWebSocket } from "./websocket/index.js";
import { shutdownAllSessions } from "./websocket/chatHandler.js";
import { ptyService } from "./services/ptyService.js";
import { initTaskRegistry } from "./services/taskRegistry.js";
import { logger } from "./utils/logger.js";
import { isAuthEnabled } from "./middleware/auth.js";

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
  // 终端也要收。ptyService.closeAll 一直写着却零调用方 —— 退出后所有 PTY
  // 及其中运行的 dev server、构建进程全部成为孤儿，占着端口直到用户手动去杀。
  // 单独 try：PTY 收尾失败不该拖累已经完成的 chat 收尾。
  try {
    ptyService.closeAll();
  } catch (err) {
    logger.error(`[${signal}] pty shutdown error: ${String(err)}`);
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

// 默认只监听回环地址(REQUIREMENTS §3.3「后端仅监听 localhost,不对外暴露」)。
// 此前默认 0.0.0.0——本应用无任何鉴权中间件,等于把「读写任意文件、跑 Claude CLI、
// 开 PTY 终端」的全部能力暴露给同局域网所有主机。
// SSH 隧道部署形态不受影响:隧道终点本就落在服务器的 127.0.0.1。
// 确需对外监听(如容器内跑、前置反代)的部署,显式设 HOST=0.0.0.0 覆盖,
// 但必须自行在前面加鉴权/防火墙。
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () => {
  logger.info(`Agent Flow server running on http://${HOST}:${PORT}`);
  logger.info("WebSocket endpoints: /ws/chat");
  // 显式打印鉴权状态:漏注入 CC_FLOW_AUTH_TOKEN 会静默退回「本机任何进程都能调」,
  // 这条日志是发现该配置漂移的唯一线索。
  logger.info(
    isAuthEnabled()
      ? "[auth] 接口鉴权已启用(仅持有令牌的调用方可访问)"
      : "[auth] 接口鉴权未启用 —— 本机任意进程均可调用 API(开发模式预期如此)"
  );
});
