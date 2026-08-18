---
name: platform-defaults
description: 需要选择技术栈、宿主路径或安全默认而用户没有明确偏好时 read；直接采用这里的默认减少提问，时效性宿主能力仍查官方文档。
---

[默认技术栈]
    - UI：React + TypeScript + Vite
    - MCP Server：Node.js + TypeScript
    - MCP SDK：@modelcontextprotocol/sdk
    - MCP App：@modelcontextprotocol/ext-apps（form = mcp-app / hybrid 时）
    - Local MCP：stdio
    - State：用户项目目录
    - Build：lockfile + clean install + typecheck + tests + bundle

    用户没有明确偏好时，不发起技术栈问卷。

[Claude Code 默认]
    先区分两个东西：
    - 项目级配置：`.claude/skills/`、`.claude/agents/`、`.claude/settings.json`
    - 可分发 Plugin：`.claude-plugin/plugin.json` 在 Plugin 根；`skills/`、`agents/`、`.mcp.json` 也在 Plugin 根

    封装与安装路径按 `host-profiles.md` 的 claude-code-plugin Profile 执行。
    记住语义：Claude Code 的安装是复制进宿主缓存；`--plugin-dir` 只是开发迭代入口，不是安装。

    交互式 UI 默认路径：
    - Primary：本地 Web UI / Browser Pane + MCP Server
    - UI 必须从 http://127.0.0.1:<port> 或 http://localhost:<port> 打开：loopback→loopback 豁免 Chrome 142+ 的 Local Network Access；禁止 file:// 打开、禁止经 LAN IP 打开后回连 127.0.0.1、禁止公网页面回连本地 server（WebSocket 通道 Chrome 147+ 同样受限）
    - Agent 触发：结构化 request queue 或当前已验证的宿主通道
    - Optional：Channel（只有当前版本可用且用户接受预览风险时）

    不能默认 Claude Code 拥有 ChatGPT / claude.ai 聊天端那样的 inline MCP App iframe；嵌入渲染只在聊天宿主成立。

[Codex 默认]
    只有明确选择 Codex target 时启用。

    候选 Profile：
    - codex-plugin
    - chatgpt-app-ui
    - codex-cli-tools
    - codex-local-dev

    封装与安装路径按 `host-profiles.md` 的 Codex Profile 执行。
    记住语义：Codex 的安装与 Claude Code 相同，都是复制缓存副本——`codex plugin add` 把插件复制进 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`（本地插件 version 为 local），源目录改动需重装并开新会话；无 `--plugin-dir` 等价物，也无 validate 命令。更新流：version 改 `<原>+codex.<UTC 时间戳>`（cachebuster）后重装；个人 marketplace `~/.agents/plugins/marketplace.json` 为隐式发现，无需 marketplace add。

    支持 MCP Apps 嵌入渲染的 Profile 只有聊天端（chatgpt-app-ui；Claude 侧对应 claude-chat-app）：Tool + `ui://` Resource + sandboxed iframe + Host Bridge。
    Codex CLI / IDE / 桌面与 Claude Code 均不渲染嵌入 UI；form = mcp-app 在这些宿主一律 tool-only。

[状态默认]
    - 状态 scope = project
    - Plugin 安装目录只读
    - 大文件保存在磁盘
    - requestId 唯一
    - 写回检查 projectVersion
    - 结果幂等
    - 长任务有 Job 状态机
    - JSON 原子写；复杂项目可升级 SQLite

[安全默认]
    - network deny-by-default
    - filesystem 仅项目目录和明确授权目录
    - 不提供万能 Shell / arbitrary path Tool
    - Secret 不写仓库、日志和模型上下文
    - 删除、覆盖、发布需要确认或可恢复机制
    - HTML / iframe / postMessage 输入都做来源与 Schema 校验
    - CSP 显式列域名

[UX 默认]
    - 高频手势留在 UI 本地
    - 语义任务才触发 Agent
    - Agent 工作状态可见
    - 错误告诉用户如何恢复
    - 结果保留来源和版本
    - 破坏性结果先预览或保留原始版本
    - 自动保存有防抖与状态提示

[首版默认不做]
    - 用户系统
    - 计费
    - 多租户
    - 实时多人协作
    - 云同步
    - 公共商店自动提交
    - 多语言
    - 移动端
    - 任意框架兼容
    - 自建模型 Agent Runtime
