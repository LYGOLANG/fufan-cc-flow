import { X, FileText } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { useFileStore } from "../../stores/fileStore";
import CodeViewer from "../ide/CodeViewer";

export default function FileViewModal() {
  const { fileViewModalOpen, setFileViewModalOpen } = useUIStore();
  const { openFilePath, openFileContent, isEditing, editingContent, closeFile } = useFileStore();

  if (!fileViewModalOpen || !openFilePath) return null;

  const fileName = openFilePath.split(/[/\\]/).pop() || "";
  // CodeViewer 自己的关闭按钮已经拦过一次未保存改动;这层外壳有自己的关闭
  // 按钮和背景点击关闭,绕开了那层拦截,同一个判断要在这里再做一遍。
  const isDirty = isEditing && editingContent !== null && editingContent !== openFileContent?.content;

  const handleClose = () => {
    if (isDirty && !window.confirm("有未保存的改动，确定要放弃吗？")) return;
    setFileViewModalOpen(false);
    closeFile();
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="modal-content glass-panel rounded-2xl w-full max-w-4xl flex flex-col shadow-2xl shadow-black/60 h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={15} className="text-amber-glow flex-shrink-0" />
            <span className="text-sm font-medium text-slate-200 truncate font-mono">
              {fileName}
            </span>
            <span className="text-xs text-slate-500 truncate hidden sm:block">
              {openFilePath}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors flex-shrink-0 ml-2"
          >
            <X size={16} />
          </button>
        </div>

        {/* Code viewer fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <CodeViewer />
        </div>
      </div>
    </div>
  );
}
