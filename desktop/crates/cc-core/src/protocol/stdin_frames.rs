//! 出站 stdin 帧构造。M0 spike 已对每个帧格式做过真机验证。

use serde_json::{json, Value};

/// 初始 prompt 帧(spawn 后写到 stdin 的第一行)。已在 M0 spike 验证过有效。
pub fn initial_user_prompt(text: &str) -> Value {
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": text }]
        }
    })
}

/// 优雅中断当前轮(进程继续存活,等待下一条消息)。
pub fn control_request_interrupt(request_id: &str) -> Value {
    json!({
        "type": "control_request",
        "request_id": request_id,
        "request": { "subtype": "interrupt" }
    })
}

/// 权限确认:允许。**`updated_input` 必填**——M0 spike 实测若省略会被 CLI 侧
/// Zod 校验拒绝(invalid_union),导致该工具调用被判定为失败。未修改工具输入时
/// 原样回填 `original_input` 即可。
pub fn permission_allow(request_id: &str, updated_input: Value) -> Value {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "allow", "updatedInput": updated_input }
        }
    })
}

/// 权限确认:拒绝。
pub fn permission_deny(request_id: &str, message: &str) -> Value {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "deny", "message": message }
        }
    })
}
