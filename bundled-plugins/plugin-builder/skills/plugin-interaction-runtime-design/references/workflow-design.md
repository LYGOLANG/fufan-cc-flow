---
name: plugin-design-workflow
description: plugin-interaction-runtime-design 启动后按此 12 步工作流执行；先分类决策归属，最后场景走查收敛。
---

[使用时机]
    Plugin-Spec.md 已通过需求 Gate，需要把产品行为转换成可实施的交互与运行时设计。

[工作流]
    Spec 复核 → 决策分类 → UI Complexity 分级 → 工作区与交互采访 → Agent 契约 → Runtime / MCP → State / Files / Jobs → Host Adapter → Security → Visual / Accessibility → Prototype Gate → 场景走查 → 输出 Design

[顶层规则]
    - 不重问 Spec 已确认的产品目标。
    - 用户只决定体验取舍；专业架构由 Architect 主动完成。
    - Platform Fact 一律查官方资料，记录日期和来源。
    - 每个设计决定要能映射回 REQ / UX / HOST / DATA / SEC / NFR / AC。
    - 发现新的用户可感知范围，先回 Spec 更新，不在 Design 偷加需求。
    - 复杂 UI 发现高风险时优先做 Spike，不靠长采访猜。

[Step 1 · Spec 复核]
    1. 建立 Requirement Index。
    2. 标出所有 must、required target 和 AC。
    3. 检查 Golden Path 中每个 Step 的 Owner。
    4. 列出需要用户决定、Architect 决定、平台验证的事项。

    输出内部 Decision Register：

    ```text
    DEC-001 | 类型 User / Architect / Platform | 问题 | 影响 | 状态 | 关联 ID
    ```

[Step 2 · UI Complexity 分级]
    按 `prototype-gate.md` 判定 A / B / C。

    - A：单面板、表单、列表、结果预览，交互状态有限。
    - B：多区工作台、多对象、筛选、历史、局部直接操作。
    - C：无限画布、时间线、节点图、3D、音视频、复杂选择与快捷键。

    分级决定采访预算、Prototype 与验证深度。

[Step 3 · 工作区与界面地图]
    先由 Architect 基于 Golden Path提出一个基线界面模型，再让用户确认关键取舍。

    必须定义：
    - 打开入口与第一屏。
    - 主工作区、辅助面板、任务状态和结果区域。
    - 当前项目、当前页面 / 对象 / 选择 / 任务怎样表达。
    - 空状态和第一步 CTA。
    - 核心结果是覆盖、并排、历史还是独立视图。

    不把“左侧栏 + 主内容 + 右侧属性”当成万能答案；区域必须对应真实任务。

[Step 4 · 直接操作与反馈]
    对每个核心对象写：

    ```text
    对象 → 可选中方式 → 可直接动作 → 即时反馈 → 保存时机 → 撤销 / 冲突 → 是否触发 Agent
    ```

    至少走查：创建、选择、修改、删除、撤销、保存、错误。

[Step 5 · UI-Agent Contract]
    设计 request envelope：

    ```text
    requestId
    projectId / workspace
    projectVersion
    userIntent
    selection / range / object refs
    asset refs
    requested operation
    createdAt
    ```

    设计 result envelope：

    ```text
    requestId
    basedOnProjectVersion
    status
    domain operation / patch / asset refs
    warnings
    createdAt
    ```

    用户不需要决定字段名；用户只确认触发、上下文、结果应用和控制权。

[Step 6 · MCP Tool 与 Resource]
    按 `tool-design-rules.md`：
    - Render Tool：打开 UI。
    - App-only Tools：UI 状态、资源、Job、下载等确定性能力。
    - Agent-visible Tools：领域查询与领域写回。
    - Long-running Tools：启动、查询、取消、重试。
    - Resources：UI、静态或按需资源。

    每个 Tool 写：Name、Visibility、Purpose、Input、Output、Side Effect、Idempotency、Error、Related IDs。

    form = mcp-app / hybrid 时补齐 MCP App Surface：`ui://` Resource 清单、Tool `_meta.ui.resourceUri` 关联、inline / fullscreen、sandbox 与 CSP 约束、tool-only 等价路径，落进设计模板第 7 节。

[Step 7 · State、File 与 Job]
    分层：
    - Authority State：项目文件 / SQLite / 远程服务。
    - UI Ephemeral State：hover、未提交输入、临时展开。
    - Persisted View State：页面、相机、面板、选择是否需要持久化。
    - Request State：pending / processing / succeeded / failed / cancelled / stale。
    - Asset State：原始、派生、缓存、输出和引用。

    Architect 默认加入：schemaVersion、原子写、projectVersion、requestId、幂等、stale result protection、迁移策略。

[Step 8 · Host Adapter]
    对每个 target 写：

    ```text
    Target ID
    Tier
    Current verified platform fact + date
    Primary Path
    UI Surface
    Agent Trigger
    Agent Result Path
    Fallback
    Unsupported / Deferred
    Install Method
    Verification Method
    ```

    Claude Code-first 默认不等于强行内联 iframe；以当前官方能力和用户可接受 fallback 为准。

[Step 9 · Security]
    按 `threat-model.md` 建立 threat table。
    所有文件、网络、Secret、HTML、postMessage、命令和破坏性 Tool 都要有边界与验证。

[Step 10 · Visual 与 Accessibility]
    将“简洁、专业、现代”等翻译成：
    - 信息密度和视觉层级。
    - 主内容与控制占比。
    - 状态色用途。
    - 字号、行高、对比度和焦点规则。
    - 交互反馈和禁用状态。
    - 键盘完成核心路径的最低要求。

    有现有设计系统就继承，不自由发挥新品牌。

[Step 11 · Prototype Gate]
    Class A 可免。
    Class B 视风险做 wireframe / interactive mock。
    Class C 必须做 runnable Spike，验证：
    - 最风险的直接操作。
    - 最风险的资源 / 性能路径。
    - 最风险的宿主通信或嵌入限制。

    Spike 不是产品代码，不提前扩张功能。

[Step 12 · 场景走查]
    至少走：
    1. 第一次打开与空状态。
    2. 一次完整核心任务。
    3. Agent 失败或不可用。
    4. 用户在 Agent 工作时继续修改，旧结果到达。
    5. 关闭重开和状态恢复。
    6. 权限拒绝、文件丢失或网络失败。
    7. required target fallback 或能力不足。

    每一步要回答：用户看到什么、能做什么、状态存哪、谁执行、怎样恢复。

[完成 Gate]
    按 SKILL.md [设计 Gate]。
    未通过 → 修设计、做 Spike 或回 Spec。
    通过 → 生成 Plugin-Design.md、Schema 与更新后的 plugin.yaml。
