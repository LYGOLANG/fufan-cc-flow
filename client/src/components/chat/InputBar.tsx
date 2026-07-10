import { useState, useRef, useCallback, useEffect } from "react";
import { Square, Paperclip, ArrowUp, Sparkles, Wrench, ShieldAlert } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useConfigStore } from "../../stores/configStore";
import { useProviderStore } from "../../stores/providerStore";
import { useUIStore, type RunMode } from "../../stores/uiStore";
import { useSystemStore } from "../../stores/systemStore";
import { wsService } from "../../services/websocket";
import { api } from "../../services/api";
import SlashCommandMenu, { type SlashCommandMenuHandle, type SlashCommand } from "./SlashCommandMenu";
import AttachmentPreview from "./AttachmentPreview";
import ModelSelector from "../manage/ModelSelector";
import type { Attachment } from "../../types/claude";

const RUN_MODES: { id: RunMode; label: string }[] = [
  { id: "default",           label: "询问权限" },
  { id: "acceptEdits",       label: "接受编辑" },
  { id: "plan",              label: "Plan 模式" },
  { id: "bypassPermissions", label: "自动" },
];

// 运行模式按钮的激活态配色
const RUN_MODE_STYLE: Record<RunMode, string> = {
  default:           "border-white/10 bg-white/5 text-slate-400",
  acceptEdits:       "border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
  plan:              "border-purple-bright/30 bg-purple-glow/10 text-purple-bright",
  bypassPermissions: "border-rose-err/30 bg-rose-err/10 text-rose-err",
};
const RUN_MODE_LABEL: Record<RunMode, string> = {
  default:           "询问权限",
  acceptEdits:       "接受编辑",
  plan:              "Plan 模式",
  bypassPermissions: "自动",
};

const ACCEPTED_FILE_TYPES = "image/*,.txt,.md,.json,.js,.ts,.jsx,.tsx,.py,.css,.html,.xml,.yaml,.yml,.toml,.csv,.sh,.bat,.rs,.go,.java,.c,.cpp,.h,.hpp,.rb,.php,.sql,.log,.cfg,.ini,.env";
const MAX_ATTACHMENTS = 5;

