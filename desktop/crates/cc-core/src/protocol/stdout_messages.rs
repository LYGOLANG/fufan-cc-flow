//! 入站 stream-json 消息 schema。对齐 `@anthropic-ai/claude-agent-sdk` 的 `SDKMessage` 联合类型
//! 与 M0 spike 的真机抓包结果。
//!
//! 解析失败必须跳过而不是 panic —— CLI 会输出大量我们不关心的 `system` 子类型
//! (hook_started/hook_response/status/...),未知 `type` 一律落到 `Other`。

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum StdoutMessage {
    #[serde(rename = "system")]
    System(SystemMessage),
    #[serde(rename = "assistant")]
    Assistant(AssistantMessage),
    #[serde(rename = "user")]
    User(UserMessage),
    #[serde(rename = "result")]
    Result(ResultMessage),
    #[serde(rename = "stream_event")]
    StreamEvent(StreamEventMessage),
    #[serde(rename = "control_request")]
    ControlRequest(ControlRequestMessage),
    #[serde(rename = "control_cancel_request")]
    ControlCancelRequest(ControlCancelRequestMessage),
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SystemMessage {
    pub subtype: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub compact_metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssistantMessage {
    pub message: RawMessage,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(default)]
    pub uuid: Option<String>,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserMessage {
    pub message: RawMessage,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawMessage {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking {
        #[serde(default)]
        thinking: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: Value,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResultMessage {
    pub subtype: String,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub num_turns: Option<u32>,
    #[serde(default)]
    pub usage: Option<Value>,
    #[serde(default)]
    pub errors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StreamEventMessage {
    pub event: Value,
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,
    #[serde(default)]
    pub uuid: Option<String>,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ControlRequestMessage {
    pub request_id: String,
    pub request: ControlRequestBody,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ControlRequestBody {
    pub subtype: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub input: Option<Value>,
    #[serde(default)]
    pub tool_use_id: Option<String>,
    #[serde(default)]
    pub decision_reason: Option<String>,
    #[serde(default)]
    pub blocked_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ControlCancelRequestMessage {
    pub request_id: String,
}
