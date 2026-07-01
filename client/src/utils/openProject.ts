import { useUIStore } from "../stores/uiStore";
import { useChatStore } from "../stores/chatStore";
import { api } from "../services/api";
import { wsService } from "../services/websocket";

/**
 * 中断"当前仍在流式输出"的旧任务(如果有)。
 *
 * 背景:后端每条 SSE/WS 事件(assistant_text / tool_use_start / task_complete ...)
 * 都只按"当前连接"转发,不看前端是否已经切走。如果旧任务还在流式输出时就切会话/建新会话/
 * 切项目,旧任务后续的事件会持续到达并被追加进刚清空的消息列表,表现为"明明新建了会话,
 * 旧的对话内容却又出现了"。因此所有会清空/替换消息列表的入口,都应先中断旧流。
 */
function abortIfStreaming(): void {
  if (useChatStore.getState().isStreaming) {
    wsService.send("abort", {});
  }
}

/**
 * 新建会话/新建任务的统一入口 —— 供 ChatPanel「新建任务」、SessionList/HistoryModal
 * 「新建会话」、/clear 等所有入口复用,保证行为一致:若旧任务还在跑,先中断,再清空。
 */
export function startNewSession(): void {
  abortIfStreaming();
  useChatStore.getState().clearMessages();
}

/**
 * 切换/打开一个项目 —— 不仅切路径,还要把聊天上下文切到该项目。
 *
 * 之前 setProjectPath 只改了 projectPath(文件树/cwd),没有加载该项目的会话,
 * 于是「打开之前的项目,聊天上下文却是别的」。这里统一成:
 *   1) 保存上一个项目当前的会话 id(便于回来时恢复)
 *   2) setProjectPath(触发文件树刷新 / WS 重连 / spawn cwd 更新)
 *   3) 清空当前消息
 *   4) 恢复该项目记住的会话并加载其历史消息;没有则置为空白(不串到别的项目)
 *
 * ProjectTabs 切标签、FolderBrowser 选目录/最近项目、初始挂载都走这一个入口,行为一致。
 */
export async function openProject(p: string): Promise<void> {
  if (!p) return;
  const ui = useUIStore.getState();
  const chat = useChatStore.getState();

  if (p === ui.projectPath) return;

  // 0) 若上一个项目还有任务在流式输出,先中断,避免其后续事件串到切换后的会话里
  abortIfStreaming();

  // 1) 保存上一个项目的活动会话
  if (ui.projectPath) ui.setProjectSession(ui.projectPath, chat.currentSessionId || "");

  // 2) 切路径(FileTree / WS / cwd 都依赖 projectPath)
  ui.setProjectPath(p);
  // 3) 清空旧消息
  chat.clearMessages();

  // 4) 恢复该项目记住的会话
  const sid = ui.projectSessions[p];
  if (sid) {
    chat.setSessionId(sid);
    try {
      const res = await api.getSessionMessages(sid, { offset: 0, limit: 50 });
      if (res.messages.length > 0) {
        chat.loadHistoryMessages(
          res.messages as Parameters<typeof chat.loadHistoryMessages>[0],
          res.total,
          0
        );
      }
    } catch {
      /* 会话 id 已设好,用户可继续对话 */
    }
  } else {
    chat.setSessionId("");
  }
}
