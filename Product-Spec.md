# Product Spec — Agent Flow 纯 Rust 桌面运行时

> 状态：已确认，进入开发  
> 日期：2026-07-16  
> 功能基线：现有 `REQUIREMENTS.md`；本文是本轮架构迁移的最高优先级需求，冲突时以本文为准。

## 1. 目标

把桌面端从「Tauri + Node/Express sidecar + 本地 HTTP/WebSocket」迁移为「Tauri + Rust 核心 + HTML/CSS/TypeScript 前端」。用户界面和功能保持不变，发布包不再携带 Node.js、`server-dist` 或生产 `node_modules`，桌面运行时不开放本地 TCP 端口。

这里的“HTML/CSS”指 WebView 界面继续由 React/Vite 生成 HTML、CSS 和浏览器 JavaScript。前端改写成 Rust/WASM 不在范围内：它不会消除桌面后端风险，只会制造一次没有用户价值的 UI 重写。

## 2. 为什么现在做

- macOS arm64 当前 `.app` 约 459 MB、DMG 约 129 MB，主要负担来自 Node 运行时和生产依赖。
- 复制构建机 Node 曾把 Homebrew 动态库依赖带进安装包，换环境后 sidecar 直接崩溃。
- Node sidecar 当前存在监听 `0.0.0.0` 的风险；本地 HTTP/CORS 也扩大了无必要的攻击面。
- npm 与 Rust 两套依赖、两套进程生命周期、两套日志和发布扫描让打包不可复现、排障成本高。
- 仓库已经存在 `desktop/crates/cc-core`：Claude CLI 流式协议、权限回路、会话恢复和 Rust PTY 已有可运行基础，不需要从零重写 Agent loop。

## 3. 用户与 Job

主用户仍是通过 Agent Flow 同时管理 Claude Code、Codex、项目文件、终端、Skills、MCP、Hooks、Plugins 和工作流的本地开发者。

核心 Job：开发者在桌面端执行和监督 AI 编程任务时，不需要安装或维护额外后端运行时，也不会因本地服务端口、依赖漂移或 sidecar 崩溃丢失任务。

成功信号：现有桌面核心流程全部通过回归，安装包中无 Node 运行时，应用运行期间无后端 TCP 监听，DMG 小于 100 MB。

## 4. 架构决策

| 层 | 目标实现 | 约束 |
|---|---|---|
| 桌面壳 | Tauri v2 / Rust | 单主进程管理所有后台任务生命周期 |
| 前端 | React + TypeScript + HTML/CSS | 保留现有页面、组件、Zustand store 和交互 |
| 请求/响应 | Tauri `invoke` commands | 桌面生产环境禁止通过 HTTP 调本地后端 |
| 流式事件 | Tauri events | 兼容现有聊天事件语义，多项目隔离、后台缓冲、可中断 |
| Claude | Rust 启动 Claude Code CLI，双向 `stream-json` | 保留流式文本/思考、工具调用、权限确认、resume、成本与 hook 事件 |
| Codex | Rust 启动 Codex `app-server`，stdio 协议 | 保留会话、流式事件、审批、图片和推理力度 |
| 终端 | `portable-pty` | 支持创建、输入、resize、关闭与应用退出回收 |
| 文件与配置 | Rust `std::fs`/Serde | 复用现有 JSON/Markdown/TOML 文件格式，不强制迁库 |
| 远程 Web | 后续可选 Axum 适配器 | 只复用 Rust service，不进入桌面安装包、不阻塞桌面迁移 |

## 5. 范围

### P0 · 没有就不能移除 Node

1. 建立统一前端 transport：桌面生产走 Tauri IPC，迁移期浏览器开发可继续走旧 HTTP/WS。
2. Rust 实现文件树、文件读写/搜索、目录浏览、项目初始化、配置和系统探测。
3. Rust 接管 Claude 与 Codex 会话、流式消息、工具结果、权限确认、中断、恢复和多项目并行。
4. Rust 接管 PTY、任务登记、优雅退出和中断恢复提醒。
5. Rust 实现 Providers、MCP、Skills、Hooks、Plugins、Marketplace、Agents、Teams、Memory、Workflows 的现有 CRUD 与文件格式。
6. 前端全部切到 IPC 后，删除 Node sidecar 启动、`server-dist`、Node runtime 下载与桌面本地端口逻辑。
7. 打包、隐私扫描、依赖扫描、安装冒烟和两阶段代码审查通过。

### P1 · 桌面迁移后再做

1. 用 Axum 暴露同一 Rust service，恢复独立浏览器/SSH 隧道部署形态。
2. 为 Windows x64、macOS x64 和 Linux 补完整安装实测与签名流水线。
3. 按实际瓶颈优化前端 chunk，不借架构迁移重做 UI。

## 6. 明确不做

- 不把 React 重写成 Yew、Leptos 或其他 Rust/WASM 前端。
- 不自己实现 Claude/Codex 的模型 Agent loop；Rust 只管理官方 CLI 协议和本地能力。
- 除第 7 节已确认的设置页重构外，不在迁移中改变其他页面布局、视觉语言、会话格式或用户操作路径。
- 不为了“纯 Rust”删除 Skills、Hooks、MCP、插件、子 Agent、权限确认等现有能力。
- 不把旧 Node 和新 Rust 两套后端长期并存；双轨只用于逐模块迁移和回归。

