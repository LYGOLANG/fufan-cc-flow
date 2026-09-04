import { useEffect, useState } from "react";
import { Plus, X, Folder, FolderPlus, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
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
    setProjectPath, closeOpenProject, setProjectSession, pickFolderInApp,
  } = useUIStore();
  const { currentSessionId, setSessionId } = useChatStore();
  const [initTargetPath, setInitTargetPath] = useState<string | null>(null);
  const [initPreview, setInitPreview] = useState<ProjectInitPreview | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initToast, setInitToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // 标签右键菜单——「初始化 Agent 模板」的唯一入口。
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Remember the active session for the current project, so returning resumes it.
  useEffect(() => {
    if (projectPath) setProjectSession(projectPath, currentSessionId || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, projectPath]);

  useEffect(() => {
    if (!initToast) return undefined;
    const timer = window.setTimeout(() => setInitToast(null), initToast.kind === "err" ? 6000 : 3200);
    return () => window.clearTimeout(timer);
  }, [initToast]);

  useEffect(() => {
    if (!tabMenu) return undefined;
    const close = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

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
      setInitToast({ kind: "ok", text: `Agent 模板已写入: ${baseName(result.targetPath)}` });
      setInitTargetPath(null);
      setInitPreview(null);
    } catch (err) {
      setInitError(formatProjectInitError(err));
    } finally {
      setInitBusy(false);
    }
  };

  const handleAddProject = async () => {
    if (initBusy) return;
    setInitBusy(true);
    try {
      // 系统原生目录框弹在**后端所在机器**上。远程连到 headless 服务器时那台
      // 机器没有图形环境,后端会回 unavailable —— 此时改用应用内目录浏览,
      // 而不是让用户对着一个什么也不会发生的按钮发呆。
      const picked = await api.systemApi.pickFolder();
      let targetPath = picked.path;
      if (!targetPath && picked.unavailable) {
        targetPath = await pickFolderInApp();
      }
      if (!targetPath) return;

      // 添加项目只做一件事：打开它。目录里一个字节都不写。
      //
      // Agent 模板（.claude/ 含 code-reviewer、evolution-runner 两个 Agent、
      // .codex/、.agents/、AGENTS.md）曾经在这一步自动落盘——先是「没冲突就
      // 直接写」，后改成「先弹预览」，用户三次说的都是「去掉」，不是「先问我」。
      // 现在只能从标签右键「初始化 Agent 模板…」显式触发，且仍先预览再确认。
      await openProject(targetPath);
    } catch (err) {
      setInitToast({ kind: "err", text: formatProjectInitError(err) });
    } finally {
      setInitBusy(false);
    }
  };

  const handleInitTemplate = async (targetPath: string) => {
    if (initBusy) return;
    setTabMenu(null);
    setInitBusy(true);
    setInitError(null);
    setInitPreview(null);
    setInitTargetPath(targetPath);
    try {
      // 往别人的目录里写文件是有后果的动作：永远先给用户看会写什么，再由他点确认。
      const preview = await api.previewProjectInit(targetPath);
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
            onContextMenu={(e) => {
              e.preventDefault();
              setTabMenu({ x: e.clientX, y: e.clientY, path: p });
            }}
            title={awaitingPermission ? `${p}（等待权限确认）` : busy ? `${p}（任务运行中）` : `${p}（右键：初始化 Agent 模板）`}
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
        onClick={handleAddProject}
        title="添加项目（只打开，不写入任何文件）"
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
      {tabMenu && (
        <div
          className="fixed z-50 min-w-[180px] py-1 rounded-lg border border-white/10 shadow-xl"
          style={{
            left: Math.min(tabMenu.x, window.innerWidth - 200),
            top: tabMenu.y,
            background: "rgba(24,22,34,0.95)",
            backdropFilter: "blur(12px)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 pt-1 pb-1.5 text-[11px] text-slate-500 truncate max-w-[260px]" title={tabMenu.path}>
            {baseName(tabMenu.path)}
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/8 transition-colors text-left"
            onClick={() => void handleInitTemplate(tabMenu.path)}
          >
            <FolderPlus size={12} className="text-amber-glow" /> 初始化 Agent 模板…
          </button>
        </div>
      )}
      {initToast && (
        <div
          className={`fixed top-12 right-4 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl shadow-black/30 ${
            initToast.kind === "err"
              ? "border-rose-err/20 text-rose-err"
              : "border-emerald-ok/20 text-emerald-ok"
          }`}
          style={{ background: "rgba(24,22,34,0.95)" }}
        >
          {initToast.kind === "err" ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
          <span className="whitespace-pre-line max-w-[360px]">{initToast.text}</span>
        </div>
      )}
    </div>
  );
}
