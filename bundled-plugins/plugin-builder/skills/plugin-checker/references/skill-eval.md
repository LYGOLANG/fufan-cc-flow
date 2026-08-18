---
name: skill-eval
description: plugin-checker 在 Host Verification 阶段做 Skill 触发评测时 read；按这里的题库规则出题、运行评测脚本并把结果转成 Finding。
---

[用途]
    生成插件的 Skill 生死在 description 能否被宿主正确触发。本评测量化两个数：正例触发率（该触发的触发了多少）与负例误触发率（不该触发的误触发了多少）。

[题库规则]
    - Skill Catalog 的每个技能各建一份题库，写进 evidence/check/skill-evals/<skill-name>.json：{"skill": "<skill-name>", "positive": [...], "negative": [...]}。
    - 正例引用采访中用户的原话短语改写；负例取自 Explicit Non-goals 与邻近场景。
    - 正例必须真实化：带文件路径、个人背景、错别字、随意大小写（如 "帮我看下 Q4 sales final FINAL v2.xlsx"），不写教科书句式。
    - 负例必须是 near-miss：与正例共享关键词但真实意图不同；毫不相关的查询（如对 PDF 工具问斐波那契）什么都测不出。
    - 宿主只在任务不能一步完成时查 Skill：一步就能答的查询无效，题目要有真实工作量。
    - 正例覆盖意图类别而不是穷举句式；负例覆盖最容易混淆的邻近场景。

[运行]
    ```bash
    python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/eval-skill-triggers.py" <插件目录> --evals evidence/check/skill-evals/<skill-name>.json --out evidence/check/skill-trigger-eval/<skill-name>.json --min-positive 0.8 --max-negative 0.2
    ```
    claude CLI 可得时必跑；宿主无 claude CLI 时跳过并在 Check-Report 注明评测缺席原因。
    Codex 插件（.codex-plugin）无需手工准备：脚本自动构建 skills 影子副本用 claude 无头模式评测触发。
    结果按技能写入 evidence/check/skill-trigger-eval/<skill-name>.json（脚本缺省即此路径），计入证据链。

[结果判读]
    - 正例触发率 < 0.8 或负例误触发率 > 0.2 → IMPORTANT Finding，交 builder 修 description（描述要进取式列举触发面，但列意图类别不堆查询原句），修后重测。
    - 题库本身也受审：全部配置都能过的题没有区分度，视为坏题重写。
    - 评测结果不改变 SHIPPABLE 硬门槛，但未跑评测（宿主可得时）算 HV 证据缺失。

[禁止]
    - 用无关查询充当负例。
    - 为让评测通过把 description 写成查询原句堆砌。
    - 评测未跑却在报告里声称触发正常。
