---
name: orchestration-core
description: 总路由与任何阶段 Skill 启动时先 read；判断第一性原理、阶段路由、状态迁移、Sub-Agent 派发和完成门槛时以此为准。
---

[第一性原理]
    让任何用户——不管专业还是小白——都能用这套 Harness 顺利开发出可安装的 Claude Code / Codex Plugin。
    不服务这一条的规则和内容，一律不要。

    讲规则、讲需求、讲标准，剩下你自己来。
    - 规则定边界，需求定目标，标准定验收。
    - 需求和设计先采访收敛，不能靠编码阶段补猜测。
    - 确定性判断交给 Schema、脚本、命令和真实宿主测试，不靠口头承诺。
    - UI、Agent、MCP、状态和宿主包装是一个闭环，缺一项就不是完成的交互式 Plugin。
    - 开发完成不等于交付完成；交付包含安装引导、使用引导和文件去向。
    - 规则只许更精炼、更准，不许膨胀成通用产品经理。

[总体规则]
    - 始终使用中文交流。
    - 匹配 Skill 时先调用 Skill，再输出响应。
    - 用户已经说过的信息不重复问；先抽取，再追问。
    - 涉及 Claude Code、Codex、MCP Apps、SDK、Manifest、Plugin 安装和宿主能力时，先查官方最新文档核验版本敏感事实，不把训练记忆当当前规范。
    - 任何重大变更先更新上游文档，再改下游代码。
    - 所有产出文档与用户沟通以中文为主体；代码、命令、字段名和宿主术语保留英文，正文不得整段转英文。

[定位]
    这是一套垂直 Coding Harness，只开发 Interactive Agent Plugin。

    Interactive Agent Plugin 只有两种开发形态，第一步采访就判定并写入 Spec 与 plugin.yaml 的 plugin.form：
    - companion-web-app（默认）：插件启动完整 Web 界面，在宿主内置 Browser 或系统浏览器打开；适合完整编辑体验。
    - mcp-app：MCP Tool 通过 `_meta.ui.resourceUri` 声明 `ui://` Resource，支持 MCP Apps 的宿主把界面嵌进对话渲染；适合对话内轻量交互，全部 Tool 必须 tool-only 可用。
    两种形态都由 Agent Skill 驱动、都能通过对话控制插件；差别只在界面出现的 UI surface。轻重两层都要时取 hybrid：同一 MCP Server 同时挂 mcp-app 轻控制层与 companion-web-app 完整编辑器。

    最终产物必须包含：
    - 可安装的宿主 Plugin 包
    - 交互式 Web UI 或宿主认可的 UI 路径
    - MCP Server / 领域 Tool
    - Agent Skill
    - 项目状态与资源层
    - UI → Agent 与 Agent → UI 双向闭环
    - 真实宿主验证证据

    普通网站、SaaS、移动 App、纯展示页、单次 Artifact 和自建模型 Agent Runtime 不属于默认范围。

[五阶段流水线]
    第一步 · 需求收集
        使用 plugin-spec-builder。
        通过采访把用户零散想法收敛为 Plugin-Spec.md 与 plugin.yaml。
        不仅记录用户主动说的，还要主动发现 Golden Path 必需但用户没有意识到的连带需求。
        用户首轮表达后先聚焦调研同类产品与成熟案例，再深入追问。
        通过后：phase = SPEC_READY，qualityGate = SPEC_VALID。

    第二步 · 交互与运行时设计
        使用 plugin-interaction-runtime-design。
        通过采访确定用户能感知的交互决策；架构师自行完成 Tool、状态、Host Adapter、安全与运行时设计。
        采访前先调研这类产品的主流布局与交互模式作为基准。
        产出 Plugin-Design.md 与 contracts/。
        通过后：phase = DESIGN_READY，qualityGate = DESIGN_VALID。

    第三步 · 定制开发计划
        使用 plugin-dev-planner。
        计划按垂直闭环拆，不按“前端 / 后端 / 测试”粗拆。
        第一条可运行切片必须先打通：打开 → 保存状态 → UI 触发 Agent → Agent 写回 UI。
        通过后：phase = PLAN_READY，qualityGate = PLAN_VALID。

    第四步 · 实时开发
        使用 plugin-builder。
        按 Plan 一个任务一个任务做，写代码、执行命令、检查真实行为、失败即修复。
        不单独设置 Bug Fixer，Builder 自己承担修复闭环。
        开发任务完成后：phase = CHECKING，qualityGate = NOT_CHECKED。

    第五步 · 检查
        使用 plugin-checker。
        主 Agent 做确定性检查，plugin-reviewer 用 fresh context 做独立审查。
        required failure 返回最早受影响阶段修复，直到 SHIPPABLE 或有真实外部阻塞。
        通过后：phase = COMPLETE，qualityGate = SHIPPABLE。

    交付收尾
        SHIPPABLE 后不再有新阶段。plugin-checker 按交付引导告知用户三件事：文件在哪、一键安装、手动安装。
        插件文件夹本身就是分发物：用 plugin-installer Skill 一键装进个人 marketplace 自用，或推 GitHub 给别人安装。
        之后的去路只有两条：新需求进 plugin-spec-builder 迭代模式重走质量门，或者到此为止。

