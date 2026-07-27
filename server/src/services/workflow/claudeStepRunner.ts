import type { StepRunner, StepRunInput, StepResult } from "./stepRunner.js";

/**
 * 把「事件驱动的一轮对话」包装成「await 一次拿到结果」。
 *
 * 这是编排引擎与真实会话之间的适配层。引擎要的是 `await runStep()` 拿结果，
 * 而底层是 start() 发起 + task_complete 事件通知完成 —— 中间这层转换正是
 * 本文件的全部职责。
 *
 * **不在这里重新实现「怎么发起一轮」**：那套逻辑（代理、供应商解析、附件、
 * 进程指纹、resume 判定）有几百行且已内联在 chatHandler 的 send_message 分支里，
 * 复制一份必然漂移。所以发起动作由外部注入，本类只管等待与收集。
 */

/** 一轮对话结束时的载荷（task_complete 事件的相关字段） */
export interface TurnCompletePayload {
  sessionId?: string;
  /** SDK 给出的最终结果文本 */
  result?: string;
  isError?: boolean;
  subtype?: string;
}

/** 助手输出的增量文本 */
export interface AssistantTextPayload {
  text?: string;
  isPartial?: boolean;
}

/** 错误事件 */
export interface TurnErrorPayload {
  code?: string;
  message?: string;
}

type Handler = (payload: never) => void;

/** 编排执行一步所需的底层能力，由 chatHandler 注入 */
export interface TurnController {
  /** 发起一轮对话（等价于用户发出一条消息）。抛错视为该步失败。 */
  startTurn(input: { prompt: string; agent: string | null }): Promise<void>;
  /** 中断当前这一轮 */
  interrupt(): void;
  /** 订阅事件；返回取消订阅的函数 */
  on(event: "task_complete", handler: (p: TurnCompletePayload) => void): () => void;
  on(event: "assistant_text", handler: (p: AssistantTextPayload) => void): () => void;
  on(event: "error", handler: (p: TurnErrorPayload) => void): () => void;
  on(event: "close", handler: (p: unknown) => void): () => void;
  on(event: string, handler: Handler): () => void;
}

export interface ClaudeStepRunnerOptions {
  /**
   * 单步超时（毫秒）。0 或未设表示不限时。
   *
   * 默认不限时：编排的一步可能是「跑完整套测试」这类长任务，武断地设个上限
   * 只会让正常任务被误杀。真要停由用户点停止（走 AbortSignal）。
   */
  timeoutMs?: number;
}

export class ClaudeStepRunner implements StepRunner {
  constructor(
    private readonly ctl: TurnController,
    private readonly opts: ClaudeStepRunnerOptions = {}
  ) {}

  async runStep(input: StepRunInput, signal?: AbortSignal): Promise<StepResult> {
    // 进来就先看一眼:用户可能在上一步结束后、这一步开始前点了停止
    if (signal?.aborted) {
      return { ok: false, reason: "已停止", aborted: true };
    }

    return new Promise<StepResult>((resolve) => {
      const cleanups: (() => void)[] = [];
      let settled = false;
      /** 累积的助手文本，作为 task_complete.result 为空时的兜底产出 */
      let streamed = "";

      const finish = (result: StepResult) => {
        if (settled) return;
        settled = true;
        // 无论成功失败都必须解绑:这些监听器挂在长生命周期的会话对象上，
        // 漏解一次就会随每步执行不断累积，最终触发 MaxListenersExceeded
        // 并让后续步骤收到本该属于前面步骤的事件。
        for (const off of cleanups) {
          try {
            off();
          } catch {
            /* 解绑失败不影响结果 */
          }
        }
        resolve(result);
      };

      // ── 先注册监听，再发起 ──
      // 顺序不能反:startTurn 之后事件可能同步或极快到达，先发后订会漏掉，
      // 表现为这一步永远等不到完成。
      cleanups.push(
        this.ctl.on("assistant_text", (p) => {
          if (typeof p?.text === "string") streamed += p.text;
        })
      );

      cleanups.push(
        this.ctl.on("task_complete", (p) => {
          // isError 是 SDK 给出的硬信号，比解析文本内容可靠
          if (p?.isError) {
            finish({
              ok: false,
              reason: p.result?.trim() || "任务以错误结束",
            });
            return;
          }
          const output = (p?.result ?? "").trim() || streamed.trim();
          if (!output) {
            // 空产出按失败处理:后续步骤若引用了这一步的变量，拿到空字符串
            // 会静默产生无意义的提示词，不如在这里停下来让用户看见。
            finish({ ok: false, reason: "该步没有产生任何输出" });
            return;
          }
          finish({ ok: true, output });
        })
      );

      cleanups.push(
        this.ctl.on("error", (p) => {
          finish({ ok: false, reason: p?.message || p?.code || "执行出错" });
        })
      );

      cleanups.push(
        this.ctl.on("close", () => {
          // 进程结束却没等到 task_complete —— 这一步没有可信的产出
          finish({ ok: false, reason: "会话进程已结束，该步未能完成" });
        })
      );

      // ── 中断 ──
      if (signal) {
        const onAbort = () => {
          this.ctl.interrupt();
          finish({ ok: false, reason: "已停止", aborted: true });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }

      // ── 超时（仅在显式配置时启用）──
      const timeoutMs = this.opts.timeoutMs ?? 0;
      if (timeoutMs > 0) {
        const timer = setTimeout(() => {
          this.ctl.interrupt();
          finish({ ok: false, reason: `该步超过 ${Math.round(timeoutMs / 1000)} 秒未完成` });
        }, timeoutMs);
        cleanups.push(() => clearTimeout(timer));
      }

      // ── 发起 ──
      this.ctl.startTurn({ prompt: input.prompt, agent: input.agent ?? null }).catch((err) => {
        finish({
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }
}
