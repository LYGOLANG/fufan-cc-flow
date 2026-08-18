---
name: host-profiles
description: 设计 Host Adapter、写宿主相关计划任务、执行安装与宿主验证时 read；按具体 Profile 的 installationMethod、hostPaths 与 verificationMethod 执行，不把宿主支持当模糊布尔值。
---

[Profile 字段]
    - id
    - tier：required / optional / experimental
    - distributionModel：分发与封装形态
    - runtimeModel：宿主如何加载与运行
    - uiSurface：UI 呈现表面
    - transport：MCP 传输方式
    - installationMethod：真实安装命令链
    - verificationMethod：真实验证手段
    - hostPaths：宿主侧关键保存路径（marketplace 登记、安装副本、持久数据）
    - fallback：该 Profile 不可用时的降级
    - verifiedAt：最后一次对照官方文档核实的日期

    installationMethod 与 hostPaths 是两宿主差异最大的两个字段，禁止互相套用。
    Claude Code 与 Codex 的安装如今都是“复制进宿主缓存”；Codex 副本在 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`（本地插件 version 为 local），源目录改动不即时生效，需重装并开新会话。

[Claude Code Profile]
    [claude-code-project]
        项目级 `.claude/` 配置，适合项目 Harness 和本地工作流。
        - distributionModel：目录拷贝，非可分发 Plugin
        - installationMethod：把 skills、agents、settings 放进项目 `.claude/`
        - hostPaths：项目根 `.claude/`
        - verificationMethod：会话内 Skill 触发与 hook 生效
        - verifiedAt：2026-07-23

    [claude-code-plugin]
        `.claude-plugin/plugin.json` + Plugin 根 `skills/`、`agents/`、`.mcp.json`。
        - distributionModel：Personal Marketplace，目录或 git 仓库根放 `.claude-plugin/marketplace.json`
        - runtimeModel：安装后宿主加载 Skill、Agent、Hook；MCP Server 随插件启用自动启动
        - uiSurface：无 inline iframe，UI 走本地 Web / Browser
        - transport：stdio MCP 优先
        - installationMethod：`claude plugin marketplace add <目录|owner/repo|url>` → `claude plugin install <plugin-id>@<marketplace>` → `/reload-plugins` 或新会话生效
        - verificationMethod：`claude plugin validate <path>`（可加 `--strict`）、`claude --debug` 看加载详情、会话内组件可发现
        - hostPaths：marketplace 登记 `~/.claude/plugins/known_marketplaces.json`；安装即复制进 `~/.claude/plugins/cache`，副本视为短暂（更新即换目录，旧目录约两周后清理），禁止引用插件目录外文件；跨更新持久数据 `~/.claude/plugins/data/<plugin-id>` 即 `${CLAUDE_PLUGIN_DATA}`，官方推荐用 SessionStart hook 把 node_modules 等依赖装进这里；`${CLAUDE_PLUGIN_ROOT}` 指向安装副本随更新变化，变量替换覆盖组件内容、hook 命令与 MCP 的 command/args/env（不含 cwd）
        - fallback：`claude --plugin-dir <path>` 仅供开发迭代，不构成真实安装证据
        - sandboxNote：宿主沙箱（/sandbox，opt-in）只覆盖 Bash 命令，hook 与 MCP server 不受限；沙箱开启时 bind 127.0.0.1 的测试首跑失败属预期——接受非沙箱回退提示，或 settings 配 sandbox.network.allowLocalBinding = true（企业严格模式只有后者）
        - verifiedAt：2026-07-23

    [claude-code-browser]
        本地 Web UI / Browser Pane；Agent 通信通过 MCP request queue 或已验证 Channel。
        - uiSurface：外部浏览器或宿主 Browser 面板，非内嵌 iframe
        - verificationMethod：UI 真实打开 + UI ↔ Agent 双向闭环证据
        - verifiedAt：2026-07-23

    [claude-chat-app]
        claude.ai / Claude Desktop 聊天端的 MCP Apps 嵌入面（form = mcp-app / hybrid 的 Claude 侧渲染宿主；Claude Code 任何 surface 不渲染嵌入 UI）。
        - tier：默认 optional，需要用户明确要求才升 required
        - runtimeModel：MCP Apps（Stable 扩展 io.modelcontextprotocol/ui，2026-01-26）——Tool `_meta.ui.resourceUri` 指向 `ui://` Resource（mimeType `text/html;profile=mcp-app`），沙箱 iframe 渲染，postMessage JSON-RPC Bridge
        - uiSurface：对话内嵌 iframe（inline / fullscreen），全档位含移动端
        - installationMethod：claude.ai 走自定义 connector（需可达的远程 MCP endpoint）；Claude Desktop 可在本地 MCP server 配置中直连
        - verificationMethod：嵌入渲染截图 + widget 经 Bridge 完成一次 tools/call 往返
        - fallback：claude-code-plugin（tool-only + Browser 路径）
        - verifiedAt：2026-08-02

