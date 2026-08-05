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
  const modelUrl = useUIStore((s) => s.companionModelUrl);
  const setModelUrl = useUIStore((s) => s.setCompanionModelUrl);

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

      {enabled && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-2.5">
          <label className="block text-xs text-slate-400">
            Live2D 模型地址
            <span className="text-slate-500 ml-1">（留空则用内置的简笔角色）</span>
          </label>
          <input
            type="text"
            value={modelUrl}
            onChange={(e) => setModelUrl(e.target.value.trim())}
            placeholder="http://localhost:xxxx/model/xxx.model3.json"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40 transition-colors font-mono"
          />
          <p className="text-[10px] text-slate-500 leading-relaxed">
            默认用随包的 haru 模型。填了才会加载 Live2D 运行时
            （PixiJS + Cubism，约 840KB），清空则退回内置的简笔角色、一个字节都不下载。
          </p>
          <button
            onClick={() => setModelUrl("/live2d/haru/haru_greeter_t03.model3.json")}
            className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            恢复默认模型
          </button>
          <div className="rounded-lg border border-amber-glow/20 bg-amber-glow/5 px-3 py-2">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Live2D 授权：个人及年营收 1000 万日元以下免费。自用没问题；
              将来若要公开分发含 Live2D 的版本，需要向 Live2D 另行申请。
              随包的 haru 是官方示例模型，同样适用这条。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
