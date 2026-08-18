---
name: plugin-dev-planner
description: 当 Plugin-Spec.md、plugin.yaml 与 Plugin-Design.md 已通过 Gate，但没有 PLUGIN-DEV-PLAN.md，或者需求、设计、宿主路径变化导致现有计划失效时使用。按可运行垂直闭环而不是泛化前后端拆分，生成包含文件、依赖、命令、验收、AC 映射、宿主证据和回退条件的 Plugin 专属开发计划。
---

[任务]
    把已收敛的 Spec 与 Design 转换成一份主 Agent 可以逐 Phase 实时开发、自检、失败回退和最终交给 Checker 的 PLUGIN-DEV-PLAN.md。

    计划必须保证：
    - 第一条开发主线先打通本地最小闭环，按 plugin.form 分支：companion-web-app 本地起服务、打开 UI、状态、UI → Agent、Agent → UI；mcp-app 起 Server、`ui://` Resource 经本地桥接桩渲染、widget 调 Tool、状态写回；hybrid 先通能力层再各接 surface。安装与宿主验证由第五步集中执行。
    - 无论哪种形态，对话控制链路（Skill 教 Agent → Tool 执行 → 状态与 UI 可见）在技术上完整可实现，并有对应实现与验证任务；form = mcp-app / hybrid 时每个带 UI 的 Tool 另有 tool-only 直调验证。
    - 业务复杂功能在平台闭环之后开发。
    - required target 有独立构建与打包任务；安装与 E2E 登记 Host Verification Matrix，由第五步执行。
    - 每个 must 与 AC 都有实现任务和证据任务。
    - 复杂 UI 的 Prototype 结论进入正式架构，不重复踩已知风险。

[依赖检测]
    必须存在且通过：
    - Plugin-Spec.md，Status = SPEC_READY。
    - plugin.yaml，通过 Schema 校验。
    - Plugin-Design.md，Status = DESIGN_READY。
    - Plugin-Project-State.md，phase = DESIGN_READY。
    - Class C 项目的 Prototype Evidence。

    开始前 read：
    - `references/planning-rules.md`
    - `templates/plugin-dev-plan-template.md`
    - `../interactive-plugin-builder/references/artifact-contracts.md`
    - `../interactive-plugin-builder/references/host-profiles.md`
    - 全部上游原文和 Spike Evidence。

    上游存在 P0 Open Question、required target 无实现路径、AC 不可测或 Prototype 失败未处理 → 返回对应上游 Skill，不用计划掩盖问题。

[第一性原则]

    [垂直闭环]
        不按“前端 → 后端 → 测试”横切拆分。
        每个 Phase 必须产生一个可运行、可观察、可回退的新能力。

    [平台先于业务]
        在写画布、时间线、3D 或复杂表单前，先证明：

        ```text
        Plugin 能加载
        → UI 能打开
        → 状态能保存并重开
        → UI 能触发当前 Agent
        → Agent 能调用领域 Tool 写回
        → UI 能显示结果
        ```

    [任务可独立验收]
        每个 Task 都写目标、输入、涉及文件、依赖、实现边界、执行命令、完成标准、失败回退和相关 ID。
        “实现 UI”“完成 MCP”“做好测试”不是合格 Task。

    [证据与代码同计划]
        不能先写完代码再想怎样证明。
        每个 AC 在计划中同时映射实现 Task、验证 Task、target 和 evidence 类型。

    [风险前置]
        高风险、不确定、会影响后续大量代码的任务先做。
        已通过 Spike 的约束直接写入任务，不重新自由发挥。

[规划流程]
    产出契约（规划路径由你决定）：
    - 按 [固定 Phase 骨架] 组织，先平台本地闭环后业务 Slice，简单阶段可合并但 Gate 不漏。
    - 每个 Task 写明 Goal、Related IDs、验证命令与 Completion Criteria，依赖显式；并行任务不改同一文件、不依赖未完成契约。
    - 每条 must 与 AC 映射到具体 Task，Skill Catalog 的每个技能有实现 Task，触发评测登记 Host Verification Matrix 由第五步 checker 执行、不排开发期 Task；无归属项立即回上游。
    - 每个 Phase 有 Entry Gate、Exit Gate、Blockers、Rollback；Traceability Matrix 完整。
    - 输出前运行中央 Validator（validate-plugin-project）。

