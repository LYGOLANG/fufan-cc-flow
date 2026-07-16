import { useState } from "react";
import { CheckCircle, Loader2, Save, Shield, XCircle, Zap } from "lucide-react";
import { useSystemStore } from "../../stores/systemStore";

export default function ProxySettingsPanel() {
  const {
    proxySettings,
    proxySaving,
    proxySaveError,
    proxyTestResult,
    proxyTesting,
    saveProxy,
    setProxySettings,
    testProxy,
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
      const parts = raw.replace(/^https?:\/\//, "").split(":");
      testProxy(parts[0], parseInt(parts[1] || "7890", 10));
    }
  }

  const canTest = !!(proxySettings.httpsProxy || proxySettings.httpProxy);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className="text-sky-link" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          代理设置
        </span>
      </div>
      <p className="text-[11px] text-amber-glow/80 mb-3 leading-relaxed">
        Claude CLI 支持 HTTP/HTTPS
        代理；保存后也会供支持它们的模型供应商使用。不需要代理时保持为空即可。
      </p>

      <div className="space-y-2.5">
        {(["httpProxy", "httpsProxy"] as const).map((key) => (
          <div key={key}>
            <label className="block text-xs text-slate-400 mb-1">
              {key === "httpProxy" ? "HTTP 代理" : "HTTPS 代理"}
            </label>
            <input
              type="text"
              value={proxySettings[key]}
              onChange={(event) =>
                setProxySettings({
                  ...proxySettings,
                  [key]: event.target.value,
                })
              }
              placeholder="http://127.0.0.1:7890"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-glow/40 transition-colors font-mono"
            />
          </div>
        ))}

        <div className="flex flex-wrap gap-2 pt-1">
          {[
            {
              label: "Clash (7890)",
              http: "http://127.0.0.1:7890",
              https: "http://127.0.0.1:7890",
            },
            {
              label: "V2Ray (10809)",
              http: "http://127.0.0.1:10809",
              https: "http://127.0.0.1:10809",
            },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() =>
                setProxySettings({
                  httpProxy: preset.http,
                  httpsProxy: preset.https,
                  socksProxy: "",
                })
              }
              className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() =>
              setProxySettings({
                httpProxy: "",
                httpsProxy: "",
                socksProxy: "",
              })
            }
            className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            清空
          </button>
        </div>

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
            {proxyTesting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Zap size={12} />
            )}
            测试代理
          </button>
          {saveMsg && (
            <span className="text-xs text-emerald-ok">{saveMsg}</span>
          )}
          {!proxySaving && proxySaveError && (
            <span className="text-xs text-rose-err">{proxySaveError}</span>
          )}
        </div>

        {proxyTestResult && (
          <div
            className={`flex flex-col gap-1 text-xs px-3 py-2 rounded-lg border ${
              proxyTestResult.success
                ? "border-emerald-ok/20 bg-emerald-ok/5"
                : "border-rose-err/20 bg-rose-err/5"
            }`}
          >
            <div
              className={`flex items-center gap-2 ${proxyTestResult.success ? "text-emerald-ok" : "text-rose-err"}`}
            >
              {proxyTestResult.success ? (
                <CheckCircle size={12} />
              ) : (
                <XCircle size={12} />
              )}
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