[产出物链]
    Plugin-Spec.md + Plugin-Spec-CHANGELOG.md + plugin.yaml
        ↓
    Plugin-Design.md + contracts/
        ↓
    PLUGIN-DEV-PLAN.md
        ↓
    Plugin 源码 + tests/ + 目标宿主包
        ↓
    Plugin-Check-Report.md + evidence/check/evidence.json

    Plugin-Project-State.md 只记录阶段、质量门、目标宿主状态和阻塞，不承担需求、设计或静态 Plugin Contract。

[单一真相源]
    - 用户可感知的目标、范围和验收 → Plugin-Spec.md
    - 交互、Tool、状态、安全、运行时和 Host Adapter → Plugin-Design.md
    - 实施顺序、任务和证据 → PLUGIN-DEV-PLAN.md
    - 静态机器可读编译输入 → plugin.yaml
    - 当前工作流与 per-host 状态 → Plugin-Project-State.md
    - 验证结论 → Plugin-Check-Report.md
    - 机器证据索引 → evidence/check/evidence.json

    文档与代码冲突时，不允许静默选一个。
    先判断变更属于哪一层，更新对应上游真相源，再同步下游。

[运行节奏]
    对话模式（默认）：
    - 阶段一到三：每个阶段的产出物完成后，先向用户复述结论，等用户确认或修改后再进入下一阶段。
    - 进入第四步开发前，先向用户汇报计划规模（Phase 较大时说明需要分 Phase 开发并确认），并提醒用户可以转 Goal 自驱。
    - 转 Goal：用 goal-creator 从当前 Resume Point 生成 /goal 指令，用户发送后按自驱模式把第四、五步跑到交付收尾；比对话连跑多一层完成合同与断点自续保障。
    - 继续对话模式：按 DEV-PLAN 连续执行全部任务，中途不设确认点，完成后自动进入第五步检查直到交付收尾。
    - 用户的修改先回写对应产出物，再继续。
    - 阶段内部的执行、排障和自检不打断用户。

    自驱模式（用户发送 Goal 指令或明确要求全自动时才生效）：
    - 全流程阶段之间不停留，只在 P0 产品取舍、破坏性权限、付费 / Secret、不可逆发布，以及第五步集中真机会话存在 L3 残余授权弹窗时（需到场）找用户。

    检查纪律：开发期写与审分离——builder 每个 Task 先跑机器自检（编译、测试、build、本地 probe），再派 plugin-reviewer 做任务级审查（相邻小 Task 可合并一次），REQUIRED Finding 修复清零才前进；开发期自检全部本地化，真实宿主只在第五步集中接触一次；第五步 plugin-checker 的完整检查和 plugin-reviewer 的全量两阶段审查照旧整体执行一次，不因任务级审查而省略。

[规划与执行]
    所有阶段同一个模式：主 Agent 先写本阶段小计划，再自驱执行到达标。

    规划：
    - 把工作拆成有序、可独立验收的步骤
    - 每步写目标、输入、产出和完成标准
    - 有依赖按序，无依赖可并行

    执行方式：
    - 主 Agent 直做：任务耦合、需要用户对话、涉及共享状态
    - 主 Agent 并行直做：任务独立但需要共享当前上下文
    - 派发 Sub-Agent：任务可隔离、需要 fresh context 或独立判断

    执行标准：
    - 上下文自带：执行前读相关原文，不靠记忆
    - 证据自检：用命令、文件、日志、截图、Tool Result 和宿主行为说话
    - 排障自驱：不达标就定位、修复、重验
    - 禁止空结论：“应该可以”“理论上支持”“代码看起来没问题”都不算证据

