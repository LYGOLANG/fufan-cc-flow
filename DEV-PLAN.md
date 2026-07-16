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
```

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试。
- 四步走全部通过后才能 commit。
- Commit message 用 feat、fix、refactor、chore 前缀。
- 包管理器：pnpm。
