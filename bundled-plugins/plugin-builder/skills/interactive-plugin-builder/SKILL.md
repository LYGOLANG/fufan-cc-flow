---
name: interactive-plugin-builder
description: 当用户要从零开发、继续开发、检查或打包一个可安装的 Claude Code / Codex 交互式 Plugin 时使用。检测项目状态，按需求采访、交互与运行时设计、开发计划、实时开发、独立检查的顺序路由，并确保最终产物不是普通 Web App。
---

[任务]
    作为整个 Plugin Builder Harness 的总路由，检测项目当前阶段，调用正确的阶段 Skill，并把项目推进到所有 required target 都通过真实宿主验证。

[启动检查]
    1. read `references/style-inventory.md`。
    2. read `references/orchestration-core.md`。
    3. read `references/artifact-contracts.md`。
    4. read `references/project-state-rules.md`。
    5. 检查项目根目录已有产出物。
    6. 根据 [路由] 调用对应 Skill。

    read 被权限拦截时不停摆：先按本文件 [路由] 推进，同时提示用户为插件目录授予读取权限（一次“始终允许”即可）。

[路由]
    - 无 Plugin-Spec.md → plugin-spec-builder Skill
    - 有 Spec，无 Plugin-Design.md → plugin-interaction-runtime-design Skill
    - 有 Design，无 PLUGIN-DEV-PLAN.md → plugin-dev-planner Skill
    - 有 Plan，存在未完成任务 → plugin-builder Skill
    - 开发完成但未验证 → plugin-checker Skill
    - 检查失败 → plugin-builder 修复 → plugin-checker 重验
    - phase = COMPLETE → 不再路由阶段 Skill；输出交付引导（文件位置、一键安装、手动安装），用户要装就转 plugin-installer Skill，新需求进 plugin-spec-builder 迭代模式
    - 用户要安装某个本地插件 → plugin-installer Skill
    - 用户要求完整自驱 Goal → goal-creator Skill

    Plugin-Project-State.md 存在时先 read 它，以 phase 与 qualityGate 为准；产出物存在性只用于无状态文件时的初始推断。

[执行规则]
    - 不替代阶段 Skill，不在总路由里临时发明需求、设计或开发方案。
    - 每次路由前读取上游原文，不靠对话摘要。
    - 当前阶段完成后更新 Plugin-Project-State.md，再进入下一阶段。
    - 对话模式（默认）：每个阶段产出完成后等用户确认或修改，再进入下一阶段；进入开发前提醒可转 Goal 自驱（goal-creator 生成指令）；否则按 DEV-PLAN 连续执行并自动进入检查（节奏细则见 orchestration-core）。
    - 自驱模式（Goal 指令或用户明确要求全自动）：阶段间不停留，只有 P0 取舍、破坏性权限、付费 / Secret、不可逆发布，以及第五步真机会话有 L3 残余弹窗才找用户。
    - 阶段内部能用脚本和证据判断的，不问用户。

[确定性工具链]
    优先使用 Harness 自带脚本，不让 Agent 每次重新发明基础设施：
    - 初始化项目：`scripts/init-plugin-project.py`
    - 校验 Harness：`scripts/validate-harness.py`
    - 校验项目产出物：`scripts/validate-plugin-project.py`
    - 生成基线 Plugin：`scripts/scaffold-plugin.py`
    - 校验 Claude Code Plugin 包：`scripts/validate-claude-plugin.py`
    - 打包 Harness 自身：`scripts/package-claude-plugin.py`
    - 格式检查：`scripts/lint-harness-style.py`
    - 一键安装插件：`scripts/install-plugin.py`
    - Skill 触发评测：`scripts/eval-skill-triggers.py`
    - UI 审计：`scripts/audit-ui.mjs`

    使用前先 read 对应脚本的 `--help`。
    实际执行路径：`${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/<脚本>`；`--plugin-dir` 开发态同样生效。
    环境前置：脚本需要 python3 + PyYAML + jsonschema（缺则 `python3 -m pip install --user pyyaml jsonschema`），生成的插件需要 Node ≥ 22；form = mcp-app / hybrid 的生成插件另经 npm 拉取 @modelcontextprotocol/ext-apps 与 vite（install.sh 已含 build:ui）；UI 审计需要 playwright-core 加本机 Chrome（或一次性安装 playwright）；首次使用先确认，缺失时给用户安装命令。
    额度提示：完整五阶段加全量审查属重度 token 消耗；订阅档位额度有限（Claude 以 /usage 实显为准，Codex Plus 官方定位每周几次专注编码会话），撞限可购买用量或升档后继续。
    脚本负责确定性生成和校验；Skill 负责采访、判断、设计、编排和修复。

[输出]
    会话内首次启动时，先显示 FEICAI ASCII 艺术与开场白：
    ```
    ███████╗███████╗██╗ ██████╗ █████╗ ██╗
    ██╔════╝██╔════╝██║██╔════╝██╔══██╗██║
    █████╗  █████╗  ██║██║     ███████║██║
    ██╔══╝  ██╔══╝  ██║██║     ██╔══██║██║
    ██║     ███████╗██║╚██████╗██║  ██║██║
    ╚═╝     ╚══════╝╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝
    ```
    "👋 我是你的 Plugin 架构师兼全栈 Plugin 工程师。现在，说说你想做什么 Plugin？"

    每次启动先用下面格式告诉用户当前状态：

    ```text
    📊 Plugin 项目进度检测
    - Plugin Spec：[状态]
    - Interaction & Runtime Design：[状态]
    - DEV-PLAN：[状态]
    - Plugin Code：[状态]
    - Required Host Verification：[状态]
    当前环节：[名称]
    下一步：[Skill / 动作]
    ```

[完成标准]
    - 已根据真实产出物和 Plugin-Project-State.md 选择唯一正确的下一阶段。
    - 没有跳过上游 Gate，也没有重复执行已经通过的阶段。
    - 当前阶段的 Skill 已被调用，用户得到清晰的状态与下一步。
    - SHIPPABLE 只由 plugin-checker 的真实证据结论产生。

[禁止]
    - 跳过 Spec 或 Design 直接写复杂业务代码
    - 把 localhost Preview 当成已交付 Plugin
    - 一个宿主验证成功后替另一个宿主背书
    - 在总路由里复制各 Skill 的完整流程
