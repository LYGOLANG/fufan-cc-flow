---
name: plugin-build-protocol
description: plugin-builder 执行每个 Task 前 read；按这里的最小闭环、小步运行、证据与排障协议开发，失败自主修复。
---

[工作区纪律]
    - 开始前检查 pwd、git status、项目结构、package manager 和现有命令。
    - 不覆盖用户未提交修改。
    - 不自动 commit，除非用户明确要求。
    - 依赖版本与 lockfile 同步。
    - 临时文件放明确目录并在完成后清理。

[当前 Task 规划]
    编码前内部写：

    ```text
    Task
    Current State
    Files to Read
    Files to Change
    Commands
    Completion Criteria
    Risk
    ```

    规划只覆盖当前 Task，不复制整份 DEV-PLAN。

[代码实现顺序]
    契约与状态层先于 Server 与 UI；每步实现跟随其测试与证据落地。
    垂直 Slice 可穿过多层，但每层围绕同一用户动作和 AC；顺序服务于最小双向闭环最早打通。

[最小 Round-trip]
    必须有一个与业务无关的最小闭环测试，例如：

    ```text
    UI 输入一段文本 / 选择一个对象
    → save_request
    → 当前 Agent 收到 requestId
    → Agent 调用 apply_result
    → UI 显示 result
    → 重开后 result 存在
    ```

    该闭环通过前，不开始大规模业务功能。

[测试金字塔]
    - Schema Test：无效 input / output 被拒绝。
    - Domain Unit：纯状态变更、版本、幂等、放置 / patch。
    - MCP Contract：initialize、tools/list、tools/call、错误结构。
    - UI Component / Interaction：核心直接操作与状态。
    - Bridge Integration：request 与 result round-trip。
    - Package Smoke：clean build、manifest、路径、启动。
    - Host E2E：真实 required target，仅第五步集中执行，开发期不接触宿主。

    宿主沙箱注意：用户开启 /sandbox 时，bind 127.0.0.1 的测试首跑会被沙箱拦截属预期；接受非沙箱回退提示，或让用户配 sandbox.network.allowLocalBinding = true。

[证据目录]

    ```text
    evidence/
    ├── build/
    ├── contracts/
    ├── ui/
    ├── mcp/
    ├── security/
    ├── performance/
    └── hosts/
        └── <target>/
    ```

    每份证据包含：
    - command / steps
    - timestamp
    - environment
    - exit code / result
    - related Task / AC
    - raw output path

[排障协议]
    失败必须修到原失败场景重验通过，且受影响回归全绿；定位方式由你决定，但版本敏感 API 查官方资料不靠猜。
    不用试错堆补丁；不因失败降低 AC、删测试或改验收换通过。
    原始错误、复现命令与修复证据写入 evidence/，Task 才能继续。

    同一问题反复失败时，检查：
    - 上游假设是否错误。
    - 宿主能力是否不存在。
    - 版本 / 缓存 / 新会话是否导致旧 Schema。
    - 是否需要回 Design 改 Primary / Fallback。

[变更分类]
    - Refactor：行为与契约不变，可直接执行并回归。
    - Implementation Change：实现方式变化，更新 Plan 备注。
    - Contract Change：Schema / Tool / State / Host 变化，回 Design。
    - Scope Change：用户可感知能力变化，回 Spec。
    - Test Change：只补证据，不允许降低预期。

[Mock 规则]
    Mock 可用于 unit / component，但：
    - Bridge Mock 不能替代真实宿主 E2E。
    - 假 MCP Server 不能替代生产 Server Probe。
    - 测试 Fixture 要与 Spec 样本对应。
    - 临时 Mock 必须有删除 / 替换 Task。

[可重现构建]
    - clean checkout / clean install 可构建。
    - lockfile 存在。
    - 构建产物不依赖开发机绝对路径。
    - 生成 package manifest、版本、hash 与文件清单。
    - 不在最终用户首次打开时无约束自动安装依赖，除非 Design 明确且验证供应链风险。

[完成前扫描]
    搜索并处理：
    - TODO / FIXME / XXX
    - mock / stub / placeholder
    - localhost 硬编码
    - 绝对用户路径
    - 任意 shell / path Tool
    - console log Secret / 文件内容
    - 未使用 fallback
    - skipped test / only test

[状态更新]
    Task done 时写：
    - 实际修改文件。
    - 实际执行命令。
    - Evidence 路径。
    - 与计划差异。
    - 新风险或技术债。

    不能只把 `[ ]` 改成 `[x]`。
