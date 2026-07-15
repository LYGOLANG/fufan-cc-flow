import { useEffect, useState } from "react";
import { Download, RefreshCw, Rocket, X } from "lucide-react";
import { isTauriRuntime } from "../../utils/tauri";

/** 启动后延迟检查,避免和应用初始化抢资源 */
const STARTUP_DELAY_MS = 8_000;
/** 长驻运行时的周期性检查间隔(4 小时) */
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** 本次会话内被用户"稍后"忽略的版本,不再重复弹 */
const dismissed = new Set<string>();

type Phase =
  | { s: "hidden" }
  | { s: "available"; version: string; notes?: string }
  | { s: "downloading"; pct: number }
  | { s: "ready" }
  | { s: "error"; msg: string };

/**
 * F1.14 应用自动升级 · 启动自动检查 + 更新弹框。
 * 应用启动 8s 后(及此后每 4h)静默检查发布仓,发现新版本即弹框提示,
 * 用户可一键"立即更新"(下载 → 安装 → 自动重启)或"稍后"(本次会话不再提示)。
 * 设置页的 AppUpdatePanel 仍保留手动检查入口,二者共用同一更新源。
 */
export default function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>({ s: "hidden" });

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let alive = true;

    const runCheck = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!alive || !update) return;
        if (dismissed.has(update.version)) return;
        setPhase((p) =>
          // 下载中/已就绪时不被后续周期检查打断
          p.s === "downloading" || p.s === "ready"
            ? p
            : { s: "available", version: update.version, notes: update.body }
        );
      } catch {
        // 静默检查失败不打扰用户(离线/网络抖动是常态),手动入口仍可用
      }
    };

    const timer = setTimeout(() => void runCheck(), STARTUP_DELAY_MS);
    const interval = setInterval(() => void runCheck(), RECHECK_INTERVAL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  if (phase.s === "hidden") return null;

  const dismiss = () => {
    if (phase.s === "available") dismissed.add(phase.version);
    setPhase({ s: "hidden" });
  };

  const install = async () => {
    setPhase({ s: "downloading", pct: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setPhase({ s: "hidden" });
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

  const busy = phase.s === "downloading" || phase.s === "ready";

  return (
    <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="modal-content glass-panel rounded-2xl w-full max-w-[420px] flex flex-col shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-amber-glow/15 flex items-center justify-center">
            <Rocket size={14} className="text-amber-glow" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white">
              {phase.s === "available" && `发现新版本 v${phase.version}`}
              {phase.s === "downloading" && "正在下载更新…"}
              {phase.s === "ready" && "安装完成，即将重启…"}
              {phase.s === "error" && "更新失败"}
            </h2>
          </div>
          {!busy && (
            <button
              onClick={dismiss}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          {phase.s === "available" && (
            <>
              {phase.notes ? (
                <p className="text-xs text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                  {phase.notes}
                </p>
              ) : (
                <p className="text-xs text-slate-400">新版本已发布，建议立即更新。</p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={dismiss}
                  className="text-xs px-3 py-1.5 rounded-md bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 transition-colors"
                >
                  稍后
                </button>
                <button
                  onClick={install}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors"
                >
                  <Download size={12} />
                  立即更新
                </button>
              </div>
            </>
          )}

          {phase.s === "downloading" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-amber-glow">
                <RefreshCw size={12} className="animate-spin" />
                下载中 {phase.pct}%
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-glow transition-all duration-300"
                  style={{ width: `${phase.pct}%` }}
                />
              </div>
            </div>
          )}

          {phase.s === "ready" && (
            <p className="text-xs text-emerald-ok">更新已安装，应用即将自动重启。</p>
          )}

          {phase.s === "error" && (
            <>
              <p className="text-xs text-rose-err break-all">{phase.msg}</p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={dismiss}
                  className="text-xs px-3 py-1.5 rounded-md bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 transition-colors"
                >
                  关闭
                </button>
                <button
                  onClick={install}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors"
                >
                  <RefreshCw size={12} />
                  重试
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
