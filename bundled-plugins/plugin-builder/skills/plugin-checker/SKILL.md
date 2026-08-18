---
name: plugin-checker
description: 当 plugin-builder 声称开发完成、计划任务全部 done、用户要求检查或发布、或者修复后需要重验时使用。执行条件化静态检查、Schema 与 MCP Probe、构建、安装包、真实 required host E2E、安全与状态检查，并派 plugin-reviewer fresh context 独立审查；失败自动返回 Builder，只有所有 required target HOST_VERIFIED 才能标记 SHIPPABLE。
---

[任务]
    证明当前产物是否真的符合 Plugin-Spec.md、Plugin-Design.md、PLUGIN-DEV-PLAN.md 和目标宿主合同。

    Checker 不是普通 Code Review，也不接受“代码应该能跑”。
    必须检查：
    - 需求与实现一致。
    - Plugin 包结构和宿主发现正确。
    - MCP、UI、State、Files、Jobs 与安全契约正确。
    - UI → Agent 与 Agent → UI 双向闭环有真实证据。
    - 每个 required target 分别安装并完成核心 E2E。
    - Plugin Reviewer 无 REQUIRED Finding。

[依赖检测]
    必须存在：
    - Plugin-Spec.md
    - plugin.yaml
    - Plugin-Design.md
    - PLUGIN-DEV-PLAN.md
    - Plugin-Project-State.md
    - 源码、tests/、evidence/、dist/（按计划）

    开始前 read：
    - `references/checklist.md`
    - `templates/plugin-check-report-template.md`
    - `../interactive-plugin-builder/references/artifact-contracts.md`
    - `../interactive-plugin-builder/references/host-profiles.md`
    - 全部上游原文和当前 Evidence。

    先运行中央 Validator：

    ```bash
    python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/validate-plugin-project.py" --root .
    ```

    Schema 或上游产物不一致时立即 BLOCKED，不继续用后续测试掩盖。

[第一性原则]

    [证据优先]
        - 文件存在 ≠ 内容正确。
        - Build 通过 ≠ Plugin 可安装。
        - Tool 可发现 ≠ 用户主流程通过。
        - localhost 页面打开 ≠ 宿主内 Plugin 通过。
        - 一个 target 的成功 ≠ 另一个 target 成功。

    [条件化检查]
        根据 plugin.yaml 启用检查：
        - jobs.enabled = true → 长任务全套。
        - permissions.network 非空 → 网络、CSP、SSRF、Secret。
        - ui.complexityClass = C → Prototype、性能、专业交互。
        - destructiveActions 非空 → 确认、恢复、审计。
        - optional / experimental target → 单独状态，不阻塞 required，报告不能暗示已完成。

    [独立审查]
        确定性检查后，必须用 fresh context 做全量两阶段独立审查，审查协议在 `references/review-protocol.md`：
        - 首选派 plugin-reviewer 子代理（`${CLAUDE_PLUGIN_ROOT}/agents/plugin-reviewer.md`）。
        - 子代理不可用时，开一个新会话按 review-protocol 执行审查，不降级为主 Agent 自查。
        Reviewer 只读，不参与修复；主 Agent 合并 Findings。

    [自动修复闭环]
        失败不直接结束：
        - 代码 / 配置缺陷 → plugin-builder 修复。
        - 计划缺口 → 更新 Plan 后修复。
        - 设计错误 → plugin-interaction-runtime-design Skill。
        - 需求变化 → plugin-spec-builder Skill。
        修复后从最早受影响 Gate 重验，不只重跑最后一步。

