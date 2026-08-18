---
name: plugin-interaction-runtime-design
description: 当 Plugin-Spec.md 与 plugin.yaml 已齐但缺少 Plugin-Design.md，或者用户流程、UI 直接操作、UI-Agent 契约、MCP Tool、状态、权限、宿主运行路径发生变化时使用。通过采访收集用户必须决定的体验取舍，由 Architect 完成专业运行时设计，并用场景走查与原型 Gate 收敛，输出 Plugin-Design.md。
---

[任务]
    把“这个 Plugin 要做什么”转换成“用户与宿主 Agent 怎样共同完成，以及 Plugin 在目标宿主中怎样运行”。

    本阶段不是传统视觉 Brief，也不是把一串技术问题推给用户。
    必须同时完成：
    - Spec 判定形态的运行时落地：companion-web-app 的本地服务与 Browser 打开路径；mcp-app 的 `ui://` Resource、Tool `_meta.ui.resourceUri` 关联、宿主 Bridge 与 tool-only 等价路径；hybrid 两层共用同一 MCP Server。
    - 用户工作区与关键界面。
    - 直接操作、反馈和边缘状态。
    - UI → Agent 与 Agent → UI 契约。
    - MCP Tool、Resource、Request、Result、State 与 Job 设计。
    - Agent 侧 Skill Catalog：按能力域抽象插件自带技能与触发语料。
    - Claude Code required target 的运行路径、fallback 和验证方式。
    - 文件、权限、网络、Secret、CSP / sandbox 等安全设计。
    - 复杂 UI 的 Prototype Gate。
    - 足够直接进入开发计划的视觉和可访问性规则。

[依赖检测]
    必须存在：
    - Plugin-Spec.md，Status = SPEC_READY。
    - plugin.yaml，通过 Schema 校验。
    - Plugin-Project-State.md，phase 至少为 SPEC_READY。

    开始前 read：
    - `references/workflow-design.md`
    - `references/interview-bank.md`
    - `references/prototype-gate.md`
    - `references/tool-design-rules.md`
    - `references/threat-model.md`
    - `templates/plugin-design-template.md`
    - `../interactive-plugin-builder/references/platform-defaults.md`
    - `../interactive-plugin-builder/references/host-profiles.md`
    - `../interactive-plugin-builder/assets/ui-kits/kits.md`
    - 风格选定后 read 该风格包的 `assets/ui-kits/<kit-id>/kit.md`
    - Plugin-Spec.md、plugin.yaml

    Spec 存在 P0 Open Question、must 无 AC、required target 不明确或 Golden Path 断裂 → 返回 plugin-spec-builder Skill，不在设计阶段猜需求。

[第一性原则]

    [三类决定分开]
        采访时把信息分成：
        - User Decision：用户可感知且有真实取舍，必须采访或确认。
        - Architect Decision：专业实现，由 Harness 基于需求和默认主动决定。
        - Platform Fact：宿主能力、SDK 和规范，必须查官方资料验证，不能问用户凭感觉决定。

        用户决定示例：结果自动替换还是先预览、Agent 工作时能否继续编辑、首版基准宿主。
        Architect 决定示例：request envelope、projectVersion、幂等、原子写、Tool Schema、状态分层。
        Platform Fact 示例：Claude Code 当前是否原生渲染某类 UI、Plugin 目录和 manifest 字段。

    [交互闭环]
        每个用户动作必须落到以下至少一个路径，不能悬空：

        ```text
        本地 UI 即时操作
        App-only MCP Tool
        UI → Agent 消息 / 请求
        Agent-visible 领域 Tool
        外部服务
        ```

        每个 Agent 结果必须通过确定性的领域动作写回权威状态，不能只在聊天中说“完成了”。

    [宿主差异显式化]
        一套业务核心可以共享，但每个 target 必须独立写 Primary Path、Fallback、Unsupported、Verification。
        required target 没有可实现路径时，立即回 Spec 调整，不写理想架构糊过去。

    [复杂交互先验证]
        UI Class C 的画布、时间线、3D、富媒体编辑器，不允许只靠长文档直接开工。
        必须先做低保真可运行 Spike，验证最风险的 1-3 个交互和宿主约束，再完成 Design。

    [最小权限]
        设计从最小文件范围、最小网络、最小 Tool、最小破坏性权限开始。
        Plugin 安装目录只存程序资源，不存用户状态。

[采访循环]
    采访前先做一次聚焦搜索：这类产品当前主流的布局与交互模式。主流做法作为带理由的默认选项呈现；用户要创新时，主流是要超越的基准，不是答案。

    界面风格按 `kits.md` 的选型规则处理：多套风格时作为一道 User Decision，给每套一句气质定位和 demo 样张、结合调研给默认推荐；确认结果写入 plugin.yaml 的 ui.kit 并登记进 Decision Register。只有一套时不问。

    每轮：
    1. 从 Plugin-Spec.md 抽取当前要设计的用户可感知决定。
    2. 先自己完成可由默认和专业判断决定的部分。
    3. 指出一个剩余关键体验取舍，给 2-3 个可感知选项及代价。
    4. 问 1 个主问题，可带 1 个强相关副问题。
    5. 用一句回放确认已达成的决定。
    6. 用关键场景走查检查是否还有断点。

    采访期间不写任何文档；设计收敛后在输出阶段一次性生成 Plugin-Design.md，用户决定登记进其中的 Decision Register。

    不向用户暴露内部 Wave、Gate、Tool 分类或安全清单标签。

