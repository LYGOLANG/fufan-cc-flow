import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import apiRouter from "./routes/index.js";
import { logger } from "./utils/logger.js";
import { statusOf, messageOf } from "./utils/httpError.js";

const app: Express = express();

// 只放行本地来源:桌面壳(tauri://localhost / http://tauri.localhost)、
// Vite dev(localhost:5273)、同端口托管(无 Origin 的同源请求)。
// 此前是裸 cors() 放行任意 Origin——任何网页都能让访客浏览器打本机 API。
// 注意这是纵深防御的一层:CORS 拦的是浏览器发起的跨站请求,拦不住 curl,
// 真正的边界是上面的 127.0.0.1 绑定。
const LOCAL_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;
app.use(
  cors({
    origin(origin, callback) {
      // 无 Origin:同源导航、curl、桌面壳内的部分请求 —— 放行
      if (!origin) return callback(null, true);
      if (LOCAL_ORIGIN.test(origin)) return callback(null, true);
      logger.warn(`[cors] blocked cross-origin request from ${origin}`);
      callback(null, false);
    },
  })
);
app.use(express.json());

// Request logger — 只记录路径,丢弃 query string。
// query 里可能带敏感值:/system/proxy-save?https=http://user:pass@host 会把
// 代理凭据明文写进日志文件(每次保存设置一条)。路径本身足够排障。
app.use((req, _res, next) => {
  const pathOnly = req.url.split("?")[0];
  const hasQuery = req.url.includes("?");
  logger.info(`[http] ${req.method} ${pathOnly}${hasQuery ? "?…" : ""}`);
  next();
});

app.use("/api", apiRouter);

// 服务器部署形态:同端口托管前端静态产物(SSH 隧道单端口访问)。
// 目录不存在时(本地 dev 走 Vite、桌面端走 Tauri 资源)完全不生效。
const clientDist = process.env.CLIENT_DIST || path.resolve(process.cwd(), "client-dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback:非 /api 的 GET 一律回 index.html(Express 5 不支持 "*" 路由,用中间件兜底)
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
  logger.info(`[static] serving client from ${clientDist}`);
}

/**
 * 统一错误出口。
 *
 * 路径守卫(assertSafeName / assertWithinRoot)和入参校验抛的错误都带
 * statusCode,这里把它们翻成 400/403 —— 否则 Express 5 兜住 async rejection
 * 后一律回 500,前端只能显示「服务器错误」,而实际上是「名称不合法」这类
 * 用户可以自己纠正的问题。
 *
 * 5xx 只回通用文案:内部错误的 message 可能含服务器路径,细节留在日志里。
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = statusOf(err);
  if (status >= 500) {
    logger.error(`[${req.method} ${req.path}]`, err instanceof Error ? err.stack : String(err));
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: { code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", message: messageOf(err) },
  });
});

export default app;
