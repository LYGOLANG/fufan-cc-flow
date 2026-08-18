---
name: plugin-spec-template
description: 生成 Plugin-Spec.md 时按此模板填写；每条需求带四行字段，AC 用 Given / When / Then 加目标宿主。
---

[文档信息]
    Plugin：
    Version：0.1
    Status：DRAFT / SPEC_READY / SUPERSEDED
    Last Updated：

[一句话定义]
    <目标用户> 使用这个 Plugin，通过 <关键 UI 操作> 让 <宿主 Agent> 完成 <语义任务>，最终得到 <可观察结果>。

[用户与情境]
    - Primary User：
    - 使用情境：
    - 当前替代方案：
    - 核心痛点：

[核心结果]
    - Outcome：
    - 为什么需要 Plugin：
    - 为什么需要 GUI：

[开发形态]
    - Form：companion-web-app / mcp-app / hybrid
    - 判定依据：界面出现位置 + 目标宿主支持面 + 交互复杂度的结论
    - 对话控制：Agent Skill 驱动方式；mcp-app / hybrid 时注明 tool-only 体验底线

[Golden Path]
    1. 安装或打开：
    2. 初始状态：
    3. 用户输入：
    4. UI 直接操作：
    5. UI → Agent：
    6. Agent 执行：
    7. Agent → UI：
    8. 保存、导出或继续迭代：

[需求]
    每条需求都带 REQ-001 的四行字段，此处不重复展开。

    [功能需求]
        - REQ-001：
            Source：user / inferred / default / official-doc / research
            Confidence：confirmed / probable / assumed
            Priority：must / should / could
            Status：active / deferred / superseded

    [交互需求]
        - UX-001：

    [宿主需求]
        - HOST-001：

    [数据与文件]
        - DATA-001：

    [安全与权限]
        - SEC-001：

    [非功能需求]
        - NFR-001：

[UI 与 Agent 分工]
    - UI 本地负责：
    - App-only Tool 负责：
    - Agent 负责：
    - Agent-visible Tool 负责：

[目标宿主]
    [<target-id>]
        Tier：required / optional / experimental
        基准体验：
        可接受降级：

[输入与输出]
    - 输入：
    - 输出：
    - 状态范围：
    - 文件范围：
    - 网络：
    - Secret：
    - Shell：

[失败路径]
    - 关键失败：
    - 用户看到：
    - 恢复方式：

[首版范围]
    Must：
    -

    Should：
    -

    Could：
    -

[明确非目标]
    -

[验收标准]
    - AC-001（target：<target-id>）：Given <前置>，When <操作>，Then <可观察结果>。

[默认与假设]
    -

[Open Questions]
    P0：
    - None

    P1：
    -

    P2：
    -

[追踪]
    - AC-001 → 待 Design / Plan / Evidence 映射。
