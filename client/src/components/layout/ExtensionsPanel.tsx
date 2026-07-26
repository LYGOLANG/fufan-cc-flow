import { Plug, Zap, Package, Brain, Webhook } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import McpManager from "../manage/McpManager";
import SkillsManager from "../manage/SkillsManager";
import PluginManager from "../manage/PluginManager";
import MemoryManager from "../manage/MemoryManager";
import HooksManager from "../manage/HooksManager";

/**
 * 「拓展」标签页(MCP / 技能 / 插件 / 记忆 / 钩子)。
 *
 * 从 RightPanel 拆出来单独成文件,是为了能被 lazy() 懒加载:这五个管理器
 * 加起来约 2800 行,而右侧栏默认停在「实时监控」,用户不点「拓展」就完全
 * 用不到 —— 原先它们被静态 import,整块躺在首屏主 chunk 里。
 */
type ExtTab = "mcp" | "skills" | "plugins" | "memory" | "hooks";

const EXT_TABS: { id: ExtTab; label: string; icon: typeof Plug }[] = [
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "skills", label: "技能", icon: Zap },
  { id: "plugins", label: "插件", icon: Package },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "hooks", label: "钩子", icon: Webhook },
];

export default function ExtensionsPanel() {
  const { extensionsSubTab: tab, setExtensionsSubTab: setTab } = useUIStore();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sub-tab bar — compact with icons */}
      <div className="flex gap-0 border-b border-white/5 flex-shrink-0 px-2">
        {EXT_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 px-2 py-2 text-xs font-medium transition-all border-b-2 -mb-px ${
              tab === id ? "tab-active" : "tab-inactive"
            }`}
          >
            <Icon size={11} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "mcp" && <McpManager />}
        {tab === "skills" && <SkillsManager />}
        {tab === "plugins" && <PluginManager />}
        {tab === "memory" && <MemoryManager />}
        {tab === "hooks" && <HooksManager />}
      </div>
    </div>
  );
}
