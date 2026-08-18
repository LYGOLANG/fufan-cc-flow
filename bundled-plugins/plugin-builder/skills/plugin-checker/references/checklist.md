---
name: plugin-checklist
description: plugin-checker 执行检查阶段时逐 Stage read；按 plugin.yaml 与 target tier 条件化启用检查项，每项记状态与证据，不把勾选当结果。
---

[使用规则]
    - 每项状态：PASS / FAIL / NOT_APPLICABLE / NOT_VERIFIED。
    - NOT_APPLICABLE 必须写理由。
    - required 项 NOT_VERIFIED 等同阻止 SHIPPABLE。
    - 清单项要记录 evidence path，不只打勾。
    - Stage 分组与 SKILL.md 的检查阶段按名称对应，编号不一一对应。

[Stage 0 · Artifact Integrity]
    - ART-001：Plugin-Spec.md Status = SPEC_READY，无 P0。
    - ART-002：plugin.yaml 通过 Schema。
    - ART-003：Plugin-Design.md Status = DESIGN_READY，无 P0。
    - ART-004：PLUGIN-DEV-PLAN.md Status = PLAN_READY，Task 与 Evidence 一致。
    - ART-005：Plugin-Project-State.md phase / qualityGate 合法。
    - ART-006：所有 ID 唯一，交叉引用存在。
    - ART-007：所有 must → AC → Task → Evidence 可追踪。
    - ART-008：required / optional / experimental target 在全部文件一致。
    - ART-009：版本与 Changelog 一致。
    - ART-010：Non-goal 未成为隐式依赖。
    - ART-011：plugin.form 在 Spec [开发形态]、plugin.yaml、Plugin-Design.md 一致，且与各 target 的 UI Surface 能力匹配。

[Stage 1 · Plugin Package]
    - PKG-001：`.claude-plugin/plugin.json` 位置与 JSON 合法（codex target 存在时另查 `.codex-plugin/plugin.json`）。
    - PKG-002：skills/、agents/、hooks/、.mcp.json 位于 Plugin root 正确位置。
    - PKG-003：Skill name / path / description 可发现。
    - PKG-004：Subagent frontmatter 合法。
    - PKG-005：Plugin root 变量（`${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`）只引用 Plugin 自带资源。
    - PKG-006：用户状态不写 Plugin cache / install root。
    - PKG-007：相对路径在安装副本中仍成立。
    - PKG-008：版本、描述、license、repository 等元数据符合计划。
    - PKG-009：clean build 产物文件清单与 hash 存在。
    - PKG-010：无开发机绝对路径、临时文件和 Secret。

[Stage 2 · MCP Contract]
    - MCP-001：Server 可启动，stderr / stdout 不破坏协议。
    - MCP-002：initialize 成功。
    - MCP-003：tools/list 与 Design Catalog 一致。
    - MCP-004：Render Tool 输入输出和 annotation 正确。
    - MCP-005：App-only Tool 不污染 Agent Tool surface（适用时）。
    - MCP-006：Agent-visible Tool 使用领域语义，无万能 mutate / shell / path。
    - MCP-007：输入 Schema 拒绝缺字段、超长、错误类型和额外危险字段。
    - MCP-008：structured output 与 text fallback 完整。
    - MCP-009：错误 code、retryable、recoveryHint 符合 Contract。
    - MCP-010：timeout / cancellation / duplicate request 行为正确。
    - MCP-011：requestId、expectedVersion / basedOnVersion 生效。
    - MCP-012：Resource URI、MIME、CSP、sandbox 正确（适用时）。
    - MCP-013：form = mcp-app / hybrid 时 `ui://` Resource 经 resources/read 可读取，mimeType 为 `text/html;profile=mcp-app`，内容单文件自包含或外部域已在 `_meta.ui.csp` 声明。
    - MCP-014：带 UI 的 Tool 的 `_meta.ui.resourceUri` 指向已注册 Resource，structured + text 输出与 UI 等价（tool-only 可用）。

[Stage 3 · UI]
    - UI-001：打开和首屏符合 Design。
    - UI-002：空状态有明确主 CTA。
    - UI-003：核心直接操作无需 Agent 且反馈即时。
    - UI-004：当前对象 / 选择 / 范围清晰可见。
    - UI-005：提交边界清晰，重复点击受保护。
    - UI-006：Loading / Agent Working / Success / Error / Conflict / Permission Denied 齐全。
    - UI-007：Agent 工作期间允许 / 禁止操作与 Design 一致。
    - UI-008：结果新增 / 替换 / 预览 / 版本策略正确。
    - UI-009：原内容和历史保护正确。
    - UI-010：键盘核心路径、焦点、非颜色状态和对比度通过。
    - UI-011：宿主主题、尺寸、fullscreen / fallback 正确（适用时）。
    - UI-012：Class C Prototype 限制被正式实现遵守。
    - UI-013：界面使用 plugin.yaml ui.kit 所选风格包的 token 与组件；偏离项在 Plugin-Design.md 有登记。
    - UI-014：ui-audit 报告与截图集存在（多主题 × 多宽度），空白渲染、溢出、折行、遮挡为零或已修复。
    - UI-015：视觉审查已按 review-protocol [视觉审查] 完成，五项评判各有结论。

