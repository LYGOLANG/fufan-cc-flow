---
name: plugin-spec-builder
description: 当用户提出新的交互式 Plugin 想法、补充或修改 Plugin 需求、项目没有 Plugin-Spec.md，或者现有 Spec 的核心流程、宿主、权限、输入输出发生变化时使用。通过采访式追问倾听、串联并主动补全潜在连带需求，在明确 Gate 内收敛，生成 Plugin-Spec.md、Plugin-Spec-CHANGELOG.md 与 plugin.yaml。
---

[任务]
    [0-1 模式]
        把用户零散、非专业、可能不完整的想法，采访成可设计、可开发、可验证的 Plugin 规格。


    [迭代模式]
        用户修改已有 Plugin 需求时，抽取变更、检测冲突和影响，更新 Plugin-Spec.md、plugin.yaml 与 Plugin-Spec-CHANGELOG.md。

    本 Skill 的重点不是问得多，而是：
    - 听懂用户主动说出的需求。
    - 发现用户想要但因为不熟悉 Plugin、宿主或编辑器而没有说出的连带需求。
    - 把零散功能串成从安装到结果的 Golden Path。
    - 在 P0 信息齐全后停止追问，不无限采访。
    - 确保最终目标是可安装 Plugin，不是普通 Web App。

[启动检查]
    1. 扫描项目根目录：
        - 有 Plugin-Spec.md → 迭代模式，read `references/workflow-iteration.md`。
        - 无 Plugin-Spec.md → 0-1 模式，read `references/workflow-0-1.md`。
    2. 0-1 模式且无 plugin.yaml 时，先用脚本初始化项目工件，不手写机器状态块：

        ```bash
        python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/init-plugin-project.py" <plugin-id> --title "<Plugin 名称>"
        ```

        脚本从模板生成 Plugin-Spec-CHANGELOG.md、Plugin-Project-State.md、plugin.yaml 与目录骨架。
    3. read `references/question-bank.md`。
    4. read `references/dialogue-style.md`。
    5. read `../interactive-plugin-builder/references/interview-protocol.md`。
    6. read `../interactive-plugin-builder/references/artifact-contracts.md`。
    7. read `../interactive-plugin-builder/references/platform-defaults.md`。
    8. 采访在对话中自然进行；全部文档在充足度 Gate 通过后一次性生成。

[第一性原则]

    [先听再问]
        用户第一段话不是“问题 0 的答案”，而是高密度原始材料。
        先抽取已经明确的信息、合理推断、默认、未知和矛盾，再问最高价值缺口。
        用户已经覆盖的维度直接吸收，不机械重问。

    [能力激发]
        用户不知道 Plugin 能做什么是常态。
        对照连带需求触发器，主动告诉用户与当前场景最相关的 1-2 个能力及代价，让用户在知情前提下选择。
        说用户能看到和控制的结果，不用 MCP、CSP、Host Bridge 等术语砸用户。

    [现实对照]
        用户首轮表达完，先做一次聚焦搜索：同类产品、成熟案例、领域惯例。
        搜索结果用来把追问从“你想要什么”升级成“同类产品都有 A / B，你的场景要哪种”，并让连带需求有现实依据。
        用户设想与成熟做法冲突时，把差异和背后原因摆给用户，让他带着信息重选——他可能有真实理由，也可能放弃臆想；不替用户拍板，也不盲从。
        成熟案例是地板不是天花板：用户有创新想法时，以案例为基准继续引导，不用案例否决创新。

    [推断不冒充事实]
        所有信息分为：
        - 【明确】：用户直接说过。
        - 【推断】：从场景推导，需确认或记录置信度。
        - 【默认】：低风险且有可靠默认，由 Harness 决定。
        - 【待定】：会改变架构、范围、安全或验收，必须解决。
        - 【矛盾】：两条要求不能同时成立，必须指出。

    [问题有成本]
        只问会改变功能、宿主、交互、状态、权限、打包或验收的问题。
        能从现有上下文推断的不问；能由低风险默认解决的不问；不要求用户决定专业实现细节。

    [收敛优先]
        采访不是无限发现需求。
        Golden Path 必需、安全必需、数据完整性必需进入首版；相关但不阻断核心流程的能力进入 Backlog。
        P0 Gate 通过后必须收敛，不为了显得全面继续问低价值偏好。

[采访循环]
    首轮倾听后、深入追问前，先完成 [现实对照] 的聚焦搜索，再进循环。

    每一轮执行：
    1. 倾听用户新信息。
    2. 把新信息放回“用户结果 → UI 操作 → Agent 任务 → 结果写回 → 状态 / 文件 → 验收”的完整模型。
    3. 检查潜在连带需求、矛盾和高风险未知。
    4. 选择 1 个主问题，可带 1 个强相关副问题，且必须属于同一决策。
    5. 用一句自然回放承上启下，不向用户暴露内部 Phase、Gate、P0 或题库标签。
    6. 回答后重新执行充足度判断。

    采访期间不写任何文档，不让用户等待落盘；充足度 Gate 通过后在输出阶段一次性生成全部产出物。

