---
name: plugin-spec-workflow-0-1
description: 项目没有 Plugin-Spec.md 时按此工作流从零采访；从第一次表达到收敛产出全套 Spec 工件。
---

[使用时机]
    项目根目录没有 Plugin-Spec.md，用户第一次表达想开发一个 Plugin。

[工作流]
    Phase 1 Plugin 基本盘 → Phase 2 Golden Path 与 UI 必要性 → Phase 3 Agent 协作与能力激发 → Phase 4 数据、权限与宿主 → Phase 5 首版边界、失败和验收 → 充足度判断 → 输出产物

[顶层规则]
    - Phase 是内部追踪，不对用户说“进入 Phase N”。
    - 先听用户开放描述，抽取已覆盖信息，再问缺口。
    - Phase 1 是必过地基；Phase 2-5 根据用户场景动态裁剪。
    - 用户一次回答溢出覆盖后续维度，直接吸收，不再重复问。
    - 每轮只问当前决策价值最高的 1 个主问题，可带 1 个强相关副问题。
    - 低风险专业细节用默认，不把技术设计题推给用户。
    - 发现需求变化影响前面结论，回到相应 Phase 修正，不强行向前。

[起始动作 · 先让用户倒出脑中的东西]
    用户只给一句短想法时，先问：

    ```text
    先别列功能。你按真实使用过程讲一遍：谁会装这个 Plugin，他当时在做什么，最卡在哪里，最后希望手里得到什么？
    ```

    用户已经给长描述、仓库、截图或旧产品时：
    - 先读取材料。
    - 抽取目标用户、核心结果、直接操作、Agent 任务、宿主、输入输出、权限和边界。
    - 用一段话回放。
    - 只问没有覆盖且会改变方案的内容。

[Phase 1 · Plugin 基本盘]

    [目标]
        定义这个 Plugin 是什么、给谁用、在什么情境解决什么问题，以及为什么它必须是 Plugin。

    [硬指标]
        - 一句话 Plugin 定义：给谁，在什么情境，通过什么交互，获得什么结果。
        - 一个具体主用户，不接受“所有人”。
        - 一个真实触发场景和现有替代方式。
        - 一个可观察的核心结果。
        - Plugin 形态理由：为什么纯聊天 Skill、CLI 或普通网页不够。
        - required target 至少一个，并标出首版基准宿主。

    [围栏]
        - 不接受“提高效率”“更智能”“体验更好”作为核心结果。
        - 不把技术栈当需求。
        - 不默认双宿主等价。
        - 如果没有 GUI 必要性，直接指出它可能更适合 Skill-only / MCP Tool，而不是硬做交互式 Plugin。

    [详细问法]
        → `question-bank.md` Phase 1

    [完成后衔接]
        用一句话复述用户、场景和结果，再自然引到完整使用过程：

        ```text
        基本盘清楚了：这是给 [用户] 在 [场景] 完成 [结果] 的 Plugin，GUI 的价值在 [直接操作]。接下来我按第一次真实使用，把整条路走一遍。
        ```

[Phase 2 · Golden Path 与 UI 必要性]

    [目标]
        把安装、打开、输入、直接操作、Agent 介入、结果写回、保存或导出串成一条没有断点的故事。

    [硬指标]
        - 打开入口和第一次看到的状态。
        - 用户提供什么输入，来自哪里。
        - 哪些操作必须在 UI 中即时完成。
        - 哪个动作或消息把任务交给 Agent。
        - Agent 结果在 UI 中怎样出现。
        - 用户怎样确认、继续修改、保存或导出。
        - 至少一个“不触发 Agent 的高频操作”和一个“必须触发 Agent 的语义操作”。
        - 开发形态已按 [形态判定] 与用户一起定下：companion-web-app / mcp-app / hybrid。

    [围栏]
        - 不接受只有功能列表、没有顺序和状态变化。
        - 不接受“用户在页面里操作，AI 帮忙”这种空描述。
        - 不让每次拖拽、缩放、输入都经过 Agent。
        - 不把 Browser Preview 当成 Plugin 的最终运行契约。

    [详细问法]
        → `question-bank.md` Phase 2

    [完成后衔接]
        ```text
        这条主流程现在能走通了：用户在 UI 里负责 [直接操作]，到 [触发点] 才把任务交给 Agent，结果以 [方式] 回来。现在把 Agent 到底要懂什么、做什么钉死。
        ```

