/**
 * 「执行单步」抽象接口 —— 编排引擎与底层会话能力之间的唯一接缝。
 *
 * 为什么要有这一层:编排状态机(顺序推进、变量传递、失败处置)是纯业务逻辑,
 * 而底层「怎么真的把一段提示词跑出结果」在 Node 侧是 claudeAgentService
 * 的事件流,在将来的纯 Rust 运行时里是另一套实现(见 Product-Spec 第 11 节)。
 * 把这条边界画清楚,迁移时只需换实现,状态机原样翻译即可。
 *
 * 因此 engine.ts 只依赖本文件,不得 import 任何 Express / ws / http 类型。
 */

/** 一步执行成功的产出 */
export interface StepSuccess {
  ok: true;
  /** 该步的最终文本产出,用于登记为输出变量 */
  output: string;
}

/** 一步执行失败 */
export interface StepFailure {
  ok: false;
  /** 面向用户的失败原因 */
  reason: string;
  /** 是否因中断而失败(用户主动停止),用于区分「出错」与「被叫停」 */
  aborted?: boolean;
}

export type StepResult = StepSuccess | StepFailure;

export interface StepRunInput {
  /** 变量替换后的最终提示词 */
  prompt: string;
  /** 指定执行该步的 Agent;null / undefined 表示在主会话直接执行 */
  agent?: string | null;
  /** 步骤序号(从 0 起),仅用于日志与事件标注 */
  index: number;
}

export interface StepRunner {
  /**
   * 执行一步并等到它真正结束。
   *
   * 实现方必须保证:返回时该步已经完整结束 —— 这是编排「顺序执行」的全部依据。
   * 不要以模型自称完成为准,要以底层的任务结束信号为准。
   */
  runStep(input: StepRunInput, signal?: AbortSignal): Promise<StepResult>;
}
