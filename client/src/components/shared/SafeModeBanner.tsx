import { ShieldAlert, X } from "lucide-react";

/**
 * 安全模式提示:界面连续崩溃后,本次启动跳过了会话自动恢复(见
 * utils/crashRecovery.ts)。告诉用户发生了什么、数据都在、如何继续,
 * 而不是让他们对着空白聊天区猜"我的会话呢"。
 */
export default function SafeModeBanner({
  failures,
  onDismiss,
}: {
  failures: number;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[min(560px,90vw)]">
      <div
        className="rounded-xl border border-amber-glow/30 shadow-2xl shadow-black/50 overflow-hidden"
        style={{ background: "rgba(30, 26, 46, 0.97)" }}
      >
        <div className="flex items-start gap-2.5 px-4 py-3">
          <ShieldAlert size={16} className="text-amber-glow flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200 font-medium">
              已进入安全模式启动
            </div>
            <div className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              界面连续 {failures} 次崩溃后自动重启,本次启动跳过了会话自动恢复,
              以避免上次的内容再次触发崩溃。
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              会话数据都在磁盘上,可从「历史」手动打开;若打开某个会话后再次崩溃,
              说明崩因就在该会话内容里,请反馈。
            </div>
          </div>
          <button
            onClick={onDismiss}
            title="知道了"
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
        <button
          onClick={onDismiss}
          className="w-full py-2 text-xs font-medium text-amber-glow hover:bg-amber-glow/10 border-t border-white/5 transition-colors"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
