---
name: goal-creator
description: 当用户希望把整个 Plugin 开发目标或当前剩余流程交给 /goal 自驱执行时使用。读取项目现状判定 Resume Point，按官方 /goal 合同生成一条可验证终态的完成条件，用户复制发送即可启动；从当前阶段续跑，不机械重走已经通过的阶段。
---

[任务]
    把“把这个 Plugin 推进到 SHIPPABLE”编译成一条符合 /goal 合同的完成条件，交给用户复制发送。
    只准备指令，不替用户触发。

[/goal 合同]
    以当前官方 /goal 行为为准（Claude Code v2.1.139 起内置）：
    - 条件上限 4000 字符，超了发不出去。
    - 每轮结束后由独立小模型 evaluator 判定条件是否成立；它不执行命令、不读文件，只看会话里已出现的内容。
    - 因此完成条件必须可自证：要求跑命令贴输出、贴关键文件行、列产出物路径。
    - Goal 写要到达的终态，不写要做的工作；流程知识由已安装的 Harness 承担，不进 Goal。

[启动检查]
    1. read `../interactive-plugin-builder/references/orchestration-core.md`。
    2. read `../interactive-plugin-builder/references/project-state-rules.md`。
    3. read Plugin-Project-State.md、Plugin-Spec.md、plugin.yaml、Plugin-Design.md、PLUGIN-DEV-PLAN.md、Plugin-Check-Report.md（存在时）。
    4. 检查实际源码、dist/、evidence/ 和未完成 Task。
    5. 判定 Resume Point。

[Resume Point]
    先读 phase 与 qualityGate，再判定：
    - phase = IDEA 或无 Spec → 从 plugin-spec-builder Skill 开始，允许与用户采访。
    - phase = SPEC_READY → 从 plugin-interaction-runtime-design Skill 开始。
    - phase = DESIGN_READY → 从 plugin-dev-planner Skill 开始。
    - phase = PLAN_READY / BUILDING → 从第一个依赖已满足的未完成 Task 开始。
    - phase = CHECKING，qualityGate = NOT_CHECKED / BUILD_VALID / HOST_VERIFIED → 从 plugin-checker、缺失的 host verification 或 SHIPPABLE 收尾判定开始。
    - qualityGate = FAIL / BLOCKED_EXTERNAL → 先处理报告中最早的 REQUIRED Finding，必要时回上游。
    - phase = COMPLETE，qualityGate = SHIPPABLE → 不生成重复开发 Goal；只生成明确的新目标或迭代 Goal。

[Goal 生成规则]
    按 `templates/goal-template.md` 填写：
    - 完成条件是唯一核心，全部写成可自证终态，evaluator 全靠它。
    - 项目路径、Resume Point、required targets 填实；填不出的行删掉。
    - 约束只写真实边界：Spec 的 Non-goals、破坏性权限、打断条件；不写空话。
    - 不复述路由、阶段流程和 Sub-Agent 规则：接收会话装有本 Harness，总路由自动接管。
    - 整条压进 4000 字符，每个字带信息。
    - 宿主不会在用户发送的消息里展开 ${CLAUDE_PLUGIN_ROOT}：生成时先解析 Harness 安装绝对路径，把模板里的 <Harness 安装绝对路径> 替换成真实路径。

[输出]
    只输出一段用户可整段复制的 /goal 指令，放进代码块，附一句“复制这段发送即可启动”。
    无 /goal 的环境（版本过旧或 hooks 被禁用）：同一段文字去掉 /goal 前缀，作为普通消息发给新会话同样成立。
    不直接执行，不替用户发送。
    涉及不可逆操作（发布、删除、付费）时提醒用户发送前扫一眼约束段。
    提醒用户：自驱中断或暂停超过 1 小时后恢复会整段上下文重算（订阅缓存寿命 1 小时），长自驱尽量连续完成。

[完成标准]
    - Goal 明确当前 Resume Point，不重做已经通过的阶段。
    - 完成条件全部可自证，覆盖 SHIPPABLE 硬门槛：中央 Validator PASS、required target 全 HOST_VERIFIED、Reviewer REQUIRED = 0、Check-Report SHIPPABLE、安装包存在。
    - 全文不超过 4000 字符，发到新会话仍可执行。

[禁止]
    - 把 Goal 写成流程剧本或工作清单。
    - 写“体验良好”“保持兼容”这类 evaluator 无法判定的条件。
    - 复述 Harness 里已有的路由与阶段规则占字数。
    - 允许没有真实宿主证据就算完成。
