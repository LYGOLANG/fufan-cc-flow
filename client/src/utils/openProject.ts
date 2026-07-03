import { useUIStore } from "../stores/uiStore";
import { useChatStore } from "../stores/chatStore";
import { api } from "../services/api";
import { wsService } from "../services/websocket";

/**
 * 中断"当前仍在流式输出"的旧任务(如果有)。
 *
 * 仅用于"同一项目内新建会话/清空"的场景:此时旧任务后续事件会追加进刚清空的
 * 消息列表,造成"新建了会话旧内容却又冒出来",所以要先中断。
 *
 * 注意:切换"项目"不再走这里——多连接架构下每个项目各持一条连接,只有活动项目的
 * 事件会进聊天记录,后台项目任务照常在服务端运行,切走不应该中断它。
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

  // 1) 保存上一个项目的活动会话(便于回来时恢复);不中断其任务——它会在后台继续跑
  if (ui.projectPath) ui.setProjectSession(ui.projectPath, chat.currentSessionId || "");

  // 2) 切路径(FileTree / cwd 都依赖 projectPath)
  ui.setProjectPath(p);
  // 2.5) 立即把事件路由切到新项目连接,避免旧项目最后一刻的事件串进刚清空的列表
  //      (React effect 会异步再调一次 setActiveProject,幂等)
  wsService.setActiveProject(p);
  // 3) 清空旧消息(仅前端视图;旧项目的服务端任务不受影响)
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
