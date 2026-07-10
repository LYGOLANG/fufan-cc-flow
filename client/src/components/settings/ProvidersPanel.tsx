/**
 * ProvidersPanel — 模型供应商管理(OpenCode 式)
 *
 * 每个供应商一张卡片:名称 + 认证状态徽标(已配置/未配置/CLI 管理),
 * 展开后可填 API Key、测试连通性、刷新可用模型列表;
 * 支持添加自定义 Anthropic 兼容端点。
 */
import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, CheckCircle2, KeyRound,
  Eye, EyeOff, Loader2, Pencil, Plug, Plus, RefreshCw, Trash2, Zap,
} from "lucide-react";
import { useProviderStore } from "../../stores/providerStore";
import type { ProviderInfo } from "../../types/provider";

/** 解析用户输入的模型列表:支持中英文逗号、空格、换行分隔 */
const parseModels = (raw: string): string[] =>
  raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

function StatusBadge({ p }: { p: ProviderInfo }) {
  if (p.authManagedByCli) {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-sky-link/20 bg-sky-link/5 text-sky-link flex-shrink-0">
        <CheckCircle2 size={10} />
        CLI 管理
      </span>
    );
  }
  return p.configured ? (
    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok flex-shrink-0">
      <CheckCircle2 size={10} />
      已配置
    </span>
  ) : (
    <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-500 flex-shrink-0">
      未配置
    </span>
  );
}