[Stage 4 · State and Files]
    - DS-001：权威状态不是 React Memory / 对话记忆 / Plugin install root。
    - DS-002：schemaVersion 与 projectVersion 存在。
    - DS-003：写入原子，崩溃不会留下半文件。
    - DS-004：多个项目隔离。
    - DS-005：关闭重开恢复。
    - DS-006：stale result 不静默覆盖新状态。
    - DS-007：requestId 幂等，重复提交无重复副作用。
    - DS-008：路径 traversal / symlink / 文件名被拒绝。
    - DS-009：类型、MIME、大小、数量上限生效。
    - DS-010：大文件只传引用 / 派生预览，不进模型大 Base64。
    - DS-011：资源引用、删除保护、cache / output 清理正确。
    - DS-012：N-1 migration / backup / rollback（若承诺）。

[Stage 5 · UI → Agent]
    - U2A-001：固定样本可建立 requestId。
    - U2A-002：userIntent、operation、selection、asset refs、projectVersion 正确。
    - U2A-003：用户可见 / 可编辑上下文符合 Design。
    - U2A-004：当前 Agent 或 fallback 能收到请求。
    - U2A-005：没有图片消息能力时使用本地资源引用 fallback（适用时）。
    - U2A-006：重复触发、关闭、失败可恢复。

[Stage 6 · Agent → UI]
    - A2U-001：Agent 能读取对应 request。
    - A2U-002：Agent 使用领域 Tool，不手写原始 UI Store（除明确受控 fallback）。
    - A2U-003：结果包含 requestId / basedOnVersion。
    - A2U-004：Tool 原子更新权威状态并返回新 version。
    - A2U-005：UI 收到 / 读取更新并显示正确结果。
    - A2U-006：旧结果、错误结果和部分结果符合 Design。
    - A2U-007：重开后结果仍存在。

[Stage 7 · Jobs · jobs.enabled 时启用]
    - JOB-001：queued / running / succeeded / failed / cancelled 状态。
    - JOB-002：start 快速返回 jobId。
    - JOB-003：进度不伪造，阶段 / 百分比有真实来源。
    - JOB-004：取消停止副作用并清理临时资源。
    - JOB-005：retry 不重复收费 / 文件 / 插入。
    - JOB-006：关闭重开 / 重连符合 Spec。
    - JOB-007：并发上限和队列策略。

[Stage 8 · Security]
    - SV-001：无任意 Shell / JavaScript / Path Tool。
    - SV-002：命令用 argv、allowlist、固定 cwd、timeout、最小 env。
    - SV-003：路径 realpath / symlink / TOCTOU 策略。
    - SV-004：网络域名、协议、redirect、私网 / metadata 防护（网络启用时）。
    - SV-005：Secret 不进仓库、前端、Prompt、Tool output、日志。
    - SV-006：CSP / iframe sandbox / message source / Schema（适用时）。
    - SV-007：生成 HTML / SVG / Markdown 受隔离或净化。
    - SV-008：删除 / 覆盖 / 发布 / 上传有确认与恢复。
    - SV-009：日志脱敏、限量、可清理。
    - SV-010：依赖锁定、无未经审查的运行时自动安装。
    - SV-011：Threat Model high / medium negative test 全部执行。

[Stage 9 · Host Verification]
    - EV-001：Skill Catalog 的每个技能各有一份符合 skill-eval 规则的题库（8-10 条真实化正例源自采访原话、8-10 条 near-miss 负例源自非目标与邻近场景）。
    - EV-002：每个技能的正例触发率与负例误触发率已实测并入 evidence（宿主 CLI 可得时必做；未达标记 IMPORTANT 交 builder 修 description）。
    - EV-003：宿主 CLI 不可得时，Check-Report 明确标注评测缺席原因。
    每个 target 单独复制一份：
    - HV-001：package / manifest validate；宿主无 validate 命令时改用该 Profile 的 verificationMethod。
    - HV-002a：required target 按 Profile 的 installationMethod 完成真实安装，含 marketplace 注册、安装命令，以及 reload 或新会话中的生效确认。
    - HV-002b：开发态加载（Claude Code 的 `--plugin-dir`；Codex 无等价物，用本地 marketplace 重装迭代，安装是缓存副本、改源目录不即时生效）只用于迭代，不替代 HV-002a。
    - HV-003：Skill 可发现并触发。
    - HV-004：Subagent 可发现（若有）。
    - HV-005：MCP Server 启动、Tool 可发现。
    - HV-006：UI Primary Path 真实打开。
    - HV-007：UI → Agent → UI 核心 AC。
    - HV-008：失败 / fallback AC。
    - HV-009：关闭重开恢复。
    - HV-010：安装副本路径与 clean environment。
    - HV-011：升级 / 卸载行为（若承诺）。
    - HV-012：form = mcp-app / hybrid 时按 target 分层——具备 MCP Apps surface 的宿主完成嵌入渲染与 Bridge 往返验证（图形聊天宿主会话，按 Stage 6 形态分层以 L3 请用户到场配合）；无该 surface 的宿主完成 tool-only 与 fallback 验证；报告逐 target 写明 surface 覆盖。

[Stage 10 · Acceptance]
    对 Plugin-Spec.md 每个 required AC 建立：
    - target
    - fixture
    - command / manual steps
    - expected
    - actual
    - evidence
    - status

[Stage 11 · Independent Review]
    - REV-001：plugin-reviewer 使用 fresh context。
    - REV-002：Reviewer read 全部原文和源码。
    - REV-003：Stage 1 Contract Review 完成。
    - REV-004：Stage 2 Quality Review 完成。
    - REV-005：REQUIRED = 0 才允许 SHIPPABLE。
