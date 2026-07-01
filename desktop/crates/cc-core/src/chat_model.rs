//! 聊天记录的结构化数据模型(替代 M2 的 Vec<String> 纯文本 log)。

use serde_json::Value;

#[derive(Debug, Clone)]
pub enum ChatEntry {
    UserText(String),
    AssistantTurn(AssistantTurn),
    SystemNote(String),
}

#[derive(Debug, Clone, Default)]
pub struct AssistantTurn {
    pub text: String,
    pub thinking: String,
    pub tool_calls: Vec<ToolCallView>,
    pub done: bool,
}

#[derive(Debug, Clone)]
pub struct ToolCallView {
    pub id: String,
    pub name: String,
    pub input: Value,
    pub result: Option<String>,
    pub is_error: bool,
    pub pending_permission: Option<PendingPermission>,
}

#[derive(Debug, Clone)]
pub struct PendingPermission {
    pub request_id: String,
    pub decision_reason: Option<String>,
    pub requested_at: std::time::Instant,
}
