import { Clock, Plus, Zap } from "lucide-react";
import MessageList from "./MessageList";
import InputBar from "./InputBar";
import { useChatStore } from "../../stores/chatStore";
import { useUIStore } from "../../stores/uiStore";
import { useSystemStore } from "../../stores/systemStore";
import { useConfigStore } from "../../stores/configStore";
import { useProviderStore } from "../../stores/providerStore";
import { useClaudeStatus } from "../../hooks/useClaudeStatus";
import { startNewSession } from "../../utils/openProject";
import SettingsPage from "../../pages/SettingsPage";

export default function ChatPanel() {
  const { currentSessionId, isStreaming, messages } = useChatStore();
  const { setHistoryModalOpen, wsConnected, setSettingsPageOpen, settingsPageOpen, projectPath, setFolderBrowserOpen } = useUIStore();
  const { claudeInfo, authStatus } = useSystemStore();
  const claudeStatus = useClaudeStatus();
  // 状态标签跟随当前供应商:非 Anthropic 时显示对应供应商名,而不是固定 Claude Code
  const providerId = useConfigStore((s) => s.providerId);
  const engine = useConfigStore((s) => s.engine);
  const providers = useProviderStore((s) => s.providers);
  const currentProvider = providers.find((p) => p.id === providerId);
  const isCodexProvider = engine === "codex" || providerId === "openai" || currentProvider?.kind === "codex";
  const isNonAnthropic = isCodexProvider || (!!currentProvider && currentProvider.kind !== "anthropic-official");
  const providerName = currentProvider?.name || (isCodexProvider ? "OpenAI (Codex)" : providerId);
  const providerConfigured = currentProvider?.configured ?? true;

  // Use last user message as task title
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const taskTitle = lastUserMsg
    ? lastUserMsg.content.slice(0, 55) + (lastUserMsg.content.length > 55 ? "…" : "")
    : "新对话";

  const handleNewTask = () => {
    if (isStreaming) return;
    startNewSession();
    if (!projectPath) {
      setFolderBrowserOpen(true);
    }
  };

  const handleOpenSettings = () => setSettingsPageOpen(true);

  // Status dot: 3-state
  const dotColor =
    claudeStatus === "ready"         ? "bg-emerald-ok"
    : claudeStatus === "unauthorized" ? "bg-amber-glow"
    : "bg-rose-err";

  const version = authStatus?.version ?? claudeInfo?.version;

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 relative border-r border-white/5">

      {/* ── Task header ── */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0 glass-panel">
        {/* Left: title + status */}
        <div className="flex flex-col min-w-0 flex-1 mr-4">
          <h2 className="text-base font-display font-semibold text-white leading-tight truncate">
            {taskTitle}
          </h2>
          {/* pl-1.5: overflow-hidden 会把 agent-pulse-ring 向左扩散的光环裁掉(左半边被遮),
              padding 在裁剪盒内给光环留 6px 呼吸空间,同时让状态行相对标题右移一点 */}
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 min-w-0 overflow-hidden whitespace-nowrap pl-1.5">
            {isStreaming ? (
              <>
                <span className="agent-pulse-ring w-2 h-2 rounded-full bg-emerald-ok flex-shrink-0" />
                <span>Agent 运行中</span>
              </>
            ) : !wsConnected ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-err" />
                <Zap size={11} className="flex-shrink-0" />
                <span>未连接</span>
              </>
            ) : isNonAnthropic ? (
              <button
                onClick={handleOpenSettings}
                className={`flex items-center gap-2 transition-colors hover:opacity-80 ${
                  providerConfigured ? "text-slate-400" : "text-amber-glow"
                }`}
                title="点击打开设置"
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  providerConfigured ? "bg-emerald-ok" : "bg-amber-glow"
                }`} />
                <Zap size={11} className="flex-shrink-0" />
                <span>
                  {providerName}
                  {providerConfigured ? "" : " · 未配置 →"}
                </span>
              </button>
            ) : (
              <button
                onClick={handleOpenSettings}
                className={`flex items-center gap-2 transition-colors hover:opacity-80 ${
                  claudeStatus === "ready"         ? "text-slate-400"
                  : claudeStatus === "unauthorized" ? "text-amber-glow"
                  : "text-rose-err"
                }`}
                title="点击打开设置"
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                <Zap size={11} className="flex-shrink-0" />
                <span>
                  {claudeStatus === "ready"
                    ? <>Claude Code{version && <span className="ml-1 font-mono text-slate-500">v{version}</span>}</>
                    : claudeStatus === "unauthorized"
                      ? "已安装，需授权 →"
                      : "未安装 Claude Code →"
                  }
                </span>
              </button>
            )}
            {currentSessionId && (
              <>
                <span className="text-slate-600">•</span>
                <span className="font-mono text-slate-500">
                  ID: #{currentSessionId.slice(0, 8)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: history + new task */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setHistoryModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 text-slate-300 hover:text-white text-sm font-medium transition-colors"
            title="历史会话"
          >
            <Clock size={15} />
            <span>历史会话</span>
          </button>
          <button
            onClick={handleNewTask}
            disabled={isStreaming}
            className="flex items-center gap-2 bg-[#ca5d3d] hover:bg-amber-glow text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-lg shadow-[#703123]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>新建任务</span>
          </button>
        </div>
      </header>

      {/* ── Message list ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <MessageList />
      </div>

      {/* ── Input bar ── */}
      <InputBar />

      {/* ── Settings overlay — covers only this center panel ── */}
      {settingsPageOpen && <SettingsPage />}
    </main>
  );
}
