use cc_core::{AppEvent, PermissionDecision};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::state::AppState;

const AUTO_APPROVE_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "TodoRead",
    "Task",
    "Agent",
    "TodoWrite",
    "NotebookRead",
    "LS",
];

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

pub(super) fn emit_ws(app: &AppHandle, project_path: &str, event: &str, mut payload: Value) {
    if let Value::Object(map) = &mut payload {
        map.insert("projectPath".to_string(), json!(project_path));
    }
    let _ = app.emit(
        "ws-chat",
        json!({ "event": event, "payload": payload, "timestamp": now_ms() }),
    );
}

pub(super) async fn dispatch_event(
    app: &AppHandle,
    state: &AppState,
    project_path: &str,
    event: AppEvent,
) {
    match event {
        AppEvent::SessionInit { session_id, model } => {
            if let Some(project) = state.sessions.lock().unwrap().get_mut(project_path) {
                project.session_id = Some(session_id.clone());
            }
            emit_ws(
                app,
                project_path,
                "session_init",
                json!({"sessionId": session_id, "model": model}),
            );
        }
        AppEvent::AssistantTextDelta { text, .. } => emit_ws(
            app,
            project_path,
            "assistant_text",
            json!({"text": text, "isPartial": true}),
        ),
        AppEvent::AssistantThinkingDelta { text, .. } => emit_ws(
            app,
            project_path,
            "assistant_thinking",
            json!({"thinking": text, "isPartial": true}),
        ),
        AppEvent::NewTurn { .. } => emit_ws(app, project_path, "new_turn", json!({})),
        AppEvent::ToolUseStart {
            tool_call_id,
            tool_name,
            tool_input,
            ..
        } => emit_ws(
            app,
            project_path,
            "tool_use_start",
            json!({"toolCallId": tool_call_id, "toolName": tool_name, "toolInput": tool_input}),
        ),
        AppEvent::ToolInputComplete {
            tool_call_id,
            tool_input,
            ..
        } => emit_ws(
            app,
            project_path,
            "tool_input_complete",
            json!({"toolCallId": tool_call_id, "toolInput": tool_input}),
        ),
        AppEvent::ToolUseResult {
            tool_call_id,
            result,
            is_error,
            ..
        } => emit_ws(
            app,
            project_path,
            "tool_use_result",
            json!({"toolCallId": tool_call_id, "result": result, "isError": is_error}),
        ),
        AppEvent::ContextCompact { metadata, .. } => emit_ws(
            app,
            project_path,
            "context_compact",
            json!({"compact_metadata": metadata}),
        ),
        AppEvent::TaskComplete {
            result,
            cost_usd,
            duration_ms,
            num_turns,
            is_error,
            ..
        } => emit_ws(
            app,
            project_path,
            "task_complete",
            json!({"result": result, "costUsd": cost_usd, "durationMs": duration_ms, "numTurns": num_turns, "isError": is_error}),
        ),
        AppEvent::PermissionRequest {
            session_id,
            request_id,
            tool_use_id,
            tool_name,
            tool_input,
            decision_reason,
            ..
        } => {
            if AUTO_APPROVE_TOOLS.contains(&tool_name.as_str()) {
                let handle = state
                    .sessions
                    .lock()
                    .unwrap()
                    .get(project_path)
                    .and_then(|project| project.handle.clone());
                if let Some(handle) = handle {
                    handle.send_permission_response(
                        request_id,
                        PermissionDecision::Allow {
                            updated_input: Some(tool_input),
                        },
                    );
                }
            } else {
                emit_ws(
                    app,
                    project_path,
                    "permission_request",
                    json!({
                        "requestId": request_id,
                        "toolCallId": tool_use_id,
                        "sessionId": session_id,
                        "toolName": tool_name,
                        "toolInput": tool_input,
                        "decisionReason": decision_reason,
                        "hasSuggestions": false,
                    }),
                );
            }
        }
        AppEvent::PermissionCancelled { request_id }
        | AppEvent::PermissionTimedOut { request_id } => emit_ws(
            app,
            project_path,
            "permission_timeout",
            json!({"requestId": request_id}),
        ),
        AppEvent::ProcessStderr { text, .. } => {
            emit_ws(app, project_path, "process_stderr", json!({"text": text}))
        }
        AppEvent::ProcessClose { code, .. } => {
            emit_ws(app, project_path, "process_close", json!({"code": code}))
        }
        AppEvent::Error { code, message, .. } => emit_ws(
            app,
            project_path,
            "error",
            json!({"code": code, "message": message}),
        ),
    }
}
