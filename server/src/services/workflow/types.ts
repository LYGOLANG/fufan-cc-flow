/**
 * 工作流的数据结构与运行态类型。
 *
 * 这里同时是服务端 Workflow 的单一定义处 —— 此前它内联在 workflowService.ts
 * 里，与前端 client/src/types/workflow.ts 各存一份，加字段时容易只改一边。
 * 两侧结构必须保持一致（同一份 JSON 文件的读写双方）。
 */

/** 单步失败时的处置方式 */
export type FailureAction = "ask" | "retry" | "skip" | "abort";

export interface WorkflowStep {
  agent: string | null; // null = main session
  prompt: string;
  /** 该步产出登记为哪个变量名；不声明则不产生变量 */
  outputVar?: string;
  /** 该步失败时怎么办；缺省 "ask"（暂停询问，不静默继续） */
  onFailure?: FailureAction;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  /** 运行前需要用户填写的输入变量名 */
  variables: string[];
  /** 数据格式版本，缺省视为 1（编排引擎上线前创建的工作流） */
  version?: number;
}

// ── 运行态 ──

/** 单个步骤在一次运行中的状态 */
export type StepStatus =
  | "pending" // 尚未开始
  | "running" // 执行中
  | "succeeded"
  | "failed" // 已失败，等待处置
  | "skipped" // 用户选择跳过
  | "aborted"; // 整个运行被中止时，未执行/未完成的步骤

export interface StepState {
  index: number;
  status: StepStatus;
  /** 成功时的文本产出 */
  output?: string;
  /** 失败原因 */
  error?: string;
  /** 已执行次数（含重试），用于界面提示与防呆 */
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

/** 整次运行的状态 */
export type RunStatus =
  | "running"
  | "awaiting" // 某步失败，停下来等用户处置
  | "completed" // 全部步骤走完（含被跳过的）
  | "aborted"; // 用户中止，或步骤策略为 abort

export interface RunState {
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  /** 当前所在步骤序号；结束后指向最后处理到的那一步 */
  currentStep: number;
  steps: StepState[];
  /** 变量表：初始为用户填写的输入变量，随步骤产出不断累积 */
  variables: Record<string, string>;
  startedAt: number;
  finishedAt?: number;
  /** 结束时的说明（中止原因等） */
  message?: string;
}

/** 用户对「某步失败」的处置 */
export type Resolution = "retry" | "skip" | "abort";
