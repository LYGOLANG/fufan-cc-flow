import { useState, useRef, useEffect } from "react";
import { ChevronDown, Brain, Gauge, Sparkles, Plug, CheckCircle2, Settings } from "lucide-react";
import { useConfigStore, type CodexEffort } from "../../stores/configStore";
import { useSystemStore } from "../../stores/systemStore";
import { useProviderStore } from "../../stores/providerStore";
import { useUIStore } from "../../stores/uiStore";
import { MODEL_LABELS, type EffortChoice, type ModelOption } from "../../types/claude";

const EFFORT_OPTIONS: { value: EffortChoice; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "max", label: "最大" },
  { value: "ultracode", label: "Ultra" },
];

const CODEX_EFFORT_OPTIONS: { value: CodexEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];

// Fallback options derived from the static alias labels.
const FALLBACK_OPTIONS: ModelOption[] = Object.entries(MODEL_LABELS).map(
  ([id, label]) => ({ id, label })
);

export default function ModelSelector({ direction = "down" }: { direction?: "up" | "down" }) {
  const {
    model, effort, thinking, providerId,
    setModel, setEffort, setThinking, setProvider,
    codexEffort, setCodexEffort, setCodexModel,
  } = useConfigStore();
  const { availableModels, loadModels } = useSystemStore();
  const { providers, loadProviders } = useProviderStore();
  const setSettingsPageOpen = useUIStore((s) => s.setSettingsPageOpen);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load live model list + provider list once on mount.
  useEffect(() => {
    if (availableModels.length === 0) loadModels();
    if (providers.length === 0) loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentProvider = providers.find((p) => p.id === providerId);
  const isCodexProvider = currentProvider?.kind === "codex";
  const isOfficialAnthropic = !currentProvider || currentProvider.kind === "anthropic-official";
  // 扩展思考/推理力度是 Claude 引擎(官方/兼容端点)特性,codex/opencode 不适用
  const isClaudeEngine =
    !currentProvider ||
    currentProvider.kind === "anthropic-official" ||
    currentProvider.kind === "anthropic-compat";

  // 模型来源:官方 Anthropic 用 /system/models 的 live 列表(离线退回别名),
  // 第三方/Codex 用供应商配置里的模型列表。
  const options: ModelOption[] = isOfficialAnthropic
    ? (availableModels.length > 0 ? availableModels : FALLBACK_OPTIONS)
    : (currentProvider?.models ?? []).map((id) => ({ id, label: id }));

  const currentLabel =
    options.find((o) => o.id === model)?.label || MODEL_LABELS[model] || model;
  // 推理力度对所有 Claude 引擎模型开放(CLI 对不支持的档位会静默降级),
  // 不再限制只有 Opus 可见。
  const showEffort = isClaudeEngine;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectProvider = (id: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    setProvider(id, { kind: p.kind, defaultModel: p.defaultModel || p.models[0], models: p.models });
  };

  // 自愈:当前模型不在供应商合法列表里(如旧版本残留的坏 id),自动回退默认模型。
  // 官方 Anthropic 例外——它的 model 可能是别名(opus/sonnet),不在 live 列表也是合法的。
  useEffect(() => {
    if (!currentProvider || isOfficialAnthropic || currentProvider.models.length === 0) return;
    if (!currentProvider.models.includes(model)) {
      const fallback = currentProvider.defaultModel || currentProvider.models[0];
      setModel(fallback);
      if (currentProvider.kind === "codex") setCodexModel(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProvider?.id, currentProvider?.models.length, model]);

  const handleSelectModel = (id: string) => {
    setModel(id);
    // Codex 供应商同时同步旧 codexModel 字段,兼容仍读它的逻辑
    if (isCodexProvider) setCodexModel(id);
  };

  const providerUnconfigured = !!currentProvider && !currentProvider.configured;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-700/30 hover:bg-obsidian-700/60 text-xs transition-colors"
      >
        <Brain size={13} className="text-violet-info" />
        <span className="text-obsidian-100 font-medium max-w-[220px] truncate">
          {currentProvider ? `${currentProvider.name} · ${currentLabel}` : currentLabel}
        </span>
        <ChevronDown
          size={12}
          className={`text-obsidian-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className={`absolute right-0 w-80 rounded-xl bg-obsidian-800 border border-obsidian-600/50 shadow-2xl shadow-black/40 overflow-hidden z-50 ${
          direction === "up" ? "bottom-full mb-2" : "top-full mt-2"
        }`}>
          {/* Ambient glow */}
          <div className="absolute -top-12 -right-12 w-24 h-24 bg-violet-info/5 rounded-full blur-2xl" />

          {/* ── 供应商 ── */}
          <div className="p-3 border-b border-obsidian-700/50">
            <div className="text-[11px] uppercase tracking-wider text-obsidian-300 font-medium mb-2 flex items-center gap-1.5">
              <Plug size={11} />
              供应商
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProvider(p.id)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    providerId === p.id
                      ? "bg-amber-glow/10 text-amber-glow border border-amber-glow/20"
                      : "text-obsidian-100 hover:bg-obsidian-700/60"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.configured ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-ok flex-shrink-0">
                      <CheckCircle2 size={10} />
                      {p.authManagedByCli ? "CLI" : "已配置"}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 flex-shrink-0">未配置</span>
                  )}
                </button>
              ))}
              {providers.length === 0 && (
                <div className="text-xs text-slate-500 px-3 py-2">供应商列表加载中…</div>
              )}
            </div>
            {providerUnconfigured && (
              <button
                onClick={() => {
                  setOpen(false);
                  setSettingsPageOpen(true);
                }}
                className="mt-2 w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-amber-glow bg-amber-glow/5 border border-amber-glow/20 hover:bg-amber-glow/10 transition-colors"
              >
                <Settings size={11} />
                {currentProvider?.name} 未配置 API Key,点击去设置
              </button>
            )}
          </div>

          {/* ── 模型 ── */}
          <div className="p-3 border-b border-obsidian-700/50">
            <div className="text-[11px] uppercase tracking-wider text-obsidian-300 font-medium mb-2">
              模型
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelectModel(opt.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    model === opt.id
                      ? "bg-amber-glow/10 text-amber-glow border border-amber-glow/20"
                      : "text-obsidian-100 hover:bg-obsidian-700/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {options.length === 0 && (
                <div className="text-xs text-slate-500 px-3 py-2">
                  暂无模型 — 到设置里配置 Key 后可一键拉取模型列表
                </div>
              )}
            </div>
          </div>

          {/* Effort (Anthropic Opus) */}
          {showEffort && (
            <div className="p-3 border-b border-obsidian-700/50">
              <div className="text-[11px] uppercase tracking-wider text-obsidian-300 font-medium mb-2 flex items-center gap-1.5">
                <Gauge size={11} />
                推理力度
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {EFFORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setEffort(opt.value)}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      effort === opt.value
                        ? "bg-amber-glow/15 text-amber-glow border border-amber-glow/25"
                        : "bg-obsidian-700/40 text-obsidian-200 hover:bg-obsidian-700/70"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Effort (Codex) */}
          {isCodexProvider && (
            <div className="p-3 border-b border-obsidian-700/50">
              <div className="text-[11px] uppercase tracking-wider text-obsidian-300 font-medium mb-2 flex items-center gap-1.5">
                <Gauge size={11} />
                推理力度
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {CODEX_EFFORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCodexEffort(opt.value)}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      codexEffort === opt.value
                        ? "bg-amber-glow/15 text-amber-glow border border-amber-glow/25"
                        : "bg-obsidian-700/40 text-obsidian-200 hover:bg-obsidian-700/70"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Extended Thinking(仅 Claude 引擎系供应商) */}
          {isClaudeEngine && (
            <div className="p-3">
              <button
                onClick={() => setThinking(!thinking)}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm hover:bg-obsidian-700/40 transition-colors"
              >
                <span className="flex items-center gap-2 text-obsidian-100">
                  <Sparkles size={14} className="text-amber-bright" />
                  扩展思考
                </span>
                <div
                  className={`w-8 h-4.5 rounded-full transition-colors relative ${
                    thinking ? "bg-amber-glow" : "bg-obsidian-500"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                      thinking ? "translate-x-[14px]" : "translate-x-0.5"
                    }`}
                  />
                </div>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
