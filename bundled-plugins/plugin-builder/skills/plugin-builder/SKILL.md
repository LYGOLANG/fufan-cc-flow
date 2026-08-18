---
name: plugin-builder
description: 当 Plugin-Spec.md、Plugin-Design.md 与 PLUGIN-DEV-PLAN.md 已齐，用户要求开始或继续开发，或者 plugin-checker 返回 REQUIRED / IMPORTANT Finding 需要修复时使用。严格按计划逐 Phase 实时写代码、运行命令、收集证据、自主排障；先完成最小双向闭环，再开发业务功能，最终生成目标宿主 Plugin 包。
---

[任务]
    按 PLUGIN-DEV-PLAN.md 将设计变成真实可安装 Plugin。

    [开发模式]
        从当前未完成 Task 继续，逐项实现、验证、记录证据。


    [修复模式]
        根据 Plugin Reviewer / Checker Finding 定位根因，修复后运行原失败场景和受影响回归，不降低上游标准。

    Builder 不是代码生成器；它负责完整的：

    ```text
    读取上游原文
    → 规划当前 Task
    → 实现
    → 构建 / 测试 / Probe
    → 检查证据
    → plugin-reviewer 任务级审查
    → 不通过就定位修复
    → 更新 Plan 与 Project State
    ```

[依赖检测]
    必须存在：
    - Plugin-Spec.md
    - plugin.yaml
    - Plugin-Design.md
    - PLUGIN-DEV-PLAN.md，Status = PLAN_READY
    - Plugin-Project-State.md，phase = PLAN_READY / BUILDING / CHECKING

    开始前 read：
    - 当前 Task 的全部相关上游 ID 原文。
    - `references/build-protocol.md`
    - `references/implementation-defaults.md`
    - `../interactive-plugin-builder/references/host-profiles.md`
    - 当前 target 的官方最新文档（涉及版本、Manifest、SDK、宿主能力时）。

    上游契约存在 P0 空缺、当前 Task 与 Design 冲突或 required target 实现路径已失效 → 停止编码，回对应阶段 Skill 更新文档。

[第一性原则]

    [计划驱动]
        一次只执行当前 Task 或明确安全的并行 Batch。
        不因为“顺手”实现计划外功能。
        计划有误时先更新 Plan 或回上游，不让代码成为新的真相源。

    [模板与契约优先]
        使用 Harness 提供的 Scaffold、Schema 和 Host Profile；不从空目录重新发明项目结构。
        UI 与 Server 共用 contracts，不各自手写相似类型。

    [最小闭环先行]
        在核心业务前完成：

        ```text
        本地启动 MCP Server 与最小 UI（宿主加载留待第五步）
        → 打开最小 UI
        → 保存一个状态
        → UI 触发当前 Agent / 请求通道
        → Agent 调用领域 Tool
        → UI 看到结果
        → 关闭重开仍存在
        ```

    [每步真实运行]
        写完不等于完成。
        每个 Task 立即用本地机器证据自证：类型检查、单元 / Contract Test、Build、stdio Probe / 本地 Smoke；没有证据不标 done。真实宿主留给第五步。

    [自主排障]
        失败修到原场景重验通过、受影响回归全绿，定位方式由你决定。
        不用试错堆补丁，不因失败降低 AC。

    [宿主隔离]
        共享 core 不依赖某个宿主私有全局。
        Claude Code Adapter、Codex Adapter 与 Standalone Dev Adapter 分层实现。

    [安全默认]
        参数、路径、权限和网络都在服务端再校验。
        不暴露任意 Shell / 任意文件 Tool，不把用户状态写进 Plugin 安装目录。

[启动动作]
    1. read Plugin-Project-State.md 和 PLUGIN-DEV-PLAN.md。
    2. 找出第一个 in_progress；没有则找第一个依赖已满足的 pending Task。
    3. 检查工作区现状、git diff、已有文件和命令，不假设目录为空。
    4. 用 3-8 行写当前 Task 执行规划与完成标准。
    5. 更新 Task = in_progress，Project State phase = BUILDING。
    6. 开始实现，不再问已经由 Spec / Design / Plan 决定的问题。

[执行方式]
    按任务隔离程度选：
    - 主 Agent 直做：耦合高、步骤少、要共享完整上下文。
    - 主 Agent 并行直做：独立命令或只读分析。
    - 派执行型 Sub-Agent：文件边界清晰、契约冻结、需要 fresh context。

    派发时必须提供：
    - Task ID、Goal、Related IDs。
    - 相关 Spec / Design 原文，不只给摘要。
    - 允许修改文件和禁止修改契约。
    - Commands、Completion Criteria、Evidence Path。
    - 不得再派 Sub-Agent，不 commit，不宣告整体完成。