[Codex Profile]
    [codex-plugin]
        Codex Plugin 安装与运行（CLI / IDE / 桌面共用安装链路）。
        - distributionModel：Codex Plugin，`.codex-plugin/plugin.json` ingestion 契约：name / version（严格 semver）/ description / author.name 必填；interface 的 displayName、shortDescription、longDescription、developerName、category 与 defaultPrompt 必填，capabilities 必须是数组；hooks 不写进 manifest（走默认发现）
        - runtimeModel：安装后宿主加载 Skill、Agent、MCP Server；MCP Apps 嵌入渲染当前不在 Codex 任何 surface 开放（嵌入 UI 属 ChatGPT 聊天端，见 chatgpt-app-ui）
        - uiSurface：无嵌入渲染；UI 走本地 Web——桌面 App 有内置 Browser（可开 localhost、点击输入检查截图），CLI / IDE 无内置 Browser
        - transport：stdio MCP
        - installationMethod：`codex plugin add <plugin-id>@<marketplace>` → 开新会话生效；个人 marketplace（~/.agents/plugins/marketplace.json）为宿主隐式发现无需 marketplace add，非默认路径才 `codex plugin marketplace add`；没有本地路径直装，也没有 `--plugin-dir` 等价物
        - updateFlow：更新本地插件先把 version 改成 `<原版本>+codex.<UTC 时间戳>`（cachebuster，只换 + 后缀不递增版本号）再 `codex plugin add` 重装、开新会话（官方 plugin-creator 更新流程）
        - verificationMethod：无 validate 命令；用 `codex doctor`、TUI 内 `/mcp` 与测试提示词真实触发
        - hostPaths：个人 marketplace 清单 `~/.agents/plugins/marketplace.json`；条目的 source path 以注册的 marketplace 根为基准——`codex plugin marketplace add ~` 时，`./plugins/<plugin-id>` 即 `~/plugins/<plugin-id>`，这是个人惯例；安装副本在 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`（本地插件 version 为 local）
        - fallback：codex-cli-tools
        - verifiedAt：2026-08-02

    [chatgpt-app-ui]
        ChatGPT 聊天端（桌面 / Web）的 MCP Apps 嵌入面（form = mcp-app / hybrid 的 OpenAI 侧渲染宿主）。
        - tier：默认 optional，需要用户明确要求才升 required
        - runtimeModel：按开放 MCP Apps 标准渲染——`_meta.ui.resourceUri` 为标准键，`_meta["openai/outputTemplate"]` 仅存量兼容别名；沙箱 iframe + postMessage JSON-RPC Bridge
        - installationMethod：桌面或 Web 的 Plugins 图形界面安装；本地 marketplace 变更需重启桌面 App 生效
        - verificationMethod：嵌入渲染截图 + widget 经 Bridge 完成一次 tools/call 往返
        - fallback：codex-cli-tools
        - verifiedAt：2026-08-02

    [codex-cli-tools]
        Skill / MCP Tool 可用；不默认有 inline UI。
        - installationMethod：与 codex-plugin 相同的 marketplace 链路
        - verificationMethod：`codex doctor`、TUI 内 `/mcp`、`$` 或 `@` 提及触发 Skill
        - verifiedAt：2026-07-23

    [codex-local-dev]
        本地开发态：源码直跑 MCP Server（手动登记进 `~/.codex/config.toml`）或本地 dev server。
        - tier：experimental，仅供开发迭代
        - 不构成任何 required target 的安装或验证证据
        - verifiedAt：2026-07-23

[验证规则]
    设计、计划和 Checker 必须写具体 Profile ID。
    “Claude Code 支持”“Codex 支持”不是可验证结论。
    required target 的安装验证必须走该 Profile 的 installationMethod，不接受开发态加载替代。
    verifiedAt 过期或字段存疑时，先查官方最新文档再实测，不引用本文件旧值。
