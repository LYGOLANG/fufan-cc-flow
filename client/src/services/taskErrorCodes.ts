/**
 * 「这一轮压根没起来」的错误码。
 *
 * 单独成文件是有原因的：这份集合同时决定两处状态
 *   - services/websocket.ts  → 项目标签的「运行中」指示
 *   - hooks/useWebSocket.ts  → 聊天面板的 isStreaming
 * 两边曾各自演化，导致「标签在闪 / 面板说结束了」的自相矛盾。
 *
 * 而且它必须能被单测直接引用。此前测试在自己文件里**抄了一份**，
 * 于是漏掉 UNKNOWN_PROVIDER / PROVIDER_NOT_CONFIGURED 时测试照样全绿 ——
 * 测的是抄件，不是生产值。放在这个无依赖的模块里，测试引它才有意义。
 *
 * 判据只有一条：**服务端发完这个 error 之后，还会不会有终态事件跟上？**
 *   不会 → 进这里（否则界面永久卡在「运行中」）
 *   会   → 不要进（否则任务还在跑，指示灯却灭了，回复也会被丢弃）
 */
export const TASK_NEVER_STARTED_CODES: ReadonlySet<string> = new Set([
  // 参数/环境校验失败，进程根本没启动
  "START_FAILED",
  "NO_PROJECT",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "INVALID_PROJECT",
  "INVALID_PROJECT_KEY",

  // chatHandler.ts:442/450 —— 选了第三方供应商但没配 Key，直接 break，
  // 不发任何终态事件。漏掉它们会让本机模式永久卡在「正在思考…」。
  "UNKNOWN_PROVIDER",
  "PROVIDER_NOT_CONFIGURED",

  // chatHandler.ts:777 —— engine.run() 抛异常时只发这一条，
  // 而 workflow_start 已经把 busy 置了 true。
  "WORKFLOW_ERROR",
]);

/**
 * 服务端真正的「一轮结束」事件。
 *
 * 注意 `error` **不在**其中：服务端在任务运行中也会发 error
 * （COMPACT_FAILED / PROCESS_ERROR / RETRY_FAILED / EXECUTION_ERROR…），
 * 那时任务还在跑、还在计费。是否终结要按上面的错误码单独判。
 */
export const TERMINAL_EVENTS: ReadonlySet<string> = new Set([
  "task_complete",
  "process_close",
  "aborted",
]);
