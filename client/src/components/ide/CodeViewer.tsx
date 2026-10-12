import { X, Copy, Check, FileText, Loader2, Pencil, Save, AlertTriangle } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { SyntaxHighlighter, oneDark } from "../../utils/syntaxHighlighter";
import { useFileStore } from "../../stores/fileStore";
import { useUIStore } from "../../stores/uiStore";

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  jsx: "jsx",
  python: "python",
  rust: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  yaml: "yaml",
  markdown: "markdown",
  bash: "bash",
  sql: "sql",
  xml: "xml",
  toml: "toml",
  plaintext: "text",
};

export default function CodeViewer() {
  const {
    openFilePath, openFileContent, fileLoading, closeFile,
    isEditing, editingContent, fileSaving, saveError,
    startEditing, updateEditingContent, cancelEditing, saveFile,
  } = useFileStore();
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const projectPath = useUIStore((s) => s.projectPath);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isImage = openFileContent?.language === "image";
  const isDirty = isEditing && editingContent !== null && editingContent !== openFileContent?.content;

  // 编辑态打开输入框立刻拿到焦点,不用再点一次才能开始打字
  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const handleSave = useCallback(() => {
    if (!projectPath || fileSaving) return;
    void saveFile(projectPath);
  }, [projectPath, fileSaving, saveFile]);

  const handleClose = useCallback(() => {
    // 关闭前拦一下未保存的改动——关掉的那一刻缓冲区就没了,没地方找回来
    if (isDirty && !window.confirm("有未保存的改动，确定要放弃吗？")) return;
    closeFile();
    setRightPanelOpen(false);
  }, [isDirty, closeFile, setRightPanelOpen]);

  const handleCancelEdit = useCallback(() => {
    if (isDirty && !window.confirm("有未保存的改动，确定要放弃吗？")) return;
    cancelEditing();
  }, [isDirty, cancelEditing]);

  const handleCopy = useCallback(() => {
    const text = isEditing ? editingContent : openFileContent?.content;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [isEditing, editingContent, openFileContent]);

  // Ctrl/Cmd+S 保存,不让浏览器弹出"保存网页"对话框
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  if (!openFilePath) return null;

  const fileName = openFilePath.split(/[/\\]/).pop() || "";
  const language = openFileContent
    ? LANGUAGE_MAP[openFileContent.language] || "text"
    : "text";
  const displayedLines = isEditing
    ? (editingContent?.split("\n").length ?? 0)
    : openFileContent?.lines ?? 0;

  return (
    <div className="flex flex-col h-full bg-obsidian-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-obsidian-700/50 bg-obsidian-800/60 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={13} className="text-obsidian-300 flex-shrink-0" />
          <span className="text-xs font-mono text-obsidian-100 truncate">
            {fileName}
          </span>
          {isDirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-glow flex-shrink-0"
              title="有未保存的改动"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEditing && !isImage && openFileContent && !fileLoading && (
            <button
              onClick={startEditing}
              className="p-1.5 rounded hover:bg-obsidian-700/50 text-obsidian-400 hover:text-obsidian-200 transition-colors"
              title="编辑"
            >
              <Pencil size={13} />
            </button>
          )}
          {isEditing && (
            <>
              <button
                onClick={handleSave}
                disabled={!isDirty || fileSaving}
                className="p-1.5 rounded hover:bg-obsidian-700/50 text-obsidian-400 hover:text-emerald-ok transition-colors disabled:opacity-30 disabled:hover:text-obsidian-400 disabled:cursor-not-allowed"
                title="保存 (Ctrl+S)"
              >
                {fileSaving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} />
                )}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-2 py-1 rounded text-[11px] hover:bg-obsidian-700/50 text-obsidian-400 hover:text-obsidian-200 transition-colors"
                title="放弃改动，回到只读预览"
              >
                取消
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-obsidian-700/50 text-obsidian-400 hover:text-obsidian-200 transition-colors"
            title="复制全部"
          >
            {copied ? (
              <Check size={13} className="text-emerald-ok" />
            ) : (
              <Copy size={13} />
            )}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-obsidian-700/50 text-obsidian-400 hover:text-obsidian-200 transition-colors"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {saveError && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-err/10 border-b border-rose-err/20 text-[11px] text-rose-err flex-shrink-0">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="truncate">保存失败：{saveError}</span>
        </div>
      )}

      {/* Content */}
      {fileLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-obsidian-400" />
        </div>
      ) : openFileContent && isImage ? (
        <div className="flex-1 overflow-auto flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.3)" }}>
          <img
            src={openFileContent.content}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded"
            style={{ imageRendering: "auto" }}
          />
        </div>
      ) : openFileContent && isEditing ? (
        // 最小够用的编辑器:朴素文本框,不是语法高亮编辑。字体/字号/行高/
        // 内边距特意和下面只读预览的 SyntaxHighlighter 对齐,切换时不跳动。
        <textarea
          ref={textareaRef}
          value={editingContent ?? ""}
          onChange={(e) => updateEditingContent(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 w-full resize-none bg-transparent text-obsidian-100 font-mono outline-none px-3 py-3"
          style={{ fontSize: "12px", lineHeight: "1.6", tabSize: 2 }}
        />
      ) : openFileContent ? (
        <div className="flex-1 overflow-auto">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            customStyle={{
              margin: 0,
              padding: "12px 0",
              background: "transparent",
              fontSize: "12px",
              lineHeight: "1.6",
            }}
            lineNumberStyle={{
              minWidth: "3em",
              paddingRight: "12px",
              color: "rgba(255,255,255,0.15)",
              textAlign: "right",
            }}
          >
            {openFileContent.content}
          </SyntaxHighlighter>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-obsidian-400 text-sm">
          无法加载文件内容
        </div>
      )}

      {/* Footer */}
      {openFileContent && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-obsidian-700/40 bg-obsidian-800/40 text-[10px] text-obsidian-400 font-mono flex-shrink-0">
          <span>{isImage ? "图片" : openFileContent.language}</span>
          {!isImage && <span>{displayedLines} 行{isDirty ? "（未保存）" : ""}</span>}
          <span>{openFileContent.encoding.toUpperCase()}</span>
          <span>
            {openFileContent.size > 1024
              ? `${(openFileContent.size / 1024).toFixed(1)} KB`
              : `${openFileContent.size} B`}
          </span>
        </div>
      )}
    </div>
  );
}
