/**
 * 「这一轮要不要从历史分叉」的判定。
 *
 * 背景：resume 会锁定该会话**首轮**的模型与推理力度 —— 后续轮次即使传了新值
 * 也不生效。所以当用户中途换模型/换力度时，必须 forkSession：从原历史分叉出
 * 新会话并应用新设置，这样既让改动立即生效，又保留上下文。
 *
 * 从 start() 里抽出来是为了能测。它把四个独立条件绞在一起，而判错的后果都是
 * 静默的：
 *   - 该 fork 却没 fork → 用户换了模型却没反应，以为设置坏了
 *   - 不该 fork 却 fork → 每轮都分叉出新会话，历史被切碎
 */

export interface ForkDecisionInput {
  /** 本轮 resume 的目标会话；没有则是全新会话 */
  sessionId?: string | null;
  /** 本轮请求的模型（短别名） */
  model?: string;
  /** 该会话上次请求的模型；undefined = 没有记录 */
  prevModel?: string;
  /** 本轮的力度组合键 */
  effortKey: string;
  /** 该会话上次的力度组合键；undefined = 没有记录 */
  prevEffort?: string;
  /** 调用方显式要求分叉（如从某个 checkpoint 派生） */
  explicitFork?: boolean;
}

export interface ForkDecision {
  fork: boolean;
  /** 触发原因，用于日志；无需分叉时为 null */
  reason: "explicit" | "model-changed" | "effort-changed" | null;
}

/** 力度组合键：推理力度 + ultracode 档共同决定行为，必须一起比 */
export function effortKeyOf(effort?: string, ultracode?: boolean): string {
  return `${effort ?? ""}:${ultracode ? 1 : 0}`;
}

export function decideFork(input: ForkDecisionInput): ForkDecision {
  if (input.explicitFork) return { fork: true, reason: "explicit" };

  // 没有 sessionId = 全新会话，本来就没有历史可分叉
  if (!input.sessionId) return { fork: false, reason: null };

  // prevModel === undefined 表示这个会话还没有记录过模型（首轮）。
  // 此时不能判为「变了」—— 首轮本来就在设定模型，分叉毫无意义且会白白多出
  // 一个空会话。
  const modelChanged =
    !!input.model && input.prevModel !== undefined && input.prevModel !== input.model;
  if (modelChanged) return { fork: true, reason: "model-changed" };

  const effortChanged =
    input.prevEffort !== undefined && input.prevEffort !== input.effortKey;
  if (effortChanged) return { fork: true, reason: "effort-changed" };

  return { fork: false, reason: null };
}
