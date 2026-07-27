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

import { isTauriRuntime } from "../utils/tauri";

const DEFAULT_BACKEND_PORT = 3001;

declare global {
  interface Window {
    __BACKEND_PORT__?: number;
    /** 桌面版的接口访问令牌,由 Tauri 外壳在启动时注入(见 main.tsx) */
    __AUTH_TOKEN__?: string;
  }
}

/**
 * 接口访问令牌。
 *
 * 桌面版由 Tauri 外壳生成随机值、同时注入后端 sidecar 与前端,本机其它进程
 * 拿不到 —— 这是「谁能调这套接口」的边界。dev 模式下不存在该令牌,后端也
 * 不会校验,返回空串即可。
 */
export function authToken(): string {
  return (typeof window !== "undefined" && window.__AUTH_TOKEN__) || "";
}

/** 需要鉴权时附加的请求头;无令牌返回空对象,不影响 dev */
export function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { "x-cc-flow-token": token } : {};
}

/**
 * 给 WebSocket 地址拼上令牌。
 *
 * 浏览器的 WebSocket API 不支持自定义握手头,只能走 query —— 这是该协议的
 * 固有限制,不是偷懒。令牌只在本机回环上传输,不出网。
 */
export function withAuthQuery(url: string): string {
  const token = authToken();
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

function backendPort(): number {
  const injected = typeof window !== "undefined" ? window.__BACKEND_PORT__ : undefined;
  return typeof injected === "number" && injected > 0 ? injected : DEFAULT_BACKEND_PORT;
}

/** HTTP API 基址(含 /api 前缀)。dev 用相对路径走 Vite 代理,打包后直连后端。 */
/** 非 Tauri 的 http(s) 页面(服务器部署形态:后端同端口托管前端静态文件,SSH 隧道访问)。
 *  此时 API/WS 一律同源,隧道本地端口映射到哪都能用;Tauri 桌面端(tauri.localhost)不走这条路。 */
function isWebOrigin(): boolean {
  return (
    typeof window !== "undefined" &&
    /^https?:$/.test(window.location.protocol) &&
    !isTauriRuntime()
  );
}

export function httpBase(): string {
  if (import.meta.env.DEV || isWebOrigin()) return "/api";
  return `http://localhost:${backendPort()}/api`;
}

/** WebSocket /ws/chat 完整地址。dev/服务器形态走同源,桌面端直连 sidecar 端口。 */
export function wsChatUrl(projectQuery: string): string {
  if (import.meta.env.DEV || isWebOrigin()) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return withAuthQuery(`${protocol}//${window.location.host}/ws/chat${projectQuery}`);
  }
  return withAuthQuery(`ws://localhost:${backendPort()}/ws/chat${projectQuery}`);
}

/** WebSocket /ws/terminal 完整地址,选址规则同 wsChatUrl。 */
export function wsTerminalUrl(query: string): string {
  if (import.meta.env.DEV || isWebOrigin()) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return withAuthQuery(`${protocol}//${window.location.host}/ws/terminal?${query}`);
  }
  return withAuthQuery(`ws://localhost:${backendPort()}/ws/terminal?${query}`);
}
