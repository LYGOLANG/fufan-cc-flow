/**
 * 后端地址解析 —— 兼容两种运行形态:
 *
 *  1) Vite 开发服务器(浏览器 或 Tauri dev 加载 http://localhost:5273):
 *     Vite 把 /api、/ws 代理到后端(见 vite.config.ts),所以用**同源相对路径**即可,
 *     天然避开 CORS / 系统代理 / 防火墙问题。判据:import.meta.env.DEV === true。
 *
 *  2) 打包后的静态资源(Tauri 桌面端 / 纯静态托管):
 *     页面从 tauri:// 之类的协议加载,没有 Vite 代理,必须**直连**后端端口。
 *     端口默认 3001;Tauri 侧确定 sidecar 实际端口后,可通过注入
 *     window.__BACKEND_PORT__ 覆盖(为将来端口动态化预留的接缝)。
 */

const DEFAULT_BACKEND_PORT = 3001;

declare global {
  interface Window {
    __BACKEND_PORT__?: number;
  }
}

function backendPort(): number {
  const injected = typeof window !== "undefined" ? window.__BACKEND_PORT__ : undefined;
  return typeof injected === "number" && injected > 0 ? injected : DEFAULT_BACKEND_PORT;
}

/** HTTP API 基址(含 /api 前缀)。dev 用相对路径走 Vite 代理,打包后直连后端。 */
export function httpBase(): string {
  if (import.meta.env.DEV) return "/api";
  return `http://localhost:${backendPort()}/api`;
}

/** WebSocket /ws/chat 完整地址。dev 走同源(Vite 代理 ws),打包后直连后端。 */
export function wsChatUrl(projectQuery: string): string {
  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/chat${projectQuery}`;
  }
  return `ws://localhost:${backendPort()}/ws/chat${projectQuery}`;
}
