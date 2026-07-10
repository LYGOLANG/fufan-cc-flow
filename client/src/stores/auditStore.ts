import { create } from "zustand";

/** F1.13 审计时间线:SDK 进程内 hooks 只读观察到的生命周期事件 */
export interface AuditEvent {
  id: number;
  sessionId: string;
  /** hook 事件名(PreToolUse / PostToolUse / SubagentStart / …) */
  event: string;
  toolName?: string;
  /** 一句话摘要(文件路径/命令/agent 类型等) */
  detail?: string;
  ts: number;
}

const MAX_EVENTS = 500;

interface AuditState {
  events: AuditEvent[];
  addEvent: (e: Omit<AuditEvent, "id">) => void;
  clear: () => void;
}

let idCounter = 0;

export const useAuditStore = create<AuditState>((set) => ({
  events: [],
  addEvent: (e) =>
    set((s) => {
      const next = [...s.events, { ...e, id: ++idCounter }];
      // 上限 500 条滚动,防止长会话撑爆内存
      return { events: next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next };
    }),
  clear: () => set({ events: [] }),
}));
