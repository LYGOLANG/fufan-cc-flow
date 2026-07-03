use std::path::PathBuf;

use cc_core::{spawn_session, AppEvent, PermissionDecision, SpawnConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// 只读/无副作用的工具永不打扰用户,直接放行——对齐 Node 版 chatHandler.ts 的清单
/// (之前 egui 版 M4 也用过同一份)。
const AUTO_APPROVE_TOOLS: &[&str] = &[
    "Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoRead", "Task", "Agent", "TodoWrite", "NotebookRead", "LS",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessagePayload {
    pub prompt: String,
    pub project_path: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub run_mode: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub fork_session: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortPayload {
    pub project_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponsePayload {
    pub project_path: String,
    pub request_id: String,
    pub decision: String,
    #[serde(default)]
    pub reason: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

fn emit_ws(app: &AppHandle, project_path: &str, event: &str, mut payload: Value) {
    if let Value::Object(map) = &mut payload {
        map.insert("projectPath".to_string(), json!(project_path));
    }
    let _ = app.emit("ws-chat", json!({ "event": event, "payload": payload, "timestamp": now_ms() }));
}

fn build_cfg(payload: &SendMessagePayload) -> SpawnConfig {
    SpawnConfig {
        model: payload.model.clone(),
        effort: payload.effort.clone(),
        permission_mode: Some(payload.run_mode.clone().unwrap_or_else(|| "default".to_string())),
        fork_session: payload.fork_session.unwrap_or(false),
        ..Default::default()
    }
}

#[tauri::command]
pub async fn send_message(app: AppHandle, state: State<'_, AppState>, payload: SendMessagePayload) -> Result<(), String> {
    let project_path = payload.project_path.clone();
    let mut cfg = build_cfg(&payload);

    // 项目当前忙 -> 排队,不新起进程、不阻塞输入框;这一轮结束后 turn_loop 会自动取下一条。
    let should_queue = {
        let mut sessions = state.sessions.lock().unwrap();
        let proj = sessions.entry(project_path.clone()).or_default();
        if proj.busy {
            proj.queue.push_back(crate::state::QueuedMessage { prompt: payload.prompt.clone(), cfg: cfg.clone() });
            true
        } else {
            proj.busy = true;
            false
        }
    };

    if should_queue {
        emit_ws(&app, &project_path, "message_queued", json!({}));
        return Ok(());
    }

    let resume = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&project_path).and_then(|p| p.session_id.clone())
    };
    cfg.resume = payload.session_id.or(resume);

    tauri::async_runtime::spawn(turn_loop(app, state.inner().clone(), project_path, payload.prompt, cfg));
    Ok(())
}

/// 处理一轮,结束后检查队列;有排队消息就(用同一个 --resume 链条)接着处理下一条,
/// 直到队列空了才真正把这个项目标成"不忙"。特意写成循环而不是递归调用自己——
/// 递归 spawn 会导致 Rust 推不出这个 Future 是 Send 的(编译报错),循环没有这个问题。
async fn turn_loop(app: AppHandle, state: AppState, project_path: String, mut prompt: String, mut cfg: SpawnConfig) {
    loop {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<AppEvent>();
        let handle = match spawn_session(PathBuf::from(&project_path), cfg.clone(), prompt.clone(), tx).await {
            Ok(h) => h,
            Err(e) => {
                emit_ws(&app, &project_path, "error", json!({"code": "SPAWN_FAILED", "message": e.to_string()}));
                let mut sessions = state.sessions.lock().unwrap();
                if let Some(proj) = sessions.get_mut(&project_path) {
                    proj.busy = false;
                    proj.handle = None;
                }
                return;
            }
        };

        {
            let mut sessions = state.sessions.lock().unwrap();
            let proj = sessions.entry(project_path.clone()).or_default();
            proj.handle = Some(handle);
        }

        while let Some(ev) = rx.recv().await {
            let is_terminal = matches!(ev, AppEvent::ProcessClose { .. });
            dispatch_event(&app, &state, &project_path, ev).await;
            if is_terminal {
                break;
            }
        }

        let next = {
            let mut sessions = state.sessions.lock().unwrap();
            let Some(proj) = sessions.get_mut(&project_path) else { return };
            proj.handle = None;
            match proj.queue.pop_front() {
                Some(queued) => Some((queued, proj.session_id.clone())),
                None => {
                    proj.busy = false;
                    None
                }
            }
        };

        match next {
            Some((queued, resume)) => {
                prompt = queued.prompt;
                cfg = queued.cfg;
                cfg.resume = resume;
            }
            None => return,
        }
    }
}

async fn dispatch_event(app: &AppHandle, state: &AppState, project_path: &str, ev: AppEvent) {
    match ev {
        AppEvent::SessionInit { session_id, model } => {
            {
                let mut sessions = state.sessions.lock().unwrap();
                if let Some(proj) = sessions.get_mut(project_path) {
                    proj.session_id = Some(session_id.clone());
                }
            }
            emit_ws(app, project_path, "session_init", json!({"sessionId": session_id, "model": model}));
        }
        AppEvent::AssistantTextDelta { text, .. } => {
            emit_ws(app, project_path, "assistant_text", json!({"text": text, "isPartial": true}));
        }
        AppEvent::AssistantThinkingDelta { text, .. } => {
            emit_ws(app, project_path, "assistant_thinking", json!({"thinking": text, "isPartial": true}));
        }
        AppEvent::NewTurn { .. } => {
            emit_ws(app, project_path, "new_turn", json!({}));
        }
        AppEvent::ToolUseStart { tool_call_id, tool_name, tool_input, .. } => {
            emit_ws(
                app,
                project_path,
                "tool_use_start",
                json!({"toolCallId": tool_call_id, "toolName": tool_name, "toolInput": tool_input}),
            );
        }
        AppEvent::ToolInputComplete { tool_call_id, tool_input, .. } => {
            emit_ws(app, project_path, "tool_input_complete", json!({"toolCallId": tool_call_id, "toolInput": tool_input}));
        }
        AppEvent::ToolUseResult { tool_call_id, result, is_error, .. } => {
            emit_ws(
                app,
                project_path,
                "tool_use_result",
                json!({"toolCallId": tool_call_id, "result": result, "isError": is_error}),
            );
        }
        AppEvent::ContextCompact { metadata, .. } => {
            emit_ws(app, project_path, "context_compact", json!({"compact_metadata": metadata}));
        }
        AppEvent::TaskComplete { result, cost_usd, duration_ms, num_turns, is_error, .. } => {
            emit_ws(
                app,
                project_path,
                "task_complete",
                json!({"result": result, "costUsd": cost_usd, "durationMs": duration_ms, "numTurns": num_turns, "isError": is_error}),
            );
        }
        AppEvent::PermissionRequest { request_id, tool_use_id, tool_name, tool_input, decision_reason, .. } => {
            if AUTO_APPROVE_TOOLS.contains(&tool_name.as_str()) {
                let handle = {
                    let sessions = state.sessions.lock().unwrap();
                    sessions.get(project_path).and_then(|p| p.handle.clone())
                };
                if let Some(handle) = handle {
                    handle.send_permission_response(request_id, PermissionDecision::Allow { updated_input: Some(tool_input) });
                }
            } else {
                emit_ws(
                    app,
                    project_path,
                    "permission_request",
                    json!({
                        "requestId": request_id,
                        "toolCallId": tool_use_id,
                        "toolName": tool_name,
                        "toolInput": tool_input,
                        "decisionReason": decision_reason,
                    }),
                );
            }
        }
        AppEvent::PermissionCancelled { request_id } | AppEvent::PermissionTimedOut { request_id } => {
            emit_ws(app, project_path, "permission_timeout", json!({"requestId": request_id}));
        }
        AppEvent::ProcessStderr { text, .. } => {
            emit_ws(app, project_path, "process_stderr", json!({"text": text}));
        }
        AppEvent::ProcessClose { code, .. } => {
            emit_ws(app, project_path, "process_close", json!({"code": code}));
        }
        AppEvent::Error { code, message, .. } => {
            emit_ws(app, project_path, "error", json!({"code": code, "message": message}));
        }
    }
}

#[tauri::command]
pub fn abort(state: State<'_, AppState>, payload: AbortPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(proj) = sessions.get_mut(&payload.project_path) {
        if let Some(handle) = &proj.handle {
            handle.interrupt();
        }
        // 用户主动中断,视为放弃这一批排队消息(而不是中断完接着自动发下一条)。
        proj.queue.clear();
    }
    Ok(())
}

#[tauri::command]
pub fn permission_response(state: State<'_, AppState>, payload: PermissionResponsePayload) -> Result<(), String> {
    let handle = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&payload.project_path).and_then(|p| p.handle.clone())
    };
    let Some(handle) = handle else {
        return Err("no active session for this project".to_string());
    };

    let decision = match payload.decision.as_str() {
        "allow" => PermissionDecision::Allow { updated_input: None },
        "deny" => PermissionDecision::Deny { reason: payload.reason.unwrap_or_else(|| "User denied".to_string()) },
        other => return Err(format!("unknown decision: {other}")),
    };
    handle.send_permission_response(payload.request_id, decision);
    Ok(())
}
