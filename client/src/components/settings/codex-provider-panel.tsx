import { useEffect, useState } from "react";
import {
  CheckCircle, Copy, Cpu, Eye, EyeOff, KeyRound,
  Loader2, RefreshCw, Save, XCircle, Zap,
} from "lucide-react";
import { useSystemStore } from "../../stores/systemStore";
import SettingsSectionTitle from "./settings-section-title";

const INSTALL_COMMAND = "npm install -g @openai/codex";

export default function CodexProviderPanel() {
  const {
    codexInfo, codexInfoLoading, codexAuthStatus, codexLoggingIn,
    codexTestResult, codexTesting, loadCodexInfo, loadCodexAuthStatus,
    codexSubscriptionLogin, codexLoginApiKey, codexLogout, testCodex,
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

  useEffect(() => {
    if (codexAuthStatus?.authMethod === "apikey") setAuthMode("apikey");
    else if (codexAuthStatus?.authMethod === "chatgpt") setAuthMode("subscription");
  }, [codexAuthStatus]);

  const installed = !!codexInfo?.installed;
  const authenticated = !!codexAuthStatus?.authenticated;

  async function handleCopyInstall() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  }

  async function handleSubscriptionLogin() {
    setLoginMsg("正在打开浏览器完成 ChatGPT 授权，请在弹出的页面中登录…（最长 3 分钟）");
    const result = await codexSubscriptionLogin();
    setLoginMsg(result.success
      ? result.alreadyLoggedIn ? "✓ 已登录（ChatGPT 订阅）" : "✓ 订阅登录成功！"
      : `✗ 登录未完成：${(result.output || "请重试").slice(0, 220)}`);
  }

  async function handleApiKeyLogin() {
    if (!apiKey.trim()) return;
    setLoginMsg("正在写入 API Key…");
    const result = await codexLoginApiKey(apiKey.trim());
    setApiKey("");
    setLoginMsg(result.success ? "✓ API Key 已保存并登录" : `✗ 失败：${(result.output || "").slice(0, 220)}`);
  }

  async function handleLogout() {
    if (!window.confirm("确定退出 Codex 登录？退出后需要重新登录才能继续使用 OpenAI Codex。")) return;
    try {
      await codexLogout();
      setLoginMsg("已退出登录");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoginMsg(`✗ 退出登录失败：${message.slice(0, 180)}`);
    }
  }

  async function handleTest() {
    setTestMsg(null);
    const result = await testCodex();
    setTestMsg(result.success
      ? `✓ 就绪！回复: "${result.responseText.slice(0, 40)}" (${result.latency}ms)`
      : `✗ 测试失败：${result.error || "未知错误"}`);
  }

  return (
    <div className="space-y-5">
      {installed ? (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-ok/20 bg-emerald-ok/5">
          <CheckCircle size={16} className="text-emerald-ok flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-slate-200">已安装 Codex CLI</span>
            {codexInfo?.version && <span className="ml-2 text-xs font-mono text-slate-500">v{codexInfo.version}</span>}
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
              <RefreshCw size={12} className={codexInfoLoading ? "animate-spin" : ""} />重新检测
            </button>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/30 p-3 flex items-center justify-between gap-3">
            <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed flex-1">{INSTALL_COMMAND}</pre>
            <button
              onClick={handleCopyInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors flex-shrink-0"
            >
              <Copy size={12} />{copiedCmd ? "已复制!" : "复制"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">在「终端」运行上面的命令安装（需 Node.js）。macOS 也可用 <span className="font-mono text-slate-400">brew install codex</span>。</p>
        </div>
      )}

      <section className={installed ? "" : "opacity-40 pointer-events-none select-none"}>
        <div className="flex items-center justify-between mb-3">
          <SettingsSectionTitle icon={KeyRound} label="授权方式" color="text-teal-400" />
          {authenticated && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-ok/10 text-emerald-ok border border-emerald-ok/20">
              已登录（{codexAuthStatus?.authMethod === "apikey" ? "API Key" : "ChatGPT 订阅"}）
            </span>
          )}
        </div>
        <div className="flex gap-2 mb-3">
          {(["subscription", "apikey"] as const).map((modeOption) => (
            <button
              key={modeOption}
              onClick={() => setAuthMode(modeOption)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                authMode === modeOption
                  ? "border-teal-400/30 bg-teal-400/10 text-teal-300"
                  : "border-white/5 text-slate-400 hover:bg-white/5"
              }`}
            >
              {modeOption === "subscription" ? "ChatGPT 订阅登录" : "API Key"}
            </button>
          ))}
        </div>

        {authMode === "subscription" ? (
          <div className="p-3 rounded-xl border border-teal-400/20 bg-teal-400/5 space-y-3">
            {authenticated && codexAuthStatus?.authMethod === "chatgpt" ? (
              <p className="text-xs text-emerald-ok leading-relaxed">已自动复用 Codex CLI 的 ChatGPT 终端登录，无需再次认证。</p>
            ) : (
              <>
                <p className="text-xs text-slate-300 leading-relaxed">点击下方按钮会调用本机 <span className="font-mono text-teal-300">codex login</span> 并打开浏览器授权。</p>
                <button
                  onClick={handleSubscriptionLogin}
                  disabled={codexLoggingIn}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#10a37f] hover:bg-[#0d8f6f] text-white transition-colors shadow-sm disabled:opacity-40"
                >
                  {codexLoggingIn
                    ? <><Loader2 size={14} className="animate-spin" />等待浏览器授权…</>
                    : <><KeyRound size={14} />使用 ChatGPT 订阅登录</>}
                </button>
              </>
            )}
            <div className="flex items-center gap-2">
              <button onClick={loadCodexAuthStatus} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-300 hover:bg-white/5 transition-colors">
                <RefreshCw size={12} />检测登录状态
              </button>
              {authenticated && <button onClick={handleLogout} className="px-3 py-1.5 rounded-lg text-xs border border-rose-err/20 text-rose-err hover:bg-rose-err/10">退出登录</button>}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 pr-10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-teal-400/40 transition-colors font-mono"
              />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300">
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleApiKeyLogin}
              disabled={codexLoggingIn || !apiKey.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#10a37f] hover:bg-[#0d8f6f] text-white transition-colors shadow-sm disabled:opacity-40"
            >
              {codexLoggingIn ? <><Loader2 size={14} className="animate-spin" />保存中…</> : <><Save size={14} />保存并登录</>}
            </button>
            <p className="text-[11px] text-slate-500 leading-relaxed">Key 通过 <span className="font-mono">codex login --with-api-key</span> 从 stdin 写入，不进入命令行或日志。</p>
          </div>
        )}
        {loginMsg && <p className={`mt-2 text-[11px] ${loginMsg.startsWith("✓") ? "text-emerald-ok" : loginMsg.startsWith("✗") ? "text-rose-err" : "text-slate-400"}`}>{loginMsg}</p>}
      </section>

      <div className="flex items-center gap-2 p-3 rounded-xl border border-sky-link/15 bg-sky-link/[0.04]">
        <Cpu size={13} className="text-sky-link flex-shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">GPT 模型与推理强度在<span className="text-sky-link font-medium">对话输入框右下角的模型按钮</span>切换；这里管理供应商连接。</p>
      </div>

      <div className={`pt-2 border-t border-white/5 space-y-2 ${installed ? "" : "opacity-40 pointer-events-none select-none"}`}>
        <button
          onClick={handleTest}
          disabled={codexTesting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
        >
          {codexTesting ? <><Loader2 size={14} className="animate-spin" />测试中（最长 60 秒）...</> : <><Zap size={14} />测试连通性</>}
        </button>
        {testMsg && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
            testMsg.startsWith("✓")
              ? "border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok"
              : "border-rose-err/20 bg-rose-err/5 text-rose-err"
          }`}>
            {testMsg.startsWith("✓") ? <CheckCircle size={13} /> : <XCircle size={13} />}
            <span>{testMsg}</span>
          </div>
        )}
        {!testMsg && codexTestResult?.error && <p className="text-xs text-rose-err">{codexTestResult.error}</p>}
      </div>
    </div>
  );
}
