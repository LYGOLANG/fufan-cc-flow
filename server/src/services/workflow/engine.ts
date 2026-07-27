import type { StepRunner, StepResult } from "./stepRunner.js";
import type {
  Workflow,
  WorkflowStep,
  RunState,
  StepState,
  Resolution,
  FailureAction,
} from "./types.js";

/**
 * 工作流编排状态机。
 *
 * ⚠️ 本文件必须保持**零传输层依赖**：不 import Express、ws、http 或任何
 * Node 服务端设施。它只认 StepRunner 接口。这是 Product-Spec 第 11.2 节的
 * 决策落点 —— 将来迁到纯 Rust 时，这套逻辑是翻译，不是重新设计。
 * Phase 12 的验收标准里有一条 grep 断言专门盯这件事。
 *
 * 设计要点：
 *
 * 1. **顺序的依据是「上一步真的结束了」**，不是模型说自己做完了。
 *    runner.runStep() 返回即视为该步结束，这个保证由实现方提供。
 *
 * 2. **失败默认停下来问人**。错误会顺着变量传递链条扩散进后续步骤，
 *    自动跳过或自动重试省下的那一次点击，远不如让用户看一眼值钱。
 *    想要自动化的人可以把某步的 onFailure 显式设成 retry/skip/abort。
 *
 * 3. **中断要立刻生效**。用户点停止时不能等当前步骤慢慢跑完，
 *    AbortSignal 透传给 runner，且每步开始前重新检查一次。
 */

/** 变量替换：把 `$名称` 换成实际值 */
export function substituteVariables(text: string, vars: Record<string, string>): string {
  let out = text;
  // 长名优先：否则 $ab 会被 $a 先替换掉一半，剩下一个孤零零的 "b"
  const names = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const name of names) {
    out = out.replaceAll(`$${name}`, vars[name] ?? "");
  }
  return out;
}

/** 运行过程中每次状态变化的回调 */
export type RunObserver = (state: RunState) => void;

export interface EngineOptions {
  workflow: Workflow;
  /** 用户在运行前填写的输入变量 */
  inputs?: Record<string, string>;
  runner: StepRunner;
  /** 每次状态变化时回调，用于向前端推送进度 */
  onChange?: RunObserver;
  /** 现在几点。抽出来是为了测试可控，不必等真实时间流逝 */
  now?: () => number;
}

export class WorkflowEngine {
  private readonly workflow: Workflow;
  private readonly runner: StepRunner;
  private readonly onChange?: RunObserver;
  private readonly now: () => number;
  private readonly abortController = new AbortController();

  private state: RunState;
  /** 停在某步等用户处置时，用它把 resolve 交回给运行循环 */
  private pendingResolution: ((r: Resolution) => void) | null = null;

  constructor(opts: EngineOptions) {
    this.workflow = opts.workflow;
    this.runner = opts.runner;
    this.onChange = opts.onChange;
    this.now = opts.now ?? (() => Date.now());

    this.state = {
      workflowId: opts.workflow.id,
      workflowName: opts.workflow.name,
      status: "running",
      currentStep: 0,
      steps: opts.workflow.steps.map((_, index) => ({
        index,
        status: "pending",
        attempts: 0,
      })),
      variables: { ...(opts.inputs ?? {}) },
      startedAt: this.now(),
    };
  }

  getState(): RunState {
    // 返回快照，避免外部拿到内部引用后改坏状态
    return {
      ...this.state,
      steps: this.state.steps.map((s) => ({ ...s })),
      variables: { ...this.state.variables },
    };
  }

  /** 用户对「当前失败的这一步」作出处置 */
  resolve(resolution: Resolution): boolean {
    if (this.state.status !== "awaiting" || !this.pendingResolution) return false;
    const fn = this.pendingResolution;
    this.pendingResolution = null;
    fn(resolution);
    return true;
  }

