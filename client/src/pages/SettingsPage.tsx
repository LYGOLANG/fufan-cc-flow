import { useEffect, useState, type ElementType } from "react";
import { ArrowUpCircle, Globe, Server, Settings, TerminalSquare, X } from "lucide-react";
import AnthropicProviderPanel from "../components/settings/anthropic-provider-panel";
import AppUpdatePanel from "../components/settings/AppUpdatePanel";
import ClaudeCliPanel from "../components/settings/claude-cli-panel";
import CodexProviderPanel from "../components/settings/codex-provider-panel";
import ProvidersPanel, { type ProviderStatusView } from "../components/settings/ProvidersPanel";
import ProxySettingsPanel from "../components/settings/proxy-settings-panel";
import { useSystemStore } from "../stores/systemStore";
import { useUIStore } from "../stores/uiStore";
import type { ProviderInfo } from "../types/provider";

type SettingsSection = "providers" | "network" | "application";

const NAV_ITEMS: { id: SettingsSection; label: string; description: string; icon: ElementType }[] = [
  { id: "providers", label: "模型服务", description: "供应商与认证", icon: Server },
  { id: "network", label: "网络代理", description: "共享连接设置", icon: Globe },
  { id: "application", label: "应用", description: "更新与版本", icon: ArrowUpCircle },
];

export default function SettingsPage() {
  const { setSettingsPageOpen } = useUIStore();
  const {
    claudeInfo, authStatus, codexInfo, codexAuthStatus,
    loadClaudeInfo, loadAuthStatus, loadClaudeSettings,
    loadCodexInfo, loadCodexAuthStatus,
  } = useSystemStore();
  const [section, setSection] = useState<SettingsSection>("providers");

  useEffect(() => {
    loadClaudeInfo();
    loadAuthStatus();
    loadClaudeSettings();
    loadCodexInfo();
    loadCodexAuthStatus();
  }, [loadClaudeInfo, loadAuthStatus, loadClaudeSettings, loadCodexInfo, loadCodexAuthStatus]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsPageOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [setSettingsPageOpen]);

  const claudeReady = !!authStatus?.authenticated;
  const codexReady = !!codexAuthStatus?.authenticated;

  function resolveProviderStatus(provider: ProviderInfo): ProviderStatusView {
    if (provider.kind === "anthropic-official") {
      if (!claudeInfo || !authStatus) return { label: "检测中", tone: "neutral" };
      if (!claudeInfo.installed) return { label: "未安装", tone: "error" };
      return claudeReady ? { label: "已就绪", tone: "ready" } : { label: "未登录", tone: "warning" };
    }
    if (provider.kind === "codex") {
      if (!codexInfo || !codexAuthStatus) return { label: "检测中", tone: "neutral" };
      if (!codexInfo.installed) return { label: "未安装", tone: "error" };
      return codexReady ? { label: "已就绪", tone: "ready" } : { label: "未登录", tone: "warning" };
    }
    return provider.configured
      ? { label: "已配置", tone: "configured" }
      : { label: "未配置", tone: "warning" };
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden" style={{ background: "#13111C" }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div
          className="absolute rounded-full blur-[120px]"
          style={{ top: "-10%", left: "-5%", width: "50%", height: "50%", background: "rgba(76,29,149,0.15)" }}
        />
        <div
          className="absolute rounded-full blur-[80px]"
          style={{ bottom: "-10%", right: "-5%", width: "35%", height: "40%", background: "rgba(112,49,35,0.08)" }}
        />
      </div>

      <header className="relative z-10 flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5 glass-panel">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl border border-amber-glow/20 bg-amber-glow/10 flex items-center justify-center">
            <Settings size={15} className="text-amber-glow" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-200 font-display">设置</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">模型、连接与桌面应用</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsPageOpen(false)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 border border-white/5 transition-colors"
          title="关闭 (Esc)"
        >
          <X size={14} />
        </button>
      </header>

      <div className="relative z-10 flex-1 min-h-0 flex">
        <aside className="w-48 flex-shrink-0 border-r border-white/5 px-3 py-5 bg-black/10 flex flex-col">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    active
                      ? "bg-white/[0.07] border border-white/10 text-white"
                      : "border border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"
                  }`}
                >
                  <Icon size={14} className={active ? "text-amber-glow" : "text-slate-500"} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{item.label}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5 truncate">{item.description}</div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 px-1">运行状态</div>
            <RuntimeStatus label="Claude" ready={claudeReady} />
            <RuntimeStatus label="Codex" ready={codexReady} />
          </div>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-7">
            {section === "providers" && (
              <div className="space-y-5">
                <SectionHeader
                  title="模型服务"
                  description="每个供应商独立管理安装、认证和模型。CLI 已登录时会自动复用，不需要在这里重新登录。"
                />
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
                  <TerminalSquare size={14} className="text-amber-glow flex-shrink-0" />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    安装或登录 CLI 时，可使用右侧下方的<span className="text-amber-glow font-medium">「终端」</span>，也可以直接使用系统终端。
                  </p>
                </div>
                <ProvidersPanel
                  resolveProviderStatus={resolveProviderStatus}
                  renderProviderExtra={(provider) => {
                    if (provider.kind === "anthropic-official") {
                      return (
                        <div className="space-y-6">
                          <ClaudeCliPanel installed={!!claudeInfo?.installed} />
                          <div className="pt-5 border-t border-white/5"><AnthropicProviderPanel /></div>
                        </div>
                      );
                    }
                    if (provider.kind === "codex") return <CodexProviderPanel />;
                    return null;
                  }}
                />
              </div>
            )}

            {section === "network" && (
              <div className="space-y-5">
                <SectionHeader title="网络代理" description="这是一份应用级共享连接设置，不属于 Claude 或任何单一供应商。" />
                <div className="rounded-2xl border border-sky-link/15 bg-sky-link/[0.03] p-5"><ProxySettingsPanel /></div>
              </div>
            )}

            {section === "application" && (
              <div className="space-y-5">
                <SectionHeader title="应用" description="管理 Agent Flow 自身的版本和桌面更新。" />
                <AppUpdatePanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RuntimeStatus({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
      <span className="truncate">{label}</span>
      <span className={ready ? "text-emerald-ok" : "text-slate-600"}>{ready ? "就绪" : "未就绪"}</span>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-100 font-display">{title}</h2>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
    </div>
  );
}