[形态判定 · Phase 2 收尾]

    [目标]
        在采访中就把开发形态和用户一起定下来，让 Design、Plan 与 Builder 直接按形态开工。
        两种形态都由 Agent Skill 驱动、都能通过对话控制插件；差别只在界面出现在哪个 surface。

    [告知义务]
        判定前用户必须已知情：两种形态各适合什么产品，以及不管选哪种都能在对话里指挥 Agent。
        - 用用户自己的业务现场举例讲，大白话；怎么讲由你组织，参考基调见 question-bank 2.7。
        - 用户已经明白或自己点名形态时不重复教学，直接进判定确认。
        - 验收：用户能用自己的话说出为什么选这种形态，而不是被动接受推荐。
        - 小面板对应 mcp-app，完整界面对应 companion-web-app；术语归档用，对用户不说。

    [判定规则]
        三个输入合成结论，逐条确认：
        - 界面出现在哪：嵌在对话里 → mcp-app；打开完整网页 → companion-web-app。
        - 目标宿主支持面：mcp-app 的嵌入渲染只在支持 MCP Apps 的对话宿主成立（当前是 ChatGPT 与 claude.ai / Claude Desktop 聊天端；Claude Code 与 Codex 的 CLI / IDE / 桌面均不渲染嵌入 UI，事实以 host-profiles 为准）。required target 是 Claude Code / Codex 且界面必须完整 → 一律 companion-web-app。
        - 交互复杂度：完整编辑体验 → companion-web-app；对话顺手完成的轻交互 → mcp-app。
        轻重两层都要 → hybrid：同一 MCP Server，mcp-app 层做轻控制与预览，companion-web-app 做完整编辑器。

    [围栏]
        - 不问“你要 MCP App 还是 Companion Web App”这种术语题；用“界面出现在哪、点两下还是拖来拖去”这类可感知问法引导，结论由 Harness 归纳并向用户确认。
        - 用户要嵌对话但 required target 不渲染嵌入 UI → 摆出宿主事实让用户重选，不许诺不存在的 surface。
        - mcp-app / hybrid 判定成立时同步告知：全部工具在无嵌入 UI 的宿主仍可对话直用（tool-only），这是硬约束不是选项。
        - 判定结果和依据写进 Plugin-Spec.md 的 [开发形态] 与 plugin.yaml 的 plugin.form，不留“以后再定”。

[Phase 3 · Agent 协作与能力激发]

    [目标]
        定义 UI 与宿主 Agent 的职责边界，主动发现用户未表达但核心流程需要的能力。

    [硬指标]
        - Agent 负责理解、规划、生成、分析、文件或命令执行中的哪些任务。
        - UI 发给 Agent 的意图、选择、范围、文件引用和状态摘要。
        - Agent 完成后是新增、替换、提案、批量修改还是导出。
        - 原内容是否保留，用户是否需要确认。
        - 生成 / 修改过程的等待、失败、取消、重试和多版本最低要求。
        - 连带需求中首版必需项与 Backlog 已区分。

    [围栏]
        - 不接受“Agent 什么都能做”。
        - 不让 Agent 直接操作 React 内部状态或依赖模拟鼠标完成核心写回。
        - 不把所有可能能力塞进首版。
        - 不向非技术用户询问 Tool Schema、MCP Transport 或幂等实现。

    [详细问法]
        → `question-bank.md` Phase 3

    [完成后衔接]
        ```text
        分工定了：UI 负责 [即时操作]，Agent 负责 [语义任务]，结果通过 [领域动作] 写回。下一步只处理会改变架构的硬边界——文件、状态、权限和宿主。
        ```

