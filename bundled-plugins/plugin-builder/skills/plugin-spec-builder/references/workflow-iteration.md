---
name: plugin-spec-workflow-iteration
description: 已有 Plugin-Spec.md 且需求变化时按此工作流迭代；维护需求 ID、Changelog 与影响分析，判断阶段回退。
---

[使用时机]
    项目已有 Plugin-Spec.md，用户提出新增、修改、删除、收敛或纠正需求。

[启动检查]
    1. read Plugin-Spec.md、plugin.yaml、Plugin-Spec-CHANGELOG.md。
    2. read Plugin-Design.md、PLUGIN-DEV-PLAN.md、Plugin-Project-State.md（存在时）。
    3. plugin.yaml 缺 plugin.form 或 Spec 缺 [开发形态] 时（早期项目），先按 0-1 工作流的 [形态判定] 与用户补定形态并回填两处，再继续迭代。
    4. 定位用户变更涉及的 REQ / UX / HOST / DATA / SEC / NFR / AC ID。
    5. 在对话中确认用户原话与变更原因，收口时记入 Plugin-Spec-CHANGELOG.md。

[变更分类]
    - Clarification：补充细节，不改变行为或验收。
    - Scope Add：新增用户可感知能力。
    - Scope Remove：删除或延后能力。
    - Behavior Change：同一能力的行为、流程或结果变化。
    - Host Change：目标宿主、tier、运行形态或 fallback 变化。
    - Form Change：开发形态在 companion-web-app / mcp-app / hybrid 之间变化；影响面最大，一律回退到 DESIGN_READY 之前重新设计。
    - Data / Permission Change：状态、文件、网络、Secret、破坏性权限变化。
    - Acceptance Change：完成标准、规模或性能边界变化。
    - Correction：旧 Spec 误解了用户原意。

[采访规则]
    不重走完整 0-1 采访，只追问变化带来的最高风险未知：
    1. 用户为什么要改，原方案哪里失败。
    2. 新行为替代旧行为，还是并存。
    3. Golden Path 哪一步变化。
    4. 输入、输出、状态、权限和宿主是否受影响。
    5. 旧数据、旧项目或旧安装包是否需要兼容。
    6. 哪些 AC 需要新增、修改或废弃。

    用户已经明确的内容直接吸收，不要求重复解释整个 Plugin。

[冲突检测]
    必须检查：
    - 新需求与明确非目标冲突。
    - 新需求与已判定形态冲突（如 companion-web-app 项目要求界面嵌进对话）。
    - 形态与 required target 宿主能力冲突（如 mcp-app 嵌入面落在不渲染嵌入 UI 的宿主）。
    - 新需求与现有 Host Capability 冲突。
    - 自动覆盖与历史保留冲突。
    - 离线要求与外部 API 冲突。
    - 多宿主一致体验与宿主能力差异冲突。
    - 长任务与“关闭即结束 / 关闭后继续”冲突。
    - 权限最小化与跨项目 / 跨目录访问冲突。
    - 新行为与旧 Acceptance Criteria 冲突。

    发现冲突时明确指出，不静默选边。

[ID 规则]
    - 已发布 ID 不复用。
    - 删除的需求标记 superseded / deferred，不从历史中抹掉。
    - 行为本质变化时可保留 ID 并记录 Revision；拆成两个独立能力时新增 ID。
    - AC 失效要标明 replacedBy 或 removal reason。

[影响分析]
    每次变更建立矩阵：

    ```text
    变更 ID
    → Plugin-Design.md 哪些章节受影响
    → PLUGIN-DEV-PLAN.md 哪些任务受影响
    → 源码哪些模块受影响
    → 哪些宿主包需要重建
    → 哪些测试与证据失效
    → 项目应回退到哪个 phase / qualityGate
    ```

    阶段回退：
    - 只改描述，无行为影响 → 保持当前阶段。
    - 改用户流程、UI-Agent 分工、Tool、状态、权限或 Host → DESIGN_READY 之前，重新进入 Design。
    - 设计不变，只改实现工作量 → PLAN_READY 之前，重新规划。
    - 代码缺陷，不改 Spec → 交给 plugin-builder / plugin-checker，不改需求。

[输出]
    1. 更新 Plugin-Spec.md 和 plugin.yaml。
    2. 在 Plugin-Spec-CHANGELOG.md 追加日期、原因、变更 ID、影响和阶段回退。
    3. 更新 Plugin-Project-State.md。
    4. 不自动修改下游 Design / Plan / Code；先告诉主 Agent 哪些已失效，再由对应 Skill 更新。
    5. 运行中央 Validator（validate-plugin-project，命令见 SKILL.md [输出规则]）。

[禁止]
    - 只改一处描述，留下 plugin.yaml 和 AC 脱节。
    - 删除历史而不留 Changelog。
    - 把实现 Bug 伪装成需求变化。
    - 用户只改一个局部，就重新问完整 Question Bank。
    - 下游产物失效后仍宣称项目保持 SHIPPABLE。
