---
name: plugin-design-template
description: 生成 Plugin-Design.md 时按此模板逐节填写；需求映射、契约、Host Adapter 与场景走查不可缺节。
---

# Plugin Interaction & Runtime Design

## 0. Document Control

- Plugin ID：[id]
- Design Version：[0.1.0]
- Status：[DRAFT / DESIGN_READY / SUPERSEDED]
- Based on Spec：[Spec version / date]
- Form：[companion-web-app / mcp-app / hybrid]
- Required Target：[target id]
- UI Complexity：[A / B / C]
- Prototype Required：[yes / no]
- Last Updated：[YYYY-MM-DD]

## 1. Design Summary

- 开发形态：[form + 一句判定依据]
- 用户打开后看到：[一句话]
- UI 负责：[直接操作]
- Agent 负责：[语义任务]
- 结果写回：[方式]
- 权威状态：[位置]
- Required Host Path：[方式]
- 最大设计风险：[风险与处理]

## 2. Requirement Coverage

| Requirement ID | Design Section | Decision / Component | Status |
|---|---|---|---|
| REQ-001 | 4 / 6 / 8 | [内容] | covered |

## 3. Decision Register

### DEC-001 · [标题]

- Type：[user / architect / platform]
- Decision：[内容]
- Alternatives：[选项]
- Rationale：[依据]
- Trade-off：[代价]
- Related IDs：[REQ / UX / HOST / DATA / SEC / NFR / AC]
- Source / Verified At：[用户确认 / 官方文档 / Probe + 日期]
- Status：[active / superseded]

## 4. Experience Architecture

### UI Complexity and Prototype

- Class：[A / B / C]
- Reasons：[命中特征]
- Prototype Scope：[none / wireframe / runnable spike]
- Highest-risk Assumptions：[列表]
- Evidence：[路径]

### Workspace Map

```text
[用文本图表示主要区域、主次、当前上下文和结果]
```

### Opening and Empty State

- Open Entry：[入口]
- Initial Context：[当前项目 / 输入]
- Empty State：[用户看到什么]
- Primary CTA：[第一步]
- Missing Context：[找不到项目 / 文件时行为]

### Core Objects

| Object | Identity | Parent / Relation | User-visible State | Persisted |
|---|---|---|---|---:|
| [对象] | [stable id] | [关系] | [状态] | yes/no |

## 5. Direct Interaction Grammar

### Action Map

| User Action | Target | Local UI Result | Save | Trigger Agent | Undo / Conflict |
|---|---|---|---|---:|---|
| [动作] | [对象] | [反馈] | [时机] | yes/no | [规则] |

### Selection and Focus

- Single Select：[规则]
- Multi-select / Range：[规则或 non-goal]
- Current Context Summary：[UI 怎样显示]
- Keyboard Focus：[进入 / 返回]
- Chat Reference：[“这个”怎样映射到 ID]

### History and Recovery

- Undo / Redo：[范围]
- Version History：[范围]
- Auto-save：[时机]
- Recovery：[刷新、崩溃、文件丢失]

## 6. UI ↔ Agent Contract

### Trigger Model

- Primary Trigger：[UI button / chat / other]
- Secondary Trigger：[可选]
- Submit Boundary：[何时意图完整]
- User Preview：[发送前可见 / 可编辑]
- Duplicate Protection：[规则]

### Request Contract

```json
{
  "requestId": "req-...",
  "operation": "...",
  "projectId": "...",
  "projectVersion": 1,
  "userIntent": "...",
  "selection": {},
  "assetRefs": [],
  "createdAt": "..."
}
```

- Schema：[contracts/request.schema.json]
- Required Context：[字段]
- Optional Preview：[截图 / 摘要]
- Large Payload Policy：[references-first]

### Agent Responsibilities

| Operation | Agent Reads | Agent Uses | Agent Must Return | Non-goal |
|---|---|---|---|---|
| [操作] | [上下文] | [工具 / 文件] | [结果] | [边界] |

### Result Contract