[Phase 4 · 数据、权限与宿主]

    [目标]
        消除会导致实现方向分叉、数据破坏或无法安装的未知。

    [硬指标]
        - required / optional / experimental target 及首版基准宿主。
        - target 组合与已判定形态一致：mcp-app 的嵌入面 target 必须支持 MCP Apps，无嵌入面的 target 有 tool-only 体验底线。
        - 每个 target 的用户可接受运行形态：内联 UI、Browser / Preview、CLI fallback 或延后。
        - 输入格式、数量、规模和位置。
        - 输出格式、保存位置和命名责任。
        - 权威状态跟随项目、用户还是会话，关闭重开是否保留。
        - 文件读写范围、外部网络、Secret、数据离开本地与破坏性操作。
        - 长任务是否需要 Job、进度、取消、恢复和重复提交保护。

    [围栏]
        - 不默认能读写整个磁盘。
        - 不把用户数据写进 Plugin 安装目录。
        - 不把 Claude Code、Claude Desktop、ChatGPT/Codex、Codex CLI 当成同一种宿主。
        - 不在未查官方资料时承诺某个宿主支持内联 iframe 或消息能力。
        - 不要求用户决定 projectVersion、原子写等实现细节；Harness 在 Design 阶段负责。

    [详细问法]
        → `question-bank.md` Phase 4

    [完成后衔接]
        ```text
        硬边界齐了：首版以 [宿主] 为基准，状态放在 [位置]，只读写 [范围]，网络和长任务按 [约束] 处理。最后把首版砍到能交付，并把失败和验收写成真场景。
        ```

[Phase 5 · 首版边界、失败与验收]

    [目标]
        防止范围爆炸，给开发和检查明确终点。

    [硬指标]
        - must / should / could 已区分。
        - 至少 3 条明确非目标，复杂项目可更多。
        - 至少 1 个关键失败路径及用户恢复方式。
        - 性能、规模或等待时间最低边界。
        - 安装后第一次核心任务的 Acceptance Scenario。
        - 每条 must 都能映射到至少一个 AC。
        - AC 是可执行、可观察、有宿主和证据类型的。
        - 参考与反例足以校准，不要求为了完整而强行提供。

    [围栏]
        - 不接受“功能都做完”“用户满意”“没有 Bug”。
        - 不把公共商店审核通过写成 Harness 能保证的 AC。
        - 不把 optional target 未验证包装成整体完成。
        - 不把未来版本能力悄悄写进首版依赖。

    [详细问法]
        → `question-bank.md` Phase 5

    [完成后衔接]
        ```text
        首版边界和验收已经够硬了。我现在做一次完整演练和冲突检查，没断点就收口写 Spec，不再继续挖低价值偏好。
        ```

[充足度判断]
    按 SKILL.md 的 [充足度 Gate] 逐条检查。

    额外执行：
    1. 用一个具体样本走完 Golden Path。
    2. 检查每一步是否有 Owner：User / UI / Agent / MCP Tool / External Service。
    3. 检查每个输入是否有来源，每个输出是否有去处。
    4. 检查 required target 是否有明确交付形态。
    5. 检查所有推断和默认是否被标注，关键决定是否得到确认。
    6. 检查 must 需求是否都有 AC。

    未达成 → 回对应 Phase 继续采访。
    已达成 → 进行一次用户可理解的收敛回放，生成产出物。

[输出阶段]
    1. 按模板生成 Plugin-Spec.md。
    2. 生成 Plugin-Spec-CHANGELOG.md，首版记录 Initial Spec。
    3. 生成 plugin.yaml，并运行 Schema 校验。
    4. 更新 init 脚本生成的 Plugin-Project-State.md 机器状态块：phase = SPEC_READY，qualityGate = SPEC_VALID。
    5. 自检：文件名、ID、交叉引用、must → AC 映射、host tier 一致；确认无残留 P0 Open Question。
    6. 完成后复述结论，等用户确认或修改，再进入 plugin-interaction-runtime-design Skill。
