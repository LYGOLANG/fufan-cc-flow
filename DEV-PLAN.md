# Development Plan — Fufan-CC Flow

> 本文件记录项目的开发阶段划分、当前进度和剩余工作。
> 新 session 启动时应首先阅读此文件，了解项目状态后再继续开发。

当前进度：Phase 1、Phase 2 已于 2026-07-08 完成开发并通过编译与服务层冒烟测试。2026-07-16 根据 Product-Spec v1.12 启动纯 Rust 桌面运行时迁移，Phase 3 待开发。

---

## Phase 1: 项目初始化后端 API

**交付内容**：
- 实现项目初始化预检查接口，返回模板源缺失项、目标目录冲突项和可复制项。
- 实现项目初始化执行接口，只复制用户确认的 `.claude`、`.codex`、`.agents`、`AGENTS.md`。
- 保证目标目录路径安全，拒绝不存在、非目录或不可写目标。
- 保证冲突项默认不覆盖，覆盖目录时只替换同名文件，不删除目标目录额外文件。

**关键文件**：
- `server/src/services/projectInitService.ts` — 封装模板项检测、冲突预览、复制执行和路径校验。
- `server/src/routes/projects.ts` — 暴露 `/api/projects/init/preview` 与 `/api/projects/init`。
- `server/src/index.ts` — 注册项目管理路由。

**验收标准**：
- `POST /api/projects/init/preview` 能返回四个模板项的 `missing/conflict/ready` 状态。
- `POST /api/projects/init` 能按用户选择复制目标项，未选择项不复制。
- 目标目录不可写、模板源缺失、目标不是目录时返回明确错误。

---

## Phase 2: Project Picker 添加并初始化项目入口

**交付内容**：
- 在顶部 Project Picker 只保留 `+` 添加项目入口。
- 让 `+` 入口执行完整初始化流程：选择目录、预检查、复制缺失模板项、冲突逐项确认、切换项目。
- 复用现有目录浏览能力选择目标目录。
- 当目标目录存在冲突项时展示逐项确认弹窗，每项支持覆盖或跳过，默认跳过。
- 初始化成功后切换当前项目到目标目录，并刷新文件树、终端工作目录和会话上下文。

**关键文件**：
- `client/src/components/layout/ProjectTabs.tsx` — 增加新建项目入口与初始化弹窗。
- `client/src/services/api.ts` — 增加项目初始化 API 客户端方法和类型。
- `client/src/stores/uiStore.ts` — 复用或补齐当前项目切换状态。
- `client/src/stores/fileStore.ts` — 复用或触发文件树刷新。

**验收标准**：
- 用户能从 Project Picker 打开新建项目流程。
- 用户选择目标目录后能看到冲突项并逐项选择覆盖或跳过。
- 用户确认后能完成复制，并自动切换到新项目目录。
- 取消目录选择或确认弹窗不会改变当前项目。

---

## Phase 3: Tauri IPC transport 与契约地基

**交付内容**：
- 建立统一前端 transport，组件和 store 不再直接绑定 HTTP、WebSocket 或 Tauri API。
- 桌面端新增 Tauri `invoke`/events adapter；Phase 3 仅通过 `VITE_RUST_CHAT=1` 显式开发开关验证，默认仍使用完整 Node adapter，避免未迁移事件静默降级。浏览器开发模式保留现有 HTTP/WS adapter。
- 统一 Rust command 错误结构、事件 envelope 和序列化命名，补 transport 契约测试。
- 接通仓库已有的 Rust Claude 流式链路，验证一条真实消息、权限响应和中断不经过 Node sidecar。

**关键文件**：
- `client/src/services/transport/types.ts` — 定义请求、错误和事件契约。
- `client/src/services/transport/http-chat.ts` — 封装迁移期浏览器 HTTP/WS adapter。
- `client/src/services/transport/tauri-chat.ts` — 封装桌面 invoke/events adapter。
- `client/src/services/transport/chat.ts`、`routing.ts` — 按运行环境和显式开发开关选择唯一 transport。
- `client/src/services/api.ts`、`client/src/services/websocket.ts` — 改为调用统一 transport。
- `client/src-tauri/src/commands/chat.rs`、`client/src-tauri/src/lib.rs` — 对齐 command/event 契约。
- `desktop/crates/cc-core/examples/streaming_check.rs`、`permission_check.rs`、`abort_check.rs` — 真实 CLI 流式、权限和取消生命周期验证。

