import { useEffect, useState } from "react";
import {
  ArrowUpCircle, CheckCircle, Copy, Info, Loader2,
  RefreshCw, Stethoscope, Wrench, XCircle,
} from "lucide-react";
import { api } from "../../services/api";
import { useSystemStore } from "../../stores/systemStore";
import SettingsSectionTitle from "./settings-section-title";

type InstallMethod = "powershell" | "winget" | "cmd";

const INSTALL_COMMANDS: Record<InstallMethod, string> = {
  powershell: "irm https://claude.ai/install.ps1 | iex",
  winget: "winget install Anthropic.ClaudeCode",
  cmd: "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
};

export default function ClaudeCliPanel({ installed }: { installed: boolean }) {
  const {
    claudeInfo, infoLoading, doctorResult, doctorLoading,
    updateOutput, updateLoading, proxySettings,
    loadClaudeInfo, runDoctor, runUpdate, loadProxy,
  } = useSystemStore();
  const [installMethod, setInstallMethod] = useState<InstallMethod>("powershell");
  const [showDoctor, setShowDoctor] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [autoChannel, setAutoChannel] = useState<"latest" | "stable">("latest");

  useEffect(() => { loadProxy(); }, [loadProxy]);

  const isWindows = claudeInfo?.platform === "win32" || claudeInfo === null;

  function buildProxyPrefix(httpsProxy: string, method: InstallMethod | "curl") {
    if (!httpsProxy) return "";
    if (method === "powershell") return `$env:HTTPS_PROXY="${httpsProxy}"; `;
    if (method === "curl") return `HTTPS_PROXY=${httpsProxy} `;
    return "";
  }

  function getInstallCmd() {
    if (!isWindows) {
      return `${buildProxyPrefix(proxySettings.httpsProxy, "curl")}curl -fsSL https://claude.ai/install.sh | bash`;
    }
    return `${buildProxyPrefix(proxySettings.httpsProxy, installMethod)}${INSTALL_COMMANDS[installMethod]}`;
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(getInstallCmd());
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  }

  async function handleChannelChange(channel: "latest" | "stable") {
    setAutoChannel(channel);
    await api.updateConfig({ autoUpdatesChannel: channel });
  }

  return (
    <div className="space-y-6">
      {installed ? (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-ok/20 bg-emerald-ok/5">
          <CheckCircle size={16} className="text-emerald-ok flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-slate-200">已安装 Claude Code</span>
            {claudeInfo?.version && <span className="ml-2 text-xs font-mono text-slate-500">v{claudeInfo.version}</span>}
          </div>
          <button
            onClick={loadClaudeInfo}
            disabled={infoLoading}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
            title="重新检测"
          >
            <RefreshCw size={14} className={infoLoading ? "animate-spin" : ""} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-rose-err/20 bg-rose-err/5">
          <XCircle size={16} className="text-rose-err flex-shrink-0" />
          <span className="text-sm text-slate-300 flex-1">未检测到 Claude Code</span>
          <button
            onClick={loadClaudeInfo}
            disabled={infoLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={infoLoading ? "animate-spin" : ""} />重新检测
          </button>
        </div>
      )}

      {!installed ? (
        <section>
          <SettingsSectionTitle icon={Wrench} label="安装 Claude Code" color="text-purple-bright" />
          <div className="space-y-3">
            {isWindows && (
              <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="text-xs font-semibold text-slate-400 mb-2">前置条件：Git for Windows</div>
                <a
                  href="https://git-scm.com/download/win"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
                >
                  下载 Git for Windows ↗
                </a>
                {claudeInfo?.gitBashAvailable === false && <p className="mt-2 text-[11px] text-amber-glow">未检测到 Git Bash，请先安装</p>}
              </div>
            )}
            {isWindows && (
              <div className="flex gap-1">
                {(["powershell", "winget", "cmd"] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setInstallMethod(method)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                      installMethod === method
                        ? "border-purple-bright/30 bg-purple-glow/10 text-purple-bright"
                        : "border-white/5 text-slate-500 hover:bg-white/5"
                    }`}
                  >
                    {method === "powershell" ? "PowerShell" : method === "winget" ? "WinGet" : "CMD"}
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-white/5 bg-black/30 p-3">
              <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed">{getInstallCmd()}</pre>
            </div>
            <div className="p-3 rounded-xl border border-amber-glow/20 bg-amber-glow/5 text-[11px] text-slate-300 leading-relaxed">
              <p className="font-semibold text-amber-glow mb-1">操作步骤：</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>复制并运行上方安装命令</li>
                <li>等待安装完成（约 1-2 分钟）</li>
                <li>回到此处点击「重新检测」</li>
              </ol>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
            >
              <Copy size={12} />{copiedCmd ? "已复制!" : "复制命令"}
            </button>
          </div>
        </section>
      ) : (
        <section>
          <SettingsSectionTitle icon={Wrench} label="CLI 工具" />
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 flex-shrink-0">更新频道</span>
              <div className="flex gap-1">
                {(["latest", "stable"] as const).map((channel) => (
                  <button
                    key={channel}
                    onClick={() => handleChannelChange(channel)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                      autoChannel === channel
                        ? "border-amber-glow/30 bg-amber-glow/10 text-amber-glow"
                        : "border-white/5 text-slate-500 hover:bg-white/5"
                    }`}
                  >
                    {channel}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { setShowUpdate(true); runUpdate(); }}
                disabled={updateLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <ArrowUpCircle size={13} className={updateLoading ? "animate-spin" : ""} />{updateLoading ? "更新中..." : "立即更新"}
              </button>
              <button
                onClick={() => { setShowDoctor(true); runDoctor(); }}
                disabled={doctorLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <Stethoscope size={13} className={doctorLoading ? "animate-pulse" : ""} />{doctorLoading ? "检查中..." : "运行 Doctor"}
              </button>
            </div>
            {showUpdate && (
              <div className="rounded-lg border border-white/5 p-3 bg-black/20 max-h-28 overflow-y-auto">
                {updateLoading
                  ? <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={11} className="animate-spin" />正在更新...</p>
                  : <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap">{updateOutput || "完成"}</pre>}
              </div>
            )}
            {showDoctor && (
              <div className="rounded-lg border border-white/5 p-3 bg-black/20 max-h-48 overflow-y-auto space-y-0.5">
                {doctorLoading ? (
                  <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={11} className="animate-spin" />运行中...</p>
                ) : doctorResult?.map((item, index) => (
                  <div key={index} className="flex items-start gap-2">
                    {item.status === "ok" && <CheckCircle size={11} className="text-emerald-ok mt-0.5 flex-shrink-0" />}
                    {item.status === "error" && <XCircle size={11} className="text-rose-err mt-0.5 flex-shrink-0" />}
                    {item.status === "info" && <Info size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />}
                    <span className={`text-[11px] font-mono leading-relaxed ${
                      item.status === "ok" ? "text-emerald-ok" : item.status === "error" ? "text-rose-err" : "text-slate-500"
                    }`}>{item.line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
