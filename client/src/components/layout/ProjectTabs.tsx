import { useEffect, useState } from "react";
import { Plus, X, Folder, Loader2, CheckCircle } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { openProject, startNewSession, dropProjectChatState } from "../../utils/openProject";
import { wsService } from "../../services/websocket";
import {
  api,
  type ProjectInitDecision,
  type ProjectInitPreview,
} from "../../services/api";
import ProjectInitConfirmModal from "../modals/ProjectInitConfirmModal";

/** Last path segment for a friendly tab label. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function getObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function formatProjectInitError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const details = getObject((err as { details?: unknown }).details);
  if (!details) return message;

  const lines = [message];
  const copied = Array.isArray(details.copied) ? details.copied : [];
  if (copied.length > 0) {
    const copiedText = copied
      .map((item) => {
        const data = getObject(item);
        if (!data || typeof data.name !== "string") return null;
        const action = data.action === "skipped" ? "跳过" : "复制";
        return `${data.name}(${action})`;
      })
      .filter((item): item is string => item !== null)
      .join("、");
    if (copiedText) lines.push(`已处理: ${copiedText}`);
  }

  const failed = getObject(details.failed);
  if (failed && typeof failed.name === "string") {
    lines.push(`失败项: ${failed.name}`);
  }

  const skippedRemaining = Array.isArray(details.skippedRemaining)
    ? details.skippedRemaining.filter((item): item is string => typeof item === "string")
    : [];
  if (skippedRemaining.length > 0) {
    lines.push(`未执行: ${skippedRemaining.join("、")}`);
  }

  return lines.join("\n");
}

/**
 * Multi-project workspace tabs. Each open project is a tab that remembers its
 * own active session; switching tabs swaps the project (file tree + spawn cwd
 * react to projectPath) and resumes that project's last session. The backend
 * already runs each session's CLI process independently.
 */
export default function ProjectTabs() {
  const {
    openProjects, projectPath, busyProjects, projectsAwaitingPermission,
    setProjectPath, closeOpenProject, setProjectSession,
  } = useUIStore();
  const { currentSessionId, setSessionId } = useChatStore();
  const [initTargetPath, setInitTargetPath] = useState<string | null>(null);
  const [initPreview, setInitPreview] = useState<ProjectInitPreview | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initToast, setInitToast] = useState<string | null>(null);

  // Remember the active session for the current project, so returning resumes it.
  useEffect(() => {
    if (projectPath) setProjectSession(projectPath, currentSessionId || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, projectPath]);

  useEffect(() => {
    if (!initToast) return undefined;
    const timer = window.setTimeout(() => setInitToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [initToast]);

  // 统一走 openProject:切路径 + 恢复该项目的会话与历史消息。
  const switchToProject = (p: string) => openProject(p);

  const resetProjectInit = () => {
    if (initBusy) return;
    setInitTargetPath(null);
    setInitPreview(null);
    setInitError(null);
  };

  const finishProjectInit = async (targetPath: string, decisions: ProjectInitDecision[]) => {
    setInitBusy(true);
    setInitError(null);
    try {
      const result = await api.initProject(targetPath, decisions);
      await openProject(result.targetPath);
      setInitToast(`项目初始化完成: ${baseName(result.targetPath)}`);
      setInitTargetPath(null);
      setInitPreview(null);
    } catch (err) {
      setInitError(formatProjectInitError(err));
    } finally {
      setInitBusy(false);
    }
  };

  const handleCreateProject = async () => {
    if (initBusy) return;
    setInitBusy(true);
    setInitError(null);
    setInitPreview(null);
    setInitTargetPath(null);
    try {
      const picked = await api.systemApi.pickFolder();
      if (!picked.path) return;

      setInitTargetPath(picked.path);
      const preview = await api.previewProjectInit(picked.path);
      if (!preview.hasConflicts && !preview.hasMissing) {
        await finishProjectInit(preview.targetPath, []);
        return;
      }
      setInitPreview(preview);
    } catch (err) {
      setInitError(formatProjectInitError(err));
    } finally {
      setInitBusy(false);
    }
  };

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
    // 关闭标签 = 明确结束该项目:断开其连接,服务端随之收尾正在跑的任务
    wsService.closeProject(p);
    dropProjectChatState(p);
    closeOpenProject(p);
  }

  return (
    <div className="flex items-center gap-1 px-2 h-9 border-b border-white/5 bg-obsidian-900/40 overflow-x-auto flex-shrink-0">
      {openProjects.map((p) => {
        const active = p === projectPath;
        const busy = busyProjects.includes(p);
        const awaitingPermission = projectsAwaitingPermission.includes(p);
        return (
          <button
            key={p}
            onClick={() => switchToProject(p)}
            title={awaitingPermission ? `${p}（等待权限确认）` : busy ? `${p}（任务运行中）` : p}
            className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 h-7 rounded-md text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
              active
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {awaitingPermission ? (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-glow flex-shrink-0 agent-pulse-ring"
                title="等待权限确认——点此切回处理"
              />
            ) : busy ? (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-ok flex-shrink-0 agent-pulse-ring"
                title="任务运行中"
              />
            ) : (
              <Folder size={12} className={active ? "text-amber-glow" : "text-slate-500"} />
            )}
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
        onClick={handleCreateProject}
        title="添加并初始化项目"
        disabled={initBusy}
        className="flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-white/5 hover:text-amber-glow transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {initBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
      </button>
      <ProjectInitConfirmModal
        targetPath={initTargetPath}
        preview={initPreview}
        error={initError}
        busy={initBusy}
        onCancel={resetProjectInit}
        onConfirm={(decisions) => {
          if (initPreview) void finishProjectInit(initPreview.targetPath, decisions);
        }}
      />
      {initToast && (
        <div className="fixed top-12 right-4 z-50 flex items-center gap-2 rounded-lg border border-emerald-ok/20 bg-obsidian-800/95 px-3 py-2 text-xs text-emerald-ok shadow-xl shadow-black/30">
          <CheckCircle size={14} />
          <span>{initToast}</span>
        </div>
      )}
    </div>
  );
}
