//! 对齐 `claudeAgentService.ts` 的 EventEmitter 事件面,供 GUI 消费的领域事件。

use serde_json::Value;

#[derive(Debug, Clone)]
pub enum AppEvent {
    SessionInit {
        session_id: String,
        model: Option<String>,
    },
    AssistantTextDelta {
        session_id: String,
        text: String,
    },
    AssistantThinkingDelta {
        session_id: String,
        text: String,
    },
    NewTurn {
        session_id: String,
    },
    ToolUseStart {
        session_id: String,
        tool_call_id: String,
        tool_name: String,
        tool_input: Value,
    },
    ToolInputComplete {
        session_id: String,
        tool_call_id: String,
        tool_input: Value,
    },
    ToolUseResult {
        session_id: String,
        tool_call_id: String,
        result: String,
        is_error: bool,
    },
    ContextCompact {
        session_id: String,
        metadata: Value,
    },
    TaskComplete {
        session_id: String,
        result: String,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
        num_turns: Option<u32>,
        is_error: bool,
    },
    PermissionRequest {
        session_id: String,
        request_id: String,
        /// Anthropic 工具调用块自己的 id(assistant message 里 tool_use.id / tool_result.tool_use_id),
        /// 跟 control 通道用的 request_id 是两个不同的 id——前者用来跟聊天记录里的工具卡片配对。
        tool_use_id: String,
        tool_name: String,
        tool_input: Value,
        decision_reason: Option<String>,
    },
    PermissionCancelled {
        request_id: String,
    },
    PermissionTimedOut {
        request_id: String,
    },
    ProcessStderr {
        session_id: String,
        text: String,
    },
    ProcessClose {
        session_id: String,
        code: Option<i32>,
    },
    Error {
        session_id: String,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone)]
pub enum PermissionDecision {
    Allow { updated_input: Option<Value> },
    Deny { reason: String },
}

#[derive(Debug, Clone)]
pub enum Command {
    PermissionResponse { request_id: String, decision: PermissionDecision },
    Interrupt,
    Shutdown,
}
