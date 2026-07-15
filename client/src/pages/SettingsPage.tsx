/**
 * SettingsPage — Full-screen settings page (replaces SettingsModal)
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ Header: ← 返回  ⚙ 设置  [status dot]    │
 *   ├─────────────────────────────────────────┤
 *   │ Scrollable content                      │
 *   │  ① Step 1: 环境配置                     │
 *   │  ② Step 2: 授权 & 模型配置              │
 *   ├─────────────────────────────────────────┤
 *   │ [▸ 命令行]  Mini-terminal drawer        │
 *   └─────────────────────────────────────────┘
 */

import { useEffect, useRef, useState } from "react";
import {
  X, Settings, CheckCircle2, Lock,
  Shield, RefreshCw, Save, TerminalSquare,
  Copy, Wrench, Zap, Loader2,
  CheckCircle, XCircle, Info, ArrowUpCircle, Stethoscope,
  Eye, EyeOff, KeyRound, Server, Globe, Cpu,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { useSystemStore } from "../stores/systemStore";
import { useConfigStore } from "../stores/configStore";
import { useClaudeStatus } from "../hooks/useClaudeStatus";
import type { ModelId, EffortLevel } from "../types/claude";
import { api } from "../services/api";
import ProvidersPanel from "../components/settings/ProvidersPanel";
import AppUpdatePanel from "../components/settings/AppUpdatePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type InstallMethod = "powershell" | "winget" | "cmd";

const INSTALL_COMMANDS: Record<InstallMethod, string> = {
  powershell: "irm https://claude.ai/install.ps1 | iex",
  winget: "winget install Anthropic.ClaudeCode",
  cmd: "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function StepIndicator({
  done,
  locked,
  number,
}: {
  done: boolean;
  locked?: boolean;
  number: number;
}) {
  if (locked) {
    return (
      <div className="w-7 h-7 rounded-full border border-white/10 bg-white/5 flex items-center justify-center flex-shrink-0">
        <Lock size={12} className="text-slate-500" />
      </div>
    );
  }
  if (done) {
    return (
      <div className="w-7 h-7 rounded-full border border-emerald-ok/40 bg-emerald-ok/10 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 size={15} className="text-emerald-ok" />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full border border-amber-glow/40 bg-amber-glow/10 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-amber-glow">{number}</span>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  color = "text-slate-400",
}: {
  icon: React.ElementType;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className={color} />
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ─── Proxy Block ───────────────────────────────────────────────────────────────

function ProxyBlock({ stepLabel }: { stepLabel?: string }) {
  const {
    proxySettings, proxySaving, proxySaveError,
    proxyTestResult, proxyTesting,
    saveProxy, setProxySettings, testProxy,
  } = useSystemStore();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function handleSave() {
    try {
      await saveProxy(proxySettings);
      setSaveMsg("已保存 ✓");
    } catch {
      setSaveMsg(null);
    } finally {
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  function handleTest() {
    const raw = proxySettings.httpsProxy || proxySettings.httpProxy;
    if (!raw) return;
    try {
      const url = new URL(raw);
      testProxy(url.hostname, parseInt(url.port || "80", 10));
    } catch {
      // invalid URL — try to parse host:port
      const parts = raw.replace(/^https?:\/\//, "").split(":");
      testProxy(parts[0], parseInt(parts[1] || "7890", 10));
    }
  }

  const canTest = !!(proxySettings.httpsProxy || proxySettings.httpProxy);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className="text-sky-link" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">代理设置</span>
        {stepLabel && (
          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-link/10 text-sky-link border border-sky-link/20">
            {stepLabel}
          </span>
        )}
      </div>

      <p className="text-[11px] text-amber-glow/80 mb-3 leading-relaxed">
        ⚠️ 国内用户需先保存代理设置，再安装 Claude Code 或调用官方模型。
      </p>

      <div className="space-y-2.5">
        {(["httpProxy", "httpsProxy", "socksProxy"] as const).map((key) => (
          <div key={key}>
            <label className="block text-xs text-slate-400 mb-1">
              {key === "httpProxy" ? "HTTP 代理" : key === "httpsProxy" ? "HTTPS 代理" : "SOCKS 代理"}
              {key === "socksProxy" && (
                <span className="ml-1.5 text-slate-600 font-normal">（可选）</span>
              )}
            </label>
            <input
              type="text"
              value={proxySettings[key]}
              onChange={(e) => setProxySettings({ ...proxySettings, [key]: e.target.value })}
              placeholder={
                key === "socksProxy"
                  ? "socks5://127.0.0.1:1080"
                  : "http://127.0.0.1:7890"
              }
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40 transition-colors font-mono"
            />
          </div>
        ))}

        {/* Quick presets */}
        <div className="flex flex-wrap gap-2 pt-1">
          {[
            { label: "Clash (7890)", http: "http://127.0.0.1:7890", https: "http://127.0.0.1:7890" },
            { label: "V2Ray (10809)", http: "http://127.0.0.1:10809", https: "http://127.0.0.1:10809" },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setProxySettings({ httpProxy: p.http, httpsProxy: p.https, socksProxy: "" })}
              className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setProxySettings({ httpProxy: "", httpsProxy: "", socksProxy: "" })}
            className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            清空
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={proxySaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
          >
            <Save size={13} />
            {proxySaving ? "保存中..." : "保存代理"}
          </button>

          <button
            onClick={handleTest}
            disabled={!canTest || proxyTesting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-sky-link/30 bg-sky-link/5 text-sky-link hover:bg-sky-link/10 transition-colors disabled:opacity-40"
          >
            {proxyTesting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            测试代理
          </button>

          {saveMsg && <span className="text-xs text-emerald-ok">{saveMsg}</span>}
          {!proxySaving && proxySaveError && (
            <span className="text-xs text-rose-err">{proxySaveError}</span>
          )}
        </div>

        {/* Test result */}
        {proxyTestResult && (
          <div className={`flex flex-col gap-1 text-xs px-3 py-2 rounded-lg border ${
            proxyTestResult.success
              ? "border-emerald-ok/20 bg-emerald-ok/5"
              : "border-rose-err/20 bg-rose-err/5"
          }`}>
            <div className={`flex items-center gap-2 ${proxyTestResult.success ? "text-emerald-ok" : "text-rose-err"}`}>
              {proxyTestResult.success
                ? <CheckCircle size={12} />
                : <XCircle size={12} />}
              <span>
                {proxyTestResult.success
                  ? `代理可达 Anthropic 服务器（${proxyTestResult.latency}ms）`
                  : `无法通过代理访问 Anthropic：${proxyTestResult.error}`}
              </span>
            </div>
            {proxyTestResult.success && (
              <span className="text-[10px] text-slate-500 pl-4">
                已通过 HTTP CONNECT 隧道验证 api.anthropic.com:443 可达性
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Step 1: Environment Setup ─────────────────────────────────────────────────

function Step1EnvCard({ done }: { done: boolean }) {
  const {
    claudeInfo, infoLoading,
    doctorResult, doctorLoading,
    updateOutput, updateLoading,
    proxySettings, loadClaudeInfo, runDoctor, runUpdate, loadProxy,
  } = useSystemStore();

  const [installMethod, setInstallMethod] = useState<InstallMethod>("powershell");
  const [showDoctor, setShowDoctor] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [autoChannel, setAutoChannel] = useState<"latest" | "stable">("latest");

  useEffect(() => { loadProxy(); }, [loadProxy]);

  const isWindows = claudeInfo?.platform === "win32" || claudeInfo === null;

  function buildProxyPrefix(httpsProxy: string, method: InstallMethod | "curl"): string {
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

  async function handleChannelChange(ch: "latest" | "stable") {
    setAutoChannel(ch);
    await api.updateConfig({ autoUpdatesChannel: ch });
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {done ? (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-ok/20 bg-emerald-ok/5">
          <CheckCircle size={16} className="text-emerald-ok flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-slate-200">已安装 Claude Code</span>
            {claudeInfo?.version && (
              <span className="ml-2 text-xs font-mono text-slate-500">v{claudeInfo.version}</span>
            )}
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
            <RefreshCw size={12} className={infoLoading ? "animate-spin" : ""} />
            重新检测
          </button>
        </div>
      )}

      {/* Proxy block — always first */}
      <ProxyBlock stepLabel={done ? undefined : "第 1 步"} />

      {/* Install guide or Tools */}
      {!done ? (
        <section>
          <SectionTitle icon={Wrench} label="安装 Claude Code" color="text-purple-bright" />
          <div className="flex items-center gap-1.5 mb-2">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-glow/10 text-purple-bright border border-purple-bright/20">
              第 2 步
            </span>
          </div>
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
                {claudeInfo?.gitBashAvailable === false && (
                  <p className="mt-2 text-[11px] text-amber-glow">未检测到 Git Bash，请先安装</p>
                )}
              </div>
            )}

            {isWindows && (
              <div className="flex gap-1">
                {(["powershell", "winget", "cmd"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setInstallMethod(m)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                      installMethod === m
                        ? "border-purple-bright/30 bg-purple-glow/10 text-purple-bright"
                        : "border-white/5 text-slate-500 hover:bg-white/5"
                    }`}
                  >
                    {m === "powershell" ? "PowerShell" : m === "winget" ? "WinGet" : "CMD"}
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-white/5 bg-black/30 p-3">
              <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                {getInstallCmd()}
              </pre>
            </div>

            <div className="p-3 rounded-xl border border-amber-glow/20 bg-amber-glow/5 text-[11px] text-slate-300 leading-relaxed">
              <p className="font-semibold text-amber-glow mb-1">操作步骤：</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>点击"复制命令"按钮复制上方安装命令</li>
                <li>点击页面底部"打开命令行"按钮展开命令行</li>
                <li>粘贴并运行命令（等待安装完成，约 1-2 分钟）</li>
                <li>安装完成后点击"重新检测"按钮</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
              >
                <Copy size={12} />
                {copiedCmd ? "已复制!" : "复制命令"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section>
          <SectionTitle icon={Wrench} label="工具" color="text-slate-400" />
          <div className="space-y-3">
            {/* Update channel */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 flex-shrink-0">更新频道</span>
              <div className="flex gap-1">
                {(["latest", "stable"] as const).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => handleChannelChange(ch)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                      autoChannel === ch
                        ? "border-amber-glow/30 bg-amber-glow/10 text-amber-glow"
                        : "border-white/5 text-slate-500 hover:bg-white/5"
                    }`}
                  >
                    {ch}
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
                <ArrowUpCircle size={13} className={updateLoading ? "animate-spin" : ""} />
                {updateLoading ? "更新中..." : "立即更新"}
              </button>
              <button
                onClick={() => { setShowDoctor(true); runDoctor(); }}
                disabled={doctorLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <Stethoscope size={13} className={doctorLoading ? "animate-pulse" : ""} />
                {doctorLoading ? "检查中..." : "运行 Doctor"}
              </button>
            </div>

            {showUpdate && (
              <div className="rounded-lg border border-white/5 p-3 bg-black/20 max-h-28 overflow-y-auto">
                {updateLoading
                  ? <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={11} className="animate-spin" />正在更新...</p>
                  : <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap">{updateOutput || "完成"}</pre>
                }
              </div>
            )}

            {showDoctor && (
              <div className="rounded-lg border border-white/5 p-3 bg-black/20 max-h-48 overflow-y-auto space-y-0.5">
                {doctorLoading
                  ? <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={11} className="animate-spin" />运行中...</p>
                  : doctorResult?.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {item.status === "ok" && <CheckCircle size={11} className="text-emerald-ok mt-0.5 flex-shrink-0" />}
                      {item.status === "error" && <XCircle size={11} className="text-rose-err mt-0.5 flex-shrink-0" />}
                      {item.status === "info" && <Info size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />}
                      <span className={`text-[11px] font-mono leading-relaxed ${
                        item.status === "ok" ? "text-emerald-ok"
                        : item.status === "error" ? "text-rose-err"
                        : "text-slate-500"
                      }`}>
                        {item.line}
                      </span>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Anthropic Tab ─────────────────────────────────────────────────────────────

function AnthropicTab() {
  const { proxySettings, claudeSettingsEnv, authStatus, claudeTesting, claudeTestResult, availableModels, loadModels, saveClaudeSettings, testClaude, loadAuthStatus } = useSystemStore();
  const { apiKey, setApiKey, model } = useConfigStore();
  // Default the auth toggle to your actual login method (订阅/OAuth vs API Key),
  // so re-entering settings reflects what you previously set up.
  const [authMode, setAuthMode] = useState<"apikey" | "oauth">(
    authStatus?.authMethod === "oauth" ? "oauth" : "apikey"
  );
  // Sync once from auth-status when it first loads (it reads ~/.claude OAuth creds
  // or settings.json key), then let the user freely switch.
  const authSyncedRef = useRef(false);
  useEffect(() => {
    if (!authSyncedRef.current && authStatus && authStatus.authMethod !== "none") {
      setAuthMode(authStatus.authMethod === "oauth" ? "oauth" : "apikey");
      authSyncedRef.current = true;
    }
  }, [authStatus]);

  // Load the live model list (from /v1/models) when this tab mounts —
  // 对话框里的模型菜单也吃这份列表。
  useEffect(() => {
    if (availableModels.length === 0) loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showKey, setShowKey] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  // Pre-fill the key from the persisted settings.json env so it survives refresh.
  useEffect(() => {
    if (claudeSettingsEnv.ANTHROPIC_API_KEY && !apiKey) {
      setApiKey(claudeSettingsEnv.ANTHROPIC_API_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeSettingsEnv]);

  async function handleTestAndSave() {
    setTestMsg(null);
    // Test FIRST, then only persist a key that actually works — this prevents a
    // typo (e.g. "admin123") from being written to settings.json and breaking
    // auth for the CLI. OAuth/订阅 mode sends no key (uses ~/.claude creds).
    const result = await testClaude({
      apiKey: authMode === "apikey" ? apiKey || undefined : undefined,
      model,
      httpProxy: proxySettings.httpProxy || undefined,
      httpsProxy: proxySettings.httpsProxy || undefined,
    });
    if (result.success) {
      if (authMode === "apikey") {
        // Persist the verified key so it survives refresh & auth-status sees it.
        await saveClaudeSettings({ ANTHROPIC_API_KEY: apiKey || undefined });
      }
      setTestMsg(`✓ 就绪！回复: "${result.responseText.slice(0, 40)}" (${result.latency}ms)`);
      await loadAuthStatus();
      await loadModels(); // refresh the real model list
    } else {
      setTestMsg(`✗ 测试失败：${result.error || "未知错误"}`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Auth method */}
      <section>
        <SectionTitle icon={KeyRound} label="授权方式" color="text-emerald-ok" />
        <div className="flex gap-2 mb-3">
          {(["apikey", "oauth"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setAuthMode(m)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                authMode === m
                  ? "border-emerald-ok/30 bg-emerald-ok/10 text-emerald-ok"
                  : "border-white/5 text-slate-400 hover:bg-white/5"
              }`}
            >
              {m === "apikey" ? "API Key" : "OAuth（claude.ai 账号）"}
            </button>
          ))}
        </div>

        {authMode === "apikey" ? (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 pr-10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-ok/40 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              点击下方"测试 &amp; 保存"后将写入 ~/.claude/settings.json，刷新后自动保留。去{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-link hover:underline"
              >
                Anthropic Console
              </a>{" "}
              获取 API Key。
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-violet-info/20 bg-violet-info/5 space-y-2">
            <p className="text-xs text-slate-300 leading-relaxed">
              OAuth 授权需要在命令行中登录 Claude.ai 账号：
            </p>
            <ol className="text-[11px] text-slate-400 list-decimal list-inside space-y-1 leading-relaxed">
              <li>点击页面底部"打开命令行"展开终端</li>
              <li>输入命令：<span className="font-mono text-violet-info">claude</span></li>
              <li>按提示打开浏览器并完成登录授权</li>
              <li>授权完成后，回到此处点击"测试 & 保存"</li>
            </ol>
            <p className="text-[11px] text-amber-glow/80">
              ⚠️ 如已配置代理，授权前请确保代理已保存（第①步）。
            </p>
          </div>
        )}
      </section>

      {/* Proxy display (read-only, inherited from Step 1) */}
      <section>
        <SectionTitle icon={Shield} label="代理（已从第①步同步）" color="text-sky-link" />
        <div className="p-3 rounded-lg border border-white/5 bg-black/20 font-mono text-[11px] text-slate-400 space-y-1">
          {proxySettings.httpProxy
            ? <div>HTTP: <span className="text-slate-300">{proxySettings.httpProxy}</span></div>
            : <div className="text-slate-600">HTTP: 未设置</div>
          }
          {proxySettings.httpsProxy
            ? <div>HTTPS: <span className="text-slate-300">{proxySettings.httpsProxy}</span></div>
            : <div className="text-slate-600">HTTPS: 未设置</div>
          }
        </div>
      </section>

      {/* 模型/推理力度不在这里选:统一在对话框右下角的模型按钮 */}
      <div className="flex items-center gap-2 p-3 rounded-xl border border-purple-bright/15 bg-purple-glow/[0.04]">
        <Zap size={13} className="text-purple-bright flex-shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          模型、推理力度、扩展思考的切换都在<span className="text-purple-bright font-medium">对话输入框右下角的模型按钮</span>里,这里只负责授权。
        </p>
      </div>

      {/* Test & Save */}
      <div className="pt-2 border-t border-white/5 space-y-2">
        <button
          onClick={handleTestAndSave}
          disabled={claudeTesting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
        >
          {claudeTesting
            ? <><Loader2 size={14} className="animate-spin" />测试中（最长 30 秒）...</>
            : <><Zap size={14} />测试 & 保存</>
          }
        </button>
        {claudeTestResult && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
            claudeTestResult.success
              ? "border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok"
              : "border-rose-err/20 bg-rose-err/5 text-rose-err"
          }`}>
            {claudeTestResult.success
              ? <CheckCircle size={13} className="mt-0.5 flex-shrink-0" />
              : <XCircle size={13} className="mt-0.5 flex-shrink-0" />
            }
            <span className="leading-relaxed">
              {testMsg ?? (claudeTestResult.error
                ? `错误：${claudeTestResult.error}`
                : claudeTestResult.responseText)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OpenAI Codex Engine Card ──────────────────────────────────────────────────

function CodexCard() {
  const {
    codexInfo, codexInfoLoading, codexAuthStatus, codexLoggingIn,
    codexTestResult, codexTesting,
    loadCodexInfo, loadCodexAuthStatus, codexSubscriptionLogin,
    codexLoginApiKey, codexLogout, testCodex,
  } = useSystemStore();

  const [authMode, setAuthMode] = useState<"subscription" | "apikey">("subscription");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    loadCodexInfo();
    loadCodexAuthStatus();
  }, [loadCodexInfo, loadCodexAuthStatus]);

  // 认证方式 tab 默认对齐已有登录状态
  useEffect(() => {
    if (codexAuthStatus?.authMethod === "apikey") setAuthMode("apikey");
    else if (codexAuthStatus?.authMethod === "chatgpt") setAuthMode("subscription");
  }, [codexAuthStatus]);

  const installed = !!codexInfo?.installed;
  const authed = !!codexAuthStatus?.authenticated;
  const INSTALL_CMD = "npm install -g @openai/codex";

  async function handleCopyInstall() {
    await navigator.clipboard.writeText(INSTALL_CMD);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  }

  async function handleSubscriptionLogin() {
    setLoginMsg("正在打开浏览器完成 ChatGPT 授权，请在弹出的页面中登录…（最长 3 分钟）");
    const r = await codexSubscriptionLogin();
    if (r.success) setLoginMsg(r.alreadyLoggedIn ? "✓ 已登录（ChatGPT 订阅）" : "✓ 订阅登录成功！");
    else setLoginMsg(`✗ 登录未完成：${(r.output || "请重试").slice(0, 220)}`);
  }

  async function handleApiKeyLogin() {
    if (!apiKey.trim()) return;
    setLoginMsg("正在写入 API Key…");
    const r = await codexLoginApiKey(apiKey.trim());
    setLoginMsg(r.success ? "✓ API Key 已保存并登录" : `✗ 失败：${(r.output || "").slice(0, 220)}`);
  }

  async function handleTest() {
    setTestMsg(null);
    const r = await testCodex();
    setTestMsg(r.success
      ? `✓ 就绪！回复: "${r.responseText.slice(0, 40)}" (${r.latency}ms)`
      : `✗ 测试失败：${r.error || "未知错误"}`);
  }

  return (
    <div className="space-y-5">
      {/* Install / status banner */}
      {installed ? (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-ok/20 bg-emerald-ok/5">
          <CheckCircle size={16} className="text-emerald-ok flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-slate-200">已安装 Codex CLI</span>
            {codexInfo?.version && (
              <span className="ml-2 text-xs font-mono text-slate-500">v{codexInfo.version}</span>
            )}
          </div>
          <button
            onClick={loadCodexInfo}
            disabled={codexInfoLoading}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
            title="重新检测"
          >
            <RefreshCw size={14} className={codexInfoLoading ? "animate-spin" : ""} />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-rose-err/20 bg-rose-err/5">
            <XCircle size={16} className="text-rose-err flex-shrink-0" />
            <span className="text-sm text-slate-300 flex-1">未检测到 Codex CLI</span>
            <button
              onClick={loadCodexInfo}
              disabled={codexInfoLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={codexInfoLoading ? "animate-spin" : ""} />
              重新检测
            </button>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/30 p-3 flex items-center justify-between gap-3">
            <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed flex-1">
              {INSTALL_CMD}
            </pre>
            <button
              onClick={handleCopyInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors flex-shrink-0"
            >
              <Copy size={12} />
              {copiedCmd ? "已复制!" : "复制"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            在底部「终端」运行上面的命令安装（需 Node.js）。macOS 也可用 <span className="font-mono text-slate-400">brew install codex</span>。安装后点「重新检测」。
          </p>
        </div>
      )}

      {/* Auth method */}
      <section className={installed ? "" : "opacity-40 pointer-events-none select-none"}>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle icon={KeyRound} label="授权方式" color="text-teal-400" />
          {authed && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-ok/10 text-emerald-ok border border-emerald-ok/20">
              已登录（{codexAuthStatus?.authMethod === "apikey" ? "API Key" : "ChatGPT 订阅"}）
            </span>
          )}
        </div>

        <div className="flex gap-2 mb-3">
          {(["subscription", "apikey"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setAuthMode(m)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                authMode === m
                  ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                  : "border-white/5 text-slate-400 hover:bg-white/5"
              }`}
            >
              {m === "subscription" ? "ChatGPT 订阅登录" : "API Key"}
            </button>
          ))}
        </div>

        {authMode === "subscription" ? (
          <div className="p-3 rounded-xl border border-teal-400/20 bg-teal-400/5 space-y-3">
            <p className="text-xs text-slate-300 leading-relaxed">
              点击下方按钮，会在本机自动打开浏览器登录 ChatGPT 账号完成授权（与命令行 <span className="font-mono text-teal-300">codex login</span> 相同）。
            </p>
            <button
              onClick={handleSubscriptionLogin}
              disabled={codexLoggingIn}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#10a37f] hover:bg-[#0d8f6f] text-white transition-colors shadow-sm disabled:opacity-40"
            >
              {codexLoggingIn
                ? <><Loader2 size={14} className="animate-spin" />等待浏览器授权…</>
                : <><KeyRound size={14} />使用 ChatGPT 订阅登录</>}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={loadCodexAuthStatus}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={12} />检测登录状态
              </button>
              {authed && (
                <button
                  onClick={() => { codexLogout(); setLoginMsg("已退出登录"); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-400 hover:bg-white/5 transition-colors"
                >
                  退出登录
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              若浏览器未自动弹出，也可在底部「终端」手动运行 <span className="font-mono text-teal-300">codex login</span>，完成后点「检测登录状态」。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 pr-10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-400/40 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleApiKeyLogin}
              disabled={codexLoggingIn || !apiKey.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#10a37f] hover:bg-[#0d8f6f] text-white transition-colors shadow-sm disabled:opacity-40"
            >
              {codexLoggingIn
                ? <><Loader2 size={14} className="animate-spin" />保存中…</>
                : <><Save size={14} />保存并登录</>}
            </button>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Key 通过 <span className="font-mono">codex login --with-api-key</span> 写入 ~/.codex/auth.json，不进日志。去{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-sky-link hover:underline">
                OpenAI Platform
              </a>{" "}获取。
            </p>
          </div>
        )}

        {loginMsg && (
          <p className={`mt-2 text-[11px] leading-relaxed ${loginMsg.startsWith("✓") ? "text-emerald-ok" : loginMsg.startsWith("✗") ? "text-rose-err" : "text-slate-400"}`}>
            {loginMsg}
          </p>
        )}
      </section>

      {/* 模型/推理强度不在这里选:统一在对话框右下角的模型按钮 */}
      <div className="flex items-center gap-2 p-3 rounded-xl border border-sky-link/15 bg-sky-link/[0.04]">
        <Cpu size={13} className="text-sky-link flex-shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          GPT 模型与推理强度的切换在<span className="text-sky-link font-medium">对话输入框右下角的模型按钮</span>里(供应商选 OpenAI),这里只负责安装与登录。
        </p>
      </div>

      {/* Test */}
      <div className={`pt-2 border-t border-white/5 space-y-2 ${installed ? "" : "opacity-40 pointer-events-none select-none"}`}>
        <button
          onClick={handleTest}
          disabled={codexTesting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
        >
          {codexTesting
            ? <><Loader2 size={14} className="animate-spin" />测试中（最长 60 秒）...</>
            : <><Zap size={14} />测试连通性</>}
        </button>
        {codexTestResult && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
            codexTestResult.success
              ? "border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok"
              : "border-rose-err/20 bg-rose-err/5 text-rose-err"
          }`}>
            {codexTestResult.success
              ? <CheckCircle size={13} className="mt-0.5 flex-shrink-0" />
              : <XCircle size={13} className="mt-0.5 flex-shrink-0" />}
            <span className="leading-relaxed">
              {testMsg ?? (codexTestResult.error ? `错误：${codexTestResult.error}` : codexTestResult.responseText)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main SettingsPage (modal overlay) ────────────────────────────────────────

export default function SettingsPage() {
  const { setSettingsPageOpen } = useUIStore();
  const { claudeInfo, authStatus, loadClaudeInfo, loadAuthStatus, loadClaudeSettings, codexAuthStatus } = useSystemStore();
  const { engine } = useConfigStore();
  const claudeStatus = useClaudeStatus();

  useEffect(() => {
    loadClaudeInfo();
    loadAuthStatus();
    loadClaudeSettings();
  }, [loadClaudeInfo, loadAuthStatus, loadClaudeSettings]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsPageOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSettingsPageOpen]);

  const step1Done = !!claudeInfo?.installed;

  // 头部状态徽标随所选引擎变化
  const isCodex = engine === "codex";
  const codexReady = !!codexAuthStatus?.authenticated;
  const codexInstalled = !!codexAuthStatus?.installed;

  const statusColor = isCodex
    ? (codexReady ? "bg-emerald-ok" : codexInstalled ? "bg-amber-glow" : "bg-rose-err")
    : (claudeStatus === "ready" ? "bg-emerald-ok" : claudeStatus === "unauthorized" ? "bg-amber-glow" : "bg-rose-err");

  const statusLabel = isCodex
    ? (codexReady ? "就绪" : codexInstalled ? "未登录" : "未安装")
    : (claudeStatus === "ready" ? "就绪" : claudeStatus === "unauthorized" ? "未授权" : "未安装");

  const engineName = isCodex ? "OpenAI Codex" : "Claude Code";

  return (
    /*
     * Absolute overlay — fills exactly the ChatPanel's <main> container.
     * Left sidebar and right panel are NOT affected (they are siblings of <main>).
     */
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: "#13111C" }}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute rounded-full blur-[120px]"
          style={{ top: "-10%", left: "-5%", width: "50%", height: "50%", background: "rgba(76,29,149,0.15)" }} />
        <div className="absolute rounded-full blur-[80px]"
          style={{ bottom: "-10%", right: "-5%", width: "35%", height: "40%", background: "rgba(112,49,35,0.08)" }} />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5 glass-panel">
        <div className="flex items-center gap-2.5">
          <Settings size={15} className="text-amber-glow" />
          <h1 className="text-sm font-semibold text-slate-200 font-display">设置</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Claude status badge */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
            <span>{engineName}：{statusLabel}</span>
            {!isCodex && authStatus?.version && (
              <span className="font-mono text-slate-600">v{authStatus.version}</span>
            )}
            {isCodex && codexAuthStatus?.version && (
              <span className="font-mono text-slate-600">v{codexAuthStatus.version}</span>
            )}
          </div>

          {/* X close button */}
          <button
            onClick={() => setSettingsPageOpen(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 border border-white/5 transition-colors"
            title="关闭 (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-7 space-y-5">

          {/* Terminal hint */}
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <TerminalSquare size={14} className="text-amber-glow flex-shrink-0" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              需要执行命令行操作（如安装 Claude Code）？请点击右侧下方的
              <span className="text-amber-glow font-medium">「终端」</span>
              栏，它是完整的交互式 PTY 终端。
            </p>
          </div>

          {/* ① 模型供应商:唯一的供应商入口,模型切换在对话框右下角 */}
          <div className="rounded-2xl border p-5 border-violet-info/20 bg-violet-info/[0.03]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-full border border-violet-info/40 bg-violet-info/10 flex items-center justify-center flex-shrink-0">
                <Server size={14} className="text-violet-info" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200 font-display">模型供应商</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  展开任意一家配置认证(国产模型填 API Key 即用,端点已内置可改);
                  <span className="text-violet-info">切换供应商和模型在对话输入框右下角的模型按钮</span>
                </p>
              </div>
            </div>
            <ProvidersPanel
              renderProviderExtra={(p) =>
                p.kind === "anthropic-official" ? (
                  <AnthropicTab />
                ) : p.kind === "codex" ? (
                  <CodexCard />
                ) : null
              }
            />
          </div>

          {/* ② Claude Code 环境 + 授权(Anthropic 官方模型用) */}
          <div className={`rounded-2xl border p-5 ${
            step1Done
              ? "border-emerald-ok/15 bg-emerald-ok/[0.03]"
              : "border-amber-glow/20 bg-amber-glow/[0.03]"
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <StepIndicator done={step1Done} number={1} />
              <div>
                <h2 className="text-sm font-semibold text-slate-200 font-display">
                  Claude Code 环境配置
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {step1Done ? "已安装 — 可管理代理和工具" : "安装 Claude Code CLI 并配置代理"}
                </p>
              </div>
            </div>
            <Step1EnvCard done={step1Done} />
          </div>

          {/* ③ 应用更新(仅 Tauri 桌面壳显示;此前误挂在不可达的旧 SettingsModal 里) */}
          <AppUpdatePanel />

        </div>
      </div>
    </div>
  );
}