**验收标准**：
- 开启 `VITE_RUST_CHAT=1` 的桌面开发构建中发送 Claude 消息时，不建立 `/ws/chat`；关闭开关时现有用户行为不变。
- 流式文本、思考、工具调用、权限允许/拒绝、中断和 task complete 与现有前端事件兼容。
- 浏览器开发模式仍能通过旧 Node adapter 运行，便于后续逐模块迁移。
- TypeScript build、Rust tests、`cargo check` 和 transport 契约测试通过。

## Phase 4: 文件、项目、配置与系统能力迁移

**交付内容**：
- 用 Rust 实现文件树、内容读取、搜索、目录浏览、创建、重命名和删除，并保持项目根路径安全校验。
- 用 Rust 实现项目初始化预览/执行、应用配置、代理配置、CLI 探测和健康状态。
- 将对应前端 API 方法切到 Tauri commands，桌面端不再依赖这些 Express routes。

**关键文件**：
- `desktop/crates/cc-core/src/fs/` — 文件与路径安全服务。
- `desktop/crates/cc-core/src/config/` — 配置、代理与 CLI 探测服务。
- `client/src-tauri/src/commands/files.rs` — 文件 commands。
- `client/src-tauri/src/commands/projects.rs` — 项目初始化 commands。
- `client/src-tauri/src/commands/config.rs`、`client/src-tauri/src/commands/system.rs` — 配置和系统 commands。
- `client/src/services/api.ts` — 切换对应 transport 方法。

**验收标准**：
- 文件与项目初始化主路径、冲突/缺失/越界路径错误和删除确认行为与 Node 版一致。
- Provider Key 等敏感配置不回传明文、不写日志，配置文件权限保持现有规则。
- 桌面端完成上述操作时无后端 HTTP 请求；Rust 单元测试覆盖路径穿越和错误映射。

## Phase 5: Rust PTY、任务登记与生命周期

**交付内容**：
- 将 `cc-core` 的 `portable-pty` 接到 Tauri commands/events，支持 create、input、resize、close。
- 用 Rust 接管任务登记、排队、中断、应用退出优雅收尾和上次中断提醒。
- 保持多项目任务并行、切换不终止、关闭标签才收尾的现有行为。

**关键文件**：
- `desktop/crates/cc-core/src/pty/` — 补齐 PTY 生命周期与平台适配。
- `desktop/crates/cc-core/src/task/` — 任务登记和持久化。
- `client/src-tauri/src/commands/terminal.rs`、`client/src-tauri/src/commands/tasks.rs` — IPC adapter。
- `client/src/services/websocket.ts`、`client/src/components/ide/Terminal.tsx` — 切换终端与任务事件 transport。
- `client/src-tauri/src/lib.rs`、`client/src-tauri/src/state.rs` — 退出收尾和状态所有权。

**验收标准**：
- 终端输入、输出、resize、关闭和异常退出通过 macOS 真机冒烟。
- 同时运行两个项目时事件不串线；退出应用后无 Claude、Codex 或 shell 孤儿进程。
- 强制中断后重启，前端能显示被中止任务提醒。

## Phase 6: Claude CLI 功能等价迁移

**交付内容**：
- 完成 `cc-core` Claude `stream-json` 协议适配：会话恢复/分叉、模型与 effort、图片、成本、context compact、hook 事件和后台任务。
- 迁移会话列表、消息历史、checkpoint、rollback/rewind 与附件处理。
- 对照 Node `claudeAgentService` 建立协议样本回归，未知 CLI 事件容错记录。

