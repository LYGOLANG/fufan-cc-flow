import { Wallet } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

/** 常用上限档位;0 表示不限制 */
const PRESETS = [
  { label: "不限制", value: 0 },
  { label: "$1", value: 1 },
  { label: "$5", value: 5 },
  { label: "$20", value: 20 },
];

/**
 * 单次任务费用上限。
 *
 * 后端一直支持这个能力(SDK 的 maxBudgetUsd),但此前前端从没有入口,
 * 传给后端的永远是 undefined —— 也就是说文档里承诺的费用保护从未生效。
 * 这里补上入口,让它真正可用。
 */
export default function BudgetPanel() {
  const maxBudget = useConfigStore((s) => s.maxBudget);
  const setMaxBudget = useConfigStore((s) => s.setMaxBudget);

  return (
    <section className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Wallet size={14} className="text-amber-glow" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          任务费用上限
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        单次任务累计花费达到该金额时自动停止，防止一个跑飞的任务烧掉大量额度。
        按 API 计费估算，订阅制额度不受此限制。设为 0 表示不限制。
      </p>

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400 font-mono">$</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={maxBudget || ""}
          onChange={(e) => setMaxBudget(Number(e.target.value) || 0)}
          placeholder="0（不限制）"
          className="w-32 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-glow/40 transition-colors font-mono"
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setMaxBudget(p.value)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] border transition-colors ${
                maxBudget === p.value
                  ? "border-amber-glow/40 bg-amber-glow/10 text-amber-glow"
                  : "border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-2.5">
        {maxBudget > 0
          ? `当前:单次任务最多花费 $${maxBudget}，超出后任务会被中止`
          : "当前:不限制单次任务花费"}
      </p>
    </section>
  );
}
