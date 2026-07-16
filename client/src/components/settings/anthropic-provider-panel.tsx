import { useEffect, useRef, useState } from "react";
import { CheckCircle, Eye, EyeOff, Info, KeyRound, Loader2, RefreshCw, XCircle, Zap } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";
import { useSystemStore } from "../../stores/systemStore";
import SettingsSectionTitle from "./settings-section-title";

export default function AnthropicProviderPanel() {
  const {
    proxySettings, authStatus, claudeTesting, claudeTestResult,
    availableModels, loadModels, saveClaudeSettings, testClaude, loadAuthStatus,
  } = useSystemStore();
  const { apiKey, setApiKey, model } = useConfigStore();
  const [authMode, setAuthMode] = useState<"apikey" | "oauth">(
    authStatus?.authMethod === "oauth" ? "oauth" : "apikey",
  );
  const authSyncedRef = useRef(false);
  const [showKey, setShowKey] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const displayedTestMessage = testMsg ?? claudeTestResult?.error ?? claudeTestResult?.responseText;
  const displayedTestTone = testMsg
    ? testMsg.startsWith("✓") || testMsg.startsWith("已清除") ? "success" : testMsg.startsWith("✗") ? "error" : "neutral"
    : claudeTestResult?.success ? "success" : "error";

  useEffect(() => {
    if (!authSyncedRef.current && authStatus && authStatus.authMethod !== "none") {
      setAuthMode(authStatus.authMethod === "oauth" ? "oauth" : "apikey");
      authSyncedRef.current = true;
    }
  }, [authStatus]);

  useEffect(() => {
    if (availableModels.length === 0) loadModels();
  }, [availableModels.length, loadModels]);

  async function handleTestAndSave() {
    setTestMsg(null);
    if (authMode === "apikey" && !apiKey.trim()) {
      setTestMsg("请输入新的 API Key 后再测试；已保存的 Key 不会回传到界面。当前状态为“已就绪”时无需重复测试。");
      return;
    }
    const result = await testClaude({
      apiKey: authMode === "apikey" ? apiKey : undefined,
      model,
      httpProxy: proxySettings.httpProxy || undefined,
      httpsProxy: proxySettings.httpsProxy || undefined,
    });
    if (!result.success) {
      setTestMsg(`✗ 测试失败：${result.error || "未知错误"}`);
      return;
    }
    if (authMode === "apikey") await saveClaudeSettings({ ANTHROPIC_API_KEY: apiKey });
    setTestMsg(`✓ 就绪！回复: "${result.responseText.slice(0, 40)}" (${result.latency}ms)`);
    await loadAuthStatus();
    await loadModels();
  }

  async function handleClearSavedKey() {
    if (!window.confirm("确定清除已保存的 Anthropic API Key？清除后将改用 Claude CLI 的终端登录状态。")) return;
    await saveClaudeSettings({ ANTHROPIC_API_KEY: "" });
    setApiKey("");
    await loadAuthStatus();
    setTestMsg("已清除保存的 API Key");
  }

  return (
    <div className="space-y-5">
      <div className={`flex items-center gap-3 p-3 rounded-xl border ${
        authStatus?.authenticated ? "border-emerald-ok/20 bg-emerald-ok/5" : "border-amber-glow/20 bg-amber-glow/5"
      }`}>
        {authStatus?.authenticated
          ? <CheckCircle size={16} className="text-emerald-ok flex-shrink-0" />
          : <Info size={16} className="text-amber-glow flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-200">
            {authStatus?.authenticated
              ? `已就绪 · ${authStatus.authMethod === "apikey" ? "API Key" : "Claude.ai 终端登录"}`
              : "尚未检测到登录"}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {authStatus?.authenticated
              ? "已自动复用 Claude CLI 的认证，无需在 Agent Flow 重复登录。"
              : "可使用 Claude.ai 订阅登录，也可单独配置 Anthropic API Key。"}
          </div>
        </div>
        <button
          onClick={loadAuthStatus}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={11} />重新检测
        </button>
      </div>

      <section>
        <SettingsSectionTitle icon={KeyRound} label="授权方式" color="text-emerald-ok" />
        <div className="flex gap-2 mb-3">
          {(["apikey", "oauth"] as const).map((modeOption) => (
            <button
              key={modeOption}
              onClick={() => setAuthMode(modeOption)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                authMode === modeOption
                  ? "border-emerald-ok/30 bg-emerald-ok/10 text-emerald-ok"
                  : "border-white/5 text-slate-400 hover:bg-white/5"
              }`}
            >
              {modeOption === "apikey" ? "API Key" : "OAuth（claude.ai 账号）"}
            </button>
          ))}
        </div>

        {authMode === "apikey" ? (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={authStatus?.authMethod === "apikey" ? "已保存（输入新 Key 可替换）" : "sk-ant-api03-..."}
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
              Key 只写入本机 ~/.claude/settings.json，不会回传到界面。输入新值后可测试并替换。去{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-sky-link hover:underline">
                Anthropic Console
              </a>{" "}获取 API Key。
            </p>
            {authStatus?.authMethod === "apikey" && (
              <button onClick={handleClearSavedKey} className="text-[11px] text-rose-err/80 hover:text-rose-err transition-colors">
                清除已保存的 API Key
              </button>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-violet-info/20 bg-violet-info/5 space-y-2">
            {authStatus?.authenticated && authStatus.authMethod === "oauth" ? (
              <p className="text-xs text-emerald-ok leading-relaxed">已从 Claude CLI 检测到 Claude.ai 登录。这里不保存第二份凭证，也不会要求再次认证。</p>
            ) : (
              <>
                <p className="text-xs text-slate-300 leading-relaxed">在任意系统终端运行以下命令并完成浏览器授权：</p>
                <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2 font-mono text-xs text-violet-info">claude auth login</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">登录完成后点击上方「重新检测」。Agent Flow 会直接复用 CLI 登录状态。</p>
              </>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 p-3 rounded-xl border border-purple-bright/15 bg-purple-glow/[0.04]">
        <Zap size={13} className="text-purple-bright flex-shrink-0" />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          模型、推理力度、扩展思考的切换都在<span className="text-purple-bright font-medium">对话输入框右下角的模型按钮</span>里；这里管理供应商连接。
        </p>
      </div>

      <div className="pt-2 border-t border-white/5 space-y-2">
        <button
          onClick={handleTestAndSave}
          disabled={claudeTesting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#ca5d3d] hover:bg-amber-glow text-white transition-colors shadow-sm disabled:opacity-40"
        >
          {claudeTesting
            ? <><Loader2 size={14} className="animate-spin" />测试中（最长 30 秒）...</>
            : <><Zap size={14} />{authMode === "apikey" ? "测试并保存" : "测试连通性"}</>}
        </button>
        {displayedTestMessage && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
            displayedTestTone === "success"
              ? "border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok"
              : displayedTestTone === "error"
                ? "border-rose-err/20 bg-rose-err/5 text-rose-err"
                : "border-amber-glow/20 bg-amber-glow/5 text-amber-glow"
          }`}>
            {displayedTestTone === "success"
              ? <CheckCircle size={13} />
              : displayedTestTone === "error" ? <XCircle size={13} /> : <Info size={13} />}
            <span className="leading-relaxed">{displayedTestMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