[提问术]
    - 场景回放：挖用户隐性信息时用“描述你上一次遇到这个问题的完整过程”，具体叙事优于抽象需求。
    - 选择题优先：搜索后把开放题改成带代价说明的选择题；纯专业连带需求不问，给带理由的默认值，用户只行使否决权。
    - 冲突暴露：用户设想与现实做法矛盾时，说明差异与原因后让用户重选；答案要么暴露真实约束，要么自然收敛。
    - 每个答案三步处理：按五级标注抽取入档，与已收集信息和搜索事实做冲突检测，再决定下一问；被答案关闭的分支不再问。

[采访边界]
    默认主问题预算：
    - 简单 Plugin：6-8 个。
    - 中等复杂 Plugin：8-12 个。
    - 多宿主、视频、画布、3D 或长任务：最多 15 个。

    达到 12 个主问题后，先做收敛审计：
    - 剩余未知是否真的会改变首版。
    - 是否可采用默认。
    - 是否应移入 Backlog。
    - 是否是 Design 阶段的问题，不应继续留在 Spec。

    只有仍存在 P0 高风险未知或矛盾时，才允许超过预算。

[充足度 Gate]
    以下信息必须齐全：
    - 一句话 Plugin 定义。
    - 目标用户、使用情境和当前痛点。
    - 核心可观察结果。
    - 为什么需要 GUI，而不是纯对话 Skill 或普通脚本。
    - 开发形态（companion-web-app / mcp-app / hybrid）已与用户确认，判定依据明确，且与目标宿主能力一致。
    - 从安装、打开、操作、Agent 介入、结果写回到保存 / 导出的 Golden Path。
    - UI 必须支持的直接操作。
    - 宿主 Agent 的职责边界。
    - UI → Agent 的交接内容与触发点。
    - Agent → UI 的结果类型与应用方式。
    - required / optional / experimental 目标宿主。
    - 输入、输出、状态归属、文件范围、网络、Secret 与破坏性权限。
    - 至少一个关键失败路径和恢复方式。
    - 首版 must、明确非目标和 Backlog。
    - 可测试的 Acceptance Criteria。

    同时必须能完整演练：

    ```text
    安装 → 打开 → 用户直接操作 → UI 交给 Agent → Agent 执行 → Agent 写回 → 用户保存或继续迭代
    ```

    Gate 未通过 → 回对应维度继续采访。
    Gate 通过且无 P0 矛盾 → 进行一次收敛回放，生成产出物，停止继续追问。

[需求标识]
    Plugin-Spec.md 中的需求必须编号：
    - REQ-XXX：功能需求
    - UX-XXX：交互需求
    - HOST-XXX：宿主与运行时
    - DATA-XXX：状态、文件与数据
    - SEC-XXX：安全与权限
    - NFR-XXX：性能、规模、可用性和兼容性
    - AC-XXX：验收标准

    REQ / UX / HOST / DATA / SEC / NFR 每条记录：
    - Source：user / inferred / default / official-doc / research
    - Confidence：confirmed / probable / assumed
    - Priority：must / should / could
    - Status：active / deferred / superseded

    AC 不带以上四字段，用 Given / When / Then + 目标宿主 + Evidence 映射表达。

[输出规则]
    0-1 模式输出：
    - Plugin-Spec.md
    - Plugin-Spec-CHANGELOG.md
    - plugin.yaml
    - Plugin-Project-State.md

    迭代模式更新以上文件，并在 Changelog 记录：
    - 变更原因
    - 新增 / 修改 / 删除的 ID
    - 对 Design、Plan、Code、Test 的影响
    - 需要重新进入的阶段

    输出前：
    1. 按 `templates/plugin-spec-template.md` 生成 Spec。
    2. 按 `../interactive-plugin-builder/templates/plugin-yaml-template.yaml` 生成 plugin.yaml。
    3. 检查所有 AC 都可被执行或观察，不写“体验良好”“运行正常”这类空验收。
    4. 更新 Plugin-Project-State.md：phase = SPEC_READY，qualityGate = SPEC_VALID。
    5. 运行中央 Validator：

        ```bash
        python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/validate-plugin-project.py" --root .
        ```

[完成标准]
    - 充足度 Gate 全部通过，P0 待定和矛盾为 0。
    - 推断、默认与待定在 Spec 的 Source / Confidence 字段和 Open Questions 中可见，不冒充用户确认。
    - Plugin-Spec.md 的 must、Non-goal、Golden Path 与 required AC 可直接进入设计。
    - plugin.yaml 通过 Schema 与语义校验，至少一个 target 为 required。
    - Plugin-Spec-CHANGELOG.md 与 Plugin-Project-State.md 已同步。

[完成后告诉用户]
    用自然语言回放：
    - 这个 Plugin 到底解决什么。
    - Golden Path 是什么。
    - 首版做什么、不做什么。
    - 哪些是用户确认、哪些是 Harness 默认。
    - 文件写到了哪里。

    等用户确认或修改后，进入 plugin-interaction-runtime-design Skill；不要继续补低价值需求。

[语言]
    产出文档正文以中文为主体；代码、命令、字段名和宿主术语保留英文，不整段写英文。

[禁止]
    - 把采访变成一次性长问卷。
    - 重问用户已经明确表达的信息。
    - 把 Architect Decision 或 Platform Fact 推给用户决定。
    - 把推断写成用户确认事实。
    - P0 未收敛就生成 SPEC_READY。
    - Gate 已通过后继续追问低价值偏好。
    - 把普通 Web App、Preview 或纯 Skill 误写成目标交互式 Plugin。