[开发循环]
    每个 Task 的完成契约（实现路径由你决定）：
    - 机器证据全绿：静态检查、Contract / Unit Test、Build、本地 Probe / Smoke 全部通过，对得上 Completion Criteria。
    - 原始证据落盘 evidence/。
    - 派 plugin-reviewer 任务级审查（fresh context 只读，协议见 plugin-checker 的 review-protocol [任务级审查]；相邻小 Task 可合并一次）。
    - REQUIRED Finding 修复并复验清零。
    全部满足才标 done，并更新 Traceability 与 Project State。

[修复模式]
    每条 Finding 先映射到上游 ID 与失败 Task，归因后路由：
    - 代码缺陷 → 本 Skill 修复。
    - 计划缺口 → 先更新 Plan 再修复。
    - 设计错误 → 回 plugin-interaction-runtime-design Skill。
    - 需求变化 → 回 plugin-spec-builder Skill。
    重验契约：原失败测试 + 邻接回归必跑，受影响时重打 target 包；Finding 不能只改报告状态，必须有新证据。

[阶段完成规则]
    一个 Phase 完成前：
    - 所有 Task done。
    - Exit Gate 通过。
    - Evidence 存在且与命令 / target 对应。
    - 没有绕过的 TODO、Mock 或临时 fallback。
    - 更新 PLUGIN-DEV-PLAN.md 和 Plugin-Project-State.md。

    Phase 7 完成后生成目标宿主包。
    Phase 8 代码与自动检查完成后，phase = CHECKING，qualityGate = NOT_CHECKED；BUILD_VALID 与更高结论只由 plugin-checker 判定。

[输出]
    持续更新：
    - 源码
    - contracts/
    - tests/
    - evidence/
    - dist/
    - PLUGIN-DEV-PLAN.md Task 状态
    - Plugin-Project-State.md

    每个关键节点告诉用户：
    - 完成了哪个可运行能力。
    - 跑了什么命令。
    - 证据在哪里。
    - 下一个 Task 是什么。

[完成标准]
    - 当前计划中所有依赖已满足的 Task 均按完成标准通过，并有 Evidence。
    - required target 的源码、测试和安装包已生成。
    - 最小 UI → Agent → UI 闭环、状态重开和项目隔离已在进入 Checker 前完成自动或本地可执行部分。
    - 没有未批准的 TODO、Mock、临时绝对路径或绕过安全契约的 fallback。
    - PLUGIN-DEV-PLAN.md 与 Plugin-Project-State.md 已同步到 CHECKING / NOT_CHECKED。
    - Builder 没有越权宣告 BUILD_VALID、HOST_VERIFIED 或 SHIPPABLE。

[开发节奏]
    开工前先向用户汇报：计划共几个 Phase、预计工作量；Phase 较大时说明需要分 Phase 开发并请用户确认。
    然后提醒用户可以转 Goal 自驱：
    - 转 Goal：调 goal-creator 生成从当前 Resume Point 续跑的 /goal 指令，用户发送后第四、五步自驱跑到交付收尾，并获得完成合同与断点自续保障。
    - 继续对话模式：按 DEV-PLAN 连续完成全部任务，中途不设确认点，完成后直接进入 plugin-checker 直到交付收尾。
    两种走法都只在 P0 取舍、破坏性权限、付费 / Secret、不可逆发布时暂停提醒用户；第五步集中真机会话仅在存在 L3 残余弹窗时提醒用户到场。

[完成后告诉用户]
    概括：
    - 最后完成的可运行 Slice。
    - 构建与测试命令。
    - 安装包和 Evidence 路径。
    - 尚需 plugin-checker 执行的真实宿主与安全 Gate。

    汇报后直接进入 plugin-checker Skill，不等用户确认。

[语言]
    产出文档正文以中文为主体；代码、命令、字段名和宿主术语保留英文，不整段写英文。

[禁止]
    - 跳过平台闭环先写复杂业务 UI。
    - 一次生成大量代码后不运行。
    - 依赖 Mock Host 就宣称 target 通过。
    - 为赶进度删除版本、幂等、安全或恢复设计。
    - 临时改 AC 让失败变成功。
    - 把普通 localhost Web App 当最终 Plugin 包。
    - 使用旧文档记忆替代当前官方资料。
    - Builder 自己宣告 SHIPPABLE。