**关键文件**：
- `desktop/crates/cc-core/src/protocol/`、`desktop/crates/cc-core/src/transport.rs` — Claude 协议与进程 actor。
- `desktop/crates/cc-core/src/session/` — 会话索引、历史和恢复。
- `client/src-tauri/src/commands/chat.rs`、`client/src-tauri/src/commands/sessions.rs`、`client/src-tauri/src/commands/attachments.rs` — IPC adapter。
- `client/src/hooks/useWebSocket.ts`、`client/src/stores/chatStore.ts`、`client/src/stores/sessionStore.ts` — 行为回归。

**验收标准**：
- Product-Spec 的 Claude 主路径 Given/When/Then 全部通过。
- Node 版已有流式事件样本与 Rust 解析结果等价；未知事件不 panic、不终止会话。
- 50 轮 resume、权限超时、中断、图片输入和 checkpoint 回滚冒烟通过。

## Phase 7: Codex app-server 迁移

**交付内容**：
- 用 Rust 管理 Codex 0.132+ `app-server` stdio 生命周期和协议消息。
- 接通 Codex 会话、流式文本/推理、工具审批、图片、模型和推理力度。
- 统一 Claude/Codex 对前端的事件语义，同时保留引擎专属字段。

**关键文件**：
- `desktop/crates/cc-core/src/codex/` — app-server 协议、actor 与兼容版本探测。
- `client/src-tauri/src/commands/codex.rs` — Codex commands。
- `client/src-tauri/src/commands/chat.rs` — 按 engine 路由。
- `client/src/types/claude.ts`、`client/src/hooks/useWebSocket.ts` — 统一事件消费。

**验收标准**：
- Codex 新会话、resume、图片、推理力度、审批和中断真机通过。
- Claude 与 Codex 同时运行时进程、事件和会话互不污染。
- Codex CLI 不存在或版本过低时给可操作错误，不导致应用崩溃。

## Phase 8: 管理能力迁移

**交付内容**：
- 用 Rust 迁移 Providers、MCP、Skills、Hooks、Plugins 和 Marketplace 的现有 CRUD、导入与刷新行为。
- 兼容 Claude/Codex 的现有配置文件、scope 和密钥掩码规则。
- 对每种可创建资源保留删除/卸载路径和冲突处理。

**关键文件**：
- `desktop/crates/cc-core/src/manage/providers.rs`、`mcp.rs`、`skills.rs`、`hooks.rs`、`plugins.rs`、`marketplace.rs` — 领域服务。
- `client/src-tauri/src/commands/manage.rs` — Tauri commands。
- `client/src/services/api.ts`、`client/src/stores/*Store.ts` — transport 切换。

**验收标准**：
- 对应设置/管理面板的加载、创建、修改、删除、空态和错误态通过回归。
- API Key 只返回掩码 hint，配置写入权限正确，路径和名称输入不可逃逸允许目录。

## Phase 9: Agent 编排与知识能力迁移

**交付内容**：
- 用 Rust 迁移 Agents、Teams、Memory、Workflows、后台任务和审计时间线。
- **Workflows 的迁移范围包含 Phase 12-14 建成的编排引擎**，不只是 CRUD：状态机、变量传递与失败处置需按 Phase 12 定义的抽象接口在 Rust 侧重新实现，行为以编排引擎上线后的表现为基准（见 `Product-Spec.md` 第 11.3 节）。
- 保持子 Agent 隔离、任务状态同步、workflow 增删改和运行事件语义。
- 补齐失败/循环/中断状态持久化与重启恢复。

**关键文件**：
- `desktop/crates/cc-core/src/orchestration/` — Agent、Team、Workflow 和任务服务。
- `desktop/crates/cc-core/src/memory/` — 项目与用户记忆服务。
- `client/src-tauri/src/commands/orchestration.rs`、`memory.rs` — IPC adapter。
- `client/src/components/agent/`、`client/src/components/memory/`、相关 stores — transport 切换与回归。

**验收标准**：
- Agent/Team/Workflow/Memory 的 CRUD 与运行路径全部不经过 Node。
- 后台任务状态、审计事件和重启恢复与现有需求一致，失败不会遗留 running 假状态。

## Phase 10: 删除 Node sidecar 与桌面发布