  /** 中止整个运行 */
  abort(reason = "已手动停止"): void {
    if (this.isFinished()) return;
    this.abortController.abort();
    // 若正停在等待处置，先把它放行，让运行循环走到收尾
    if (this.pendingResolution) {
      const fn = this.pendingResolution;
      this.pendingResolution = null;
      fn("abort");
    }
    this.finish("aborted", reason);
  }

  private isFinished(): boolean {
    return this.state.status === "completed" || this.state.status === "aborted";
  }

  /** 跑完整个工作流；返回最终状态 */
  async run(): Promise<RunState> {
    for (let i = 0; i < this.workflow.steps.length; i++) {
      if (this.abortController.signal.aborted) break;

      this.state.currentStep = i;
      const step = this.workflow.steps[i];
      const outcome = await this.runStepWithRetry(i, step);

      if (outcome === "aborted") {
        // abort() 已经写好终态，这里只需停止推进
        return this.getState();
      }
      // "succeeded" 与 "skipped" 都继续下一步
    }

    if (!this.isFinished()) this.finish("completed");
    return this.getState();
  }

  /**
   * 执行一步，处理失败与重试。
   * 返回 "succeeded" | "skipped" | "aborted"。
   */
  private async runStepWithRetry(
    index: number,
    step: WorkflowStep
  ): Promise<"succeeded" | "skipped" | "aborted"> {
    // 允许无限次重试：重试是用户主动发起的，不该由引擎设上限
    for (;;) {
      if (this.abortController.signal.aborted) return "aborted";

      const st = this.state.steps[index];
      st.status = "running";
      st.attempts += 1;
      st.startedAt = this.now();
      st.error = undefined;
      this.emit();

      const prompt = substituteVariables(step.prompt, this.state.variables);
      let result: StepResult;
      try {
        result = await this.runner.runStep(
          { prompt, agent: step.agent, index },
          this.abortController.signal
        );
      } catch (err) {
        // runner 抛异常等同于失败，不让它把整个运行炸掉
        result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }

      if (result.ok) {
        st.status = "succeeded";
        st.output = result.output;
        st.finishedAt = this.now();
        // 登记输出变量，供后续步骤引用
        if (step.outputVar) this.state.variables[step.outputVar] = result.output;
        this.emit();
        return "succeeded";
      }

      // ── 失败 ──
      st.finishedAt = this.now();
      st.error = result.reason;

      if (result.aborted || this.abortController.signal.aborted) {
        st.status = "aborted";
        this.emit();
        return "aborted";
      }

      const action: FailureAction = step.onFailure ?? "ask";

      if (action === "skip") {
        st.status = "skipped";
        this.emit();
        return "skipped";
      }
      if (action === "abort") {
        st.status = "failed";
        this.finish("aborted", `第 ${index + 1} 步失败：${result.reason}`);
        return "aborted";
      }
      if (action === "retry") {
        // 自动重试一次就够；再失败则转为询问，避免无人值守时空转
        if (st.attempts <= 1) continue;
        // 落到询问分支
      }

      // action === "ask"（或自动重试已用尽）：停下来等用户
      st.status = "failed";
      this.state.status = "awaiting";
      this.emit();

      const decision = await new Promise<Resolution>((res) => {
        this.pendingResolution = res;
      });

      if (this.abortController.signal.aborted || decision === "abort") {
        if (!this.isFinished()) {
          this.finish("aborted", `已在第 ${index + 1} 步中止`);
        }
        return "aborted";
      }
      if (decision === "skip") {
        st.status = "skipped";
        this.state.status = "running";
        this.emit();
        return "skipped";
      }
      // decision === "retry"：回到循环开头重跑这一步
      this.state.status = "running";
    }
  }

  private finish(status: RunState["status"], message?: string): void {
    this.state.status = status;
    this.state.finishedAt = this.now();
    if (message) this.state.message = message;
    // 中止时把没走到的步骤标出来，界面上不留「一直在等待」的假象
    if (status === "aborted") {
      for (const s of this.state.steps) {
        if (s.status === "pending" || s.status === "running") s.status = "aborted";
      }
    }
    this.emit();
  }

  private emit(): void {
    this.onChange?.(this.getState());
  }
}
