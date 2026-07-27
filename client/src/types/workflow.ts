/** 单步失败时的处置方式 */
export type FailureAction = "ask" | "retry" | "skip" | "abort";

export interface WorkflowStep {
  agent: string | null;
  prompt: string;
  /**
   * 该步产出登记为哪个变量名。声明后，后续步骤可用 `$名称` 引用它的输出。
   *
   * 可选：不声明就不产生变量，仅靠会话上下文自然延续 —— 简单场景零配置。
   */
  outputVar?: string;
  /**
   * 该步失败时怎么办。缺省 "ask"：暂停并询问用户。
   *
   * 不默认自动跳过或自动重试：错误会顺着数据传递链条扩散进后续步骤，
   * 让用户看一眼比省一次点击重要。
   */
  onFailure?: FailureAction;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  /** 运行前需要用户填写的输入变量名 */
  variables: string[];
  /**
   * 数据格式版本，缺省视为 1（编排引擎上线前创建的工作流）。
   *
   * 新增字段一律可选、读取时按缺省值补全，所以不需要迁移脚本，
   * 用户已有的工作流不必重建。
   */
  version?: number;
}