**交付内容**：
- 删除 sidecar 启动、本地端口注入、`server-dist`、Node runtime 准备和桌面 bundle 资源。
- 更新打包脚本、Tauri 配置、隐私门禁和依赖扫描，只发布 Rust 桌面运行时。
- 从 DMG/安装器安装后执行完整功能回归、进程/端口检查和两阶段代码审查。

**关键文件**：
- `client/src-tauri/src/sidecar.rs`、`client/src-tauri/src/lib.rs`、`client/src-tauri/src/state.rs` — 删除 sidecar 与端口状态。
- `client/src-tauri/tauri.conf.json` — 删除 externalBin 和 `server-dist` resources。
- `client/scripts/prepare-sidecar.mjs`、`server/` — 从桌面构建链删除；确认无 Web adapter 依赖后移除。
- `scripts/package-desktop.mjs`、`桌面端打包记录.md` — 纯 Rust 发布与证据。

**验收标准**：
- 安装产物中无 Node、`server-dist`、生产 `node_modules`，应用运行时无后端 TCP 监听。
- macOS arm64 DMG 小于 100 MB，实际产物隐私扫描和 OSV/`cargo audit` 无 Critical/High。
- Claude、Codex、终端、文件、管理面板、多项目任务和退出恢复完整冒烟通过。

## Phase 11（P1）: Rust Web/远程 adapter

**交付内容**：
- 用 Axum 暴露同一 Rust service，恢复独立浏览器与 SSH 隧道部署。
- 非 loopback 监听强制认证，桌面构建不携带、不启动 Web server。
- 复用 transport 契约，避免出现第三套业务实现。

**关键文件**：
- `desktop/crates/cc-server/` — Axum binary 与认证边界。
- `client/src/services/transport/http.ts` — 切换到 Rust Web API。
- `pnpm-workspace.yaml`、根脚本 — Web 开发和发布编排。

**验收标准**：
- 浏览器主路径与桌面 transport 契约测试一致。
- loopback 可无远程认证运行；任何非 loopback 监听都必须配置认证并通过安全测试。

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 包管理 | pnpm workspace | 10.33.1 | 仅管理前端和迁移期 Web adapter |
| 前端 | React | 19.2.7 | 复用现有组件和 Zustand store |
| 前端构建 | Vite | 6.4.3 | 生成 Tauri WebView 的 HTML/CSS/JavaScript |
| 桌面壳 | Tauri | 2.11.3 | commands + events，不开放本地端口 |
| 后端核心 | Rust | edition 2021 / rust-version 1.77.2+ | `cc-core` 承载业务、CLI、会话和 PTY |
| 异步运行时 | Tokio | 1.x | 子进程、流式 I/O、任务与事件 |
| 终端 | portable-pty | 0.9.0 | 跨平台 PTY |
| 类型系统 | TypeScript / Serde | 5.9.3 / 1.x | 统一 camelCase IPC 契约 |
| 远程 Web（P1） | Axum | 实施时锁定当前稳定版 | 与桌面共享 Rust service，不进入桌面包 |

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| 无 | 无 | 本功能不引入数据库，状态来自文件系统和现有前端 store |

## Phase 12: 工作流编排引擎内核（Node 侧，与传输层解耦）

> 本 Phase 及 13、14 属**功能开发**，不在纯 Rust 迁移序列内，优先级高于 Phase 3-11。
> 需求见 `REQUIREMENTS.md` 2.5（F5.1-F5.8），实现位置决策见 `Product-Spec.md` 第 11 节。

**交付内容**：
- 扩展工作流数据结构以承载编排语义：步骤级新增输出变量名与失败策略，字段一律可选，旧工作流文件不加改动即可读取。
- 实现线性编排状态机：顺序推进、变量替换、单步失败后暂停并等待处置（重试/跳过/中止）、可中断。
- 定义「执行单步」抽象接口，状态机只依赖该接口，不 import 任何 Express/ws/HTTP 类型，以保证后续 Rust 迁移是翻译而非重新设计。
- 用 fake 执行器覆盖状态机全部分支的单元测试，不依赖真实模型调用。

