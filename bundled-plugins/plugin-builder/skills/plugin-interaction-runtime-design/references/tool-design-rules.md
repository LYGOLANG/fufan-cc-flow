---
name: plugin-tool-design-rules
description: 设计 MCP Tool、Resource 与 Request / Result 契约时 read；按领域语义设计，禁止万能 Tool 与原始 UI Store 暴露。
---

[目标]
    Tool 是 UI、Agent 与权威状态之间的稳定契约，不是为了让模型获得任意代码执行入口。

[分类]

    [Render Tool]
        目的：打开或初始化 UI surface。
        特征：
        - read-only 或幂等。
        - 返回最小初始上下文和 UI Resource 关联。
        - 不把完整项目大状态塞进首次结果。

    [App-only Tool]
        目的：只给 UI 调用的确定性能力。
        典型：load_state、save_view、upload_asset、read_asset、get_job_status、download_result。
        规则：
        - 对模型隐藏，避免污染 Tool 列表。
        - 输入严格 Schema。
        - 不包含自然语言模糊意图。

    [Agent-visible Tool]
        目的：让宿主 Agent 查询领域上下文或应用领域结果。
        典型：get_current_selection、get_request、apply_timeline_patch、insert_asset、replace_node。
        规则：
        - 使用领域名，不叫 run_action / mutate_state。
        - 输入输出足以独立理解。
        - 有副作用时包含 requestId、expectedVersion、dryRun / confirmation（需要时）。
        - 返回明确 ID、版本、路径、bounds、warnings 和下一状态。

    [Long-running Tool]
        目的：启动和管理异步任务。
        最小集合：start_job、get_job_status、cancel_job；重试可创建新 requestId 或受控复用。
        规则：
        - start 返回 jobId，不长时间占住 Tool Call。
        - 状态有 queued / running / succeeded / failed / cancelled。
        - 进度是 best-effort，阶段与日志比伪精确百分比更可信。

[Tool Contract]
    每个 Tool 记录：
    - name
    - title / user-facing purpose
    - visibility：app / agent / both
    - readOnly / destructive / idempotent / openWorld
    - input schema
    - structured output schema
    - text fallback
    - side effects
    - permission scope
    - timeout
    - error codes
    - related requirement IDs
    - verification command / scenario

[Request Envelope]
    Agent 任务请求至少考虑：

    ```json
    {
      "requestId": "req-...",
      "operation": "domain-operation",
      "projectId": "...",
      "projectVersion": 12,
      "userIntent": "...",
      "selection": {},
      "assetRefs": [],
      "createdAt": "..."
    }
    ```

    原则：
    - 大文件只传引用、metadata、时间范围、抽帧或派生摘要。
    - selection 使用稳定 ID，不只传屏幕坐标或“这个”。
    - requestId 全局唯一，用于重复提交保护和审计。

[Result Envelope]
    写回至少考虑：

    ```json
    {
      "requestId": "req-...",
      "basedOnProjectVersion": 12,
      "status": "succeeded",
      "operations": [],
      "assetRefs": [],
      "warnings": [],
      "createdAt": "..."
    }
    ```

    规则：
    - basedOnProjectVersion 与当前版本不一致时，不静默覆盖。
    - Operation 应是领域操作或受控 Patch，不是任意 JavaScript / JSONPath 写入。
    - Tool 应返回新的 projectVersion。

[错误契约]
    错误必须可判定、可展示、可恢复：
    - INVALID_INPUT
    - NOT_FOUND
    - PERMISSION_DENIED
    - VERSION_CONFLICT
    - DUPLICATE_REQUEST
    - UNSUPPORTED_FORMAT
    - PAYLOAD_TOO_LARGE
    - EXTERNAL_SERVICE_FAILED
    - CANCELLED
    - INTERNAL_ERROR

    返回：code、message、retryable、details（安全过滤后）、recoveryHint。

[禁止]
    - run_shell(command)
    - write_any_file(path, content)
    - execute_javascript(code)
    - update_raw_react_state
    - save_entire_store 未校验直接覆盖
    - 一个 Tool 同时承担十几个不相关操作
    - 把 Secret、绝对敏感路径或大 Base64 返回给模型
    - 用 Tool Description 代替输入 Schema 和运行时验证
