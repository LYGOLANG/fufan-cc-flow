---
name: plugin-check-report-template
description: 检查完成生成 Plugin-Check-Report.md 时按此模板填写；per-target 状态独立记录，无真实宿主证据最多 BUILD_VALID。
---

# Plugin Check Report

## 0. Report Control

- Plugin ID：[id]
- Report Revision：[1]
- Checked Version：[version / commit]
- Date：[YYYY-MM-DD HH:mm]
- Checker Environment：[OS / Node / Claude Code version]
- Spec Version：[version]
- Design Version：[version]
- Plan Version：[version]
- Overall Status：[BLOCKED / BUILD_VALID / SHIPPABLE]

## 1. Executive Verdict

- Verdict：[一句话]
- Required Targets：[列表]
- Required AC：[pass / total]
- Reviewer REQUIRED：[数量]
- Highest Remaining Risk：[内容]
- Next Action：[Skill / Task / none]

## 2. Per-target Status

| Target | Tier | Package | Static / Build | Host Install | Core E2E | Reopen | Surface Coverage | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| claude-code | required | pass | pass | pass | pass | pass | browser-ui | HOST_VERIFIED | evidence/hosts/... |

说明：
- required 全部 HOST_VERIFIED 才能 SHIPPABLE。
- optional / experimental 未验证必须显示 DEFERRED / BUILD_VALID，不能隐去。

## 3. Stage Summary

| Stage | Status | Checks | Passed | Failed | Not Verified | Evidence |
|---|---|---:|---:|---:|---:|---|
| Artifact Integrity | [状态] | [n] | [n] | [n] | [n] | [路径] |
| Static / Contract |  |  |  |  |  |  |
| Build / MCP Probe |  |  |  |  |  |  |
| UI / State |  |  |  |  |  |  |
| UI → Agent → UI |  |  |  |  |  |  |
| Security / Failure |  |  |  |  |  |  |
| Host Verification |  |  |  |  |  |  |
| Independent Review |  |  |  |  |  |  |

## 4. Acceptance Results

### AC-001 · [标题]

- Target：[target]
- Covers：[IDs]
- Fixture：[样本]
- Given：[前置]
- When：[步骤]
- Expected：[期望]
- Actual：[实际]
- Status：[PASS / FAIL / NOT_VERIFIED]
- Evidence：[路径]
- Notes：[说明]

## 5. Check Results

### CHECK-001 · [标题]

- Stage：[Stage]
- Target：[target / shared]
- Related IDs：[IDs]
- Command / Steps：[命令或步骤]
- Expected：[期望]
- Actual：[实际]
- Status：[PASS / FAIL / NOT_APPLICABLE / NOT_VERIFIED]
- Evidence：[路径]
- Environment：[环境]
- Timestamp：[时间]

## 6. UI → Agent → UI Evidence

- Request ID：[id]
- Project Version Before：[n]
- User Intent：[内容]
- Selection / Asset Refs：[内容]
- Agent Receipt Evidence：[路径]
- Agent Tool Call：[名称 / 参数摘要]
- Result：[内容]
- Project Version After：[n]
- UI Update Evidence：[路径]
- Reopen Evidence：[路径]
- Duplicate / Stale Test：[结果]

## 7. Security Results

| THR ID | Test | Expected | Actual | Status | Evidence | Residual Risk |
|---|---|---|---|---|---|---|
| THR-001 | [测试] | [结果] | [实际] | PASS | [路径] | [风险] |

## 8. Plugin Reviewer

- Stage 1 Contract：[PASS / FAIL]
- Stage 2 Quality：[PASS / FAIL]
- REQUIRED：[n]
- IMPORTANT：[n]
- SUGGESTION：[n]

### Findings

#### [REQUIRED] F-001 · [标题]

- 位置：[位置]
- 违反：[合同]
- 证据：[内容]
- 影响：[影响]
- 修复：[方向]
- 重验：[命令 / 场景]
- Status：[open / fixed / waived-with-reason]

## 9. Build and Package Provenance

- Clean Install Command：[命令]
- Build Command：[命令]
- Lockfile Hash：[hash]
- Source Revision：[commit / hash]
- Package Path：[路径]
- Package SHA-256：[hash]
- File Manifest：[路径]
- Absolute Path Scan：[结果]
- Secret Scan：[结果]

## 10. Blockers and Deferred Work

### Required Blockers

- [无 / Finding ID]

### Optional / Experimental Deferred

| Target / Feature | Reason | Current Status | Re-entry Condition |
|---|---|---|---|
| [内容] | [原因] | DEFERRED | [条件] |

## 11. Final Gate

- [ ] All required targets HOST_VERIFIED
- [ ] All required AC PASS
- [ ] UI → Agent → UI PASS
- [ ] Reopen and project isolation PASS
- [ ] Security REQUIRED tests PASS
- [ ] Reviewer REQUIRED = 0
- [ ] Package hash and file manifest exist

Final Status：[BLOCKED / BUILD_VALID / SHIPPABLE]

## 12. History

| Revision | Date | Changes | Previous Status | New Status |
|---|---|---|---|---|
| 1 | [date] | Initial check | none | [status] |