export default function InputBar() {
  const [text, setText] = useState("");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const statusText = useChatStore((s) => s.statusText);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const pendingPermCount = useChatStore((s) => s.pendingPermissions.size);
  const pendingFork = useChatStore((s) => s.pendingFork);
  const model = useConfigStore((s) => s.model);
  const effort = useConfigStore((s) => s.effort);
  const apiKey = useConfigStore((s) => s.apiKey);
  const engine = useConfigStore((s) => s.engine);
  const codexModel = useConfigStore((s) => s.codexModel);
  const codexEffort = useConfigStore((s) => s.codexEffort);
  const providerId = useConfigStore((s) => s.providerId);
  const providers = useProviderStore((s) => s.providers);
  const currentProvider = providers.find((p) => p.id === providerId);
  const { runMode, setRunMode, setSettingsPageOpen, projectPath, prefillInput, setPrefillInput, insertInput, setInsertInput } = useUIStore();
  const { claudeInfo, codexInfo } = useSystemStore();

  const isCodexProvider = engine === "codex" || providerId === "openai" || currentProvider?.kind === "codex";
  const cliName = isCodexProvider ? "Codex CLI" : "Claude Code";
  const notInstalled = (isCodexProvider ? codexInfo?.installed : claudeInfo?.installed) === false;
  const noProject = !projectPath;

  // Listen for Agent launch prefill
  useEffect(() => {
    if (prefillInput) {
      setText(prefillInput);
      setPrefillInput("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [prefillInput, setPrefillInput]);

  // 追加插入（文件树「引用到对话」/ 拖拽文件等）——插到当前文本末尾，保持已有内容
  useEffect(() => {
    if (!insertInput) return;
    setText((prev) => {
      const needSpace = prev.length > 0 && !prev.endsWith(" ") && !prev.endsWith("\n");
      return prev + (needSpace ? " " : "") + insertInput;
    });
    setInsertInput("");
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 200) + "px";
      }
    });
  }, [insertInput, setInsertInput]);

  // F1.15 外部拖入(OS 文件/文件夹)→ 识别绝对路径插入输入框。
  // 桌面壳里 Tauri 拦截原生文件拖放(HTML5 drop 拿不到路径),必须走 onDragDropEvent;
  // 多个路径空格分隔,含空格的路径加引号,Claude 可直接 Read/Glob。
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const paths = (event.payload as { paths?: string[] }).paths ?? [];
          if (paths.length === 0) return;
          const insert =
            paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ") + " ";
          useUIStore.getState().setInsertInput(insert);
        });
        if (disposed) un();
        else unlisten = un;
      } catch {
        /* 非桌面环境或 API 不可用,静默跳过 */
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const cycleRunMode = () => {
    const idx = RUN_MODES.findIndex((m) => m.id === runMode);
    setRunMode(RUN_MODES[(idx + 1) % RUN_MODES.length].id);
  };

  const [uploadError, setUploadError] = useState("");

  // 统一的附件上传：被「回形针选择」和「粘贴图片」共用
  const uploadFiles = useCallback(async (files: File[]) => {
    if (!projectPath || files.length === 0) return;

    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toUpload = files.slice(0, remaining);
    if (toUpload.length === 0) return;

    setUploading(true);
    setUploadError("");
    try {
      const results: Attachment[] = [];
      for (const file of toUpload) {
        const meta = await api.uploadAttachment(file, projectPath);
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        results.push({ ...meta, previewUrl });
      }
      setAttachments((prev) => [...prev, ...results]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传失败";
      setUploadError(msg);
      console.error("[attachment upload]", err);
      // Auto-clear error after 5s
      setTimeout(() => setUploadError(""), 5000);
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attachments.length, projectPath]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    void uploadFiles(Array.from(files));
  }, [uploadFiles]);

  // 拖拽进输入框:
  //   ① 文件树内部拖拽(text/plain)→ 插入 @相对路径(既有行为)
  //   ② 浏览器模式从外部拖入文件 → 拿不到绝对路径(安全限制),回退为附件上传;
  //      桌面壳的外部拖入由上面的 Tauri onDragDropEvent 处理,HTML5 drop 不会触发
  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const dropped = e.dataTransfer?.getData("text/plain");
    if (dropped) {
      e.preventDefault();
      setInsertInput(dropped.endsWith(" ") ? dropped : dropped + " ");
      return;
    }
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && !notInstalled && !noProject) {
      e.preventDefault();
      void uploadFiles(Array.from(files));
    }
  }, [setInsertInput, uploadFiles, notInstalled, noProject]);

  // 直接粘贴图片到输入框 → 走附件上传，纯文本粘贴不受影响
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (notInstalled || noProject) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      // 截图通常无文件名，补一个兜底名（服务端会再用 UUID 重命名）
      const named = file.name
        ? file
        : new File([file], `pasted-${Date.now()}.${item.type.split("/")[1] || "png"}`, {
            type: item.type,
          });
      imageFiles.push(named);
    }

    if (imageFiles.length > 0) {
      // 阻止图片二进制/路径被插入文本框
      e.preventDefault();
      void uploadFiles(imageFiles);
    }
  }, [notInstalled, noProject, uploadFiles]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
    if (projectPath) {
      api.deleteAttachment(id, projectPath).catch(() => {});
    }
  }, [projectPath]);

  const handleSend = useCallback(() => {
    const prompt = text.trim();
    // 不再拦 isStreaming——正在处理时也能发,后端会排队,等当前这轮结束自动接着处理,
    // 不用等它跑完才能继续输入。
    if (!prompt || notInstalled || noProject) return;

    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;
    const attachmentPaths = currentAttachments?.map((a) => a.serverPath).filter(Boolean) as string[] | undefined;

    // 发送时若已有一轮在流式中,说明这是对当前活跃会话的续发(哪怕 session_init 还没回、
    // 拿不到 sessionId)。带 continueActive 让后端排队复用常驻进程,而不是误把正在跑的任务杀掉。
    const continueActive = useChatStore.getState().isStreaming;

    useChatStore.getState().addUserMessage(prompt, currentAttachments);

    // If pendingFork is set, this message triggers a session fork
    const forkInfo = useChatStore.getState().pendingFork;
    // F1.11:扩展思考预算(仅开启扩展思考且选了具体档位时注入)
    const { thinking: thinkingOn, thinkingBudget } = useConfigStore.getState();
    wsService.send("send_message", {
      prompt, model, effort, runMode,
      engine, codexModel, codexEffort, providerId,
      apiKey: apiKey || undefined,
      thinkingBudget: thinkingOn && thinkingBudget > 0 ? thinkingBudget : undefined,
      sessionId: forkInfo?.sessionId || currentSessionId || undefined,
      forkSession: forkInfo ? true : undefined,
      continueActive: continueActive || undefined,
      attachmentPaths: attachmentPaths?.length ? attachmentPaths : undefined,
    });
    // Clear pendingFork — will be fully resolved on session_init with new ID
    if (forkInfo) {
      useChatStore.getState().clearPendingFork();
    }

    // 只有当前没有正在流式输出时才立即切到 streaming 视觉状态;如果已经在流式,
    // 这条消息在后端排队,等当前这轮结束自动续上,session_init/assistant_text 事件
    // 到时候会自然把状态接回去,不在这里手动重置(避免打断当前正在渲染的那轮)。
    if (!useChatStore.getState().isStreaming) {
      useChatStore.getState().startStreaming();
    }
    if (prompt.startsWith("/compact")) {
      useChatStore.getState().setStatusText("正在压缩上下文...");
    }

    setText("");
    // Release blob URLs
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, model, effort, runMode, engine, codexModel, codexEffort, providerId, apiKey, notInstalled, noProject, currentSessionId, pendingFork, attachments]);

  const handleAbort = useCallback(() => wsService.send("abort", {}), []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 组词防护:中文/日文输入法打拼音按 Enter 确认候选词时,
    // isComposing 为 true——此时 Enter 属于输入法,不是"发送"。
    // 没有这个防护,中文根本打不进去(半截拼音就被发出去了)。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Forward navigation keys to slash menu when open
    if (slashMenuOpen && slashMenuRef.current) {
      if (e.key === "Enter" && !e.shiftKey) {
        // Try to select from the menu; if handleKey returns false
        // (no matching command), close the menu and send the message
        e.preventDefault();
        const handled = slashMenuRef.current.handleKey(e.key);
        if (!handled) {
          setSlashMenuOpen(false);
          setSlashQuery("");
          handleSend();
        }
        return;
      }
      const forwarded = ["ArrowUp", "ArrowDown", "Tab", "Escape"];
      if (forwarded.includes(e.key)) {
        e.preventDefault();
        slashMenuRef.current.handleKey(e.key);
        return;
      }
      if (e.key === "Backspace" && slashQuery === "") {
        e.preventDefault();
        slashMenuRef.current.handleKey("Backspace");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Slash command detection: show menu only for the command part (before first space)
    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashMenuOpen(true);
      setSlashQuery(val.slice(1)); // everything after "/"
    } else {
      setSlashMenuOpen(false);
      setSlashQuery("");
    }

    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setSlashMenuOpen(false);
    setSlashQuery("");

    // "insert" — place text in input for user to add arguments, keep focus
    if (cmd.type === "insert" && cmd.insertText) {
      setText(cmd.insertText);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    // "prompt" — send as message to Claude via WebSocket
    if (cmd.type === "prompt" && cmd.promptText) {
      const prompt = cmd.promptText;
      useChatStore.getState().addUserMessage(prompt);
      const {
        model: m, effort: e, apiKey: k, engine: eng,
        codexModel: cm, codexEffort: ce, providerId: pid,
        thinking: thk, thinkingBudget: thkBudget,
      } = useConfigStore.getState();
      const { runMode: rm } = useUIStore.getState();
      const sid = useChatStore.getState().currentSessionId;
      wsService.send("send_message", {
        prompt, model: m, effort: e, runMode: rm,
        engine: eng, codexModel: cm, codexEffort: ce, providerId: pid,
        // 与主发送路径保持一致:思考预算 + 流式中续发标记,
        // 缺一不可——否则 slash 调技能会丢预算,且指纹不一致导致杀常驻进程
        thinkingBudget: thk && thkBudget > 0 ? thkBudget : undefined,
        continueActive: useChatStore.getState().isStreaming || undefined,
        apiKey: k || undefined, sessionId: sid || undefined,
      });
      // Instant feedback
      useChatStore.getState().startStreaming();
      if (prompt.startsWith("/compact")) {
        useChatStore.getState().setStatusText("正在压缩上下文...");
      }
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    // "action" — execute local UI action
    cmd.action?.();
    // Brief status feedback for action commands (auto-clears after 2s)
    const feedbackMap: Record<string, string> = {
      clear: "✓ 对话已清空", plan: "✓ 已切换到 Plan 模式",
      fork: "✓ 对话已 Fork，下次发送将创建分支",
      copy: "✓ 已复制到剪贴板", export: "✓ 对话已导出",
      "model-opus": "✓ 已切换到 Opus", "model-sonnet": "✓ 已切换到 Sonnet", "model-haiku": "✓ 已切换到 Haiku",
      "fast-on": "✓ Fast 模式已开启", "fast-off": "✓ Fast 模式已关闭",
    };
    const fb = feedbackMap[cmd.id];
    if (fb) {
      useChatStore.getState().setStatusText(fb);
      setTimeout(() => {
        // Only clear if it's still our feedback message
        if (useChatStore.getState().statusText === fb) {
          useChatStore.getState().setStatusText("");
        }
      }, 2000);
    }
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const handleSlashDismiss = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashQuery("");
  }, []);

  const handleOpenSetup = () => setSettingsPageOpen(true);

  return (
    <div className="flex-shrink-0 glass-panel border-t border-white/5 p-4">
      <div className="relative max-w-3xl mx-auto">

        {/* Slash command menu */}
        {slashMenuOpen && !isStreaming && (
          <SlashCommandMenu
            ref={slashMenuRef}
            query={slashQuery}
            onSelect={handleSlashSelect}
            onDismiss={handleSlashDismiss}
          />
        )}

        {/* Left icon inside textarea */}
        <div className="absolute left-4 top-3.5 text-slate-500 pointer-events-none" style={{ zIndex: 1 }}>
          <Sparkles size={18} />
        </div>

        {/* Main input container */}
        <div className={`relative rounded-xl border transition-colors overflow-hidden ${
          notInstalled || noProject
            ? "border-rose-err/20 focus-within:border-rose-err/40"
            : "border-white/10 focus-within:border-purple-glow/40"
        }`}
          style={{ background: "rgba(13,11,24,0.6)" }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder={
              notInstalled
                ? `请先安装 ${cliName} 才能开始对话...`
                : noProject
                  ? "请先在左侧侧栏选择项目文件夹..."
                  : pendingFork
                    ? "输入消息继续（将创建分支会话）..."
                  : "描述你的下一个任务或提问..."
            }
            disabled={notInstalled || noProject}
            rows={1}
            className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-500 pl-12 pr-14 py-3.5 resize-none focus:outline-none font-sans leading-relaxed disabled:opacity-50"
            style={{ minHeight: "52px" }}
          />

          {/* Attachment preview */}
          <AttachmentPreview
            attachments={attachments}
            onRemove={handleRemoveAttachment}
            uploading={uploading}
          />

          {/* Upload error */}
          {uploadError && (
            <div className="px-3 py-1.5 text-xs text-rose-err border-t border-rose-err/10">
              附件上传失败: {uploadError}
            </div>
          )}

          {/* Send / Abort / Setup button */}
          <div className="absolute right-3 top-2.5">
            {text.trim() && !notInstalled && !noProject ? (
              // 有文字就始终显示发送——处理中也能发,后端排队,不用等当前任务结束。
              <button
                onClick={handleSend}
                className="p-1.5 rounded-lg text-white transition-colors"
                style={{ background: "#7c3aed" }}
                title={isStreaming ? "发送(将排队，等当前任务结束后处理)" : "发送 (Enter)"}
              >
                <ArrowUp size={16} />
              </button>
            ) : isStreaming ? (
              <button
                onClick={handleAbort}
                className="p-1.5 rounded-lg bg-rose-err/10 text-rose-err hover:bg-rose-err/20 border border-rose-err/20 transition-colors"
                title="停止"
              >
                <Square size={16} />
              </button>
            ) : notInstalled ? (
              <button
                onClick={handleOpenSetup}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-err/10 text-rose-err hover:bg-rose-err/20 border border-rose-err/20 transition-colors text-xs font-medium"
                title={`安装 ${cliName}`}
              >
                <Wrench size={13} />
                <span className="hidden sm:inline">安装</span>
              </button>
            ) : noProject ? (
              <button
                disabled
                className="p-1.5 rounded-lg bg-rose-err/10 text-rose-err/50 border border-rose-err/20 transition-colors"
                title="请先选择项目文件夹"
              >
                <ArrowUp size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!text.trim()}
                className="p-1.5 rounded-lg text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: text.trim() ? "#7c3aed" : "rgba(124,58,237,0.3)" }}
                title="发送 (Enter)"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between mt-2 px-1">
          {/* Left: attachment + mic + run mode */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={notInstalled || noProject || isStreaming || attachments.length >= MAX_ATTACHMENTS}
              className="p-1.5 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={attachments.length >= MAX_ATTACHMENTS ? `最多 ${MAX_ATTACHMENTS} 个附件` : "添加附件"}
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />
            {/* Separator */}
            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Run mode cycle button */}
            <button
              onClick={cycleRunMode}
              disabled={notInstalled || noProject}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed ${RUN_MODE_STYLE[runMode]}`}
              title="点击切换运行模式"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
              {RUN_MODE_LABEL[runMode]}
            </button>
          </div>

          {/* Right: hint or not-installed / no-project CTA */}
          <div className="flex items-center gap-3">
            {notInstalled ? (
              <button
                onClick={handleOpenSetup}
                className="text-[11px] text-rose-err hover:text-rose-err/80 transition-colors flex items-center gap-1"
              >
                安装 {cliName} →
              </button>
            ) : noProject ? (
              <span className="text-[10px] text-slate-600 hidden sm:block">
                Enter 发送，Shift+Enter 换行，/ 命令
              </span>
            ) : (
              <>
                {pendingPermCount > 0 ? (
                  <span className="text-[11px] text-amber-glow flex items-center gap-1.5 animate-pulse">
                    <ShieldAlert size={12} className="flex-shrink-0" />
                    等待权限确认 ({pendingPermCount})
                  </span>
                ) : statusText ? (
                  <span className={`text-[11px] flex items-center gap-1.5 ${
                    isStreaming ? "text-emerald-ok/80 animate-pulse" : "text-slate-400"
                  }`}>
                    {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-emerald-ok flex-shrink-0" />}
                    {statusText}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600 hidden sm:block">
                    {isStreaming ? "双击 ESC 中断" : "Enter 发送，Shift+Enter 换行，/ 命令"}
                  </span>
                )}
                {/* 供应商 → 模型 两级切换器(向上弹出) */}
                <ModelSelector direction="up" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
