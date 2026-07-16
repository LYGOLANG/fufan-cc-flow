import { useUIStore } from "../stores/uiStore";
import { createChatConnection } from "./transport/chat";
import type { ChatConnection, ChatHandler } from "./transport/types";

/**
 * 后台项目积压缓冲的硬上限(条)。连续的流式增量已在入缓冲时合并成一条,故正常一轮
 * 远达不到此值;超限时丢弃最旧的条目只保留最近尾部,防止极端情况下内存无界增长。
 */
const MAX_BUFFER = 2000;

/** 终态事件:任务在服务端结束,可清除 busy 标记。 */
const TERMINAL_EVENTS = new Set(["task_complete", "process_close", "aborted", "error"]);

/**
 * 多项目连接管理器(对外仍名 wsService,保持 .send()/.subscribe() 原 API 不变)。
 *
 * 关键行为:每个打开的项目各持一条独立连接;切换项目只切"活动连接",
 * 后台项目的连接不断开,其服务端 CLI 任务继续运行——不再因切项目被 abort。
 * 只有"关闭项目标签"才真正 close 该连接(触发服务端收尾)。
 *
 * 事件路由:内部订阅每一条连接,但只有"活动项目"的事件实时转发给 App 层订阅者
 * (useWebSocket),因此后台项目的流式事件不会串进当前可见的聊天记录;
 * 后台项目的业务事件缓存在 buffers 里,切回该项目时按序重放,内容无缝续上。
 * 所有连接的 session_init/终态事件都用于维护 busyProjects(标签"运行中"指示)。
 */
class WebSocketManager {
  private conns = new Map<string, ChatConnection>();
  private internalUnsubs = new Map<string, () => void>();
  private appHandlers = new Set<ChatHandler>();
  private activeProject = "";
  /**
   * 后台项目(以及活动项目在 attach 前)积压的业务事件,切回时按序重放。
   * 一个后台任务从切走到切回的全部流式增量都在这里,重放后视图与"从未切走"一致;
   * 任务终态(TERMINAL_EVENTS)后不再有新事件,故缓冲不会无限增长。
   */
  private buffers = new Map<string, [string, Record<string, unknown>][]>();
  /** App 层 handler 是否已就绪:attach() 后才实时转发,期间事件进 buffer 不丢失 */
  private live = false;

  private ensure(projectPath: string): ChatConnection {
    let conn = this.conns.get(projectPath);
    if (!conn) {
      conn = createChatConnection(projectPath);
      const unsub = conn.subscribe((event, payload) => {
        this.trackBusy(projectPath, event);
        if (projectPath === this.activeProject && this.live) {
          this.notify(event, payload);
        } else if (!event.startsWith("_")) {
          // 连接状态事件不缓存——切回时 setActiveProject 会补发当前状态
          let buf = this.buffers.get(projectPath);
          if (!buf) { buf = []; this.buffers.set(projectPath, buf); }
          const last = buf[buf.length - 1];
          // 合并连续的同类流式增量:一轮里成千上万个 token 增量压成一条,避免缓冲无界增长、
          // 切回时逐条同步重放卡死 UI。合并后累加值与逐条追加等价(handler 里都是 += )。
          const mergeKey =
            event === "assistant_text" ? "text" :
            event === "assistant_thinking" ? "thinking" : null;
          if (mergeKey && last && last[0] === event) {
            last[1] = {
              ...last[1],
              [mergeKey]: ((last[1][mergeKey] as string) || "") + ((payload[mergeKey] as string) || ""),
            };
          } else {
            buf.push([event, payload]);
            if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
          }
        }
      });
      this.internalUnsubs.set(projectPath, unsub);
      this.conns.set(projectPath, conn);
      conn.connect();
    }
    return conn;
  }

