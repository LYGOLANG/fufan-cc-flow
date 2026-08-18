---
name: review-protocol
description: plugin-reviewer 被派发执行独立审查时按此协议执行并输出报告；plugin-builder 开发期按 [任务级审查] 派发，plugin-checker 第五步按全量两阶段派发，派发时把项目根与本协议路径一并交付。
---

[审查流程]
    两种派发范围：
    - 任务级审查：plugin-builder 开发期派发，只按 [任务级审查] 执行。
    - 全量审查：plugin-checker 第五步派发，先完成 Stage 1，再完成 Stage 2，最后按 [Finding 格式] 输出；两个 Stage 都必须执行，Stage 1 失败不能成为跳过质量审查的理由。
    全程只读，任何修复建议都交给主 Agent 或 plugin-builder 执行。

[任务级审查]
    范围只覆盖本次派发的 Task（相邻小 Task 可合并为一次）：
    1. read 该 Task 的 Goal、Completion Criteria 与 Related IDs 对应的 Spec / Design / Plan 原文。
    2. 对照改动文件：实现是否偏离契约、有没有计划外功能或被静默省略的 must 项。
    3. 抽查改动代码的安全与可靠性：边界校验、幂等、状态隔离、错误行为。
    4. 核对证据：命令输出是否真实支撑 Completion Criteria，测试是否真的执行核心路径而非只断言存在。
    输出沿用 [Finding 格式]，Verdict 只给 PASS / FIX_REQUIRED。
    REQUIRED Finding 由 builder 修复并复验清零后才允许标 done；任务级审查不产生 BUILD_VALID 及以上结论。

[视觉审查]
    输入：evidence/check/ui-audit/ 的多主题多宽度截图集（form = mcp-app / hybrid 时含桥接桩页面的 widget 截图），对照所选风格包的 kit.md 纪律与 demo.html 样张、Plugin-Design.md 的界面章节。
    逐项评判，不推给用户：
    - 主题相符：整体气质符合所选风格包，明暗两主题都成立。
    - 应用正确：风格纪律零违例——Agent 专属视觉不外借、语义色不作装饰、形状语义完整。
    - 组件得所：每个组件用在其设计用途上，无平行发明、无错位使用。
    - 布局与审美：层级清晰、对齐一致、密度得当；溢出、折行、遮挡为零。
    - 优化空间：给出可执行的改进项，不空谈。
    产出沿用 [Finding 格式]：纪律违例记 IMPORTANT 起，布局破坏记 REQUIRED，优化项记 SUGGESTION。
    用户保留最终品味否决权，但以上判断是审查员本职，不得上交。

[Stage 1 · Contract Review]
    目标：判定 Spec、Design、Plan、源码与宿主包各层相互一致，闭环真实存在。核对方式由你决定，必须覆盖：
    - 每条 must 需求与 Acceptance Criteria 在下游有落点，无静默省略。
    - 设计中的 Render、UI、Agent、Tool、State、Permission、Fallback 契约在源码与宿主包里有真实实现。
    - UI → Agent 与 Agent → UI 双向闭环有实现和证据。
    - 没有绕过 Spec 进入代码的新增功能。
    - AC 有区分度：无论实现好坏都会通过的 AC 记 Finding，要求换成能失败的验收。
    任一覆盖面失守即 FAIL。

    Stage 1 有 REQUIRED Finding 时，Stage 2 仍可继续，但最终结论不得通过。

[Stage 2 · Quality Review]
    重点检查：
    - Plugin 安装目录与用户项目状态是否隔离。
    - 文件路径、文件名、软链接、输入数据和 HTML 是否有边界校验。
    - Tool 是否使用领域语义，是否暴露任意 Shell、任意路径或万能写入接口。
    - Request ID、projectVersion、幂等、旧结果保护和原子写是否完整。
    - 长任务是否有状态、取消、重试、恢复和重复提交保护。
    - required target 是否逐个真实验证，是否存在一个宿主替另一个宿主背书。
    - Build 是否可重现，依赖是否锁定，安装包是否来自 clean build。
    - 错误、权限拒绝、网络失败、文件丢失、冲突和升级迁移是否有明确行为。
    - 测试是否真的执行核心路径，而不是只断言函数存在。

[证据规则]
    - 代码存在 ≠ 功能通过。
    - Build 通过 ≠ Plugin 可安装。
    - localhost 打开 ≠ 宿主内运行。
    - Tool 可发现 ≠ 双向闭环通过。
    - 一个 target 的证据不能复用给另一个 target。
    - 没有命令输出、截图、日志、文件或宿主结果时，写“未验证”，不要推测通过。
    - 举证责任在通过一侧：文件名正确但内容错误 = FAIL；不存在部分通过。

[Finding 格式]
    每条 Finding 必须使用：

    ```text
    [REQUIRED|IMPORTANT|SUGGESTION] F-XXX · 标题
    - 位置：文件:行号 / 产物 / 宿主
    - 违反：REQ / AC / Design / Host Contract / Security Rule
    - 证据：实际看到的代码、日志或缺失项
    - 影响：用户或系统会怎样失败
    - 修复：最小可执行修复方向
    - 重验：修复后必须运行什么
    ```

    严重度：
    - REQUIRED：阻止 SHIPPABLE，包含需求缺失、安装失败、双向闭环缺失、数据破坏、安全高风险、required host 未验证。
    - IMPORTANT：不一定阻止核心路径，但明显影响可靠性、维护性或用户控制。
    - SUGGESTION：非必需优化，不得混进 REQUIRED。

[报告结构]
    最终返回：

    ```text
    Plugin Review
    - Stage 1 Contract：[PASS / FAIL]
    - Stage 2 Quality：[PASS / FAIL]
    - REQUIRED：[数量]
    - IMPORTANT：[数量]
    - SUGGESTION：[数量]

    Positive Findings
    - [确实做对的关键点，1-3 条]

    Findings
    ...

    Verdict
    - BLOCKED / BUILD_VALID / HOST_VERIFIED_CANDIDATE
    - 一句话理由
    ```

    HOST_VERIFIED_CANDIDATE 只是候选结论，HOST_VERIFIED 由主 Agent 依真实宿主证据判定。
