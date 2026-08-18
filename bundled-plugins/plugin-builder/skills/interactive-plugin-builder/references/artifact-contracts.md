---
name: artifact-contracts
description: 生成或修改任何阶段产出物（Spec、plugin.yaml、Design、Plan、State、Report、evidence）前先 read；按这里规定的字段、ID 与追踪要求写，不自创结构。
---

[Plugin-Spec.md]
    回答“用户最终要得到什么”。

    必须包含：
    - 一句话定义
    - 目标用户和使用情境
    - 核心结果
    - 为什么需要 GUI
    - 开发形态（companion-web-app / mcp-app / hybrid）与判定依据
    - Golden Path
    - Must / Should / Could / Non-goal
    - UI 直接操作
    - Agent 职责
    - UI → Agent / Agent → UI 用户可感知行为
    - 输入、输出、状态与权限
    - 失败行为
    - Requirement ID
    - Acceptance Criteria ID
    - 假设和 Open Question

    ID 前缀：
    - REQ：功能需求
    - UX：交互需求
    - HOST：宿主需求
    - DATA：状态与文件
    - SEC：安全与权限
    - NFR：性能、规模、兼容性
    - AC：验收标准

    每条记录：
    - Source：user / inferred / default / official-doc
    - Confidence：confirmed / probable / assumed
    - Priority：must / should / could
    - Status：active / deferred / superseded

[Plugin-Spec-CHANGELOG.md]
    只记录已批准的 Spec 变化：日期、变更 ID、原因、影响范围、下游同步状态。

[plugin.yaml]
    Host-neutral Plugin IR，供脚本校验和 Host Adapter 编译。

    必须有：
    - schemaVersion
    - plugin metadata（含 plugin.form）
    - targets 映射、tier、runtimeProfile、uiMode、fallback 与 requiredStatus
    - ui / agent / state / permissions / jobs
    - request / result / state / evidence contract paths
    - mcp catalog 摘要
    - acceptance IDs
    - code / dist / state / evidence paths

    不包含当前 phase、qualityGate 或 per-host 验证结果；这些只写入 Plugin-Project-State.md。
    它不代替 Spec。冲突时先以 Plugin-Spec.md 为准，再修复 YAML。

[Plugin-Design.md]
    回答“用户和 Agent 怎样共同完成任务，以及 Plugin 怎样运行”。

    必须包含：
    - Design Decision ID
    - Requirement Mapping
    - Prototype Class 与 Gate
    - 界面地图
    - 交互语法
    - UI 状态模型
    - UI → Agent Request Contract
    - Agent → UI Result Contract
    - Tool / Resource Catalog
    - MCP App Surface（form = mcp-app / hybrid 时）
    - 权威状态与文件生命周期
    - Host Adapter
    - Capability Detection
    - Loading / Error / Conflict
    - Threat Model
    - Visual / Accessibility

[PLUGIN-DEV-PLAN.md]
    回答“按什么顺序把它做成可安装 Plugin”。

    每个任务必须有：
    - Task ID
    - Status
    - Goal
    - Inputs
    - Files
    - Dependencies
    - Implementation
    - Host
    - Verification commands
    - UI verification
    - Evidence path
    - Completion criteria

    每个 AC、Design Decision 和高风险假设都必须映射到任务。

[Plugin-Project-State.md]
    只记录：
    - phase
    - qualityGate
    - currentTask
    - artifacts
    - per-host status 与 evidence refs
    - blockers
    - nextAction

    不复制需求和设计内容。

[Plugin-Check-Report.md]
    回答“它是否真的可交付”。

    整体结论只能是：
    - BLOCKED
    - BUILD_VALID
    - SHIPPABLE

    每个 target 的状态只能是：
    - NOT_BUILT
    - BUILD_VALID
    - HOST_VERIFIED
    - BLOCKED
    - DEFERRED

    报告必须逐 target 给状态和证据。
    无真实宿主证据不得把任何 target 写成 HOST_VERIFIED。
    只有所有 required target 都是 HOST_VERIFIED，整体结论才能是 SHIPPABLE。

[evidence/check/evidence.json]
    机器可读证据索引，必须符合 Harness 的 evidence schema（skills/interactive-plugin-builder/schemas/evidence.schema.json）。项目 contracts/evidence.schema.json 是插件自身证据契约的占位，设计阶段细化，不约束本文件。

    每条证据包含：
    - evidenceId
    - target
    - checkId
    - relatedIds
    - action / command
    - exitCode / status
    - artifactPath
    - timestamp
    - environment
    - notes
