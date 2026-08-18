import { useState } from "react";
import { FolderOpen, Package, Check, Loader2, AlertCircle, X } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../services/api";
import type { BundledPluginInfo } from "../../types/plugin";

/**
 * 从本地文件夹安装插件。
 *
 * Claude Code 的插件必须先落进 marketplace 目录并注册，才能被 `plugin install`
 * 装上；插件作者通常附一个 install.sh 让用户去命令行跑。这里把那一整套
 * （复制 → 写市场清单 → 注册 → 安装）交给后端做完，用户只需选一个文件夹。
 *
 * **刻意不预置任何插件卡片**：装什么、什么时候装由用户决定，界面不替他做主。
 */

export default function LocalPluginInstall({ onInstalled }: { onInstalled?: () => void }) {
  const pickFolderInApp = useUIStore((s) => s.pickFolderInApp);
  const [path, setPath] = useState<string | null>(null);
  // 与 BundledPlugins 共用 types/plugin 里的定义，不各自抄一份 ——
  // 抄件会和接口各自演化，这个项目已经栽过好几次
  const [info, setInfo] = useState<BundledPluginInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setPath(null);
    setInfo(null);
    setError(null);
    setDone(false);
  };

  const pick = async () => {
    const picked = await pickFolderInApp();
    if (!picked) return;
    setPath(picked);
    setInfo(null);
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      // 走 api 封装：桌面版后端是随机端口的 sidecar 且要鉴权头，
      // 裸 fetch("/api/...") 在 Tauri WebView 里打不到它
      const { plugin } = await api.inspectLocalPlugin(picked);
      setInfo(plugin);
    } catch (e) {
      // 选错目录是最常见的情况，必须当场说清楚，而不是等点了安装才失败
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await api.installLocalPlugin(path);
      setDone(true);
      onInstalled?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 p-2.5 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={11} className="text-slate-400" />
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            本地安装
          </span>
          <span className="text-[10px] text-slate-600">选一个插件文件夹装进 Claude Code</span>
        </div>
        <button
          onClick={() => void pick()}
          disabled={busy}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md shrink-0
                     border border-white/10 text-slate-300 hover:bg-white/5 hover:text-white
                     disabled:opacity-50 transition-colors"
        >
          <FolderOpen size={11} /> 选择文件夹
        </button>
      </div>

      {path && (
        <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
          <span className="font-mono break-all flex-1">{path}</span>
          <button onClick={reset} className="text-slate-600 hover:text-slate-300 shrink-0">
            <X size={11} />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[10px] text-rose-err px-2 py-1.5 rounded-md bg-rose-err/10">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span className="break-all whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {info && (
        <div className="rounded-md border border-white/10 p-2 space-y-1.5">
          <div className="flex items-start gap-2">
            <Package size={12} className="text-slate-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-slate-200">
                  {info.displayName || info.name}
                </span>
                {info.version && <span className="text-[10px] text-slate-600">v{info.version}</span>}
                {info.author && <span className="text-[10px] text-slate-600">· {info.author}</span>}
              </div>
              {info.description && (
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                  {info.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                {info.components.skills.length > 0 && (
                  <span>{info.components.skills.length} 个技能</span>
                )}
                {info.components.agents.length > 0 && (
                  <span>{info.components.agents.length} 个 Agent</span>
                )}
                {/* Hook 会对所有会话生效，不是只在用这个插件时 —— 得先说清楚 */}
                {info.components.hooks && <span className="text-amber-glow">含 Hook</span>}
              </div>
            </div>

            {done || info.installed ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-ok shrink-0 px-2 py-1">
                <Check size={11} /> 已安装
              </span>
            ) : (
              <button
                onClick={() => void install()}
                disabled={busy}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md shrink-0
                           bg-[#ca5d3d] hover:bg-amber-glow disabled:opacity-50
                           text-white font-medium transition-colors"
              >
                {busy && <Loader2 size={11} className="animate-spin" />}
                {busy ? "安装中" : "安装"}
              </button>
            )}
          </div>

          {info.components.hooks && !info.installed && !done && (
            <p className="text-[10px] text-slate-500 leading-relaxed">
              这个插件带 Hook，装上后会对**所有**会话生效（不只是用到它的时候）。
            </p>
          )}
        </div>
      )}

      {done && (
        <p className="text-[10px] text-emerald-ok">
          已装好。新开的会话即可使用；当前会话可能需要重启应用才认得到。
        </p>
      )}
    </div>
  );
}
