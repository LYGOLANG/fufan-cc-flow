import { httpBase, wsChatUrl } from "../endpoint";
import type { ChatConnection, ChatHandler } from "./types";

interface PendingSend {
  action: string;
  payload: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

/** 迁移期浏览器/Node adapter。桌面功能逐项迁到 Rust 后删除。 */
export class HttpChatConnection implements ChatConnection {
  private ws: WebSocket | null = null;
  private handlers = new Set<ChatHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
  private readonly maxReconnectDelay = 30000;
  private readonly sendTimeoutMs = 15000;
  private pendingSends: PendingSend[] = [];
  private closedByUser = false;

  constructor(private readonly projectPath: string) {}

  connect() {
    this.clearTimer();
    const query = this.projectPath
      ? `?project=${encodeURIComponent(this.projectPath)}`
      : "";
    const wsUrl = wsChatUrl(query);
    console.debug("[WS] Connecting to", wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectDelay = 3000;
      this.notify("_connected", {});
      this.flushPendingSends();
    };
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          event: string;
          payload: Record<string, unknown>;
        };
        this.notify(message.event, message.payload);
      } catch (error) {
        console.error("[WS] Failed to parse message:", error, "raw:", event.data);
      }
    };
    this.ws.onclose = () => {
      this.notify("_disconnected", {});
      if (this.closedByUser) return;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = (event) => console.error("[WS] Error:", event);
  }

  send(action: string, payload: Record<string, unknown> = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, payload }));
      return true;
    }
    if (action !== "send_message") return false;

    const pending: PendingSend = {
      action,
      payload,
      timer: setTimeout(() => {
        this.pendingSends = this.pendingSends.filter((item) => item !== pending);
        this.notify("error", {
          code: "BACKEND_NOT_CONNECTED",
          message:
            "迁移期 Node 后端还没连接上，这条消息没有发出去。请稍等几秒重试。",
        });
      }, this.sendTimeoutMs),
    };
    this.pendingSends.push(pending);
    return true;
  }

  subscribe(handler: ChatHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close() {
    this.closedByUser = true;
    this.clearTimer();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send("shutdown", {});
    } else {
      try {
        fetch(`${httpBase()}/system/shutdown-project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath: this.projectPath }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // 页面已卸载时不再重试。
      }
    }
    this.ws?.close();
    this.ws = null;
    this.clearPendingSends();
  }

  private clearTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private flushPendingSends() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const item of this.pendingSends.splice(0)) {
      clearTimeout(item.timer);
      this.ws.send(JSON.stringify({ action: item.action, payload: item.payload }));
    }
  }

  private clearPendingSends() {
    for (const item of this.pendingSends) clearTimeout(item.timer);
    this.pendingSends = [];
  }

  private notify(event: string, payload: Record<string, unknown>) {
    for (const handler of this.handlers) handler(event, payload);
  }
}