**关键文件**：
- `client/src/types/workflow.ts` — `WorkflowStep` 增 `outputVar?`、`onFailure?`；`Workflow` 增 `version?`。
- `server/src/services/workflow/types.ts` — 运行态类型：`RunState`、`StepState`、`StepResult`、`FailureAction`。
- `server/src/services/workflow/stepRunner.ts` — `StepRunner` 接口：`runStep({ prompt, agent, signal }) => Promise<StepResult>`。
- `server/src/services/workflow/engine.ts` — 状态机；变量替换复用现有 `$name` 语法。
- `server/src/services/workflow/engine.test.ts` — fake StepRunner 驱动的分支覆盖测试。

**验收标准**：
- 三步工作流按序推进，第 N+1 步在第 N 步返回后才启动（fake 执行器断言调用顺序）。
- 第 1 步声明 `outputVar`、第 2 步引用 `$var`，第 2 步收到的 prompt 中变量已被实际产出替换。
- 单步失败时状态机停在该步等待处置；重试重跑该步、跳过进入下一步、中止结束整个运行，三条路径均有测试。
- 中断信号触发后不再启动后续步骤，已完成步骤的产出保留在运行态里。
- `engine.ts` 中不出现 Express/ws/http 相关 import（可用 grep 断言）。

## Phase 13: 接入真实执行与运行态反馈

**交付内容**：
- 实现 Node 版 `StepRunner`：复用当前项目会话的 `claudeAgentService`，把事件驱动的一轮任务包装成 Promise（`task_complete` 视为完成，累积 `assistant_text` 作为该步产出，`error`/`close` 视为失败）。
- 新增工作流运行的 WebSocket 协议：启动、逐步状态推送、失败待处置、用户处置指令、运行结束。
- 前端展示运行态：当前第几步、每步状态与耗时、产出可展开、失败原因可见；提供重试/跳过/中止与全局停止。

**关键文件**：
- `server/src/services/workflow/claudeStepRunner.ts` — 事件转 Promise，含超时与中断透传。
- `server/src/websocket/chatHandler.ts` — 新增 `workflow_start` / `workflow_resolve` / `workflow_abort` 入站动作与对应出站事件转发。
- `client/src/stores/workflowStore.ts` — 运行态 store（当前运行、各步状态、待处置项）。
- `client/src/hooks/useWebSocket.ts` — 新增工作流事件分支。
- `client/src/components/agent/WorkflowManager.tsx` — 运行态面板与失败处置交互，替换当前「填入输入框」的执行路径。

**验收标准**：
- 点击执行后工作流真实运行：可在界面看到步骤逐个由等待变为运行中再变为成功，且第 N+1 步确实在第 N 步结束后才开始。
- 步骤间数据传递在真实运行中生效：第 2 步的产出内容体现出它读到了第 1 步的结论。
- 手动制造一步失败（如指定不存在的 Agent）时，运行暂停并弹出处置选项，选择跳过后其余步骤继续。
- 运行中点停止：当前步骤被中止，后续不再启动，已完成步骤产出仍可见。
- 断线重连不产生「运行中」假状态：重连后要么恢复真实运行态，要么明确标记为已中断。

## Phase 14: 工作流编辑器支持编排字段

**交付内容**：
- 编辑器支持为每个步骤配置输出变量名与失败策略，未配置时保持零配置可用。
- 变量面板区分「运行前需填写的输入变量」与「由步骤产出的输出变量」，避免用户混淆。
- 保存前校验：变量名合法、被引用的变量必须在引用步骤之前产出。

**关键文件**：
- `client/src/components/agent/WorkflowManager.tsx` — `WorkflowEditor` 增字段与校验提示。
- `server/src/services/workflowService.ts` — 保存时的服务端校验（前端校验不可信）。
- `server/src/services/workflowService.test.ts` — 校验规则测试。

**验收标准**：
- 新建工作流可为步骤指定输出变量，并在后续步骤的提示词里通过 `$名称` 引用。
- 引用了尚未产出的变量时保存被拒绝，并明确指出是哪一步引用了哪个变量。
- 旧工作流打开后不显示任何报错，保存后仍可被旧版本读取（新增字段可选）。

