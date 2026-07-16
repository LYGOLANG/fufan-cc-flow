import { useEffect, useState, type ReactNode } from "react";
import { Plug, Plus, RefreshCw } from "lucide-react";
import { useProviderStore } from "../../stores/providerStore";
import type { ProviderInfo } from "../../types/provider";
import ProviderCard from "./provider-card";
import type { ProviderStatusView } from "./provider-status-badge";

export type { ProviderStatusView } from "./provider-status-badge";

const parseModels = (raw: string) => raw.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean);

export default function ProvidersPanel({
  renderProviderExtra,
  resolveProviderStatus,
}: {
  renderProviderExtra?: (provider: ProviderInfo) => ReactNode;
  resolveProviderStatus?: (provider: ProviderInfo) => ProviderStatusView | undefined;
}) {
  const { providers, hiddenBuiltins, loadProviders, restoreDefaults, createProvider, loadError } = useProviderStore();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", baseUrl: "", apiKey: "", models: "" });
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  async function handleAdd() {
    setAdding(true);
    setAddError("");
    try {
      const models = parseModels(draft.models);
      await createProvider({
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey || undefined,
        models: models.length > 0 ? models : undefined,
      });
      setDraft({ name: "", baseUrl: "", apiKey: "", models: "" });
      setShowAdd(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-2">
      {loadError && <div className="text-[11px] text-rose-err px-2.5 py-1.5 rounded-lg border border-rose-err/20 bg-rose-err/5">{loadError}</div>}
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          extra={renderProviderExtra?.(provider)}
          status={resolveProviderStatus?.(provider)}
        />
      ))}

      {showAdd ? (
        <div className="rounded-xl border border-purple-bright/20 bg-purple-glow/[0.04] p-3.5 space-y-2">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
            <Plug size={11} />自定义供应商（需提供 Anthropic 兼容端点）
          </div>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="名称，如 OpenRouter"
            className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600"
          />
          <input
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="Base URL，如 https://example.com/anthropic"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600"
          />
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            placeholder="API Key（可稍后填写）"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600"
          />
          <input
            value={draft.models}
            onChange={(event) => setDraft({ ...draft, models: event.target.value })}
            placeholder="模型 ID，逗号分隔（可稍后填写或拉取）"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600"
          />
          <p className="text-[10px] text-slate-600">未实现模型列表接口的端点需要手动填写模型 ID。</p>
          {addError && <div className="text-[11px] text-rose-err">{addError}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !draft.name.trim() || !draft.baseUrl.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#ca5d3d] disabled:opacity-50"
            >
              {adding ? "添加中…" : "添加"}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400">取消</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-white/10 text-xs text-slate-500 hover:text-slate-300 hover:border-white/20">
          <Plus size={13} />添加自定义供应商
        </button>
      )}

      {hiddenBuiltins.length > 0 && (
        <button onClick={restoreDefaults} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] text-slate-500 hover:text-slate-300">
          <RefreshCw size={11} />恢复内置供应商（{hiddenBuiltins.length} 个已删除）
        </button>
      )}
    </div>
  );
}