[固定 Phase 骨架]
    必须评估以下 Phase，允许合并简单阶段但不能漏掉对应 Gate：

    0. Scaffold & Contracts
        项目结构、依赖、Schema、Host-neutral core、基础 Manifest / MCP config。

    1. Local Round-trip
        按 plugin.form 分支，均不接触宿主：companion-web-app 本地启动 MCP Server（stdio Probe 通过）、打开最小 UI；mcp-app 本地启动 MCP Server、`ui://` Resource 可读取、桥接桩页面渲染 widget 并完成一次 Tool 往返；hybrid 两条都通。

    2. State Round-trip
        UI 加载、保存、原子写、项目隔离、关闭重开恢复。

    3. UI → Agent
        requestId、选择 / 资源引用、触发当前 Agent、重复提交保护。

    4. Agent → UI
        Agent-visible 领域 Tool、版本保护、结果写回、UI 刷新。

    5. Core Feature Slices
        按 Golden Path 的用户价值切片开发业务功能。

    6. Failure, Security & Jobs
        失败恢复、权限、Threat Model、长任务、迁移和清理。

    7. Host Packaging
        每个 required target 的安装包、clean build、版本和元数据。

    8. Final Package Smoke
        clean build 安装包、本地 Package Smoke、证据齐备与 Checker 入口；Install 与 Host E2E 由第五步执行。

[Task 格式]
    每个任务必须包含：

    ```text
    TASK-XXX · 标题
    - Goal
    - Related IDs
    - Inputs
    - Files
    - Dependencies
    - Implementation Boundary
    - Commands
    - Completion Criteria
    - Evidence
    - Failure / Rollback
    - Parallel Safety
    - Status
    ```

[计划 Gate]
    - 所有 must Requirement 有 Task。
    - 所有 required AC 有实现 Task + 验证 Task。
    - 对话控制链路（Skill 驱动 → Tool → 状态与 UI 可见）有实现与验证 Task；form = mcp-app / hybrid 时含每个带 UI 的 Tool 的 tool-only 直调验证。
    - 每个 required target 有 Package + 本地 Package Smoke Task；Install 与 Core E2E 登记 Host Verification Matrix，由第五步执行。
    - UI → Agent 与 Agent → UI 是独立可验收阶段。
    - State reopen、project isolation 和 stale result 有任务。
    - Threat Model 中 high / medium 有缓解和验证任务。
    - Class C Prototype 结论映射到正式任务。
    - Task 无“若时间允许”“视情况”“后面补”。
    - 不存在先使用后定义的契约依赖。
    - 并行任务不写同一文件。
    - 最终 Exit Gate 与 SHIPPABLE 定义一致。

[输出规则]
    1. 按 `templates/plugin-dev-plan-template.md` 生成 PLUGIN-DEV-PLAN.md。
    2. 给每个任务稳定 ID，不因排序变化重编号。
    3. 初始化任务状态 pending；Design 阶段已完成的 Spike 对应任务标 done 并引用其 Evidence，不等于生产任务完成。
    4. 更新 Plugin-Project-State.md：phase = PLAN_READY，qualityGate = PLAN_VALID。
    5. 不改代码；发现需要代码验证的未知应回 Design 做 Spike，而不是偷偷开发。

[完成标准]
    - PLUGIN-DEV-PLAN.md 通过计划 Gate。
    - 每个 must Requirement 和 required AC 都映射到实现 Task、验证 Task 与 Evidence。
    - 第一条 Critical Path 是最小 Plugin 双向闭环，不是复杂业务 UI。
    - 每个 required target 有独立 Package、本地 Smoke 与 Reopen Task；Install 与 Core E2E 由第五步集中执行并回填 Matrix。
    - Task 的文件边界、依赖、命令、完成标准、回退和并行安全可直接执行。
    - Plugin-Project-State.md 已更新为 PLAN_READY / PLAN_VALID。

[完成后告诉用户]
    概括：
    - Critical path。
    - 第一条最小闭环。
    - 业务功能怎样分 Slice。
    - required target 何时真实安装验证。
    - 最大风险在哪个 Phase 被消除。
    - 文件写到了哪里。

    等用户确认或修改后，进入 plugin-builder Skill。

[语言]
    产出文档正文以中文为主体；代码、命令、字段名和宿主术语保留英文，不整段写英文。

[禁止]
    - 按前端、后端、测试三个大桶写计划。
    - 用“完成页面”“接入 Agent”“完善安全”这种不可验收任务。
    - 把 optional target 当 required，或相反。
    - 把真实宿主安装排进开发期任务（Host Spike 例外）。
    - 所有测试都放到最后。
    - 计划里重新发明与 Plugin-Design.md 冲突的架构。
