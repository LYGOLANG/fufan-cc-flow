import { useUIStore } from "../stores/uiStore";
import { useChatStore } from "../stores/chatStore";
import { useConfigStore } from "../stores/configStore";
import { api } from "../services/api";
import { wsService } from "../services/websocket";
import { streamingFlush } from "../hooks/useWebSocket";

/**
 * 每个后台项目的聊天视图快照:切走时整体保存(含"正在流式输出"的中间态),
 * 切回时原样恢复,再由 useWebSocket 重放后台期间积压的事件把内容续上——
 * 这样正在跑的任务切走再切回,看起来从未中断。
 */
type ChatSnapshot = ReturnType<typeof takeChatSnapshot>;
const chatSnapshots = new Map<string, ChatSnapshot>();

function takeChatSnapshot() {
  const s = useChatStore.getState();
  return {
    messages: s.messages,
    currentSessionId: s.currentSessionId,
    currentAssistantId: s.currentAssistantId,
    isStreaming: s.isStreaming,
    streamingText: s.streamingText,
    statusText: s.statusText,
    totalUsage: s.totalUsage,
    totalCost: s.totalCost,
    hasMoreHistory: s.hasMoreHistory,
    historyOffset: s.historyOffset,
    streamingStartedAt: s.streamingStartedAt,
    contextTokens: s.contextTokens,
    contextMax: s.contextMax,
    pendingPermissions: s.pendingPermissions,
    pendingFork: s.pendingFork,
  };
}

/** 关闭项目标签时丢弃其聊天快照(其连接与任务已被收尾,快照不再有意义)。 */
export function dropProjectChatState(p: string): void {
  chatSnapshots.delete(p);
}

/**
 * 切换代数:每次 openProject 递增,异步历史加载完成时校验代数——
 * 快速连续切换时,前一次未完成的磁盘加载绝不能落到后一个项目的视图上。
 */
let switchGen = 0;

/**
 * 页面加载(含 vite 整页重载/手动刷新)后恢复当前项目的会话视图,并为所有
 * 打开的项目预热 WS 连接(认领服务端寄存的常驻进程)。
 *
 * 背景:openProject 对 p === projectPath 早退,刷新后没有任何入口加载历史,
 * 聊天区停在空白欢迎页,用户必须"切走再切回"才能看到会话——这就是
 * "刷新后变成新建状态"的来源。App 挂载时调用一次即可。
 */
export async function restoreOnBoot(): Promise<void> {
  const ui = useUIStore.getState();
  const chat = useChatStore.getState();

  // 预热所有打开标签的连接:让服务端寄存的引擎(页面刷新前的任务)被立即认领
  wsService.warmup(ui.openProjects);

  const p = ui.projectPath;
  if (!p) return;
  if (chat.messages.length > 0 || chat.isStreaming) return;
  const sid = ui.projectSessions[p] || chat.currentSessionId || "";
  if (!sid) return;

  const gen = ++switchGen;
  chat.setSessionId(sid);
  try {
    const res = await api.getSessionMessages(sid, { offset: 0, limit: 50 });
    if (gen !== switchGen) return; // 加载期间用户切了项目
    const now = useChatStore.getState();
    if (now.isStreaming || now.messages.length > 0) return; // 用户已开始操作/直播已接管
    if (res.messages.length > 0) {
      chat.loadHistoryMessages(
        res.messages as Parameters<typeof chat.loadHistoryMessages>[0],
        res.total,
        0
      );
    }
  } catch {
    /* 会话 id 已设好,可继续对话 */
  }
}

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
 *   1) 保存上一个项目的会话 id + 聊天视图快照(便于回来时无缝恢复)
 *   2) setProjectPath(触发文件树刷新 / WS 路由切换 / spawn cwd 更新)
 *   3) 有快照则直接恢复(流式中状态也保留,积压事件由 useWebSocket 重放续上);
 *      无快照则清空并从磁盘加载该项目记住的会话;没有则置为空白(不串到别的项目)
 *
 * ProjectTabs 切标签、FolderBrowser 选目录/最近项目、初始挂载都走这一个入口,行为一致。
 */
export async function openProject(p: string): Promise<void> {
  if (!p) return;
  const ui = useUIStore.getState();
  const chat = useChatStore.getState();

  if (p === ui.projectPath) return;
  const gen = ++switchGen;

  // 1) 保存上一个项目的活动会话(便于回来时恢复);不中断其任务——它会在后台继续跑
  if (ui.projectPath) {
    ui.setProjectSession(ui.projectPath, chat.currentSessionId || "");
    // 模型选择档案随项目走:切走时保存当前整组选择
    useConfigStore.getState().saveProjectSelection(ui.projectPath);
    // 把 60ms 节流中尚未落进 store 的流式增量先刷进去,再整体快照该项目的聊天视图
    streamingFlush.run();
    const s = useChatStore.getState();
    // 只快照"有内容或正在流式"的状态。空白/半加载的瞬态不快照(切回时走磁盘重建)
    // ——否则上一次切换的历史加载尚未完成就切走,会把"刚清空还没加载"的空状态
    // 定格成该项目的视图,切回来就成了莫名其妙的"新建状态"。
    if (s.messages.length > 0 || s.isStreaming) {
      chatSnapshots.set(ui.projectPath, takeChatSnapshot());
    } else {
      chatSnapshots.delete(ui.projectPath);
    }
  }

  // 2) 切路径(FileTree / cwd 都依赖 projectPath)
  ui.setProjectPath(p);
  // 2.1) 恢复该项目自己的模型选择(供应商/模型/力度);首次打开则以当前选择为初始档案
  useConfigStore.getState().restoreProjectSelection(p);
  // 2.5) 立即把事件路由切到新项目连接并进入缓冲模式,避免切换瞬间的事件
  //      串进旧列表或丢失(React effect 会异步再调一次 setActiveProject + attach)
  wsService.setActiveProject(p);

  // 3) 有快照直接恢复(含"任务运行中"的流式状态);useWebSocket 的 effect 随后
  //    会重放该项目后台期间积压的事件,把切走后新产生的内容无缝续上
  const snap = chatSnapshots.get(p);
  if (snap) {
    chatSnapshots.delete(p);
    useChatStore.setState(snap);
    return;
  }

  // 3b) 无快照(首次打开/刷新后):清空旧消息(仅前端视图;旧项目任务不受影响)
  chat.clearMessages();

  // 4) 恢复该项目记住的会话
  const sid = ui.projectSessions[p];
  if (sid) {
    chat.setSessionId(sid);
    try {
      const res = await api.getSessionMessages(sid, { offset: 0, limit: 50 });
      // 加载期间又切走了:丢弃过期结果,不许它落到别的项目的视图上
      if (gen !== switchGen) return;
      // 缓冲重放已把"正在运行的任务"接上直播:历史让位,不覆盖流式状态
      // (任务结束后再切回来自然会走磁盘加载补全历史)
      if (useChatStore.getState().isStreaming) return;
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
