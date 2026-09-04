import { useChatStore } from "../stores/chatStore";
import { useUIStore } from "../stores/uiStore";
import { wsService } from "../services/websocket";
import { buildEngineParams } from "./sendPayload";
import { startNewSession } from "./openProject";
import {
  extractHandoffDoc,
  buildHandoffRequestPrompt,
  buildHandoffOpeningPrompt,
} from "./autoHandoff";

/**
 * 「交接到新会话」的执行器 —— 自动(达阈值)与手动(上下文栏按钮)共用一份实现。
 *
 * 交接横跨两轮对话,中间那段状态必须活在组件之外:
 *   第一步 begin() —— 让当前会话写一份给接班人的交接文档(纯文本,不许调工具、不许写文件);
 *   第二步 finishIfPending() —— 那一轮结束时取出文档,开一个干净的新会话,把文档当开场白发进去。
 *
 * 放在模块级而不是 hook 的 ref 里,是因为手动按钮点的是第一步、而完成第一步之后
 * 的第二步由 useAutoHandoff 统一收尾。两边各存一份状态必然漂移。
 *
 * 为什么不再用压缩:见 utils/autoHandoff.ts 顶部。
 */

interface PendingHandoff {
  /** 发出请求时的消息条数——只认这之后的助手回复,否则会把无关的旧回复当文档 */
  fromIndex: number;
  /** 发起交接的会话与项目;中途被切走就作废,免得把 A 的交接开进 B 的新会话 */
  sessionId: string | null;
  projectPath: string;
  /** 触发时的上下文用量,用于文案与分隔符 */
  pct: number;
}

let pending: PendingHandoff | null = null;

/** 是否有交接正在进行(旧会话正在写文档)。 */
export function isHandoffPending(): boolean {
  return pending !== null;
}

export type BeginResult = "started" | "busy" | "no-session" | "not-sent";

/**
 * 第一步:请当前会话写交接文档。
 *
 * 调用方负责保证「此刻没有正在跑的任务」——交接指令要排在一轮对话之后发,
 * 插进正在跑的任务里会打断它。
 */
export function beginHandoff(pct: number): BeginResult {
  if (pending) return "busy";
  const chat = useChatStore.getState();
  if (!chat.currentSessionId) return "no-session";

  const prompt = buildHandoffRequestPrompt(pct);

  // 先发再改视图:连接不在时这一帧会被丢弃,那就当无事发生,
  // 不要在聊天记录里留下一条根本没送出去的指令。
  const sent = wsService.send("send_message", {
    prompt,
    // 引擎参数必须整组带上:少带字段会让后端的常驻进程指纹不一致,
    // 触发无谓的杀进程重启(见 buildEngineParams 注释)
    ...buildEngineParams(),
    sessionId: chat.currentSessionId,
  });
  if (!sent) return "not-sent";

  chat.addUserMessage(prompt);
  pending = {
    // 取「刚加进那条指令之后」的长度:只有这之后的助手回复才算文档
    fromIndex: useChatStore.getState().messages.length,
    sessionId: chat.currentSessionId,
    projectPath: useUIStore.getState().projectPath,
    pct,
  };
  chat.startStreaming();
  chat.setStatusText(`上下文已达 ${Math.round(pct)}%，正在生成交接文档...`);
  return "started";
}

export type FinishResult =
  /** 没有待办的交接 */
  | { status: "idle" }
  /** 期间切了项目/会话,这份交接已无处安放,作废 */
  | { status: "stale" }
  /** 没拿到文档(模型没照做/被中止/报错),保留原会话 */
  | { status: "no-doc" }
  /** 已开新会话并把交接文档发过去 */
  | { status: "handed-off" }
  /** 新会话的开场白没送出去(连接断了) */
  | { status: "not-sent" };

/**
 * 第二步:交接文档那一轮结束后收尾。由 useAutoHandoff 在「流式刚结束」时调用。
 *
 * 任何一步不对就什么都不做、保留原会话 —— 宁可让用户手动处理,也不能把一个
 * 空交接塞进新会话,那等于悄悄扔掉整段上下文。
 */
export function finishHandoffIfPending(): FinishResult {
  if (!pending) return { status: "idle" };
  const ctx = pending;
  pending = null;

  const chat = useChatStore.getState();
  if (
    useUIStore.getState().projectPath !== ctx.projectPath ||
    chat.currentSessionId !== ctx.sessionId
  ) {
    return { status: "stale" };
  }

  const doc = extractHandoffDoc(chat.messages, ctx.fromIndex);
  if (!doc) {
    // 刻意不自动重试:走到这里最常见的原因是用户自己按了停止,或者那一轮报错。
    // 每轮结束都再问一次模型要文档,既费钱又烦人,而且用户明明刚表达过「别弄」。
    // 状态栏说清楚就够了,他想交接可以点上下文栏里的「立即交接到新会话」。
    chat.setStatusText("自动交接未完成：没拿到交接文档，已保留当前会话");
    setTimeout(() => useChatStore.getState().setStatusText(""), 6000);
    return { status: "no-doc" };
  }

  const opening = buildHandoffOpeningPrompt(doc, ctx.pct);

  // 先发再清:发不出去就保留原会话原样。反过来做的话,连接一断就成了
  // 「旧会话被清掉、新会话也没起来」——用户眼前一片空白,交接文档也没了。
  //
  // 这条不带 sessionId、不带 continueActive:后端 tryReuseLive 因此不会复用常驻进程,
  // 而是收尾旧进程重开一个 —— 新会话的上下文是真的空的,不是「摘要 + 残留」。
  // (WS 事件要等本函数跑完才轮到,所以先发不会让 session_init 抢在清空之前落地。)
  const sent = wsService.send("send_message", {
    prompt: opening,
    ...buildEngineParams(),
  });
  if (!sent) {
    chat.setStatusText("网络未连接，交接未执行，当前会话保持原样");
    setTimeout(() => useChatStore.getState().setStatusText(""), 6000);
    return { status: "not-sent" };
  }

  startNewSession();
  useChatStore.getState().addHandoffEvent(ctx.pct, ctx.sessionId || undefined);
  useChatStore.getState().addUserMessage(opening);
  useChatStore.getState().startStreaming();
  useChatStore.getState().setStatusText("已交接到新会话，正在接手...");
  return { status: "handed-off" };
}

/** 仅供测试/异常恢复:丢弃待办的交接。 */
export function resetHandoff(): void {
  pending = null;
}
