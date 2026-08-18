---
name: plugin-project-state-template
description: init 脚本生成 Plugin-Project-State.md 用；此后只更新 YAML 机器块字段值，不改结构、不复制需求设计。
---

[机器状态]

```yaml
schemaVersion: 1
pluginId: "[plugin-id]"
phase: "IDEA"
qualityGate: "NOT_CHECKED"
currentTask: null
artifacts:
  spec: "Plugin-Spec.md"
  specChangelog: "Plugin-Spec-CHANGELOG.md"
  ir: "plugin.yaml"
  design: "Plugin-Design.md"
  plan: "PLUGIN-DEV-PLAN.md"
  checkReport: "Plugin-Check-Report.md"
  evidenceIndex: "evidence/check/evidence.json"
targets:
  claude-code:
    tier: "required"
    status: "NOT_BUILT"
    evidence: []
blockers: []
nextAction: "plugin-spec-builder"
updatedAt: "[ISO-8601]"
```

[当前摘要]
    - 当前阶段：IDEA
    - 质量门：NOT_CHECKED
    - 当前任务：无
    - Required Target：claude-code · NOT_BUILT
    - 阻塞：无
    - 下一步：plugin-spec-builder

[更新历史]

| Time | Phase | Quality Gate | Change | Evidence |
|---|---|---|---|---|
| [time] | IDEA | NOT_CHECKED | Initialized | none |