## Phase 15: 远程连接底座（SSH 隧道 + 远程 sidecar 启动）

> 与 Phase 11 的区别：Phase 11 是 Rust 迁移完成后用 Axum 暴露服务的目标形态；
> 本 Phase 是 Node 阶段的提前实现，不新增服务端组件。迁移完成后，
> 隧道管理与前端代码可沿用，仅把远程跑的进程换成 Rust binary。
> 设计依据见 REQUIREMENTS.md 8.2。

**交付内容**：
- 连接配置模型：`{kind: local|remote, sshTarget, remoteServerPath, remotePort}`，
  持久化到本机配置，含"当前使用哪个连接"的选择。
- `sidecar` 抽象出两种实现：本机 spawn / 远程 spawn。远程实现负责
  ① 经 SSH 启动远程后端并注入本机生成的 `CC_FLOW_AUTH_TOKEN`
  ② 建立 `ssh -L <本地端口>:127.0.0.1:<远程端口>` 转发
  ③ 就绪探测（`/health` 免鉴权，正是为此设计）
  ④ 断开时只清理本次启动的远程进程与隧道。
- `lib.rs` setup 的连接分支：现为 `if cfg!(debug_assertions)` 这一个编译期判据
  同时决定"清孤儿/起 sidecar/写 AppState"三件事，需改为运行时可选的连接策略。
- 退出链路隔离：`RunEvent::ExitRequested` 的 `shutdown_all` 与 `graceful_shutdown`
  当前硬编码 `127.0.0.1`，远程形态下不得对远端广播关闭（那会关掉别人的后端）。
- 远程部署脚本：在目标机器安装 Node 运行时与 server 产物、生成启动命令。

**关键文件**：
- `client/src-tauri/src/sidecar.rs` — 本机/远程两种实现的分派点（现全为本机语义：
  `reserve_port` 绑回环、`reap_orphans` 走 PowerShell CIM、`graceful_shutdown` 硬编码回环 IP）。
- `client/src-tauri/src/lib.rs:64-98` — setup 连接分支与退出链路。
- `client/src-tauri/src/ssh.rs`（新建）— 隧道与远程进程生命周期。
- `scripts/install-remote.sh`（新建）— 远程部署脚本。

**验收标准与当前状态**（截至 v0.1.24 打包）：

| # | 标准 | 状态 |
|---|------|------|
| 1 | 隧道连通且鉴权生效（无令牌/错令牌 401，对令牌 200） | ✅ 实测通过 |
| 2 | 令牌不出现在远程机器的进程列表 | ✅ 实测通过（查 `/proc/<pid>/cmdline`） |
| 3 | 应用退出后远程无残留进程 | ✅ 实测通过 |
| 4 | 未配置远程时行为与现状逐字一致 | ✅ 默认路径不变，有单测 |
| 5 | 连接失败时给出可行动的原因 | ✅ ssh stderr 已翻译（含私钥 ACL 这类反直觉项） |
| 6 | **连上远程后对话可用** | ❌ **未验证** — 靶机未装 Claude Code CLI |
| 7 | 文件树 / 终端在远程下可用 | ❌ 未验证 |
| 8 | 隧道中断时前端有明确提示而非无限重连 | ❌ 未做（前端重连逻辑仍认为后端只是暂时不在） |

第 6 项是硬缺口：后端只是 CLI 的壳，靶机上没有 CLI，对话必然失败。
要验证需在目标机装好 Claude Code CLI **并以运行后端的那个用户登录**。

第 8 项属于 Phase 16 范围（`http-chat.ts:48` 的重连状态机没有"地址失效"概念）。

## Phase 16: 跨机语义修正

> 摸排（2026-07-28）确认的本机假设，逐条消除。这些不修就会以"路径找不到"、
> "对话框卡 120 秒"等形式暴露，且症状与真实原因相距很远。

**交付内容**：
- `connectionStore`：单一事实源，持有 `{kind, remotePlatform, pathSep, label}`。
  平台语义由后端上报，前端不再猜。
