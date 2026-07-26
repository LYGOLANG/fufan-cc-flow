# Fufan-CC Flow — Claude Code 项目指南

## 交流语言

- 始终使用中文回答用户。

## 项目简介

Fufan-CC Flow（发布名 **Agent Flow**）是 Claude Code 的图形化桌面客户端：**Tauri 2 外壳 + WebView2**，Node 后端以 **sidecar 二进制**随应用一起分发。通过 **Claude Agent SDK** 把 Claude Code CLI 的能力以友好 UI 呈现，并支持 **Claude / Codex 双引擎**切换。

功能包括：实时对话流、Tool Call 可视化、HIL 权限确认、Session 管理、上下文压缩（手动 + 达阈值自动）、MCP 管理、Memory 管理、终端集成、Sub-Agent 树、内置浏览器面板、桌面自动更新。

同一套前后端代码也能以纯 Web 模式跑（`pnpm dev`），这是日常开发调试的方式；桌面安装包由 `pnpm package:desktop` 产出。

## 项目结构

```
fufan-cc-flow/
├── client/          # 前端 React 19 + Vite + TypeScript + Tailwind CSS + Zustand
│   ├── src/
│   │   ├── components/   # UI 组件（layout / chat / ide / modals / manage / settings / …）
│   │   ├── pages/        # 整页视图（SettingsPage）
│   │   ├── stores/       # Zustand 状态管理（每功能域一个 store）
│   │   ├── hooks/        # 自定义 Hook（useWebSocket / useAutoCompact 等）
│   │   ├── services/     # HTTP / WebSocket 客户端
│   │   └── utils/        # 前端工具（costCalculator / sendPayload / autoCompact / …）
│   ├── src-tauri/   # Tauri 桌面外壳（Rust）：sidecar 启停、看门狗、更新器、打包配置
│   └── tests/       # 前端单测（node 原生 test runner）
├── server/          # 后端 Node.js + Express + WebSocket (ws) + TypeScript
│   └── src/
│       ├── routes/       # REST API 路由
│       ├── services/     # 业务逻辑（claudeAgentService / codexAgentService / …）
│       ├── websocket/    # WebSocket 处理（chat / terminal）
│       └── utils/        # 工具函数（pathUtils / logger / …）
├── desktop/crates/  # 桌面端共享 Rust crate（cc-core）
├── scripts/         # package-desktop.mjs 等构建脚本
├── eslint.config.mjs
├── package.json
└── pnpm-workspace.yaml
```

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面外壳 | Tauri 2（Rust + WebView2），Node 后端为 sidecar 二进制 |
| 前端框架 | React 19 + Vite + TypeScript |
| UI 样式 | Tailwind CSS v4（Void Console 设计系统） |
| 前端状态 | Zustand（功能域独立 Store） |
| 后端框架 | Node.js + Express + ws |
| AI 集成 | `@anthropic-ai/claude-agent-sdk`（Claude）/ Codex CLI（Codex 引擎） |
| 终端 | node-pty + xterm.js |
| 代码查看 | react-syntax-highlighter（Prism） |
| 静态检查 | ESLint 9 + typescript-eslint + react-hooks / Prettier |
| 包管理 | pnpm workspace (Monorepo) |

## 开发命令

```bash
pnpm dev              # 同时启动前后端开发服务器（前端 :5273，后端 :3001）
pnpm build            # 构建生产版本
pnpm typecheck        # TypeScript 类型检查（前后端）
pnpm test             # 单元测试（node 原生 test runner）
pnpm lint             # ESLint —— 只抓 bug 类问题，风格交给 Prettier
pnpm lint:fix         # 自动修可修的部分
pnpm format           # Prettier 格式化
pnpm package:desktop  # 打包 Windows 桌面安装包（NSIS）
```

## 代码规范

- TypeScript 严格模式，所有组件和服务均有类型
- 组件文件 PascalCase（`ChatPanel.tsx`），服务/工具文件 camelCase（`sessionManager.ts`）
- 使用 Tailwind CSS utility classes，不写自定义 CSS 文件
- 前端状态管理：Zustand，每个功能域独立 Store（`chatStore`, `uiStore`, `agentStore` 等）
- 后端分层：`routes` → `services` → `utils`，路由只做参数校验和调用转发

## 关键架构决策

- **Agent SDK 集成**：对话流通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 实现，支持 HIL 权限回调
- **双引擎 + 两级供应商**：`engine` 选 Claude / Codex；供应商（Anthropic 官方、Codex、各兼容端点）→ 模型 两级切换，每个项目独立记住自己的选择（`projectSelections`）
- **通信协议**：WebSocket 处理对话流和终端 I/O，REST API 处理配置管理（MCP/Memory/Settings）
- **桌面外壳**：Rust 侧负责拉起/回收 Node sidecar（退出时按进程树 kill，启动时清理孤儿）、WebView 心跳看门狗（渲染进程崩溃自动重载）、minisign 签名的自动更新
- **发送参数收口**：`send_message` 的引擎参数一律由 `client/src/utils/sendPayload.ts` 的 `buildEngineParams()` 组装。后端 `spawnFingerprint` 会把 effort / thinkingBudget / maxBudget 算进常驻进程指纹，少带一个字段就会触发无谓的杀进程重启——不要在调用点手写这组字段
- **跨平台**：路径统一用 `path.normalize`，Windows 下路径哈希先将 `\` 转换为 `/`
- **安全**：API Key 仅存本地不写日志，文件写操作校验路径在项目目录内；后端只绑 `127.0.0.1`，CLI 调用一律绝对路径 + 数组 argv（不用 `shell:true`）

## 前端设计系统（Void Console）

核心颜色：

| 用途 | 值 |
|------|----|
| 全局背景 | `#13111C` (obsidian-900) |
| 主操作色 | `#d97757` (amber-glow) |
| 品牌/AI 色 | `#7c3aed` (purple-glow) |
| 文字层级 | white → slate-200 → slate-300 → slate-400 |

关键规则：

- 文字颜色用 `slate-*`，**不用** `obsidian-*`（obsidian-500 = `#2D2845` 近乎纯黑）
- 面板背景用内联 `rgba()` style，不用 Tailwind `bg-obsidian-*`
- 主操作按钮：`bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium`
- 光晕环境仅在 Sidebar **外**的中/右区域，Sidebar 本身无光晕

## 注意事项

- `node-pty` 需要本机编译（`node-gyp`），安装前确认 Python 和 C++ 构建工具已就位
- Windows 下 Claude Code CLI 需要 Git Bash，路径由 `CLAUDE_CODE_GIT_BASH_PATH` 环境变量覆盖
- 权限请求（HIL）超时为 60 秒，超时后自动拒绝
- 单次任务费用上限在 **设置 → 应用 → 任务费用上限** 配置（0 = 不限制），落到 SDK 的 `maxBudgetUsd`
- 上下文达阈值自动压缩在 **上下文栏 → 压缩上下文** 里调（默认 95%，拖到 100% 关闭）。只在一轮对话结束时判定，打开已经很满的旧会话不会被误压
- 模型显示名在三处各存了一份（`client/src/types/claude.ts` 的 `MODEL_LABELS`、`server/src/routes/system.ts` 的 `FALLBACK_MODELS`、`SlashCommandMenu.tsx` 的 `/model` 子命令），改一处要三处同步——曾经漂移成同一别名两个代次
- 打包前先确认没有残留的 sidecar `node.exe` 占着 `server-dist`，否则 EBUSY（按命令行精确 kill，别按名字批量杀）
