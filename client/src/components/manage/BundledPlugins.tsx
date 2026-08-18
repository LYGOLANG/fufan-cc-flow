import { useCallback, useEffect, useState } from "react";
import { Package, Check, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { api } from "../../services/api";
import type { BundledPluginInfo } from "../../types/plugin";

/**
 * 随应用分发、但**不自动安装**的插件。
 *
 * 两条边界，缺一条这个功能就会招骂：
 *   1. 插件文件随包带着 —— 换台电脑装完 Agent Flow 就有，不依赖用户手里
 *      还留着那个文件夹，也不用去命令行跑插件自带的 install.sh。
 *   2. **装不装、什么时候装，只由用户点那个按钮决定。** 应用启动、面板加载
 *      都只读状态，绝不代替用户执行安装 —— 插件会往会话里注入 skills/agents/
 *      hooks，替用户装等于替他改了工作环境。
 */

export default function BundledPlugins({ onInstalled }: { onInstalled?: () => void }) {
  const [plugins, setPlugins] = useState<BundledPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 拉取失败与「确实没有内置插件」必须分开：前者要说话，后者才静默隐藏 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { plugins: list } = await api.getBundledPlugins();
      setPlugins(list ?? []);
      setLoadError(null);
    } catch (e) {
      // 以前这里 catch 掉就当「没有内置插件」→ 整块隐藏。结果是接口打不通时
      // 界面上什么都没有，而后端明明是好的，排查只能靠猜。失败就说出来。
      setPlugins([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 只有这里会触发安装，且只在用户点击时调用 */
  const install = async (p: BundledPluginInfo) => {
    setInstallingId(p.id);
    setError(null);
    try {
      await api.installBundledPlugin(p.id);
      await load();
      onInstalled?.();
    } catch (e) {
      // 失败必须让用户看见原因：装不上多半是 claude CLI 不在 PATH，
      // 静默失败会让人以为按钮坏了
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) return null;

  // 拉取失败要说话，不能装作「没有内置插件」—— 那正是上一版让人对着
  // 空白界面找不着北的原因
  if (loadError) {
    return (
      <div className="flex items-start gap-1.5 text-[10px] text-rose-err px-2.5 py-1.5 rounded-md bg-rose-err/10">
        <AlertCircle size={11} className="mt-0.5 shrink-0" />
        <span className="break-all">读取内置插件失败：{loadError}</span>
      </div>
    );
  }

  // 确实没有内置插件时才静默隐藏
  if (plugins.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles size={11} className="text-purple-glow" />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          内置插件
        </span>
        <span className="text-[10px] text-slate-600">随 Agent Flow 分发 · 需要时你自己点安装</span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[10px] text-rose-err px-2.5 py-1.5 rounded-md bg-rose-err/10">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {plugins.map((p) => {
        const busy = installingId === p.id;
        return (
          <div
            key={p.id}
            className="rounded-lg border border-white/10 p-2.5"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div className="flex items-start gap-2">
              <Package size={13} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-slate-200">
                    {p.displayName || p.name}
                  </span>
                  {p.version && <span className="text-[10px] text-slate-600">v{p.version}</span>}
                  {p.author && <span className="text-[10px] text-slate-600">· {p.author}</span>}
                </div>
                {p.description && (
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                  {p.components.skills.length > 0 && (
                    <span>{p.components.skills.length} 个技能</span>
                  )}
                  {p.components.agents.length > 0 && (
                    <span>{p.components.agents.length} 个 Agent</span>
                  )}
                  {p.components.hooks && <span>含 Hook</span>}
                </div>
              </div>

              {p.installed ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-ok shrink-0 px-2 py-1">
                  <Check size={11} /> 已安装
                </span>
              ) : (
                <button
                  onClick={() => void install(p)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md shrink-0
                             bg-[#ca5d3d] hover:bg-amber-glow disabled:opacity-50
                             text-white font-medium transition-colors"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                  {busy ? "安装中" : "安装"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
