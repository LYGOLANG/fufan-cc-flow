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

  // codexAgentService.ts 的 proc.on("error") —— 进程压根没 spawn 起来
  // （可执行文件缺失、权限不足等）。Node 在 spawn 失败时只发 'error'、
  // 不发 'close'，所以服务端那侧已补发 close；这里再兜一层，
  // 不把「界面能否恢复」全押在服务端记得补发上。
  "SPAWN_ERROR",

  // ── 下面三条是把 error 移出终态集合时漏掉的，独立审查发现 ──
  //
  // 判据没变，还是那一条：**服务端发完它，后面还会不会有终态事件跟上？**
  // 漏掉的原因是当初只按「听起来像不像运行中的错误」分类，而没有逐条去看
  // 服务端发完之后到底还发不发别的。教训：分类要看代码，不能看名字。

  // claudeAgentService.ts:1263 —— SDK 回 is_error / error_during_execution 的
  // result（触碰 maxBudgetUsd 上限、上下文超限、工具致命失败）时 emit 后直接
  // return，常驻进程**不退出**，因此没有 close/task_complete 跟上。
  // 注意 Codex 侧同名码后面有 proc.on("close")，两边不对称 —— 但多熄一次灯无害，
  // 少熄一次就是永久卡死，所以统一收进来。
  "EXECUTION_ERROR",

  // chatHandler.ts:684 —— 无常驻进程时压缩，且 claude.start() 抛异常
  // （CLI 路径解析失败、projectPath 为空）。进程根本没起来，之后不会有任何事件。
  "COMPACT_FAILED",

  // chatHandler.ts:642 —— Codex 引擎不支持 /compact，forward 后直接 break。
  // 而 ContextBar 点了就 startStreaming("正在压缩上下文...")，没有这条会永久转圈。
  "UNSUPPORTED",
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
