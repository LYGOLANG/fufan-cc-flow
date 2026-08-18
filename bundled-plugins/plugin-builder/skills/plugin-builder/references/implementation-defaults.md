---
name: plugin-implementation-defaults
description: 开发时项目没有既有技术栈且 Spec / Design 未另行决定时 read；直接采用这里的技术栈、目录与打包默认，有既有约定则继承。
---

[适用范围]
    只在项目没有既有技术栈、Spec / Design 未另行决定时使用。
    当前官方规则和项目先例优先于本默认。

[默认技术栈]
    - Language：TypeScript。
    - Runtime：Node.js 当前稳定 LTS（不低于 22；20 已于 2026 年 EOL），具体版本写入 engines 并在开发时核验。
    - UI：React + TypeScript + Vite。
    - MCP：`@modelcontextprotocol/sdk` ^1.29.0（≥1.26.0 避开 CVE-2026-25536 / CVE-2026-0621；禁止 npm audit fix --force，它会把 SDK 降级进高危区间）；form = mcp-app / hybrid 时使用 `@modelcontextprotocol/ext-apps` ^1.7.5（peer sdk ^1.29.0、zod ^3.25 或 ^4、Node ≥ 20），细则见 [MCP App 形态默认]。
    - Validation：Zod（^4.4.0 起）+ JSON Schema。
    - 自定义 `_meta` key 用插件自己的反向 DNS 前缀；io.modelcontextprotocol/* 与 mcp 保留前缀禁用。
    - MCP Server 必须提供 server instructions（McpServer 构造第二参）说明何时该用这组工具；宿主对工具描述与 instructions 在 2KB 处截断，关键信息前置。
    - contracts JSON Schema 顶层禁用 anyOf / oneOf / allOf（宿主会拍平重写），组合子下沉到属性层。
    - 单次 Tool 结果默认预算 25k tokens：大内容写盘传引用，不整段进结果。
    - Test：Vitest；Browser E2E 按项目选 Playwright。
    - node:test 子测试必须 await t.test(...) 或用 describe/it：Node 20/22 把未 await 的子测试计为失败，Node ≥ 24.3 才自动等待，在 24 上开发不 await 也全绿、换到 22 会挂。
    - Hook 阻断只能 exit 2 或 exit 0 加 decision: block（exit 1 不阻断）；需要读插件 userConfig 的 hook 用 exec form，2.1.207 起 shell-form 命令禁用 ${user_config.*}。
    - Package Manager：继承仓库；新项目优先 npm；lockfile 在项目生成时新鲜产出并提交，之后用 npm ci，模板不预置 lockfile。

[默认目录]

    ```text
    <plugin-name>/
    ├── .claude-plugin/
    │   └── plugin.json
    ├── skills/
    ├── agents/
    ├── .mcp.json
    ├── packages/
    │   ├── contracts/
    │   ├── domain/
    │   ├── mcp-server/
    │   ├── host-bridge/
    │   └── ui/
    ├── tests/
    ├── evidence/
    ├── dist/
    ├── package.json
    └── package-lock.json
    ```

    简单项目可以扁平化，但 Host Adapter、Domain、Contract 与 UI 仍保持职责边界。

[Claude Code-first 默认]
    - 产物是 Claude Code Plugin：`.claude-plugin/plugin.json` 在 Plugin root 下的专用目录里；skills/、agents/、.mcp.json 在 Plugin root。
    - `${CLAUDE_PLUGIN_ROOT}` 只引用 Plugin 自带脚本与资源，不写用户状态。
    - 用户状态放当前项目的 `.<plugin-id>/`。
    - UI Primary Path 依据当前官方能力：本地 Web / Browser / Preview + MCP / request queue；Channel 只在已验证、用户接受 Research Preview 风险时作为增强。MCP Apps 嵌入渲染当前不在 Claude Code 任何 surface 开放，form = mcp-app 的嵌入面走聊天宿主（见 host-profiles claude-chat-app）。
    - Plugin root `CLAUDE.md` 不作为已安装 Plugin 指令来源；指令放 Skill。

[默认 State]
    - Authority：项目本地 JSON；状态关系复杂或并发高时用 SQLite。
    - `schemaVersion`、`projectVersion`、`requestId` 必需。
    - 写入：temp + atomic rename。
    - 资源：assets / outputs / cache 分离。
    - cache 可重建，outputs 和项目状态不可被无确认清理。

[默认通信]
    - UI 高频操作本地完成。
    - UI 保存结构化 request，再触发 Agent；若当前 Host 无主动消息通道，则使用 request queue 并由 Skill / MCP Tool 处理。
    - Agent 通过领域 Tool 写回，不直接改 UI 内存。
    - 大文件只传路径引用、metadata、派生预览。

[MCP App 形态默认]
    form = mcp-app / hybrid 时启用；标准是 MCP Apps 扩展 io.modelcontextprotocol/ui（Stable 2026-01-26），宿主经 extensions capability 声明支持。
    - 注册：用 `@modelcontextprotocol/ext-apps/server` 的 registerAppResource / registerAppTool 与 RESOURCE_MIME_TYPE（`text/html;profile=mcp-app`）；Tool 用 `_meta.ui.resourceUri` 关联 `ui://` Resource。扁平 `ui/resourceUri` 已废弃不写；`_meta["openai/outputTemplate"]` 只是 ChatGPT 兼容别名，需要覆盖存量 ChatGPT 集成时才并写。
    - widget：单文件自包含 HTML，样式脚本与所选风格包 token 全部内联；确需外部域时在 Resource 的 `_meta.ui.csp` 显式声明 connectDomains / resourceDomains，默认不引外链。
    - iframe 侧：同包根导出的 App 类（`new App({ name, version })` → `connect()` → `callServerTool` / `ontoolresult`）；或按规范直接实现 postMessage JSON-RPC（`ui/initialize` 握手 + `tools/call`）。
    - 双输出：每个带 UI 的 Tool 的 structured + text 输出必须与 UI 等价，保证无嵌入 UI 的宿主 tool-only 可用。
    - 本地验证：开发期用脚手架的桥接桩页面渲染 widget 并完成一次 Tool 往返，不模拟宿主私有 API；嵌入渲染的宿主验证按 host-profiles 由第五步在具备该 surface 的宿主执行。

[默认安全]
    - 文件范围 = 当前项目。
    - network = none。
    - secrets = none。
    - destructive = explicit confirmation + recoverable where possible。
    - App-only Tool 仍服务端校验。
    - 所有输入设长度、类型和数量上限。

[默认 UI]
    - 视觉基线是 plugin.yaml ui.kit 所选的风格包：复用该包的组件与 token，不写平行样式；包里缺的组件按该包 kit.md 的纪律先补进包再用。Agent 专属视觉（极光 / 蓝黑墨）只属于 Agent 活动，不外借。
    - 内容优先，Agent 状态不遮挡主工作区。
    - 核心操作有键盘路径。
    - 空状态只有一个主 CTA。
    - Agent Working 锁目标对象而不是默认锁整个 UI。
    - 旧结果默认变成候选，不自动覆盖新版本。

[默认 Packaging]
    - 发布前预构建。
    - clean install / build。
    - package file list、version、hash。
    - 开发期只做本地 Package Smoke（clean build + stdio Probe）；开发态加载与真实安装均由第五步集中执行，真实安装链与宿主路径按 host-profiles 对应 Profile 执行。
    - marketplace 清单与 Codex manifest 的字段基线用 Harness 模板（在 interactive-plugin-builder Skill 的 templates 目录下）：`claude-marketplace.template.json`、`codex-plugin-manifest.template.json`、`codex-marketplace.template.json`。

[生成 Skill 与 Agent 规范]
    - 生成插件的 Skill description：第三人称 “This skill should be used when...”，包含用户会说的引号触发短语，50-500 字符；进取式列举触发面（宿主当前倾向漏触发），但列意图类别，不堆查询原句。
    - Skill 正文控制在 500 行内（1000-3000 词最佳，超 5000 词必拆 references/）；引用文件只允许离 SKILL.md 一层深。
    - 生成插件的 Subagent（宿主支持时）：description 以 “Use this agent when...” 开头并内嵌 2-4 个 example 块；system prompt 用第二人称 500-3000 词。
    - 文体不对称是官方规范：Skill 描述第三人称、正文祈使句；Agent 描述 Use-this-agent-when、system prompt 第二人称。
    - 本节只约束生成的插件；Harness 自身文件遵循 style-inventory。

[Hook 事实（Claude Code）]
    - 插件 hooks.json 是 wrapper 格式（顶层 hooks 对象），与用户 settings 的直铺格式不同。
    - prompt 型 hook（type = prompt，由模型判定）只支持 Stop / SubagentStop / UserPromptSubmit / PreToolUse；判断类检查优先用它，确定性检查用 command 型。
    - PreToolUse 可输出 hookSpecificOutput.permissionDecision（allow / deny / ask）并用 updatedInput 改写工具入参；退出码 0 = stdout 进 transcript，2 = stderr 回喂模型。
    - SessionStart 专属 $CLAUDE_ENV_FILE 可持久化环境变量；默认超时 command 60s / prompt 30s；同 matcher 的 hook 并行执行、顺序不定。
    - hook 改动后先 /reload-plugins，行为未变则重启会话再验。
    - 插件捆绑的 MCP 工具全名是 mcp__plugin_<plugin>_<server>__<tool>；权限规则与 hook matcher 必须用全名，裸 server 名永不命中。
