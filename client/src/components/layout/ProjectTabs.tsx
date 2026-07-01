import { useEffect } from "react";
import { Plus, X, Folder } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { openProject, startNewSession } from "../../utils/openProject";

/** Last path segment for a friendly tab label. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Multi-project workspace tabs. Each open project is a tab that remembers its
 * own active session; switching tabs swaps the project (file tree + spawn cwd
 * react to projectPath) and resumes that project's last session. The backend
 * already runs each session's CLI process independently.
 */
export default function ProjectTabs() {
  const {
    openProjects, projectPath,
    setProjectPath, closeOpenProject, setProjectSession, setFolderBrowserOpen,
  } = useUIStore();
  const { currentSessionId, setSessionId } = useChatStore();

  // Remember the active session for the current project, so returning resumes it.
  useEffect(() => {
    if (projectPath) setProjectSession(projectPath, currentSessionId || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, projectPath]);

  // 统一走 openProject:切路径 + 恢复该项目的会话与历史消息。
  const switchToProject = (p: string) => openProject(p);

  function handleClose(e: React.MouseEvent, p: string) {
    e.stopPropagation();
    const remaining = openProjects.filter((x) => x !== p);
    if (p === projectPath) {
      if (remaining.length > 0) {
        switchToProject(remaining[remaining.length - 1]);
      } else {
        setProjectPath("");
        startNewSession();
        setSessionId("");
      }
    }
    closeOpenProject(p);
  }

  if (openProjects.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 h-9 border-b border-white/5 bg-obsidian-900/40 overflow-x-auto flex-shrink-0">
      {openProjects.map((p) => {
        const active = p === projectPath;
        return (
          <button
            key={p}
            onClick={() => switchToProject(p)}
            title={p}
            className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 h-7 rounded-md text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
              active
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            <Folder size={12} className={active ? "text-amber-glow" : "text-slate-500"} />
            <span className="max-w-[140px] truncate">{baseName(p)}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleClose(e, p)}
              className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-rose-err opacity-0 group-hover:opacity-100 transition-opacity"
              title="关闭"
            >
              <X size={11} />
            </span>
          </button>
        );
      })}
      <button
        onClick={() => setFolderBrowserOpen(true)}
        title="添加项目"
        className="flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-white/5 hover:text-amber-glow transition-colors flex-shrink-0"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
