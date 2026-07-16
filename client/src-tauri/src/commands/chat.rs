mod contract;
mod events;

use std::path::PathBuf;
use std::time::Duration;

use cc_core::{spawn_session, AppEvent, PermissionDecision, SessionHandle, SpawnConfig};
use serde_json::json;
use tauri::{AppHandle, State};

use crate::state::AppState;
use contract::{
    build_cfg, canonical_project_path, existing_session_key, validate_payload, AbortPayload,
    CommandError, PermissionResponsePayload, SendMessagePayload,
};
use events::{dispatch_event, emit_ws};

const SESSION_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(4);

#[tauri::command]
pub fn resolve_project_path(payload: AbortPayload) -> Result<String, CommandError> {
    canonical_project_path(&payload.project_path)
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SendMessagePayload,
) -> Result<(), CommandError> {
    validate_payload(&payload)?;
    let project_path = canonical_project_path(&payload.project_path)?;
    let mut cfg = build_cfg(&payload);

    // 项目当前忙 -> 排队,不新起进程、不阻塞输入框;这一轮结束后 turn_loop 会自动取下一条。
    let generation = {
        let mut sessions = state.sessions.lock().unwrap();
        let proj = sessions.entry(project_path.clone()).or_default();
        if proj.busy {
            proj.queue.push_back(crate::state::QueuedMessage {
                prompt: payload.prompt.clone(),
                cfg: cfg.clone(),
            });
            None
        } else {
            Some(proj.begin_turn())
        }
    };

    let Some(generation) = generation else {
        emit_ws(&app, &project_path, "message_queued", json!({}));
        return Ok(());
    };

    let resume = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&project_path)
            .and_then(|p| p.session_id.clone())
    };
    cfg.resume = payload.session_id.or(resume);

    tauri::async_runtime::spawn(turn_loop(
        app,
        state.inner().clone(),
        project_path,
        payload.prompt,
        cfg,
        generation,
    ));
    Ok(())
}