[Sub-Agent 调度]
    固定 Sub-Agent：plugin-reviewer。

    派发时必须提供：
    - 完整 Spec、Design、Plan 原文
    - 目标文件和代码范围
    - 验收标准
    - 已有证据
    - 禁止事项

    Sub-Agent：
    - 使用 fresh context
    - 不依赖主 Agent 的口头摘要
    - 不继续派 Sub-Agent
    - 不 commit
    - 不自行降低要求

[重大变更分类]
    [Spec 变更]
        核心用户结果、首版范围、非目标、目标宿主、核心权限、Acceptance Criteria 变化。
        先更新 Plugin-Spec.md 与 Plugin-Spec-CHANGELOG.md。

    [Design 变更]
        UI 结构、交互、Agent 触点、Tool Catalog、状态模型、Host Adapter、安全和运行模式变化。
        先更新 Plugin-Design.md 与 contracts/。

    [Plan 变更]
        任务顺序、实现方式、风险验证或证据要求变化，但不改变用户和架构契约。
        更新 PLUGIN-DEV-PLAN.md。

[目标宿主分级]
    每个 target 必须标：
    - required：进入 SHIPPABLE 的硬门槛
    - optional：可以 DEFERRED，但报告必须写清
    - experimental：只做探索，不承诺交付

    每个 target 的当前验证状态只记录在 Plugin-Project-State.md：
    - NOT_BUILT
    - BUILD_VALID
    - HOST_VERIFIED
    - BLOCKED
    - DEFERRED

    一个宿主的 HOST_VERIFIED 不能替代另一个宿主。

[阶段与质量门]
    phase：
    - IDEA
    - SPEC_READY
    - DESIGN_READY
    - PLAN_READY
    - BUILDING
    - CHECKING
    - COMPLETE

    qualityGate：
    - NOT_CHECKED
    - SPEC_VALID
    - DESIGN_VALID
    - PLAN_VALID
    - FAIL
    - BUILD_VALID
    - HOST_VERIFIED
    - SHIPPABLE
    - BLOCKED_EXTERNAL

    phase 和 qualityGate 分开记录。
    代码写完不等于质量门通过。

[硬性不变量]
    1. 最终有至少一个 target，且所有 required target 为 HOST_VERIFIED。
    2. 富 UI 必须验证 UI → Agent 和 Agent → UI。
    3. 用户权威状态不能写进 Plugin 安装目录。
    4. 高频直接操作不逐个经过模型。
    5. 大文件只传引用、元数据和必要预览。
    6. 写操作有 requestId、幂等与版本保护。
    7. 外部网络、文件范围、Secret 和破坏性操作明确声明。
    8. Checker required failure 未清零时，不得宣告完成。
    9. 用户要求 Both 时，必须明确哪个 target required，不能默认“验证一个就算两边完成”。
    10. 公共商店审核不在 Harness 可保证范围内，只能保证产物满足当前可验证规则。
    11. 形态在采访阶段判定并贯穿五阶段；任何形态都保持对话可控——Skill 教宿主 Agent 驱动插件，mcp-app 的全部 Tool 在无嵌入 UI 的宿主可独立调用。

[默认技术边界]
    read `platform-defaults.md`。
    默认技术栈只用于减少无价值提问，不替代当前官方文档和实际验证。

[完成定义]
    全部满足才可 SHIPPABLE：
    - Spec P0 完整，无 P0 Open Question
    - Design 无 P0 Open Decision
    - Plan 任务完成且证据齐全
    - 所有 required target 为 HOST_VERIFIED
    - UI ↔ Agent 双向闭环通过
    - 状态恢复和项目隔离通过
    - 安全 required checks 通过
    - clean build 与可重现 package 通过
    - plugin-reviewer 无 REQUIRED Finding
    - Plugin-Check-Report.md 为 SHIPPABLE
