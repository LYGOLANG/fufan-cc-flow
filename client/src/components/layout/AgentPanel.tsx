import { useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import AgentManager from "../agent/AgentManager";
import SubAgentTree from "../agent/SubAgentTree";
import BackgroundTasks from "../agent/BackgroundTasks";
import WorkflowManager from "../agent/WorkflowManager";
import TeamPanel from "../agent/TeamPanel";
import AuditLog from "../agent/AuditLog";

/**
 * 「Agent」标签页(管理 / 执行树 / 后台任务 / 工作流 / 团队 / 审计)。
 *
 * 从 RightPanel 拆出来单独成文件,是为了能被 lazy() 懒加载:这一组约 1900 行
 * 加上 4 个专属 store,而右侧栏默认停在「实时监控」,不点进来就用不到。
 */
type AgentTab = "manager" | "tree" | "tasks" | "workflows" | "teams" | "audit";

const AGENT_TABS: { id: AgentTab; label: string }[] = [
  { id: "manager", label: "Agent 管理" },
  { id: "tree", label: "执行树" },
  { id: "tasks", label: "后台任务" },
  { id: "workflows", label: "工作流" },
  { id: "teams", label: "团队" },
  { id: "audit", label: "审计" },
];

export default function AgentPanel() {
  const [tab, setTab] = useState<AgentTab>("manager");
  // 注意订阅的是派生出的「数量」而非数组:返回新数组会让 zustand 的
  // useSyncExternalStore 每次快照都判定为变化,触发 React error #185。
  const runningTaskCount = useAgentStore(
    (s) => s.backgroundTasks.filter((t) => t.status === "running").length
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sub-tab bar */}
      <div className="flex gap-0 border-b border-white/5 flex-shrink-0 px-3">
        {AGENT_TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium transition-all border-b-2 -mb-px flex items-center gap-1 ${
              tab === id ? "tab-active" : "tab-inactive"
            }`}
          >
            {label}
            {id === "tasks" && runningTaskCount > 0 && (
              <span className="ml-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-amber-glow/20 text-amber-glow text-[9px] font-bold px-1">
                {runningTaskCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "manager" && <AgentManager />}
        {tab === "tree" && <SubAgentTree />}
        {tab === "tasks" && <BackgroundTasks />}
        {tab === "workflows" && <WorkflowManager />}
        {tab === "teams" && <TeamPanel />}
        {tab === "audit" && <AuditLog />}
      </div>
    </div>
  );
}
