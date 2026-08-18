---
name: style-inventory
description: 修改本 Harness 任何 Skill、Subagent 或支持文件之前先 read；按这里的目录、frontmatter、方括号章节与缩进规范写作，改完跑 lint。
---

[定位]
    这是 Harness 的格式单一真相源。
    它只规定怎么写，不规定 Plugin 业务内容。
    业务规则写进对应 Skill；宿主硬约束以当前官方文档为准。

[目录规范]
    本 Harness 自身与它生成的 Plugin 都是安装型 Plugin 形态：

    ```text
    <plugin-root>/
    ├── .claude-plugin/
    │   └── plugin.json
    ├── skills/
    │   └── <skill-name>/
    │       ├── SKILL.md
    │       ├── references/
    │       ├── templates/
    │       ├── schemas/
    │       ├── scripts/
    │       └── assets/
    ├── agents/
    └── hooks/
    ```

    - 只有 plugin.json 放进 `.claude-plugin/`；其余组件放 Plugin root。
    - Plugin root 不放 CLAUDE.md；指令入口是总路由 Skill，规则内核在它的 references。
    - 一个 Skill 的支持文件跟随该 Skill，不建立跨 Skill 的散乱公共目录。

[SKILL.md 规范]
    frontmatter 只保留：

    ```yaml
    ---
    name: <与目录相同的小写 kebab-case>
    description: <触发时机 + 做什么 + 主要产出>
    ---
    ```

    正文：
    - 第一节必须是 [任务]。
    - 顶层只用 [章节]，不用 Markdown # 标题。
    - 正文统一缩进 4 空格；下一层再加 4 空格。
    - 触发条件写进 description 和 [启动检查] / [依赖检测]，不另造冗余元数据。
    - 主流程、硬指标、围栏、完成标准放 SKILL.md；大量案例、题库、模板和规则拆到支持文件。
    - 引用支持文件使用相对路径，例如 `references/workflow-0-1.md`。

[支持文件规范]
    支持 Markdown 文件允许 frontmatter：

    ```yaml
    ---
    name: <文件职责名>
    description: <何时 read 本文件 + 按它做什么>
    ---
    ```

    正文优先使用方括号章节与 4 空格缩进。
    面向最终用户阅读的交付模板可以使用正常 Markdown 标题，但不能反向改变 SKILL.md 写法。

    所有 frontmatter 的 description 写使用时机与用法（何时用、怎么用），不写内容介绍。

[Question Bank 规范]
    每个采访维度使用固定五段：
    - [覆盖意图]
    - [主问题]
    - [追问深化]
    - [接受标准]
    - [不接受的答案]

    Question Bank 是追问纪律，不是逐题照念的问卷。
    用户初始表达或前一轮回答已覆盖的维度，直接吸收，不重复问。
    内部 Phase、Gate、维度编号不向用户暴露；用户面前只做自然的承上启下。

[Subagent 规范]
    frontmatter 只保留四个字段，顺序固定：

    ```yaml
    ---
    name: <小写 kebab-case>
    description: <何时被派发 + 做什么 + 边界>
    skills:
        - <承载其方法论的 Skill>
    model: inherit
    ---
    ```

    正文第一节必须是 [角色]，并至少包含：
    - [任务]
    - [输入]
    - [审查流程] 或 [工作流程]
    - [输出]
    - [完成标准]
    - [禁止]

    Subagent 是薄壳：方法论住在 skills 指向的 Skill 及其 references，正文只写角色、输入输出与边界。
    只读、不修改文件等行为约束写进正文 [禁止]。
    model 写 inherit 表示跟随当前会话主模型；需要固定模型时写具体型号。
    Subagent 使用 fresh context，只做被派发职责，不继续派 Subagent，不代替主 Agent 宣告完成。

[脚本规范]
    脚本不写模块 docstring、行内注释和宿主品牌备注；help 信息只来自参数定义。
    JSON、YAML 与模板一律不写注释：JSON 注释直接破坏解析，模板注释会随生成播种进用户项目。
    脚本生成的用户文档（README 等）属于交付内容，不受此限。

[缩进与标点]
    - 禁止 Tab。
    - 缩进必须是 4 的倍数。
    - 文件末尾保留一个换行。
    - 禁止行尾空格。
    - 中文正文优先用中文标点；文件名、命令、API、字段保持原样。
    - 中英文混排时，英文术语两侧按可读性留空格，不为追求形式破坏代码或路径。

[总路由规范]
    编排入口是 interactive-plugin-builder 总路由 Skill；第一性原理、总体规则与状态机内核在 `orchestration-core.md`。
    总路由只负责状态检测与路由，不复制各阶段 Skill 的完整流程。

    总路由 [输出] 含固定品牌区块：FEICAI ASCII 艺术 + 开场白。
    ASCII 艺术本体不许改动或删除；开场白措辞可按 Harness 领域适配。

[自动检查]
    每次修改 Skill、Subagent 或支持文件后运行：

    ```bash
    python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/lint-harness-style.py" --root "${CLAUDE_PLUGIN_ROOT}"
    ```

    在 Harness 源码根开发时，把 ${CLAUDE_PLUGIN_ROOT} 换成 `.` 即可。

    格式检查失败时先修格式，再继续领域工作。