[检查阶段]

    [Stage 0 · Artifact Integrity]
        - 文件、ID、版本、required target、Spec / Design / Plan / IR 一致。
        - must → AC → Task → Evidence 可追踪。
        - P0 Open Question 为 0。
        - Plan Task 真实 done，不是只勾选。

    [Stage 1 · Static and Contract]
        - Harness Style / Plugin Schema / JSON Schema。
        - Typecheck、lint、unit、contract test。
        - Tool / Resource / Manifest / `.mcp.json` 路径与字段。
        - TODO、Mock、绝对路径、Secret 和危险 Tool 扫描。

    [Stage 2 · Build and MCP Probe]
        - clean install / build。
        - MCP initialize、tools/list、tools/call、错误与 timeout。
        - Render / App-only / Agent-visible / Job Tool。
        - structured output、text fallback、annotations、visibility。
        - package file list、version、hash。

    [Stage 3 · UI and State]
        - 打开、空、Loading、Agent Working、Success、Error、Conflict、Permission Denied。
        - 核心直接操作、键盘路径、保存和重开。
        - project isolation、atomic write、schemaVersion、migration。
        - stale result、duplicate request、原内容保护。

    [Stage 4 · UI → Agent → UI]
        - 用 Spec 固定样本建立 request。
        - 验证当前 Agent 获得 requestId、intent、selection 和 asset refs。
        - Agent 调用领域 Tool 写回。
        - UI 观察到正确结果和新 projectVersion。
        - 重复提交、失败和旧结果场景通过。

    [Stage 5 · Security and Failure]
        - 按 Threat Model 执行 negative tests。
        - 文件边界、symlink / traversal、命令、网络、Secret、HTML / iframe / message、日志。
        - 关键失败有明确恢复且不丢数据。

    [Stage 6 · Host Verification]
        集中真机会话（无人值守优先）：本阶段是全流程唯一接触真实宿主的环节，按三级执行——
        L1 无头自动化：CLI 安装、claude 无头会话驱动 E2E、HTTP 驱动 UI、无头触发评测、预置 allowlist，默认覆盖绝大多数真机项。
        L2 一次性持久授权：个人 marketplace 首次信任、常用权限写入项目 settings，争取一生一次。
        L3 残余系统弹窗：仅此时呼叫用户到场；用户显式开启无人值守兜底后方可代点残余弹窗并留完整操作日志，默认不代点。
        - 形态分层：form = companion-web-app 按下述路径全量执行；form = mcp-app / hybrid 时 widget 的 UI 审计直连桥接桩的 /widget 路由（widget 文档本身为顶层页面，双主题与 DOM 审计有效；/preview 宿主页只用于闭环演示），tool-only 与 fallback 验证照 L1 无头执行。嵌入渲染验证只在具备 MCP Apps surface 的聊天宿主成立——该类 target 为 required 时属图形宿主会话，超出无头覆盖，按 L3 请用户到场配合一次并留证据；报告逐 target 写明 surface 覆盖。
        - UI 审计与视觉审查：默认运行 `../interactive-plugin-builder/scripts/audit-ui.mjs`（playwright-core + 本机 Chrome，多主题 × 多宽度 DOM 审计 + 全页截图，结果入 evidence/check/ui-audit/）——这是无头与 CLI 环境下唯一成立且支持全页截图的路径；当前会话为 Claude 桌面交互态且宿主 Browser 面板可用时，可改用面板执行同款审计（附着 127.0.0.1、resize_window 设宽度与 colorScheme、javascript_tool 跑审计 JS、分段截图），零额外依赖且用户可旁观。截图交独立审查按 review-protocol [视觉审查] 评判；两条路径都不可用时降级为 HTTP 与静态检查并在报告注明审计缺席。
        - Skill 触发评测：按 `references/skill-eval.md` 为 Skill Catalog 每个技能出题并逐个运行 `../interactive-plugin-builder/scripts/eval-skill-triggers.py`，结果按技能落盘 evidence/check/skill-trigger-eval/<skill-name>.json；claude CLI 可得时必跑，宿主无 claude CLI 时跳过并在报告注明评测未运行；未达标转 IMPORTANT Finding 交 builder 修 description。
        对每个 target 单独：
        - required → 必须真实安装、发现组件、打开、跑核心任务、重开恢复。
        - optional → 可 HOST_VERIFIED / BUILD_VALID / DEFERRED，必须明确。
        - experimental → 不进入整体 SHIPPABLE Gate，但报告风险。

        Claude Code target 至少：
        - `claude plugin validate <plugin-path>`（CLI 可用时）。
        - required target 走真实安装：`claude plugin marketplace add` → `claude plugin install <plugin-id>@<marketplace>` → `/reload-plugins` 或新会话生效。
        - `claude --plugin-dir <plugin-path>` 只作开发迭代，不构成 required target 的安装证据。
        - Skill / Agent / MCP Server 可发现。
        - UI Primary / Fallback Path 按 Design 真实运行。
        - 核心 AC、失败、重开有证据。

        Codex target 至少：
        - 无 validate 命令，用 `codex doctor`、TUI 内 `/mcp` 与测试提示词验证。
        - required target 走真实安装：`codex plugin add <plugin-id>@<marketplace>` → 开新会话生效（个人 marketplace 隐式发现无需 marketplace add，非默认路径才 add）；无 `--plugin-dir` 等价物。安装是缓存副本（`~/.codex/plugins/cache/`）：更新先把 version 改成 `<原>+codex.<UTC 时间戳>`（cachebuster）再重装、开新会话，改源目录不即时生效。
        - Skill 触发（`$` 或 `@` 提及与隐式触发）、MCP Server 与 UI Surface 按 Profile 验证。

    [Stage 7 · Independent Review]
        派 plugin-reviewer，提供项目根目录和审查要求，不给结论暗示。
        收集 REQUIRED / IMPORTANT / SUGGESTION。
        Reviewer 的 HOST_VERIFIED_CANDIDATE 只是候选结论，HOST_VERIFIED 由主 Agent 依真实宿主证据判定。

