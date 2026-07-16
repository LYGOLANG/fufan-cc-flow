import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { normalizeTransportError } from "./error";
import { shouldUseRustChat } from "./routing";
import type {
  ChatConnection,
  ChatEventEnvelope,
  ChatHandler,
} from "./types";

interface TauriEvent<T> {
  payload: T;
}

export interface TauriChatRuntime {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    event: string,
    handler: (event: TauriEvent<T>) => void
  ): Promise<UnlistenFn>;
}

const DEFAULT_RUNTIME: TauriChatRuntime = {
  invoke: (command, args) => invoke(command, args),
  listen: (event, handler) => listen(event, handler),
};

/** Rust/Tauri chat adapter；不创建 HTTP 或 WebSocket 连接。 */
export class TauriChatConnection implements ChatConnection {
  private handlers = new Set<ChatHandler>();
  private unlisten: UnlistenFn | null = null;
  private connectPromise: Promise<void> | null = null;
  private projectKey: string | null = null;
  private ready = false;
  private closed = false;

  constructor(
    private readonly projectPath: string,
    private readonly runtime: TauriChatRuntime = DEFAULT_RUNTIME
  ) {}

  connect() {
    if (this.connectPromise || this.closed) return;
    this.connectPromise = this.runtime.invoke<string>("resolve_project_path", {
      payload: { projectPath: this.projectPath },
    })
      .then((projectKey) => {
        this.projectKey = projectKey;
        if (this.closed) return null;
        return this.runtime.listen<ChatEventEnvelope>("ws-chat", (event) => {
          const envelope = event.payload;
          if (envelope.payload.projectPath !== this.projectKey) return;
          this.notify(envelope.event, envelope.payload);
        });
      })
      .then((unlisten) => {
        if (unlisten === null) return;
        if (this.closed) {
          unlisten();
          return;
        }
        this.unlisten = unlisten;
        this.ready = true;
        this.notify("_connected", {});
      })
      .catch((error: unknown) => {
        this.connectPromise = null;
        if (!this.closed) this.notifyError("TAURI_CONNECT_FAILED", error);
      });
  }

  send(action: string, payload: Record<string, unknown> = {}) {
    if (this.closed) return false;
    if (action === "send_message" && !shouldUseRustChat(payload)) {
      // InputBar 会在 send() 返回后创建 assistant 流式占位。把错误推迟到当前调用栈
      // 结束，确保错误能写进占位气泡并正常 stopStreaming，而不是留下空白转圈。
      queueMicrotask(() => {
        if (this.closed) return;
        this.notify("error", {
          code: "RUST_CHAT_UNSUPPORTED",
          message: "该请求仍依赖未迁移能力，请关闭 VITE_RUST_CHAT 开发开关后重试。",
        });
      });
      return true;
    }
    if (!this.connectPromise) this.connect();
    void this.connectPromise?.then(() => {
      if (!this.closed && this.ready) return this.invokeAction(action, payload);
    });
    return true;
  }

  subscribe(handler: ChatHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get connected() {
    return this.ready;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.unlisten?.();
    this.unlisten = null;
    void this.runtime
      .invoke("shutdown_project", { payload: this.identityPayload() })
      .catch((error: unknown) => {
        const structured = normalizeTransportError(error, "TAURI_SHUTDOWN_FAILED");
        console.error(
          `[TauriChat] ${structured.code}: ${structured.message}`
        );
      });
  }

  private async invokeAction(
    action: string,
    payload: Record<string, unknown>
  ) {
    try {
      if (action === "send_message") {
        await this.runtime.invoke("send_message", {
          payload: { ...payload, projectPath: this.projectPath },
        });
      } else if (action === "abort") {
        await this.runtime.invoke("abort", { payload: this.identityPayload() });
      } else if (action === "permission_response") {
        await this.runtime.invoke("permission_response", {
          payload: { ...payload, ...this.identityPayload() },
        });
      } else if (action === "shutdown") {
        await this.runtime.invoke("shutdown_project", {
          payload: this.identityPayload(),
        });
      } else {
        throw new Error(`Rust chat transport 暂不支持 action: ${action}`);
      }
    } catch (error) {
      this.notifyError("TAURI_INVOKE_FAILED", error);
    }
  }

  private notifyError(code: string, error: unknown) {
    const structured = normalizeTransportError(error, code);
    this.notify("error", {
      code: structured.code,
      message: structured.message,
      ...(structured.details === undefined ? {} : { details: structured.details }),
    });
  }

  private identityPayload() {
    return {
      projectPath: this.projectPath,
      ...(this.projectKey === null ? {} : { projectKey: this.projectKey }),
    };
  }

  private notify(event: string, payload: Record<string, unknown>) {
    for (const handler of this.handlers) handler(event, payload);
  }
}
