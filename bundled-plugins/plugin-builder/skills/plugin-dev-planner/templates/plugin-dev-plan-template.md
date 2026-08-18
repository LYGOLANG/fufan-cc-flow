---
name: plugin-dev-plan-template
description: 生成 PLUGIN-DEV-PLAN.md 时按此模板填写；每个 Task 带稳定 ID、文件、命令、完成标准与证据路径。
---

# Plugin Development Plan

## 0. Document Control

- Plugin ID：[id]
- Plan Version：[0.1.0]
- Status：[DRAFT / PLAN_READY / SUPERSEDED]
- Spec Version：[版本]
- Design Version：[版本]
- Required Targets：[列表]
- Created：[YYYY-MM-DD]
- Last Updated：[YYYY-MM-DD]

## 1. Delivery Strategy

- Critical Path：[一句话]
- First Vertical Round-trip：[打开 → 状态 → UI → Agent → UI]
- Highest Risk：[风险]
- Risk Retirement Phase：[Phase]
- UI Complexity：[A / B / C]
- Shared Core Boundary：[内容]
- Host Adapter Boundary：[内容]
- Non-goals Guard：[引用]

## 2. Requirement and Acceptance Index

| ID | Priority / Tier | Design Section | Implementation Task | Verification Task | Status |
|---|---|---|---|---|---|
| REQ-001 | must | 4 | TASK-XXX | TASK-XXX | pending |
| AC-001 | required | 15 | TASK-XXX | TASK-XXX | pending |

## 3. Component Map

```text
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json
├── skills/
├── agents/
├── .mcp.json
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── ui/
│   ├── mcp-server/
│   └── host-bridge/
├── tests/
├── evidence/
└── dist/
```

- 目录基线与 plugin-builder 的 implementation-defaults 一致；宿主专属清单放插件根，宿主适配代码放 packages/host-bridge/。
- 允许按项目裁剪，但实际路径必须在 Task 中一致。

## 4. Phase 0 · Scaffold & Contracts

- Status：[not_started]
- Entry Gate：[Spec / Design / Schemas]
- Exit Gate：[clean install + typecheck + contract validation]
- Rollback：[方式]

### TASK-001 · [标题]

- Status：pending
- Goal：[独立目标]
- Related IDs：[REQ / UX / HOST / DATA / SEC / NFR / AC / DEC / THR]
- Inputs：[上游原文、Schema、Spike]
- Files：[精确路径]
- Dependencies：[Task IDs / none]
- Implementation Boundary：[做什么、不做什么]
- Commands：
    - `[命令]`
- Completion Criteria：
    - [可观察标准]
- Evidence：
    - [路径 / 类型]
- Failure / Rollback：[失败行为]
- Parallel Safety：[可与谁并行、禁止同改什么]

## 5. Phase 1 · Local Round-trip

[按同样结构填写]

## 6. Phase 2 · State Round-trip

[按同样结构填写]

## 7. Phase 3 · UI → Agent

[按同样结构填写]

## 8. Phase 4 · Agent → UI

[按同样结构填写]

## 9. Phase 5 · Core Feature Slices

### Slice 1 · [用户价值]

[Tasks]

### Slice 2 · [用户价值]

[Tasks]

## 10. Phase 6 · Failure, Security & Jobs

[Tasks]

## 11. Phase 7 · Host Packaging

### [required target]

[Tasks]

### [optional target]

[Tasks 或明确 deferred]

## 12. Phase 8 · Final Package Smoke

[Tasks]

Install 与 Host E2E 不在本计划排任务：由第五步 plugin-checker 在集中真机会话一次完成，并回填 Host Verification Matrix。

## 13. Host Verification Matrix

| Target | Tier | Build Task | Package Task | Install Task | Core E2E | Required Status |
|---|---|---|---|---|---|---|
| claude-code | required | TASK- | TASK- | TASK- | TASK- | HOST_VERIFIED |

## 14. Security Verification Matrix

| THR ID | Mitigation Task | Negative Test | Evidence | Status |
|---|---|---|---|---|
| THR-001 | TASK- | TASK- | [路径] | pending |

## 15. Test and Evidence Matrix

| AC ID | Target | Fixture | Command / Steps | Expected | Evidence Path | Task |
|---|---|---|---|---|---|---|
| AC-001 | claude-code | [样本] | [命令] | [结果] | evidence/... | TASK- |

## 16. Parallel Execution Map

| Batch | Tasks | Why Safe | Shared Read-only Inputs | Merge Owner |
|---|---|---|---|---|
| B1 | TASK-X, TASK-Y | [不改同一文件] | [契约] | Main Agent |

## 17. Change Log

| Date | Change | Reason | Affected Tasks | Upstream Impact |
|---|---|---|---|---|
| [日期] | Initial Plan | [原因] | all | none |

## 18. Completion Gate

- [ ] All must Requirement Tasks done with evidence
- [ ] All required AC pass
- [ ] All required targets HOST_VERIFIED
- [ ] UI → Agent round-trip pass
- [ ] Agent → UI round-trip pass
- [ ] State reopen and project isolation pass
- [ ] Security REQUIRED tests pass
- [ ] Plugin Reviewer no REQUIRED Finding
- [ ] Plugin-Check-Report.md = SHIPPABLE
