import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauriRuntime } from "./utils/tauri";

declare global {
  interface Window {
    __BACKEND_PORT__?: number;
    __AUTH_TOKEN__?: string;
  }
}

/**
 * 桌面版启动前从 Tauri 外壳取回后端端口与接口访问令牌。
 *
 * 必须在 createRoot 之前完成:令牌一旦晚于首批请求到位,那些请求就会被后端
 * 401 挡掉(表现为「刚打开应用时一片空白/加载失败」)。所以这里是 await 完
 * 才渲染,而不是丢进 effect 里。
 *
 * 令牌只存在内存,不写 localStorage —— 存了反而多一条被其它进程读取的途径,
 * 而它本来每次启动就会换新的。
 */
async function initDesktopRuntime() {
  if (import.meta.env.DEV || !isTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [port, token] = await Promise.all([
      invoke<number | null>("backend_port"),
      invoke<string | null>("backend_auth_token"),
    ]);
    if (typeof port === "number" && port > 0) {
      window.__BACKEND_PORT__ = port;
    }
    if (typeof token === "string" && token) {
      window.__AUTH_TOKEN__ = token;
    }
  } catch (err) {
    console.error("[desktop] failed to resolve backend port/token", err);
  }
}

void initDesktopRuntime().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
