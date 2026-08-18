---
name: plugin-planning-rules
description: plugin-dev-planner 拆计划前 read；按这里的垂直切片、依赖、风险与证据规则组织 Task，保证计划可实时执行、失败可回退。
---

[任务粒度]
    一个 Task 应在一个清晰工作块内完成，并能用命令或可观察场景独立判定。

    太大：
    - 实现视频编辑器
    - 完成 MCP Server
    - 支持 Claude Code

    合格：
    - 定义并校验 `trim_clip` request / result Schema。
    - 在 Claude Code Plugin 包中注册 stdio MCP Server，并通过 initialize + tools/list Probe。
    - UI 点击“删除停顿”后持久化 requestId，Channel 不可用时写入 request queue，并显示 pending 状态。

[垂直 Slice]
    每个用户价值 Slice 尽量包含：

    ```text
    UI 入口
    → 状态 / 请求
    → Agent / Tool
    → 领域写回
    → UI 反馈
    → 自动测试 / 证据
    ```

    不能只完成一层后长期悬空。

[依赖规则]
    - Schema 在使用前定义并验证。
    - 权威状态与版本规则在业务写回前完成。
    - 对话控制链路是每种形态的 must：Skill → Tool → 状态可见的闭环有实现与验证 Task；form = mcp-app / hybrid 时每个带 UI 的 Tool 另有 tool-only 直调验证任务。
    - Host Adapter 基础能力在业务 UI 依赖前完成。
    - 破坏性行为在实现前有确认与恢复设计。
    - 打包与本地 Package Smoke 在计划内完成；真实宿主的 install 与 E2E 统一由第五步集中执行，开发期不排真机任务。

[风险排序]
    优先级：
    1. 宿主不支持或安装不确定；用到脚手架未覆盖的宿主能力时，排一个早期 Host Spike（唯一的开发期真机例外，须向用户明示需要到场一次），否则宿主验证一律留在第五步。
    2. UI ↔ Agent 消息与写回不确定。
    3. 状态、并发、文件和大资源风险。
    4. 复杂直接操作和性能。
    5. 业务变体与视觉 polish。

    同等价值时先做失败成本最高的任务。

[并行规则]
    可并行：
    - Schema 与 UI 静态框架（契约已冻结）。
    - 独立 target 包装（共享 core 接口已冻结）。
    - 不同 AC 的测试夹具（不改同一实现文件）。

    不可并行：
    - 两个任务同时改核心 State Schema。
    - UI 与 Server 各自猜 request contract。
    - Host Adapter 未确定时并行写依赖它的业务入口。
    - 生产实现和 Checker 同时改变验收标准。

    派 Sub-Agent 时主 Agent必须提供：
    - 完整相关 Spec / Design 原文。
    - Task ID 和 Completion Criteria。
    - 允许修改的文件。
    - 禁止修改的契约。
    - 验证命令。

[命令规则]
    每个 Task 的 Commands 分：
    - Build / Typecheck
    - Unit / Contract Test
    - Probe / Smoke（一律本地：stdio 探针、本地 server、本地测试）
    - 宿主步骤不进 Task Commands，登记进 Host Verification Matrix 由第五步执行

    命令必须可从固定 cwd 执行，不写“运行测试”。

[证据规则]
    Evidence 要与 AC 类型匹配：
    - Schema / Tool：Probe JSON、contract test。
    - UI：截图、Playwright / browser test、可访问性结果。
    - Host：安装命令输出、debug log、Tool discovery、真实交互截图（产生于第五步集中真机会话）。
    - State：重开前后文件 hash / 内容、隔离测试。
    - Security：恶意输入测试、路径 / 网络拒绝日志。
    - Performance：固定样本和测量记录。

[Phase Entry / Exit]
    每个 Phase 写：
    - Entry Gate：必须已有的产物与通过项。
    - Exit Gate：该 Phase 新增的可观察能力。
    - Blockers：遇到什么回 Spec / Design / 用户。
    - Rollback：失败后如何恢复可运行基线。

[状态]
    Task：pending / in_progress / blocked / done / superseded。
    Phase：not_started / active / blocked / complete。

    done 只能在 Completion Criteria 和 Evidence 都满足时设置。

[变更控制]
    开发中发现：
    - 用户可感知范围变化 → 回 plugin-spec-builder。
    - 交互、Tool、状态、权限、Host 契约变化 → 回 plugin-interaction-runtime-design。
    - 只是实现顺序 / 文件变化 → 更新 Plan Changelog。
    - 单纯代码 Bug → plugin-builder 内修复，不改上游标准。
