import { useEffect, useRef } from "react";
import { ScrollText, Trash2 } from "lucide-react";
import { useAuditStore, type AuditEvent } from "../../stores/auditStore";

/** 事件名 → 展示样式(颜色区分事件族) */
const EVENT_STYLES: Record<string, { label: string; color: string }> = {
  PreToolUse:         { label: "工具开始", color: "text-sky-link" },
  PostToolUse:        { label: "工具完成", color: "text-emerald-ok" },
  PostToolUseFailure: { label: "工具失败", color: "text-rose-err" },
  SubagentStart:      { label: "子Agent启动", color: "text-amber-bright" },
  SubagentStop:       { label: "子Agent结束", color: "text-amber-glow" },
  PreCompact:         { label: "压缩开始", color: "text-violet-info" },
  PostCompact:        { label: "压缩完成", color: "text-violet-info" },
  PermissionDenied:   { label: "权限拒绝", color: "text-rose-err" },
  FileChanged:        { label: "文件变更", color: "text-amber-glow" },
  Stop:               { label: "回合结束", color: "text-slate-400" },
  // workflow/后台任务生命周期(background_task_event)
  task_started:             { label: "任务启动", color: "text-emerald-ok" },
  task_notification:        { label: "任务通知", color: "text-sky-link" },
  background_tasks_changed: { label: "任务列表", color: "text-violet-info" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}`;
}

function EventRow({ e }: { e: AuditEvent }) {
  const style = EVENT_STYLES[e.event] ?? { label: e.event, color: "text-slate-400" };
  return (
    <div className="flex items-start gap-2 px-3 py-1 hover:bg-white/[0.03] transition-colors">
      <span className="text-[10px] font-mono text-slate-600 flex-shrink-0 mt-0.5 w-14">
        {formatTime(e.ts)}
      </span>
      <span className={`text-[10px] font-medium flex-shrink-0 mt-0.5 w-20 ${style.color}`}>
        {style.label}
      </span>
      <span className="text-[11px] text-slate-400 min-w-0 truncate font-mono" title={e.detail}>
        {e.toolName && !e.detail?.startsWith(e.toolName) ? `${e.toolName} · ` : ""}
        {e.detail || "—"}
      </span>
    </div>
  );
}

/**
 * F1.13 审计时间线:按时间展示 SDK hooks 观察到的生命周期事件。
 * 只读观察,不影响执行;上限 500 条滚动。
 */
export default function AuditLog() {
  const events = useAuditStore((s) => s.events);
  const clear = useAuditStore((s) => s.clear);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 新事件到达时自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
        <ScrollText size={20} className="opacity-40" />
        <p className="text-xs">暂无审计事件 — 发起一轮任务后这里会实时记录生命周期</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
        <span
          className="text-[11px] text-slate-400"
          title="审计为实时视图:仅记录本次打开期间的事件,刷新清空,断线重连期间可能有缺口"
        >
          {events.length} 条事件{events.length >= 500 ? "（已滚动截断）" : ""}
          <span className="text-slate-600 ml-1.5">· 实时视图</span>
        </span>
        <button
          onClick={clear}
          title="清空"
          className="p-1 rounded-md text-slate-500 hover:text-rose-err hover:bg-white/5 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {events.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
