import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

declare global {
  interface Window {
    __BACKEND_PORT__?: number;
    __TAURI_INTERNALS__?: unknown;
  }
}

async function initDesktopBackendPort() {
  if (import.meta.env.DEV || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number | null>("backend_port");
    if (typeof port === "number" && port > 0) {
      window.__BACKEND_PORT__ = port;
    }
  } catch (err) {
    console.error("[desktop] failed to resolve backend port", err);
  }
}

void initDesktopBackendPort().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
