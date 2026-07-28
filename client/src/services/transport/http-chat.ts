import { httpBase, wsChatUrl, authHeaders } from "../endpoint";
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
  /** 自上次成功连接以来的连续失败次数 */
  private consecutiveFailures = 0;
  /**
   * 连续失败到这个次数就认为「这条连接大概率不会自己好了」。
   * 4 次 ≈ 3+6+12+24 秒,足够穿过一次 sidecar 重启,又不至于让用户
   * 对着"正在重连"干等太久。
   */
  private readonly staleAfterFailures = 4;

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
      this.consecutiveFailures = 0;
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
      if (this.closedByUser) {
        this.notify("_disconnected", { stale: false });
        return;
      }
      this.consecutiveFailures += 1;

      // 重试本身不停 —— 网络恢复、后端重启都可能让它自己好起来。
      // 但连续失败到一定次数后必须**告诉用户**,因为有一类故障重试
      // 一万次也没用:远程模式下 SSH 隧道是桌面壳在启动时建的,
      // 隧道进程一旦死掉(换网、休眠、服务器重启),本机那个端口就再也
      // 没人监听了,只有重启应用才会重新建立。此时界面若一直显示
      // "正在重连",就是在骗人。
      const stale = this.consecutiveFailures >= this.staleAfterFailures;
      this.notify("_disconnected", { stale, attempts: this.consecutiveFailures });

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
          // 原文案是「迁移期 Node 后端还没连接上」——那是开发者视角的话,
          // 用户既不知道什么是迁移期,也不知道 Node 后端是什么。
          message:
            "与后端的连接尚未建立，这条消息没有发出去。请稍等几秒重试；" +
            "若持续如此，检查连接状态提示。",
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
          headers: { "Content-Type": "application/json", ...authHeaders() },
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
