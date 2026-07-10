import { Minimize2, Loader2, Cpu } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useConfigStore } from "../../stores/configStore";
import { useProviderStore } from "../../stores/providerStore";
import { useUIStore } from "../../stores/uiStore";
import { useSystemStore, type UsageSource, type UsageWindow } from "../../stores/systemStore";
import { formatTokens, formatCost, inferContextMax } from "../../utils/costCalculator";
import { MODEL_LABELS } from "../../types/claude";
import { wsService } from "../../services/websocket";
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
  const { model, providerId, engine } = useConfigStore();
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

  const handleCompact = () => {
    // Build the /compact prompt (same as typing it in InputBar)
    const prompt = compactHint.trim()
      ? `/compact ${compactHint.trim()}`
      : "/compact";

    // Add as a user message in chat (so user sees it)
    useChatStore.getState().addUserMessage(prompt);

    // Send via normal send_message flow (same path as InputBar.handleSend)
    const { model, effort, apiKey, engine, codexModel, codexEffort, providerId } = useConfigStore.getState();
    const { runMode } = useUIStore.getState();
    wsService.send("send_message", {
      prompt,
      model,
      effort,
      runMode,
      engine,
      codexModel,
      codexEffort,
      providerId,
      apiKey: apiKey || undefined,
      sessionId: currentSessionId || undefined,
    });

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
          压缩上下文
        </button>
      )}

      {showCompact && !isStreaming && (
        <div className="mt-2 space-y-2">
          <input
            value={compactHint}
            onChange={(e) => setCompactHint(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCompact(); }}
            placeholder="侧重于...（可选）"
            className="w-full text-xs bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-glow/40"
          />
          <button
            onClick={handleCompact}
            className="w-full text-xs py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors shadow-sm shadow-[#703123]/30"
          >
            立即压缩
          </button>
        </div>
      )}
    </div>
  );
}
