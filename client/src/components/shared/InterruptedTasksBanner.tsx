import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { api } from "../../services/api";

interface InterruptedTask {
  projectPath: string;
  engine: string;
  sessionId: string | null;
  promptSnippet: string;
  startedAt: number;
  interruptedAt: number;
}

/** 项目路径截取尾部文件夹名做展示 */
function projectName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/**
 * 启动提醒:上次关闭程序(或崩溃)时被中止的任务。
 * 数据来自后端任务登记表(~/.fufan-cc-flow/running-tasks.json 的 interrupted 区),
 * 用户点「知道了」即清除,不再打扰。
 */
export default function InterruptedTasksBanner() {
  const [tasks, setTasks] = useState<InterruptedTask[]>([]);

  useEffect(() => {
    api.systemApi
      .getInterruptedTasks()
      .then((data) => setTasks(data.tasks ?? []))
      .catch(() => {});
  }, []);

  if (tasks.length === 0) return null;

  const dismiss = () => {
    setTasks([]);
    void api.systemApi.clearInterruptedTasks().catch(() => {});
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[min(560px,90vw)]">
      <div
        className="rounded-xl border border-amber-glow/30 shadow-2xl shadow-black/50 overflow-hidden"
        style={{ background: "rgba(30, 26, 46, 0.97)" }}
      >
        <div className="flex items-start gap-2.5 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-glow flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200 font-medium">
              上次退出时有 {tasks.length} 个任务被中止
            </div>
            <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto">
              {tasks.map((t, i) => (
                <div key={i} className="text-xs text-slate-400 truncate">
                  <span className="text-slate-300">{projectName(t.projectPath)}</span>
                  <span className="text-slate-600"> · {t.engine} · {formatTime(t.interruptedAt)} · </span>
                  {t.promptSnippet || "(无 prompt 记录)"}
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              对话历史已保存,打开对应项目的会话即可继续。
            </div>
          </div>
          <button
            onClick={dismiss}
            title="知道了"
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
        <button
          onClick={dismiss}
          className="w-full py-2 text-xs font-medium text-amber-glow hover:bg-amber-glow/10 border-t border-white/5 transition-colors"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