```json
{
  "requestId": "req-...",
  "basedOnProjectVersion": 1,
  "status": "succeeded",
  "operations": [],
  "assetRefs": [],
  "warnings": [],
  "createdAt": "..."
}
```

- Schema：[contracts/result.schema.json]
- Default Application：[auto / preview / new version / proposal]
- Destructive Exception：[规则]
- Original Preservation：[规则]
- Stale Result：[规则]
- User Confirmation：[规则]

## 7. MCP Catalog

### Render Tool

| Name | Purpose | Input | Output | Annotations | Resource |
|---|---|---|---|---|---|
| [open_x] | [目的] | [schema] | [structured + text] | [readOnly...] | [ui:// / none] |

### App-only Tools

| Name | Purpose | Input / Output | Side Effect | Idempotency | Permission |
|---|---|---|---|---|---|
| [tool] | [目的] | [schema] | [副作用] | [规则] | [范围] |

### Agent-visible Tools

| Name | Domain Operation | Input / Output | Version / Request | Error | Related IDs |
|---|---|---|---|---|---|
| [tool] | [语义] | [schema] | [规则] | [错误码] | [ID] |

### Long-running Tools

| Name | Stage | Job State | Cancel / Retry | Output |
|---|---|---|---|---|
| [tool] | start / status / cancel | [状态] | [规则] | [结果] |

### Resources

| URI | MIME | Loaded By | CSP / Sandbox | Update Strategy |
|---|---|---|---|---|
| [uri] | [mime] | [host / UI] | [规则] | [规则] |

### MCP App Surface（form = mcp-app / hybrid 时必填）

- UI Resource：[ui://... 清单，mimeType `text/html;profile=mcp-app`，单文件自包含或 `_meta.ui.csp` 显式声明外部域]
- Tool 关联：[哪些 Tool 带 `_meta.ui.resourceUri`，visibility 取值]
- Display Mode：[inline / fullscreen 与切换时机]
- Bridge 通信：[widget 经宿主 Bridge 调哪些 Tool（tools/call）、接收哪些结果]
- Sandbox 约束落地：[deny-by-default CSP 下的资源打包方式；不假定剪贴板 / 文件系统 / 媒体权限可用]
- Tool-only 等价：[无嵌入 UI 的宿主上，每个带 UI 的 Tool 的 structured + text 输出如何等价传达]

## 8. Skill Catalog

| Skill | 触发描述要点（引用用户原话短语） | 覆盖 REQ / UX | 教 Agent 的工具流 | 负例来源 |
|---|---|---|---|---|
| [kebab-name] | [「用户原话短语」] | [IDs] | [tool 调用顺序] | [非目标 / 邻近场景] |

- 至少一个启动技能；一个技能只管一件事，无悬空 agent 侧 REQ。
- Codex target：每个技能配 agents/openai.yaml，需要时用 dependencies.tools 绑定 server。

## 9. State, Files and Jobs

### State Layers

| Layer | Authority | Contents | Persistence | Writer | Conflict Rule |
|---|---|---|---|---|---|
| Authority State | [JSON / SQLite] | [内容] | [位置] | [Tool] | [规则] |
| UI Ephemeral | memory | [内容] | none | UI | none |
| View State | [位置] | [内容] | [规则] | UI Tool | [规则] |
| Request State | [位置] | [内容] | [规则] | Server | [规则] |

### Project Storage

```text
[project]/
└── .[plugin-id]/
    ├── project.json
    ├── requests/
    ├── assets/
    ├── outputs/
    ├── cache/
    └── logs/
```

- schemaVersion：[值]
- Atomic Write：[方式]
- Migration：[N-1 / backup / rollback]
- Cleanup：[cache / uninstall]
- Plugin Install Directory：[read-only program resources]

### Asset Lifecycle

| Asset Type | Source | Stored | Reference | Delete Protection | Derived / Cache |
|---|---|---|---|---|---|
| [类型] | [来源] | [位置] | [ID / URL] | [规则] | [规则] |

### Job Lifecycle

```text
queued → running → succeeded / failed / cancelled
```

- Reconnect：[规则]
- Duplicate Request：[规则]
- Progress：[stage / real percent]
- Result Apply：[规则]

## 10. Host Adapters

### [target id]

- Tier：[required / optional / experimental]
- Platform Fact：[内容 + verified date + source]
- Runtime Profile：[profile id]
- Primary Path：[运行形态]
- UI Surface：[Browser / Preview / MCP App / CLI]
- Agent Trigger：[方式]
- Agent Result Path：[方式]
- Fallback：[方式]
- Unsupported / Deferred：[内容]
- Install Method：[命令 / package]
- Verification Method：[真实步骤]
- Minimum User Experience：[不能降级的底线]

## 11. Security and Permissions

### Permission Matrix

| Capability | Scope | Reason | User Confirmation | Validation |
|---|---|---|---|---|
| Filesystem | [project] | [原因] | [规则] | [规则] |
| Network | [domains] | [原因] | [规则] | [规则] |
| Secret | [name] | [原因] | [规则] | [规则] |
| Command | [allowlist] | [原因] | [规则] | [规则] |

### Threat Model

| THR ID | Asset | Entry | Threat | Impact | Mitigation | Verification | Related ID |
|---|---|---|---|---|---|---|---|
| THR-001 | [资产] | [入口] | [威胁] | [影响] | [缓解] | [测试] | SEC-001 |

### CSP / Sandbox / Message Rules

- connect：[domains]
- resources：[domains / data / blob]
- frames：[domains]
- sandbox：[flags]
- message source / schema validation：[规则]
- Generated HTML Isolation：[规则]

## 12. Visual and Accessibility Rules

- Experience Type：[professional editor / lightweight tool / dashboard]
- Information Density：[low / medium / high + reason]
- Content Priority：[规则]
- Layout：[比例和最小尺寸]
- Typography Hierarchy：[具体层级]
- Color Semantics：[normal / selected / agent / success / warning / destructive]
- Motion：[用途、时长范围、reduced-motion]
- Keyboard Core Path：[步骤]
- Focus Management：[规则]
- Contrast and Non-color Cues：[规则]
- Host Theme / Resize：[规则]

## 13. UI State Catalog

| State | Trigger | User Sees | Available Action | Data Preserved | Exit |
|---|---|---|---|---|---|
| Empty | [触发] | [显示] | [动作] | [内容] | [条件] |
| Loading |  |  |  |  |  |
| Agent Working |  |  |  |  |  |
| Success |  |  |  |  |  |
| Error |  |  |  |  |  |
| Conflict |  |  |  |  |  |
| Permission Denied |  |  |  |  |  |
| Offline / Host Unsupported |  |  |  |  |  |

## 14. Prototype Evidence

### SPIKE-001 · [标题]

- Hypothesis：[假设]
- Why High Risk：[原因]
- Environment：[宿主 / 浏览器 / 样本]
- Steps：[步骤]
- Pass Criteria：[标准]
- Result：[PASS / PASS_WITH_LIMIT / FAIL]
- Evidence：[路径]
- Design Impact：[决定]

## 15. Scenario Walkthroughs

### Scenario 1 · First Open

| Step | User Sees | User Does | System / Agent | State | Failure / Recovery |
|---|---|---|---|---|---|
| 1 | [内容] | [动作] | [执行] | [状态] | [恢复] |

### Scenario 2 · Core Task

[同上]

### Scenario 3 · Agent Failure

[同上]

### Scenario 4 · Concurrent Edit and Stale Result

[同上]

### Scenario 5 · Close and Reopen

[同上]

### Scenario 6 · Permission, File, or Network Failure

[同上]

### Scenario 7 · Required Host Fallback

[同上]

## 16. Open Questions

- P0：[必须为空才能 DESIGN_READY]
- P1：[允许带明确默认进入 Plan]
- Platform Verification Pending：[required target 不允许残留阻断项]

## 17. Design-to-Plan Handoff

- Required Vertical Slices：[列表]
- Required Spikes Resolved：[列表]
- Required Host Tests：[列表]
- Highest-risk Build Order：[列表]
- Acceptance Mapping：[AC → Design Section]
