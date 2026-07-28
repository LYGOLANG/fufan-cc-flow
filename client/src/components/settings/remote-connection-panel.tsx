import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Monitor, Save, Server } from "lucide-react";
import { isTauriRuntime } from "../../utils/tauri";

/**
 * 远程连接设置。
 *
 * 与 Rust 侧 connection.rs 的 ConnectionConfig 一一对应(camelCase)。
 * 保存后**下次启动生效**:热切换要把运行中的所有 WebSocket、会话、终端 PTY
 * 迁到新后端,而这些状态有一半在远端 —— 为一个低频操作引入那种复杂度不划算。
 */

type ConnectionMode = "local" | "remote";

interface RemoteConfig {
  host: string;
  sshPort: number;
  user: string;
  identityFile?: string | null;
  remoteDir: string;
  remotePort: number;
}

interface ConnectionConfig {
  mode: ConnectionMode;
  remote?: RemoteConfig | null;
}

const EMPTY_REMOTE: RemoteConfig = {
  host: "",
  sshPort: 22,
  user: "",
  identityFile: "",
  remoteDir: "/opt/agent-flow-server",
  remotePort: 3001,
};

const INPUT_CLASS =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40 transition-colors font-mono";

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export default function RemoteConnectionPanel() {
  const [mode, setMode] = useState<ConnectionMode>("local");
  const [remote, setRemote] = useState<RemoteConfig>(EMPTY_REMOTE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  const desktop = isTauriRuntime();

  useEffect(() => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invokeTauri<ConnectionConfig>("get_connection_config");
        if (cancelled) return;
        setMode(cfg.mode ?? "local");
        if (cfg.remote) setRemote({ ...EMPTY_REMOTE, ...cfg.remote });
        // 启动失败的原因(远端关机、密钥过期…)。不显示的话用户只看到界面连不上,
        // 却不知道是远端不可达还是应用自己坏了。
        const err = await invokeTauri<string | null>("backend_error");
        if (!cancelled) setBackendError(err ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      await invokeTauri("set_connection_config", {
        config: {
          mode,
          remote: mode === "remote" ? { ...remote, identityFile: remote.identityFile || null } : null,
        },
      });
      setSaveMsg("已保存 ✓ 重启应用后生效");
      setTimeout(() => setSaveMsg(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!desktop) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Server size={14} className="text-sky-link" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            远程连接
          </span>
        </div>
        <p className="text-[11px] text-slate-400">
          仅桌面端可用。浏览器形态下后端地址由部署方式决定。
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Server size={14} className="text-sky-link" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          远程连接
        </span>
      </div>
      <p className="text-[11px] text-amber-glow/80 mb-3 leading-relaxed">
        让本机界面操作另一台机器上的项目。连接经 SSH 隧道建立，数据不过第三方。
        远程机器需先用 <code className="font-mono">scripts/install-remote.sh</code> 安装后端，
        并装好 Claude Code CLI 且已登录。
      </p>

      {backendError && (
        <div className="mb-3 rounded-lg border border-rose-err/30 bg-rose-err/5 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-rose-err mt-0.5 shrink-0" />
            <div className="text-[11px] text-slate-300 leading-relaxed">
              <span className="text-rose-err font-medium">本次启动未能连上后端：</span>
              <br />
              {backendError}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={12} className="animate-spin" />
          读取配置…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                { id: "local" as const, label: "本机", icon: Monitor, desc: "使用本机后端" },
                { id: "remote" as const, label: "远程服务器", icon: Server, desc: "经 SSH 隧道" },
              ]
            ).map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                    active
                      ? "border-purple-glow/40 bg-purple-glow/10"
                      : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <Icon size={14} className={active ? "text-purple-glow" : "text-slate-400"} />
                  <span>
                    <span
                      className={`block text-xs font-medium ${active ? "text-white" : "text-slate-300"}`}
                    >
                      {opt.label}
                    </span>
                    <span className="block text-[10px] text-slate-400">{opt.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {mode === "remote" && (
            <div className="space-y-2.5 pt-1">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">主机地址</label>
                  <input
                    type="text"
                    value={remote.host}
                    onChange={(e) => setRemote({ ...remote, host: e.target.value })}
                    placeholder="192.168.1.10 或 example.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-1">SSH 端口</label>
                  <input
                    type="number"
                    value={remote.sshPort}
                    onChange={(e) =>
                      setRemote({ ...remote, sshPort: parseInt(e.target.value, 10) || 22 })
                    }
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">登录用户名</label>
                <input
                  type="text"
                  value={remote.user}
                  onChange={(e) => setRemote({ ...remote, user: e.target.value })}
                  placeholder="root"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  私钥路径
                  <span className="text-slate-500 ml-1">（留空则用默认密钥或 ssh-agent）</span>
                </label>
                <input
                  type="text"
                  value={remote.identityFile ?? ""}
                  onChange={(e) => setRemote({ ...remote, identityFile: e.target.value })}
                  placeholder="C:\Users\you\.ssh\id_ed25519"
                  className={INPUT_CLASS}
                />
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">远程后端目录</label>
                  <input
                    type="text"
                    value={remote.remoteDir}
                    onChange={(e) => setRemote({ ...remote, remoteDir: e.target.value })}
                    placeholder="/opt/agent-flow-server"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-1">后端端口</label>
                  <input
                    type="number"
                    value={remote.remotePort}
                    onChange={(e) =>
                      setRemote({ ...remote, remotePort: parseInt(e.target.value, 10) || 3001 })
                    }
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                只支持密钥登录，不支持密码：图形界面下没有输入密码的地方，密码认证只会让连接挂起。
                访问令牌经 SSH 标准输入传给远端，不会出现在远程机器的进程列表里。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
            >
              <Save size={13} />
              {saving ? "保存中..." : "保存连接设置"}
            </button>
            {saveMsg && <span className="text-xs text-emerald-ok">{saveMsg}</span>}
            {error && <span className="text-xs text-rose-err">{error}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