function ProviderCard({
  p,
  extra,
}: {
  p: ProviderInfo;
  /** 该供应商专属的完整配置面板(Anthropic 授权 / Codex 安装登录),替代通用 Key 输入 */
  extra?: React.ReactNode;
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

  const handleSaveKey = async () => {
    setSaving(true);
    try {
      await updateProvider(p.id, { apiKey: keyDraft.trim() });
      setKeyDraft("");
      flash(true, keyDraft.trim() ? "API Key 已保存" : "API Key 已清除");
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testProvider(p.id);
      flash(r.ok, r.message);
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  const handleRefreshModels = async () => {
    setRefreshing(true);
    try {
      const models = await refreshModels(p.id);
      flash(true, `已更新模型列表(${models.length} 个)`);
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "拉取模型失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveModels = async () => {
    const models = parseModels(modelsDraft);
    if (models.length === 0) {
      flash(false, "模型列表不能为空");
      return;
    }
    setSavingModels(true);
    try {
      await updateProvider(p.id, { models });
      setEditingModels(false);
      flash(true, `已保存模型列表(${models.length} 个)`);
    } catch (err) {
      flash(false, err instanceof Error ? err.message : "保存模型失败");
    } finally {
      setSavingModels(false);
    }
  };

  return (
    <div className={`rounded-xl border transition-colors ${
      expanded ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.03]"
    }`}>
      {/* 卡片头:名称 + 状态,点击展开 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200">{p.name}</span>
            <StatusBadge p={p} />
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
            {p.kind === "codex"
              ? "OpenAI Codex CLI 引擎"
              : p.baseUrl || "api.anthropic.com(官方)"}
            {p.apiKeyHint ? ` · ${p.apiKeyHint}` : ""}
          </div>
        </div>
        <span className="text-[10px] text-slate-600 flex-shrink-0">
          {p.models.length} 个模型
        </span>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-white/5 pt-3">
          {/* 专属配置面板(Anthropic 授权 / Codex 安装登录) */}
          {extra}

          {/* API Key(直连兼容端点的供应商) */}
          {!extra && !p.authManagedByCli && (
            <div>
              <div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <KeyRound size={11} />
                API Key {p.configured && <span className="text-slate-600">(已配置{p.apiKeyHint ? ` ${p.apiKeyHint}` : ""},输入新值可覆盖)</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={p.configured ? "输入新 Key 覆盖,留空保存 = 清除" : "sk-..."}
                    className="w-full px-3 py-2 pr-9 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                  >
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <button
                  onClick={handleSaveKey}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: "#ca5d3d" }}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : "保存"}
                </button>
              </div>
            </div>
          )}

          {/* 操作行:有专属面板时只保留「刷新模型列表」(面板自带测试) */}
          <div className="flex items-center gap-2">
            {!extra && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {testing ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                测试连通性
              </button>
            )}
            <button
              onClick={handleRefreshModels}
              disabled={refreshing}
              title={
                p.kind === "codex"
                  ? "API Key 登录时从 OpenAI 拉取;ChatGPT 订阅模式使用内置档位"
                  : "从供应商端点拉取可用模型"
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              刷新模型列表
            </button>
            {p.kind === "anthropic-compat" && (
              <button
                onClick={() => deleteProvider(p.id)}
                title={p.builtin ? "删除后可在下方「恢复内置供应商」找回" : "删除自定义供应商"}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-rose-err/20 text-rose-err hover:bg-rose-err/10 transition-colors ml-auto"
              >
                <Trash2 size={11} />
                删除
              </button>
            )}
          </div>

          {/* 结果提示 */}
          {notice && (
            <div className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
              notice.ok
                ? "text-emerald-ok border-emerald-ok/20 bg-emerald-ok/5"
                : "text-rose-err border-rose-err/20 bg-rose-err/5"
            }`}>
              {notice.text}
            </div>
          )}

          {/* 模型列表(compat 供应商可手动编辑,兼容 DeepSeek 等未实现 /v1/models 的端点) */}
          {p.kind === "anthropic-compat" && editingModels ? (
            <div className="space-y-1.5">
              <input
                value={modelsDraft}
                onChange={(e) => setModelsDraft(e.target.value)}
                placeholder="模型 ID,逗号分隔,如 deepseek-chat, deepseek-reasoner"
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveModels}
                  disabled={savingModels}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                  style={{ background: "#ca5d3d" }}
                >
                  {savingModels ? <Loader2 size={13} className="animate-spin" /> : "保存模型"}
                </button>
                <button
                  onClick={() => setEditingModels(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400 hover:bg-white/5"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            (p.models.length > 0 || p.kind === "anthropic-compat") && (
              <div className="flex flex-wrap gap-1.5 items-center">
                {p.models.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-white/5 bg-white/[0.03] text-slate-400"
                  >
                    {m}
                  </span>
                ))}
                {p.models.length === 0 && (
                  <span className="text-[10px] text-slate-600">暂无模型,请手动填写</span>
                )}
                {p.kind === "anthropic-compat" && (
                  <button
                    onClick={() => {
                      setModelsDraft(p.models.join(", "));
                      setEditingModels(true);
                    }}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                  >
                    <Pencil size={9} />
                    编辑
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

export default function ProvidersPanel({
  renderProviderExtra,
}: {
  /** 为特定供应商注入专属配置面板(如 Anthropic 授权 / Codex 安装登录) */
  renderProviderExtra?: (p: ProviderInfo) => React.ReactNode;
}) {
  const { providers, hiddenBuiltins, loadProviders, restoreDefaults, createProvider, loadError } = useProviderStore();
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", baseUrl: "", apiKey: "", models: "" });
  const [addErr, setAddErr] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    setAdding(true);
    setAddErr("");
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
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      {loadError && (
        <div className="text-[11px] text-rose-err px-2.5 py-1.5 rounded-lg border border-rose-err/20 bg-rose-err/5">
          {loadError}
        </div>
      )}

      {providers.map((p) => (
        <ProviderCard key={p.id} p={p} extra={renderProviderExtra?.(p)} />
      ))}

      {/* 添加自定义供应商 */}
      {showAdd ? (
        <div className="rounded-xl border border-purple-bright/20 bg-purple-glow/[0.04] p-3.5 space-y-2">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
            <Plug size={11} />
            自定义供应商(需提供 Anthropic 兼容端点)
          </div>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="名称,如 OpenRouter"
            className="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
          />
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="Base URL,如 https://xxx.com/anthropic"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
          />
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="API Key(可稍后填)"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
          />
          <input
            value={draft.models}
            onChange={(e) => setDraft({ ...draft, models: e.target.value })}
            placeholder="模型 ID,逗号分隔,如 deepseek-chat, deepseek-reasoner(可稍后从端点拉取)"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40"
          />
          <div className="text-[10px] text-slate-600">
            部分端点(如 DeepSeek)未实现模型列表接口,无法自动拉取,需在此手动填写模型 ID
          </div>
          {addErr && <div className="text-[11px] text-rose-err">{addErr}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
              style={{ background: "#ca5d3d" }}
            >
              {adding ? "添加中…" : "添加"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400 hover:bg-white/5"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-white/10 text-xs text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors"
        >
          <Plus size={13} />
          添加自定义供应商
        </button>
      )}

      {/* 被删除的内置供应商可一键找回 */}
      {hiddenBuiltins.length > 0 && (
        <button
          onClick={() => restoreDefaults()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RefreshCw size={11} />
          恢复内置供应商({hiddenBuiltins.length} 个已删除)
        </button>
      )}
    </div>
  );
}
