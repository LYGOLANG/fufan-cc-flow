import { wsChatUrl } from "./endpoint";
import { useUIStore } from "../stores/uiStore";

type Handler = (event: string, payload: Record<string, unknown>) => void;

/**
 * 单条物理连接:连后端 /ws/chat,带指数退避重连。一个项目一条。
 * 服务端把 project 作为 spawn cwd 在连接建立时固定,故一个项目对应一条独立连接。
 */
class WebSocketConnection {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private closedByUser = false;

  constructor(private readonly projectPath: string) {}

  connect() {
    this.clearTimer();
    const query = this.projectPath ? `?project=${encodeURIComponent(this.projectPath)}` : "";
    const wsUrl = wsChatUrl(query);
    console.debug("[WS] Connecting to", wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.debug("[WS] Connected", this.projectPath);
      this.reconnectDelay = 3000;
      this.notify("_connected", {});
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.notify(msg.event, msg.payload);
      } catch (err) {
        console.error("[WS] Failed to parse message:", err, "raw:", ev.data);
      }
    };
    this.ws.onclose = (ev) => {
      console.debug("[WS] Closed", this.projectPath, ev.code);
      this.notify("_disconnected", {});
      if (this.closedByUser) return; // 关闭项目标签:不再重连
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = (ev) => console.error("[WS] Error:", ev);
  }

  send(action: string, payload: Record<string, unknown> = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, payload }));
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 用户显式关闭该项目:停重连并断连(服务端 ws.on("close") 会收尾其任务)。 */
  close() {
    this.closedByUser = true;
    this.clearTimer();
    this.ws?.close();
    this.ws = null;
  }

  private clearTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notify(event: string, payload: Record<string, unknown>) {
    for (const h of this.handlers) h(event, payload);
  }
}

/** 终态事件:任务在服务端结束,可清除 busy 标记。 */
const TERMINAL_EVENTS = new Set(["task_complete", "process_close", "aborted", "error"]);

/**
 * 多项目连接管理器(对外仍名 wsService,保持 .send()/.subscribe() 原 API 不变)。
 *
 * 关键行为:每个打开的项目各持一条独立连接;切换项目只切"活动连接",
 * 后台项目的连接不断开,其服务端 CLI 任务继续运行——不再因切项目被 abort。
 * 只有"关闭项目标签"才真正 close 该连接(触发服务端收尾)。
 *
 * 事件路由:内部订阅每一条连接,但只有"活动项目"的事件转发给 App 层订阅者
 * (useWebSocket),因此后台项目的流式事件不会串进当前可见的聊天记录;
 * 所有连接的 session_init/终态事件都用于维护 busyProjects(标签"运行中"指示)。
 */
class WebSocketManager {
  private conns = new Map<string, WebSocketConnection>();
  private internalUnsubs = new Map<string, () => void>();
  private appHandlers = new Set<Handler>();
  private activeProject = "";

  private ensure(projectPath: string): WebSocketConnection {
    let conn = this.conns.get(projectPath);
    if (!conn) {
      conn = new WebSocketConnection(projectPath);
      const unsub = conn.subscribe((event, payload) => {
        this.trackBusy(projectPath, event);
        if (projectPath === this.activeProject) this.notify(event, payload);
      });
      this.internalUnsubs.set(projectPath, unsub);
      this.conns.set(projectPath, conn);
      conn.connect();
    }
    return conn;
  }

  /**
   * 切换活动项目:确保其连接存在,并把该连接当前的连接态补发给 App 层
   * (切回一个已连接项目时,让连接指示灯即时正确)。不影响其它项目连接。
   */
  setActiveProject(projectPath: string) {
    this.activeProject = projectPath;
    const conn = this.ensure(projectPath);
    this.notify(conn.connected ? "_connected" : "_disconnected", {});
  }

  /** 发送到"活动项目"连接。 */
  send(action: string, payload: Record<string, unknown> = {}) {
    this.conns.get(this.activeProject)?.send(action, payload);
    if (action === "send_message") this.setBusy(this.activeProject, true);
    else if (action === "abort") this.setBusy(this.activeProject, false);
  }

  subscribe(handler: Handler): () => void {
    this.appHandlers.add(handler);
    return () => this.appHandlers.delete(handler);
  }

  /** 关闭某个项目(关标签):断连,其服务端任务被收尾。 */
  closeProject(projectPath: string) {
    this.internalUnsubs.get(projectPath)?.();
    this.internalUnsubs.delete(projectPath);
    this.conns.get(projectPath)?.close();
    this.conns.delete(projectPath);
    this.setBusy(projectPath, false);
    if (this.activeProject === projectPath) this.activeProject = "";
  }

  get connected() {
    return this.conns.get(this.activeProject)?.connected ?? false;
  }

  private trackBusy(projectPath: string, event: string) {
    if (event === "session_init") this.setBusy(projectPath, true);
    else if (TERMINAL_EVENTS.has(event)) this.setBusy(projectPath, false);
  }

  private setBusy(projectPath: string, busy: boolean) {
    if (!projectPath) return;
    useUIStore.getState().setProjectBusy(projectPath, busy);
  }

  private notify(event: string, payload: Record<string, unknown>) {
    for (const h of this.appHandlers) h(event, payload);
  }
}

export const wsService = new WebSocketManager();