## 7. 兼容与迁移规则

- 前端业务调用必须通过统一 transport，组件和 store 不直接依赖 `fetch`、`WebSocket` 或 Tauri `invoke`。
- 每个迁移模块先建立输入/输出契约测试，再切换桌面 transport；失败时只回滚该模块。
- 现有用户文件、会话记录、provider 配置、项目模板和 CLI 登录状态原地兼容，不要求用户迁移数据。
- 未迁移完成前，发布脚本继续构建当前 Node 版；只有 P0 回归全部通过才能删除 sidecar。
- Rust command 必须校验项目根目录和目标路径，禁止目录穿越；敏感 Key 不回传明文、不写日志。

### 7.1 Provider-first 设置与认证状态

- 设置页以「模型服务」为第一层对象，不再把 Claude Code 的安装、授权和代理步骤当作全局设置主线。
- Anthropic、OpenAI Codex、内置兼容端点和自定义端点使用同一套供应商卡片语义；每家独立展示「未安装 / 未登录 / 未配置 / 已就绪」状态，并在卡片内管理自己的认证、连通性和模型列表。
- Claude Code 与 Codex 的认证真值来自各自 CLI 的官方状态命令；应用不得仅凭历史凭证文件是否存在推断登录状态。CLI 已通过持久登录或官方 `setup-token` 登录时，应用都自动复用同一认证，不要求用户再次认证。
- API Key 与订阅/OAuth 是并列认证方式。切换认证方式只影响当前供应商，不改变其他供应商配置。
- 网络代理和应用更新是独立设置分类，不嵌在 Claude Code 的安装流程中；HTTP/HTTPS 代理可供明确支持它们的供应商和 CLI 共用。SOCKS 只供明确支持的联网组件使用，不得宣称 Claude CLI 支持 SOCKS。
- 设置页头部只表达「设置」本身，不使用当前选中的 Claude/Codex 状态代表整个应用。当前会话头部只显示当前供应商及其真实就绪状态。
- 保留现有视觉语言与中心面板覆盖范围；通过分类导航和按供应商展开减少单页纵向堆叠，不把设置扩展为新的全屏窗口。

## 8. 验收标准

### 核心流程

- Given 用户打开已安装桌面应用，When 发送 Claude 或 Codex 消息，Then 能看到逐步流式文本、思考、工具调用与最终结果，且可以中断和继续会话。
- Given Agent 请求写文件或执行命令，When 权限卡出现并由用户允许/拒绝，Then CLI 收到对应决策，超时自动拒绝。
- Given 两个项目同时运行任务，When 用户切换项目，Then 后台任务不终止、事件不串线，切回后完整重放。
- Given 用户打开终端，When 输入、resize、关闭，Then Rust PTY 正常响应且退出应用后无孤儿进程。
- Given 用户管理文件、配置、MCP、Skills、Hooks、Plugins、Agents、Teams、Memory 或 Workflows，When 执行现有 CRUD，Then 行为和数据格式与迁移前一致。
- Given 用户已经在系统终端完成 `claude` 或 `codex` 登录，When 打开或刷新设置，Then 对应供应商显示「已就绪」，且不会要求重复登录。
- Given 用户打开设置，When 查看模型服务，Then Claude、Codex 与兼容端点处于同一层级，每个供应商显示独立状态；网络代理和应用更新位于独立分类。

### 发布与安全

- `.app`、DMG 和 Windows 安装包中不存在 Node 可执行文件、`server-dist` 或生产 `node_modules`。
- 桌面应用运行时 `lsof`/`netstat` 不出现 Agent Flow 后端监听端口。
- 实际安装产物隐私扫描无 `.env`、数据库、credentials、私钥/证书、用户数据和开发者绝对路径。
- OSV/`cargo audit` 不存在 Critical 或 High；前端与 Rust 编译、契约测试、安装冒烟全部通过。
- macOS arm64 DMG 小于 100 MB；无签名本地测试版明确标注，公开发布必须签名并公证。

## 9. 风险与兜底

| 风险 | 处理 |
|---|---|
| Claude/Codex CLI 协议升级 | 协议解析使用容错枚举，未知事件记录并跳过；固定最小兼容版本并保留协议回归样本 |
| SDK 专属能力在 CLI 不可用 | 以当前 CLI 2.1.210 / Codex 0.132.0 真机协议为准，逐项对照；缺口阻断对应模块切换，不静默降级 |
| 一次性重写回归面过大 | transport 双轨、按模块切换、每步可独立回滚，最终一次删除 sidecar |
| 浏览器部署受影响 | 桌面 P0 完成后用同一 Rust service 增加 Axum adapter，不让 Web 兼容绑架桌面安全边界 |

## 10. 假设

- 用户所说“全部用 Rust + HTML + CSS”接受前端继续使用 TypeScript/React；浏览器最终运行 JavaScript 是 WebView 的必要组成，不属于 Node 后端。
- Claude Code 和 Codex CLI 由用户安装并登录，应用负责探测、启动和协议适配，不把它们重新打进安装包。
- 本轮优先交付 macOS arm64，代码保持 Windows/Linux 可编译，其他平台安装实测列入 P1。
