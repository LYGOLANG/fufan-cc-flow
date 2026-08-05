import { Sparkles } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";

/**
 * 伴随角色开关。
 *
 * 默认关闭：这是纯娱乐特性，不该由它替用户决定界面上多个东西。
 * 关掉后不产生任何 DOM，也不起眨眼定时器 —— 不用的人不为它付出任何代价。
 */
export default function CompanionPanel() {
  const enabled = useUIStore((s) => s.companionEnabled);
  const setEnabled = useUIStore((s) => s.setCompanionEnabled);

  return (
    <section
      className="rounded-2xl border border-white/10 p-5"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-purple-glow" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          伴随角色
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        在界面右下角显示一个会对任务状态做反应的小角色：思考中、等待你确认权限、
        刚完成。点它可以隐藏。
      </p>
      <p className="text-[11px] text-amber-glow/80 mb-3 leading-relaxed">
        它只在你看着屏幕时有用。任务跑完的提醒不靠它——那走系统通知，
        切到别的窗口也能收到。
      </p>

      <button
        onClick={() => setEnabled(!enabled)}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          enabled
            ? "bg-[#ca5d3d] hover:bg-amber-glow text-white"
            : "border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
        }`}
      >
        {enabled ? "已开启 · 点击关闭" : "开启"}
      </button>
    </section>
  );
}