[采访边界]
    默认主问题预算：
    - UI Class A · 简单表单 / 面板：4-6 个。
    - UI Class B · 多区工作台：6-9 个。
    - UI Class C · 直接操作编辑器：8-12 个，另加 Prototype Spike，不靠无限提问补风险。

    超过预算前先判断：
    - 这是用户体验取舍，还是 Architect 应自己决定？
    - 这是 Platform Fact，是否应查官方资料？
    - 这是首版必须，还是 Backlog？
    - 是否可以通过 Prototype 比继续口头询问更快得到答案？

[Skill Catalog]
    从 Plugin-Spec.md 的 Golden Path、REQ 清单与 Agent 职责边界按能力域抽象本插件自带的技能清单，属 Architect Decision：不询问用户，不设确认门。
    - 至少包含一个启动技能（打开工作区并教 Agent 完整工具环）；能力域独立成组时拆分，一个技能只管一件事，覆盖到每条 agent 侧 REQ。
    - 触发描述与评测正例引用采访中用户的原话短语；负例取自 Explicit Non-goals 与邻近场景。
    - 技能正文遵循 plugin-builder implementation-defaults 的生成 Skill 与 Agent 规范。
    - 结果登记进 Plugin-Design.md 的 Skill Catalog 章节，交 plugin-dev-planner 排任务。

[设计 Gate]
    以下必须齐全：
    - 形态一致性：plugin.form 与 required target 的 UI Surface 能力匹配；mcp-app / hybrid 有 `ui://` Resource 清单、Tool 关联与 tool-only 等价路径，且 plugin.yaml mcp.resources 已登记。
    - UI Complexity Class 与 Prototype 要求。
    - 七类场景走查全部通过，清单以 `references/workflow-design.md` Step 12 为准。
    - 界面地图、主要区域、区块布局与排版层级，具体到看文档能画出界面。
    - 核心对象模型和直接操作语法。
    - 用户动作映射表，无悬空动作。
    - Request / Result / State / Job Contract。
    - Render、App-only、Agent-visible、Long-running Tool Catalog。
    - Skill Catalog 覆盖全部 agent 侧能力域与 REQ，触发语料来源明确。
    - required target 的 Primary、Fallback、Verification。
    - 权威状态、临时 UI 状态、选择、视口、资源和版本策略。
    - 权限、路径、网络、Secret、破坏性操作和 Threat Model。
    - 空、Loading、Agent Working、Success、Error、Conflict、Offline、Permission Denied 状态。
    - 视觉、信息密度、键盘、焦点和对比度规则。
    - P0 Design Open Question 为 0。
    - UI Class C 的 Prototype Evidence 存在并通过。

[输出规则]
    1. 按 `templates/plugin-design-template.md` 生成 Plugin-Design.md。
    2. 更新 plugin.yaml：
        - ui.complexityClass 与 ui.kit
        - targets runtimeProfile / uiMode / fallback
        - mcp renderTool / tools / resources
        - contracts paths
        - state / permissions / jobs
    3. 为 request、result、state、evidence 生成或更新 contracts/*.schema.json。
    4. 复杂 UI 将 Spike 代码与证据放在 `<plugin-name>/spikes/` 或 `evidence/design/`，不混进正式实现。
    5. 更新 Plugin-Project-State.md：phase = DESIGN_READY，qualityGate = DESIGN_VALID。
    6. 运行中央 Validator：

        ```bash
        python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/validate-plugin-project.py" --root .
        ```

[完成标准]
    - 所有 User Decision 已确认或按明确默认处理。
    - Architect Decision 有依据，Platform Fact 有当前官方证据。
    - Action Map、Request、Result、State、Tool 与 Host Contract 无悬空项。
    - required target 有可实现的 Primary Path、Fallback 与 Verification。
    - Threat Model 的 high / medium 风险有缓解与验证。
    - UI Class C 已通过 Prototype Gate。
    - Plugin-Design.md、contracts/、plugin.yaml 与 Plugin-Project-State.md 已同步并通过校验。

[完成后告诉用户]
    用用户语言概括：
    - 打开后是什么工作区。
    - 哪些操作直接做，哪些交给 Agent。
    - 插件自带哪些技能、各自何时被唤起。
    - 结果怎样回来、怎样保护原内容。
    - required target 怎样运行，fallback 是什么。
    - 最大技术 / 安全风险怎样处理。
    - 是否做过 Prototype，验证了什么。

    等用户确认或修改后，进入 plugin-dev-planner Skill。

[语言]
    产出文档正文以中文为主体；代码、命令、字段名和宿主术语保留英文，不整段写英文。

[禁止]
    - 把 Plugin-Design.md 写成视觉形容词清单。
    - 把专业实现问题全问用户。
    - 假设所有宿主都有相同 iframe 和消息桥。
    - 让 Agent 通过模拟鼠标或直接改 DOM 完成核心写回。
    - 把 React State、localStorage 或对话记忆当唯一权威状态。
    - UI Class C 没 Prototype Evidence 就宣告 DESIGN_READY。