- 路径处理去 Windows 化：`uiStore.ts:5` 的 `toLowerCase()` 归一在 Linux 远端会把
  `/Src` 与 `/src` 判为同一目录；`FileTree.tsx:92` 的小写前缀比较同理；
  `FolderBrowserModal.tsx:85`、`:344` 靠"有没有反斜杠"猜分隔符。
- 目录选择：`server/src/routes/system.ts:293` 的 `pick-folder` 会在**后端机器**
  拉起原生对话框（PowerShell / osascript / zenity）。远程 headless 无 DISPLAY，
  会挂到 120 秒超时。远程形态改用应用内目录浏览。
- 外链与预览：`openExternal.ts:16` 在本机开浏览器，`BrowserPanel.tsx:123` 由本机
  网络栈发起请求。AI 回复里的 `localhost:3000` 指的是远程机器，需经隧道映射。
- 拖拽：`InputBar.tsx:102-127` 插入的是本机 OS 绝对路径，远程 Claude 读不到。
  远程形态下改走已有的附件上传路径（`InputBar.tsx:179-191` 那条已是远程安全的）。
- 项目列表按连接分组：`uiStore.ts:137-143` 的最近/打开项目存的是裸路径，
  与"连的哪台后端"无绑定，切换后全是脏数据。

**关键文件**：
- `client/src/stores/connectionStore.ts`（新建）
- `client/src/stores/uiStore.ts`、`client/src/components/ide/FileTree.tsx`、
  `client/src/components/modals/FolderBrowserModal.tsx`、
  `client/src/components/chat/InputBar.tsx`、`client/src/utils/openExternal.ts`

**验收标准**：
- Linux 远端上大小写不同的同名目录被正确区分（构造 `/tmp/A` 与 `/tmp/a` 实测）。
- 远程连接下点"新建项目"不触发后端原生对话框，不出现 120 秒挂起。
- 切换连接后，最近项目列表只显示当前连接下的项目。
- 本机连接的所有行为与 Phase 15 之前逐字一致（回归测试覆盖）。

## Phase 17: 会话共享（在 Phase 15/16 之上叠加协作层）

> 待拍板项见 REQUIREMENTS.md 8.1 决策表 #1、#2，开工前必须先定。

**交付内容**：
- 会话票据：加密封装 `{连接地址, sessionId, 一次性凭据, 过期时间, 权限档位}`，
  可过期、可吊销；Host 能查看当前连接方并踢出（可建必可删）。
- 事件广播：同一会话的事件流分发给多个连接方。
- 发言权控制：会话串行，一轮未完不能插入第二轮（决策 #2）。
- HIL 权限归属（决策 #1）。

**验收标准**：
- 两个客户端连同一会话，一方发消息另一方实时看到完整事件流。
- 票据过期后无法建连；Host 踢出后对方立即断开且无法自动重连。
- Host 拒绝权限请求时，Guest 侧显示明确原因而非静默失败。

## 功能依赖图

```text
Phase 3 IPC 契约
  ├─ Phase 4 文件/项目/配置/系统
  ├─ Phase 5 PTY/任务生命周期
  └─ Phase 6 Claude 等价迁移
       └─ Phase 7 Codex app-server

Phase 4 ─┬─ Phase 8 管理能力
Phase 6 ─┘

Phase 5 ─┬─ Phase 9 Agent 编排/Memory/Workflow
Phase 6 ─┤
Phase 8 ─┘

Phase 4 + 5 + 6 + 7 + 8 + 9
  └─ Phase 10 删除 Node 与发布
       └─ Phase 11 Rust Web/远程 adapter（P1）

功能开发线（独立于迁移序列，优先级更高）：
Phase 12 编排引擎内核
  └─ Phase 13 真实执行与运行态
       └─ Phase 14 编辑器编排字段
            └─ 并入 Phase 9 的 Rust 迁移范围
                 └─ 必须先于 Phase 10（删除 Node sidecar）完成迁移
```

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试。
- 四步走全部通过后才能 commit。
- Commit message 用 feat、fix、refactor、chore 前缀。
- 包管理器：pnpm。
