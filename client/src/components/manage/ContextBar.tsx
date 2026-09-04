import { Minimize2, Loader2, Cpu } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useConfigStore } from "../../stores/configStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSystemStore, type UsageSource, type UsageWindow } from "../../stores/systemStore";
import { buildEngineParams } from "../../utils/sendPayload";
import { formatTokens, formatCost, inferContextMax } from "../../utils/costCalculator";
import { MODEL_LABELS } from "../../types/claude";
import { wsService } from "../../services/websocket";
import { beginHandoff } from "../../utils/handoffRunner";
import { useEffect, useState } from "react";

/** "2h 57m" / "57m" until the given ISO reset time. */
function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return "即将重置";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const clampPct = (n: number) => Math.min(Math.max(n, 0), 100);
const barFillHex = (pct: number) => (pct > 90 ? "#fb7185" : pct > 70 ? "#fbbf24" : "#34d399");
// Mask that turns a solid bar into discrete "█" blocks (6px block, 2px gap).
const BLOCK_MASK = "repeating-linear-gradient(90deg, #000 0 6px, transparent 6px 8px)";

/**
 * claude-hud style block bar — looks like █░ segments but is responsive:
 * fills the available width (never overflows / clips the numbers) and shows the
 * exact filled proportion. Empty segments are dim, filled are color-coded.
 */
function HudBar({ pct }: { pct: number }) {
  const p = clampPct(pct);
  return (
    <div className="flex-1 min-w-0 h-2.5 relative">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(148,163,184,0.20)", WebkitMaskImage: BLOCK_MASK, maskImage: BLOCK_MASK }}
      />
      <div
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{ width: `${p}%`, background: barFillHex(p), WebkitMaskImage: BLOCK_MASK, maskImage: BLOCK_MASK }}
      />
    </div>
  );
}

/** One HUD row: label · block bar · percentage · trailing detail. */
function HudRow({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[11px] text-slate-400 font-medium w-10 flex-shrink-0">{label}</span>
      <HudBar pct={pct} />
      <span className="text-[11px] font-mono text-slate-300 flex-shrink-0 w-8 text-right">{Math.round(pct)}%</span>
      {detail && (
        <span className="text-[10px] font-mono text-slate-600 flex-shrink-0 w-[46px] text-right truncate">{detail}</span>
      )}
    </div>
  );
}

function UsageRow({ label, win }: { label: string; win: UsageWindow | null }) {
  if (!win) return null;
  return <HudRow label={label} pct={clampPct(win.utilization)} detail={formatReset(win.resetsAt)} />;
}

