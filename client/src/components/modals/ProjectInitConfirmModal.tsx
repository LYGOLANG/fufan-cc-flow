import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderPlus,
  Loader2,
  X,
} from "lucide-react";
import type {
  ProjectInitDecision,
  ProjectInitPreview,
  ProjectTemplateItemName,
} from "../../services/api";

const ITEM_LABELS: Record<ProjectTemplateItemName, string> = {
  ".claude": "Claude 项目配置",
  ".codex": "Codex 项目配置",
  ".agents": "Agent 与 Skill 配置",
  "AGENTS.md": "主控规则文档",
};

interface Props {
  targetPath: string | null;
  preview: ProjectInitPreview | null;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (decisions: ProjectInitDecision[]) => void;
}

export default function ProjectInitConfirmModal({
  targetPath,
  preview,
  error,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [overwrite, setOverwrite] = useState<Partial<Record<ProjectTemplateItemName, boolean>>>({});

  useEffect(() => {
    const initial: Partial<Record<ProjectTemplateItemName, boolean>> = {};
    preview?.items.forEach((item) => {
      if (item.status === "conflict") initial[item.name] = false;
    });
    setOverwrite(initial);
  }, [preview]);

  const missingItems = useMemo(
    () => preview?.items.filter((item) => item.status === "missing") ?? [],
    [preview]
  );
  const canConfirm = !!preview && missingItems.length === 0 && !busy;

  if (!targetPath) return null;

  const handleConfirm = () => {
    if (!preview) return;
    const decisions = preview.items
      .filter((item) => item.status === "conflict")
      .map((item) => ({
        name: item.name,
        overwrite: overwrite[item.name] === true,
      }));
    onConfirm(decisions);
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="modal-content glass-panel rounded-2xl w-full max-w-[560px] max-h-[78vh] flex flex-col shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-amber-glow/15 flex items-center justify-center">
            <FolderPlus size={14} className="text-amber-glow" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white">新建项目</h2>
            <p className="text-[11px] text-slate-500 truncate" title={targetPath}>
              {targetPath}
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-3">
          {error && (
            <div className="flex gap-2 rounded-lg border border-rose-err/20 bg-rose-err/10 px-3 py-2.5 text-xs text-rose-err">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{error}</span>
            </div>
          )}

          {preview && (
            <>
              <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="text-[11px] text-slate-500 mb-1">模板来源</div>
                <div className="text-xs text-slate-300 truncate" title={preview.templateRoot}>
                  {preview.templateRoot}
                </div>
              </div>

              {missingItems.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-rose-err/20 bg-rose-err/10 px-3 py-2.5 text-xs text-rose-err">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    模板源缺失 {missingItems.map((item) => item.name).join("、")}，不能初始化。
                  </span>
                </div>
              )}

              <div className="space-y-2">
                {preview.items.map((item) => {
                  const isConflict = item.status === "conflict";
                  const isMissing = item.status === "missing";
                  return (
                    <div
                      key={item.name}
                      className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <Copy size={14} className="text-slate-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-100 font-medium">{item.name}</span>
                            <span className="text-[11px] text-slate-500">{ITEM_LABELS[item.name]}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate" title={item.targetPath}>
                            {item.targetPath}
                          </div>
                        </div>
                        {!isConflict && (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                            isMissing
                              ? "bg-rose-err/10 text-rose-err"
                              : "bg-emerald-ok/10 text-emerald-ok"
                          }`}>
                            {isMissing ? "源缺失" : "将复制"}
                          </span>
                        )}
                      </div>

                      {isConflict && (
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={() => setOverwrite((state) => ({ ...state, [item.name]: false }))}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                              overwrite[item.name]
                                ? "border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
                                : "border-amber-glow/40 bg-amber-glow/10 text-amber-glow"
                            }`}
                          >
                            跳过
                          </button>
                          <button
                            onClick={() => setOverwrite((state) => ({ ...state, [item.name]: true }))}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                              overwrite[item.name]
                                ? "border-rose-err/40 bg-rose-err/10 text-rose-err"
                                : "border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            覆盖
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 text-sm rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-1.5 text-sm rounded-lg bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            初始化项目
          </button>
        </div>
      </div>
    </div>
  );
}
