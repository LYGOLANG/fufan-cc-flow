import { useState } from "react";
import { RefreshCw, Download, CheckCircle2, AlertTriangle, Rocket } from "lucide-react";
import { isTauriRuntime } from "../../utils/tauri";

type Phase =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "none" }
  | { s: "available"; version: string; notes?: string }
  | { s: "downloading"; pct: number }
  | { s: "ready" }
  | { s: "error"; msg: string };

/**
 * F1.14 应用自动升级:检查更新 → 下载安装 → 重启。
 * 走 tauri-plugin-updater,更新源为 tauri.conf.json plugins.updater.endpoints,
 * 安装包签名由打包时的私钥保证(公钥固化在应用里,防篡改)。
 */
export default function AppUpdatePanel() {
  const [phase, setPhase] = useState<Phase>({ s: "idle" });

  if (!isTauriRuntime()) return null;

  const check = async () => {
    setPhase({ s: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setPhase({ s: "available", version: update.version, notes: update.body });
      } else {
        setPhase({ s: "none" });
      }
    } catch (err) {
      setPhase({ s: "error", msg: String(err).slice(0, 200) });
    }
  };

  const install = async () => {
    setPhase({ s: "downloading", pct: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setPhase({ s: "none" });
        return;
      }
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          setPhase({ s: "downloading", pct: total > 0 ? Math.round((received / total) * 100) : 0 });
        }
        if (ev.event === "Finished") setPhase({ s: "ready" });
      });
      setPhase({ s: "ready" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setPhase({ s: "error", msg: String(err).slice(0, 200) });
    }
  };

  return (
    <section>
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-1.5">
        <Rocket size={11} />
        应用更新
      </div>
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-2">
          {phase.s === "available" ? (
            <span className="text-xs text-amber-glow flex items-center gap-1.5">
              <Download size={12} />
              发现新版本 v{phase.version}
            </span>
          ) : phase.s === "none" ? (
            <span className="text-xs text-emerald-ok flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              已是最新版本
            </span>
          ) : phase.s === "downloading" ? (
            <span className="text-xs text-amber-glow flex items-center gap-1.5">
              <RefreshCw size={12} className="animate-spin" />
              下载中 {phase.pct}%
            </span>
          ) : phase.s === "ready" ? (
            <span className="text-xs text-emerald-ok flex items-center gap-1.5">
              <CheckCircle2 size={12} />
              安装完成，即将重启…
            </span>
          ) : phase.s === "error" ? (
            <span className="text-xs text-rose-err flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span className="break-all">{phase.msg}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">点击检查是否有新版本</span>
          )}
        </div>

        {phase.s === "available" && phase.notes && (
          <p className="text-[11px] text-slate-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
            {phase.notes}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={check}
            disabled={phase.s === "checking" || phase.s === "downloading"}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={phase.s === "checking" ? "animate-spin" : ""} />
            检查更新
          </button>
          {phase.s === "available" && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors"
            >
              <Download size={12} />
              下载并安装
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
