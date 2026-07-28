import {
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  Zap,
  DollarSign,
  Wifi,
  WifiOff,
  TerminalSquare,
} from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useConfigStore } from "../../stores/configStore";
import { useChatStore } from "../../stores/chatStore";
import { formatCost } from "../../utils/costCalculator";
import ModelSelector from "../manage/ModelSelector";

export default function TopBar() {
  const isRemoteConn = useConnectionStore((s) => s.kind === "remote");
  const { sidebarOpen, toggleSidebar, wsConnected, wsStale, projectPath, setProjectPath, toggleTerminal } =
    useUIStore();
  const model = useConfigStore((s) => s.model);
  const totalCost = useChatStore((s) => s.totalCost);

  return (
    <header className="h-12 flex-shrink-0 flex items-center border-b border-obsidian-700/50 bg-obsidian-800/60 backdrop-blur-sm px-3 gap-3 z-20">
      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded-md hover:bg-obsidian-700/60 text-obsidian-300 hover:text-obsidian-50 transition-colors"
      >
        {sidebarOpen ? (
          <PanelLeftClose size={18} />
        ) : (
          <PanelLeftOpen size={18} />
        )}
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-glow to-amber-dim flex items-center justify-center">
          <Zap size={14} className="text-obsidian-900" />
        </div>
        <span className="font-display font-semibold text-[15px] tracking-tight text-obsidian-50">
          Agent Flow
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-obsidian-700/60" />

      {/* Project path */}
      <button
        onClick={() => {
          const p = window.prompt("项目路径：", projectPath);
          if (p) setProjectPath(p);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono text-obsidian-200 hover:text-obsidian-50 hover:bg-obsidian-700/40 transition-colors max-w-[280px] truncate"
      >
        <Folder size={13} className="flex-shrink-0 text-obsidian-300" />
        {projectPath || "选择项目..."}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Model selector */}
      <ModelSelector />

      {/* Terminal toggle */}
      <button
        onClick={toggleTerminal}
        className="p-1.5 rounded-md hover:bg-obsidian-700/60 text-obsidian-300 hover:text-obsidian-50 transition-colors"
        title="终端"
      >
        <TerminalSquare size={16} />
      </button>

      {/* Cost */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-700/30 text-xs font-mono">
        <DollarSign size={12} className="text-amber-glow" />
        <span className="text-obsidian-100">{formatCost(totalCost)}</span>
      </div>

      {/* Connection status */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
          wsConnected
            ? "text-emerald-ok bg-emerald-ok/5"
            : "text-rose-err bg-rose-err/5"
        }`}
        // 连不上时把「为什么」和「怎么办」说清楚。远程模式下隧道由桌面壳
        // 在启动时建立，它一死就只能重启应用——这时还让用户等"自动重连"
        // 是在浪费他的时间。
        title={
          wsConnected
            ? undefined
            : wsStale
              ? isRemoteConn
                ? "与远程服务器的连接已断开。SSH 隧道在应用启动时建立，断开后需重启应用重建。"
                : "后端多次重连失败。可尝试重启应用；若仍不行，查看应用日志。"
              : "正在重连…"
        }
      >
        {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
        <span className="hidden sm:inline">
          {wsConnected ? "已连接" : wsStale ? "连接已断开" : "重连中…"}
        </span>
      </div>
    </header>
  );
}