[状态判定]
    每个 target：
    - NOT_BUILT：无包或不可构建。
    - BUILD_VALID：静态、构建和本地 Probe 通过，未完成真实宿主 E2E。
    - HOST_VERIFIED：真实宿主安装和 required 场景有证据。
    - BLOCKED：存在阻断问题。
    - DEFERRED：非 required，明确延期。

    整体：
    - BLOCKED：任一 required target BLOCKED / NOT_BUILT，或有 REQUIRED Finding / required AC 失败。
    - BUILD_VALID：代码与包通过，但至少一个 required target 未 HOST_VERIFIED。
    - SHIPPABLE：所有 required target HOST_VERIFIED、所有 required AC 通过、Reviewer 无 REQUIRED Finding。

[报告规则]
    按模板生成 Plugin-Check-Report.md，并保存机器证据：

    ```text
    evidence/check/evidence.json
    evidence/hosts/<target>/
    ```

    每个 Check 记录：
    - Check ID
    - target
    - related IDs
    - command / steps
    - expected
    - actual
    - status
    - evidence path
    - timestamp / environment

[失败回退]
    发现失败后：
    1. 写 Finding 与证据。
    2. 更新 Plugin-Project-State.md：phase = BUILDING 或 DESIGN_READY / SPEC_READY，qualityGate = FAIL。
    3. 调用对应 Skill 修复。
    4. 修复后重跑失败 Gate 和受影响后续 Gate。
    5. 旧报告保留历史，生成新 Revision，不覆盖证据来源。
    6. 同一 failure 连续两轮修复仍无新证据 → 停止循环，向用户报告阻塞与已尝试方案。

[完成标准]
    - Harness、Schema、Contract、Build、MCP、UI、State、Security 和 Host Gate 都有明确状态。
    - 每个 required target 独立记录 Package、Install、Core E2E、Reopen 与 Evidence。
    - 每个 required AC 有可复核的实际结果。
    - plugin-reviewer 已用 fresh context 完成独立审查。
    - BLOCKED、BUILD_VALID 或 SHIPPABLE 结论与 Plugin-Project-State.md、plugin.yaml、报告和 Evidence 一致。
    - 只有所有 required target HOST_VERIFIED、所有 required AC 通过且 Reviewer REQUIRED = 0 时，phase 才能进入 COMPLETE、qualityGate 才能进入 SHIPPABLE。

[完成后告诉用户]
    只陈述证据支持的状态：
    - SHIPPABLE：列出每个 required target 的 HOST_VERIFIED 证据和安装包，并给交付引导。
    - BUILD_VALID：明确还缺哪个真实宿主步骤，不能说完成。
    - BLOCKED：列出 REQUIRED Findings、回退阶段和修复路径。

    交付引导必须包含三件事：
    - 文件在哪：插件文件夹完整路径与安装依赖状态；源文件夹（不含 node_modules）可上传 GitHub 或发给别人。Claude Code 的安装是复制进宿主缓存，源文件夹才是分发物。
    - 一键安装：直接用 plugin-installer Skill 现场装，或告知插件包自带的 install.sh 一条命令完成；同时给一段可复制发给宿主 Agent 的安装提示词。
    - 手动安装：按 target Profile 的 installationMethod 逐条列命令。

[语言]
    产出文档正文以中文为主体；代码、命令、字段名和宿主术语保留英文，不整段写英文。

[禁止]
    - 在无法访问真实宿主时伪造 HOST_VERIFIED。
    - 把手工描述当执行证据。
    - 修改 AC 或严重度来通过。
    - 一个 target 成功后把整体写成已完成。
    - Reviewer 有 REQUIRED Finding 仍写 SHIPPABLE。
    - 只做 Code Review，不跑安装与双向闭环。
