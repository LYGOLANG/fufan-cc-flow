---
name: plugin-goal-template
description: goal-creator 生成 /goal 指令时按此模板填写；完成条件必须全部可自证，整条不超 4000 字符，填不出的行删掉。
---

/goal 把 <项目绝对路径> 的 Plugin「<plugin-id>」推进到 SHIPPABLE。当前 phase = <phase>，qualityGate = <qualityGate>，从 <Resume Point> 继续，已过 Gate 的阶段不重做；按项目产出物原文推进，本消息不替代原文。

完成的标准（逐条自证，缺一不可）：
1. 运行中央 Validator 输出 PASS 并贴完整输出：python3 "<Harness 安装绝对路径>/skills/interactive-plugin-builder/scripts/validate-plugin-project.py" --root .
2. Plugin-Project-State.md 中所有 required target（<targets>）的 status 为 HOST_VERIFIED，贴 targets 块
3. plugin-reviewer 独立审查 REQUIRED = 0，贴 Verdict 行
4. Plugin-Check-Report.md 的 Final Status 为 SHIPPABLE，贴该行
5. 安装包与 evidence/check/evidence.json 存在，列出路径

约束：
- 不实现 Plugin-Spec.md 的 Explicit Non-goals；localhost 预览、Build 成功、Tool 可发现都不算完成
- 遇 P0 产品取舍、新的破坏性权限、付费 / Secret、不可逆发布、集中真机会话的 L3 残余弹窗才暂停问用户，其余自驱
- <项目真实约束，没有就删本行>

执行策略：目标导向，一条路不通换方法，多种都试过才停；每阶段完成即更新 Plugin-Project-State.md 并保存 evidence。