export default function ContextBar() {
  const { currentSessionId, contextTokens, isStreaming, totalCost } = useChatStore();
  const { model, providerId, engine, autoHandoffThreshold, setAutoHandoffThreshold } = useConfigStore();
  const providers = useProviderStore((s) => s.providers);
  const currentProvider = providers.find((p) => p.id === providerId);
  const isCodexProvider = engine === "codex" || providerId === "openai" || currentProvider?.kind === "codex";
  const isOfficialAnthropic = !isCodexProvider && (currentProvider
    ? currentProvider.kind === "anthropic-official"
    : providerId === "anthropic");
  const usageSource: UsageSource | null = isCodexProvider
    ? "codex"
    : isOfficialAnthropic
      ? "anthropic"
      : null;
  const { usage, usageAvailable, loadUsage, availableModels } = useSystemStore();
  const [showCompact, setShowCompact] = useState(false);
  const [compactHint, setCompactHint] = useState("");

  // Friendly model label (strip the "Claude " prefix to fit the narrow sidebar).
  const modelLabel = isOfficialAnthropic
    ? (
        availableModels.find((o) => o.id === model)?.label || MODEL_LABELS[model] || model || "—"
      ).replace(/^Claude\s+/, "")
    : model || "—";

  // Subscription usage source follows the selected provider. Anthropic and Codex
  // have separate OAuth usage APIs; compatible endpoints usually don't expose one.
  useEffect(() => {
    if (!usageSource) return;
    loadUsage(usageSource);
    const t = setInterval(() => loadUsage(usageSource), 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageSource]);

  // The context window follows the currently selected model (200K vs 1M),
  // so changing the model in the dropdown updates this bar immediately.
  const effectiveMax = inferContextMax(model);

  // Use contextTokens from real-time task_complete events or history estimation
  const displayTokens = contextTokens;
  const pct = effectiveMax > 0 ? Math.min((displayTokens / effectiveMax) * 100, 100) : 0;

  /**
   * 手动交接到新会话 —— 与达阈值自动触发同一份实现(utils/handoffRunner.ts)。
   * 有它才能不必把上下文真烧到 90% 就验证这条链路。
   */
  const handleHandoff = () => {
    const res = beginHandoff(pct);
    const chat = useChatStore.getState();
    if (res === "no-session") {
      chat.setStatusText("当前还没有会话可交接");
    } else if (res === "busy") {
      chat.setStatusText("交接已在进行中");
    } else if (res === "not-sent") {
      chat.setStatusText("网络未连接，交接未执行");
    }
    if (res !== "started") {
      setTimeout(() => useChatStore.getState().setStatusText(""), 5000);
      return;
    }
    setShowCompact(false);
  };

  const handleCompact = () => {
    // Build the /compact prompt (same as typing it in InputBar)
    const prompt = compactHint.trim()
      ? `/compact ${compactHint.trim()}`
      : "/compact";

    // Add as a user message in chat (so user sees it)
    useChatStore.getState().addUserMessage(prompt);

    // 走专用的 compact 通道，而不是把 "/compact" 当普通消息发。
    //
    // 差别是实质性的：该通道会先尝试把指令推入**现有常驻进程的输入队列**
    // （不重启进程、不打断正在跑的后台 sub-agent），拿不到进程时才回落到
    // 新建一轮。当作普通消息发则必然走后者。
    // 它还带着 Codex 的能力检测——Codex 不支持 /compact，此前当普通消息发
    // 的结果是：模型把 "/compact" 当成一句提问随便答一句，上下文纹丝不动，
    // 而状态栏还显示「正在压缩上下文...」。
    // 必须看返回值:连接不 OPEN 时这一帧会被直接丢弃(compact 不在
    // pendingSends 兜底队列里)。不看就 startStreaming 的话,指令没送出去、
    // 界面却进了流式态,又没有任何事件回来清它 —— 永久停在「正在压缩上下文...」。
    const sent = wsService.send("compact", {
      instructions: compactHint.trim() || undefined,
      sessionId: currentSessionId || undefined,
    });
    if (!sent) {
      useChatStore.getState().setStatusText("网络未连接，压缩指令未送达");
      setTimeout(() => useChatStore.getState().setStatusText(""), 5000);
      return;
    }

    // Instant feedback: start streaming lifecycle immediately
    useChatStore.getState().startStreaming();
    useChatStore.getState().setStatusText("正在压缩上下文...");

    setShowCompact(false);
    setCompactHint("");
  };

  return (
    <div className="px-3 py-3 border-t border-white/5">
      {/* claude-hud style HUD: 模型 + 花费 · 用量 (5h) · 本周 (7d) · 上下文 */}
      <div className="space-y-1.5 mb-2.5">
        {/* Model + session cost */}
        <div className="flex items-center gap-2 min-w-0">
          <Cpu size={11} className="text-violet-info flex-shrink-0" />
          <span className="text-[11px] text-slate-300 font-medium truncate min-w-0 flex-1" title={modelLabel}>
            {modelLabel}
          </span>
          {totalCost > 0 && (
            <span className="text-[11px] font-mono text-emerald-ok flex-shrink-0">{formatCost(totalCost)}</span>
          )}
        </div>

        {usageSource && usageAvailable && usage?.source === usageSource && (
          <>
            <UsageRow label="用量" win={usage.fiveHour} />
            <UsageRow label="本周" win={usage.sevenDay} />
          </>
        )}
        <HudRow
          label="上下文"
          pct={pct}
          detail={`${formatTokens(displayTokens)}/${formatTokens(effectiveMax)}`}
        />
      </div>

      {/* Compact button */}
      {isStreaming ? (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-glow">
          <Loader2 size={11} className="animate-spin" />
          任务进行中...
        </div>
      ) : (
        <button
          onClick={() => setShowCompact(!showCompact)}
          disabled={!currentSessionId}
          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-amber-glow transition-colors disabled:opacity-40 disabled:hover:text-slate-500"
        >
          <Minimize2 size={11} />
          上下文管理
        </button>
      )}

      {showCompact && !isStreaming && (
        <div className="mt-2 space-y-2">
          <input
            value={compactHint}
            onChange={(e) => setCompactHint(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCompact(); }}
            placeholder="压缩时侧重...（可选）"
            className="w-full text-xs bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-glow/40"
          />
          <button
            onClick={handleHandoff}
            disabled={!currentSessionId}
            className="w-full text-xs py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors shadow-sm shadow-[#703123]/30 disabled:opacity-40"
          >
            立即交接到新会话
          </button>
          <button
            onClick={handleCompact}
            className="w-full text-xs py-1.5 rounded-md border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
          >
            压缩当前会话（不新建）
          </button>

          {/* 自动交接阈值 —— 取代原来的自动压缩,理由见 utils/autoHandoff.ts */}
          <div className="pt-1.5 border-t border-white/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-400">用量达到时交接新会话</span>
              <span className="text-[11px] font-mono text-slate-300">
                {autoHandoffThreshold >= 100 ? "关闭" : `${autoHandoffThreshold}%`}
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={autoHandoffThreshold}
              onChange={(e) => setAutoHandoffThreshold(Number(e.target.value))}
              className="w-full accent-amber-glow"
            />
            <p className="text-[10px] text-slate-600 mt-0.5">
              {autoHandoffThreshold >= 100
                ? "拖到 100% 表示不自动交接，上下文满了自己处理"
                : `上下文超过 ${autoHandoffThreshold}% 时，让本会话写一份交接文档，再自动开新会话接着干（不压缩历史）`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
