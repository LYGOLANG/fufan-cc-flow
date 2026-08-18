---
name: project-state-rules
description: 读写 Plugin-Project-State.md 或按状态路由阶段时 read；phase、qualityGate 与 per-host 状态的合法值和更新纪律以此为准。
---

[phase]
    IDEA
        没有完整 Spec。

    SPEC_READY
        Plugin-Spec.md 与 plugin.yaml 已收敛并通过 SPEC_VALID。

    DESIGN_READY
        Plugin-Design.md 与 contracts/ 已完成并通过 DESIGN_VALID；Prototype Gate 已处理。

    PLAN_READY
        PLUGIN-DEV-PLAN.md 可执行并通过 PLAN_VALID。

    BUILDING
        正在开发或修复；qualityGate 通常保持 PLAN_VALID 或 FAIL。

    CHECKING
        正在运行 Checker、Reviewer 或 Host Test。

    COMPLETE
        所有 required target 已满足交付要求；qualityGate 必须是 SHIPPABLE。

[qualityGate]
    NOT_CHECKED
    SPEC_VALID
    DESIGN_VALID
    PLAN_VALID
    FAIL
    BUILD_VALID
    HOST_VERIFIED
    SHIPPABLE
    BLOCKED_EXTERNAL

[hostStatus]
    NOT_BUILT
    BUILD_VALID
    HOST_VERIFIED
    BLOCKED
    DEFERRED

[合法组合]
    - IDEA → NOT_CHECKED / FAIL / BLOCKED_EXTERNAL
    - SPEC_READY → SPEC_VALID / FAIL / BLOCKED_EXTERNAL
    - DESIGN_READY → DESIGN_VALID / FAIL / BLOCKED_EXTERNAL
    - PLAN_READY → PLAN_VALID / FAIL / BLOCKED_EXTERNAL
    - BUILDING → PLAN_VALID / FAIL / BLOCKED_EXTERNAL
    - CHECKING → NOT_CHECKED / FAIL / BUILD_VALID / HOST_VERIFIED / BLOCKED_EXTERNAL
    - COMPLETE → SHIPPABLE

    CHECKING 下所有 required target 达到 HOST_VERIFIED 且 Reviewer 无 REQUIRED Finding 时，phase 与 qualityGate 一次性同步写为 COMPLETE / SHIPPABLE，不存在中间态。
    Check-Report 的整体结论 BLOCKED 对应 qualityGate 的 FAIL（内部失败）或 BLOCKED_EXTERNAL（外部阻塞），按失败原因二选一。

[路由]
    - phase = IDEA → plugin-spec-builder
    - phase = SPEC_READY → plugin-interaction-runtime-design
    - phase = DESIGN_READY → plugin-dev-planner
    - phase = PLAN_READY / BUILDING → plugin-builder
    - phase = CHECKING → plugin-checker
    - phase = COMPLETE → 输出交付引导；新需求进 plugin-spec-builder 迭代模式
    - qualityGate = FAIL → 回最早受影响阶段修复后重验
    - required host 非 HOST_VERIFIED → 不得 COMPLETE / SHIPPABLE

[单一真相源]
    - plugin.yaml 记录静态 Plugin Contract，不记录当前工作流阶段或验证结果。
    - Plugin-Project-State.md 记录 phase、qualityGate 与每个 target 当前状态。
    - Plugin-Check-Report.md 和 evidence/check/evidence.json 记录验证结论与证据。

[更新纪律]
    每个阶段完成后立即更新：
    - phase
    - qualityGate
    - currentTask
    - artifacts
    - targets.<target-id>.status
    - targets.<target-id>.evidence
    - blockers
    - nextAction
    - updatedAt

    不允许只在对话里说“已完成”而不更新状态文件。
