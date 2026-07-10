import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import apiRouter from "./routes/index.js";
import { logger } from "./utils/logger.js";

const app: Express = express();

app.use(cors());
app.use(express.json());

// Request logger — shows every HTTP request that reaches Express
app.use((req, _res, next) => {
  logger.info(`[http] ${req.method} ${req.url}`);
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

export default app;