  /**
   * 页面加载时为所有打开的项目标签预建连接。
   * 服务端在 WS 断开后会把引擎寄存 30s 等重连(页面刷新场景);这里让所有
   * 后台项目也在刷新后第一时间重连认领,它们的常驻进程/后台任务才能存活,
   * 而不是等用户切到该标签时才连(可能已超宽限期)。
   */
  warmup(projectPaths: string[]) {
    for (const p of projectPaths) {
      if (p) this.ensure(p);
    }
  }

  /**
   * 切换活动项目:确保其连接存在,并把该连接当前的连接态补发给 App 层
   * (切回一个已连接项目时,让连接指示灯即时正确)。不影响其它项目连接。
   * 切到新项目后进入"缓冲模式",等 useWebSocket 重新订阅后调 attach() 恢复实时转发,
   * 避免切换瞬间的事件打进旧 handler 或丢失。
   */
  setActiveProject(projectPath: string) {
    if (projectPath !== this.activeProject) this.live = false;
    this.activeProject = projectPath;
    // 切到该项目后其待确认权限会随缓冲重放显示出来,清掉"需确认"角标
    this.setAwaiting(projectPath, false);
    const conn = this.ensure(projectPath);
    this.notify(conn.connected ? "_connected" : "_disconnected", {});
  }

  /**
   * App 层 handler 就绪后调用:先按序重放当前项目积压的事件(含它在后台运行期间的
   * 全部流式增量),再恢复实时转发。与 openProject 恢复的聊天快照配合,实现
   * "切走再切回,任务照常在跑、内容无缝续上"。
   */
  attach() {
    const buf = this.buffers.get(this.activeProject);
    this.buffers.delete(this.activeProject);
    this.live = true;
    if (buf) for (const [event, payload] of buf) this.notify(event, payload);
  }

  /** 发送到"活动项目"连接。 */
  send(action: string, payload: Record<string, unknown> = {}) {
    const accepted = this.conns.get(this.activeProject)?.send(action, payload) ?? false;
    if (action === "send_message" && accepted) this.setBusy(this.activeProject, true);
    else if (action === "abort") this.setBusy(this.activeProject, false);
  }

  subscribe(handler: ChatHandler): () => void {
    this.appHandlers.add(handler);
    return () => this.appHandlers.delete(handler);
  }

  /** 关闭某个项目(关标签):断连,其服务端任务被收尾。 */
  closeProject(projectPath: string) {
    this.internalUnsubs.get(projectPath)?.();
    this.internalUnsubs.delete(projectPath);
    this.conns.get(projectPath)?.close();
    this.conns.delete(projectPath);
    this.buffers.delete(projectPath);
    this.setBusy(projectPath, false);
    this.setAwaiting(projectPath, false);
    if (this.activeProject === projectPath) this.activeProject = "";
  }

  get connected() {
    return this.conns.get(this.activeProject)?.connected ?? false;
  }

  private trackBusy(projectPath: string, event: string) {
    if (event === "session_init") this.setBusy(projectPath, true);
    else if (TERMINAL_EVENTS.has(event)) {
      this.setBusy(projectPath, false);
      this.setAwaiting(projectPath, false); // 任务终结,清掉可能残留的"需确认"角标
    }
    // 后台项目冒出待确认权限:打角标提醒用户切回处理,否则 60s 后被服务端自动拒绝。
    // (活动项目会直接弹权限卡,不需要角标。)
    if (event === "permission_request" && projectPath !== this.activeProject) {
      this.setAwaiting(projectPath, true);
    } else if (event === "permission_timeout") {
      this.setAwaiting(projectPath, false);
    }
  }

  private setBusy(projectPath: string, busy: boolean) {
    if (!projectPath) return;
    useUIStore.getState().setProjectBusy(projectPath, busy);
  }

  private setAwaiting(projectPath: string, awaiting: boolean) {
    if (!projectPath) return;
    useUIStore.getState().setProjectAwaitingPermission(projectPath, awaiting);
  }

  private notify(event: string, payload: Record<string, unknown>) {
    for (const h of this.appHandlers) h(event, payload);
  }
}

export const wsService = new WebSocketManager();