/// 处理一轮,结束后检查队列;有排队消息就(用同一个 --resume 链条)接着处理下一条,
/// 直到队列空了才真正把这个项目标成"不忙"。特意写成循环而不是递归调用自己——
/// 递归 spawn 会导致 Rust 推不出这个 Future 是 Send 的(编译报错),循环没有这个问题。
async fn turn_loop(
    app: AppHandle,
    state: AppState,
    project_path: String,
    mut prompt: String,
    mut cfg: SpawnConfig,
    generation: u64,
) {
    loop {
        // 必须在真正 spawn 之前登记；ExitRequested 会先封门并等待这个计数归零，
        // 覆盖 Child 已创建但 SessionHandle 尚未来得及写回 sessions 的窗口。
        if !state.try_begin_spawn() {
            return;
        }
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<AppEvent>();
        let handle = match spawn_session(
            PathBuf::from(&project_path),
            cfg.clone(),
            prompt.clone(),
            tx,
        )
        .await
        {
            Ok(h) => h,
            Err(e) => {
                let is_current = {
                    let mut sessions = state.sessions.lock().unwrap();
                    match sessions.get_mut(&project_path) {
                        Some(proj) if proj.is_generation(generation) => {
                            proj.busy = false;
                            proj.handle = None;
                            true
                        }
                        _ => false,
                    }
                };
                if is_current {
                    emit_ws(
                        &app,
                        &project_path,
                        "error",
                        json!({"code": "SPAWN_FAILED", "message": e.to_string()}),
                    );
                }
                state.finish_spawn();
                return;
            }
        };

        let accepted = {
            let mut sessions = state.sessions.lock().unwrap();
            match sessions.get_mut(&project_path) {
                Some(project) if project.is_active_generation(generation) => {
                    project.handle = Some(handle.clone());
                    true
                }
                _ => false,
            }
        };
        if !accepted {
            if let Err(error) = wait_for_shutdown(handle).await {
                log::error!("拒绝迟到的 Claude spawn 时回收失败: {error:?}");
            }
            state.finish_spawn();
            return;
        }
        state.finish_spawn();

        while let Some(ev) = rx.recv().await {
            let is_current = {
                let sessions = state.sessions.lock().unwrap();
                matches!(
                    sessions.get(&project_path),
                    Some(project) if project.is_active_generation(generation)
                )
            };
            if !is_current {
                handle.shutdown();
                return;
            }
            let is_terminal = matches!(ev, AppEvent::ProcessClose { .. });
            dispatch_event(&app, &state, &project_path, ev).await;
            if is_terminal {
                break;
            }
        }

        let next = {
            let mut sessions = state.sessions.lock().unwrap();
            let Some(proj) = sessions.get_mut(&project_path) else {
                return;
            };
            if !proj.is_generation(generation) {
                return;
            }
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

#[tauri::command]
pub async fn abort(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: AbortPayload,
) -> Result<(), CommandError> {
    let project_path = existing_session_key(&payload.project_path, payload.project_key.as_deref())?;
    let (aborted, handle, cancelled_generation) = {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(proj) = sessions.get_mut(&project_path) {
            proj.invalidate_turn();
            (true, proj.handle.clone(), Some(proj.generation))
        } else {
            (false, None, None)
        }
    };
    if aborted {
        emit_ws(&app, &project_path, "aborted", json!({}));
    }
    if let Some(handle) = handle {
        wait_for_shutdown(handle).await?;
    }
    if let Some(cancelled_generation) = cancelled_generation {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(project) = sessions.get_mut(&project_path) {
            if project.is_generation(cancelled_generation) && !project.busy {
                project.handle = None;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn permission_response(
    state: State<'_, AppState>,
    payload: PermissionResponsePayload,
) -> Result<(), CommandError> {
    if payload.always_allow {
        return Err(CommandError::new(
            "UNSUPPORTED_ALWAYS_ALLOW",
            "Rust transport 暂不支持永久授权；请仅允许本次操作",
        ));
    }
    let project_path = existing_session_key(&payload.project_path, payload.project_key.as_deref())?;
    let handle = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&project_path).and_then(|p| p.handle.clone())
    };
    let Some(handle) = handle else {
        return Err(CommandError::new(
            "NO_ACTIVE_SESSION",
            "当前项目没有等待权限决策的会话",
        ));
    };

    let decision = match payload.decision.as_str() {
        "allow" => PermissionDecision::Allow {
            updated_input: None,
        },
        "deny" => PermissionDecision::Deny {
            reason: payload.reason.unwrap_or_else(|| "User denied".to_string()),
        },
        other => {
            return Err(CommandError::new(
                "INVALID_DECISION",
                format!("unknown decision: {other}"),
            ))
        }
    };
    handle.send_permission_response(payload.request_id, decision);
    Ok(())
}

#[tauri::command]
pub async fn shutdown_project(
    state: State<'_, AppState>,
    payload: AbortPayload,
) -> Result<(), CommandError> {
    let project_path = existing_session_key(&payload.project_path, payload.project_key.as_deref())?;
    let (handle, cancelled_generation) = {
        let mut sessions = state.sessions.lock().unwrap();
        let Some(project) = sessions.get_mut(&project_path) else {
            return Ok(());
        };
        project.invalidate_turn();
        (project.handle.clone(), project.generation)
    };
    if let Some(handle) = handle {
        wait_for_shutdown(handle).await?;
    }
    let mut sessions = state.sessions.lock().unwrap();
    if matches!(
        sessions.get(&project_path),
        Some(project) if project.is_generation(cancelled_generation) && !project.busy
    ) {
        if let Some(mut project) = sessions.remove(&project_path) {
            project.queue.clear();
            project.handle = None;
        }
    }
    Ok(())
}

pub fn shutdown_all(state: &AppState) {
    state.begin_exit_and_wait_for_spawns();
    let handles = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions
            .drain()
            .filter_map(|(_, mut project)| {
                project.queue.clear();
                project.handle.take()
            })
            .collect::<Vec<_>>()
    };

    std::thread::scope(|scope| {
        let waits = handles
            .into_iter()
            .map(|handle| {
                scope.spawn(move || {
                    handle.interrupt();
                    handle.shutdown_and_wait(SESSION_SHUTDOWN_TIMEOUT)
                })
            })
            .collect::<Vec<_>>();
        for wait in waits {
            if !wait.join().unwrap_or(false) {
                log::error!("Claude 子进程在桌面退出前未能按时回收");
            }
        }
    });
}

async fn wait_for_shutdown(handle: SessionHandle) -> Result<(), CommandError> {
    let completed = tauri::async_runtime::spawn_blocking(move || {
        handle.interrupt();
        handle.shutdown_and_wait(SESSION_SHUTDOWN_TIMEOUT)
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "SHUTDOWN_JOIN_FAILED",
            format!("等待 Claude 子进程回收失败: {error}"),
        )
    })?;

    if completed {
        Ok(())
    } else {
        Err(CommandError::new(
            "SHUTDOWN_TIMEOUT",
            "Claude 子进程未能在 4 秒内退出",
        ))
    }
}
