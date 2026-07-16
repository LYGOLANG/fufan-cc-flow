import { useState, type ReactNode } from "react";
import {
  ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, Loader2,
  Pencil, RefreshCw, Trash2, Zap,
} from "lucide-react";
import { useProviderStore } from "../../stores/providerStore";
import type { ProviderInfo } from "../../types/provider";
import ProviderStatusBadge, { type ProviderStatusView } from "./provider-status-badge";

const parseModels = (raw: string) => raw.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean);

export default function ProviderCard({
  provider,
  extra,
  status,
}: {
  provider: ProviderInfo;
  extra?: ReactNode;
  status?: ProviderStatusView;
}) {
  const { updateProvider, testProvider, refreshModels, deleteProvider } = useProviderStore();
  const [expanded, setExpanded] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingModels, setEditingModels] = useState(false);
  const [modelsDraft, setModelsDraft] = useState("");
  const [savingModels, setSavingModels] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 5000);
  };

  async function handleSaveKey() {
    const nextKey = keyDraft.trim();
    if (provider.configured && !nextKey && !window.confirm(`确定清除 ${provider.name} 的 API Key？`)) return;
    setSaving(true);
    try {
      await updateProvider(provider.id, { apiKey: nextKey });
      setKeyDraft("");
      flash(true, nextKey ? "API Key 已保存" : "API Key 已清除");
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await testProvider(provider.id);
      flash(result.ok, result.message);
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function handleRefreshModels() {
    setRefreshing(true);
    try {
      const models = await refreshModels(provider.id);
      flash(true, `已更新模型列表（${models.length} 个）`);
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "拉取模型失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveModels() {
    const models = parseModels(modelsDraft);
    if (models.length === 0) {
      flash(false, "模型列表不能为空");
      return;
    }
    setSavingModels(true);
    try {
      await updateProvider(provider.id, { models });
      setEditingModels(false);
      flash(true, `已保存模型列表（${models.length} 个）`);
    } catch (error) {
      flash(false, error instanceof Error ? error.message : "保存模型失败");
    } finally {
      setSavingModels(false);
    }
  }

  async function handleDelete() {
    const recovery = provider.builtin ? "之后可通过“恢复内置供应商”找回。" : "该操作无法撤销。";
    if (!window.confirm(`确定删除 ${provider.name}？${recovery}`)) return;
    await deleteProvider(provider.id);
  }

  return (
    <div className={`rounded-xl border transition-colors ${
      expanded ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.03]"
    }`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left">
        {expanded
          ? <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
          : <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200">{provider.name}</span>
            <ProviderStatusBadge provider={provider} status={status} />
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
            {provider.kind === "codex" ? "OpenAI Codex CLI 引擎" : provider.baseUrl || "api.anthropic.com（官方）"}
            {provider.apiKeyHint ? ` · ${provider.apiKeyHint}` : ""}
          </div>
        </div>
        <span className="text-[10px] text-slate-600 flex-shrink-0">{provider.models.length} 个模型</span>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-white/5 pt-3">
          {extra}
          {!extra && !provider.authManagedByCli && (
            <div>
              <div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <KeyRound size={11} />API Key
                {provider.configured && <span className="text-slate-600">（已配置{provider.apiKeyHint ? ` ${provider.apiKeyHint}` : ""}，输入新值可覆盖）</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={keyDraft}
                    onChange={(event) => setKeyDraft(event.target.value)}
                    placeholder={provider.configured ? "输入新 Key 覆盖；留空保存将清除" : "sk-..."}
                    className="w-full px-3 py-2 pr-9 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
                  />
                  <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300">
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <button
                  onClick={handleSaveKey}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-white bg-[#ca5d3d] disabled:opacity-50"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : "保存"}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {!extra && (
              <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50">
                {testing ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}测试连通性
              </button>
            )}
            <button onClick={handleRefreshModels} disabled={refreshing} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-50">
              {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}刷新模型列表
            </button>
            {provider.kind === "anthropic-compat" && (
              <button onClick={handleDelete} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-rose-err/20 text-rose-err hover:bg-rose-err/10 ml-auto">
                <Trash2 size={11} />删除
              </button>
            )}
          </div>

          {notice && <div className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${notice.ok ? "text-emerald-ok border-emerald-ok/20 bg-emerald-ok/5" : "text-rose-err border-rose-err/20 bg-rose-err/5"}`}>{notice.text}</div>}

          {provider.kind === "anthropic-compat" && editingModels ? (
            <div className="space-y-1.5">
              <input
                value={modelsDraft}
                onChange={(event) => setModelsDraft(event.target.value)}
                placeholder="模型 ID，逗号分隔"
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600"
              />
              <div className="flex items-center gap-2">
                <button onClick={handleSaveModels} disabled={savingModels} className="px-3 py-1.5 rounded-lg text-xs text-white bg-[#ca5d3d] disabled:opacity-50">
                  {savingModels ? <Loader2 size={13} className="animate-spin" /> : "保存模型"}
                </button>
                <button onClick={() => setEditingModels(false)} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400">取消</button>
              </div>
            </div>
          ) : (
            (provider.models.length > 0 || provider.kind === "anthropic-compat") && (
              <div className="flex flex-wrap gap-1.5 items-center">
                {provider.models.map((model) => <span key={model} className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-white/5 bg-white/[0.03] text-slate-400">{model}</span>)}
                {provider.models.length === 0 && <span className="text-[10px] text-slate-600">暂无模型，请手动填写</span>}
                {provider.kind === "anthropic-compat" && (
                  <button
                    onClick={() => { setModelsDraft(provider.models.join(", ")); setEditingModels(true); }}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 text-slate-500 hover:text-slate-300"
                  >
                    <Pencil size={9} />编辑
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
