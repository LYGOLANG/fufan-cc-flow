//! 单个 claude 子进程的完整生命周期管理:spawn、stdin 写入任务、stdout 解析、
//! HIL 60s 超时(竞态安全)、优雅回收。
//!
//! 架构对齐 Node 版 `claudeAgentService.ts` 的关键决定:**每一轮用户消息都是一个新的
//! 子进程**(通过 `--resume <sessionId>` 承接历史),而不是让一个进程横跨多轮 stdin 输入
//! ——这一点已通过 M0 spike 交叉验证:结果消息(`result`)出现后进程并不会自己退出,
//! 需要我们主动关闭 stdin 才会退出,这与"每轮起新进程"的设计假设一致。

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use crate::cli::spawn::build_claude_command;
use crate::events::{AppEvent, Command, PermissionDecision};
use crate::protocol::args::{build_args, SpawnConfig};
use crate::protocol::stdin_frames;
use crate::protocol::stdout_messages::{ContentBlock, StdoutMessage};

#[derive(Clone)]
pub struct SessionHandle {
    cmd_tx: mpsc::UnboundedSender<Command>,
}

impl SessionHandle {
    pub fn send_permission_response(&self, request_id: String, decision: PermissionDecision) {
        let _ = self.cmd_tx.send(Command::PermissionResponse { request_id, decision });
    }

    pub fn interrupt(&self) {
        let _ = self.cmd_tx.send(Command::Interrupt);
    }

    pub fn shutdown(&self) {
        let _ = self.cmd_tx.send(Command::Shutdown);
    }
}

/// 启动一轮对话:spawn claude 子进程、写入初始 prompt、后台跑事件循环。
/// 返回后 `events_tx` 上会陆续收到 SessionInit/AssistantTextDelta/.../TaskComplete/ProcessClose。
pub async fn spawn_session(
    project_path: PathBuf,
    cfg: SpawnConfig,
    prompt: String,
    events_tx: mpsc::UnboundedSender<AppEvent>,
) -> Result<SessionHandle> {
    let args = build_args(&cfg);
    let mut cmd = build_claude_command(&args)?;
    cmd.current_dir(&project_path);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().context("spawn claude failed")?;
    let mut stdin = child.stdin.take().context("child has no stdin")?;
    let stdout = child.stdout.take().context("child has no stdout")?;
    let stderr = child.stderr.take().context("child has no stderr")?;

    {
        let events_tx = events_tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = events_tx.send(AppEvent::ProcessStderr {
                    session_id: String::new(),
                    text: line,
                });
            }
        });
    }

    let initial = stdin_frames::initial_user_prompt(&prompt);
    write_frame(&mut stdin, &initial)
        .await
        .context("write initial prompt failed")?;

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Command>();

    tokio::spawn(async move {
        run_actor(child, stdin, stdout, cmd_rx, events_tx).await;
    });

    Ok(SessionHandle { cmd_tx })
}

async fn write_frame(stdin: &mut ChildStdin, value: &Value) -> std::io::Result<()> {
    let mut line = serde_json::to_string(value).expect("serialize control frame");
    line.push('\n');
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await
}

async fn run_actor(
    mut child: Child,
    mut stdin: ChildStdin,
    stdout: tokio::process::ChildStdout,
    mut cmd_rx: mpsc::UnboundedReceiver<Command>,
    events_tx: mpsc::UnboundedSender<AppEvent>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut known_session_id = String::new();
    let mut pending_cancels: HashMap<String, oneshot::Sender<()>> = HashMap::new();
    let mut pending_inputs: HashMap<String, Value> = HashMap::new();
    let (timeout_tx, mut timeout_rx) = mpsc::unbounded_channel::<String>();
    let mut interrupt_counter: u64 = 0;

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(raw)) => {
                        let should_stop = handle_stdout_line(
                            &raw,
                            &mut known_session_id,
                            &mut pending_cancels,
                            &mut pending_inputs,
                            &timeout_tx,
                            &events_tx,
                        );
                        if should_stop {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(Command::PermissionResponse { request_id, decision }) => {
                        resolve_permission(&request_id, decision, &mut stdin, &mut pending_cancels, &mut pending_inputs).await;
                    }
                    Some(Command::Interrupt) => {
                        interrupt_counter += 1;
                        let request_id = format!("interrupt-{interrupt_counter}");
                        let frame = stdin_frames::control_request_interrupt(&request_id);
                        let _ = write_frame(&mut stdin, &frame).await;
                    }
                    Some(Command::Shutdown) | None => break,
                }
            }
            Some(request_id) = timeout_rx.recv() => {
                if pending_cancels.remove(&request_id).is_some() {
                    pending_inputs.remove(&request_id);
                    let frame = stdin_frames::permission_deny(&request_id, "Permission request timed out (60s)");
                    let _ = write_frame(&mut stdin, &frame).await;
                    let _ = events_tx.send(AppEvent::PermissionTimedOut { request_id });
                }
            }
        }
    }

    drop(stdin);
    let status = match timeout(Duration::from_secs(2), child.wait()).await {
        Ok(Ok(status)) => Some(status),
        _ => {
            let _ = child.start_kill();
            child.wait().await.ok()
        }
    };

    let _ = events_tx.send(AppEvent::ProcessClose {
        session_id: known_session_id,
        code: status.and_then(|s| s.code()),
    });
}

/// 解析一行 stdout。返回 true 表示这一轮已经结束(收到 `result`),外层应回收进程。
fn handle_stdout_line(
    raw: &str,
    known_session_id: &mut String,
    pending_cancels: &mut HashMap<String, oneshot::Sender<()>>,
    pending_inputs: &mut HashMap<String, Value>,
    timeout_tx: &mpsc::UnboundedSender<String>,
    events_tx: &mpsc::UnboundedSender<AppEvent>,
) -> bool {
    let parsed: StdoutMessage = match serde_json::from_str(raw) {
        Ok(v) => v,
        // 解析失败就记日志然后跳过,不中断——对齐 Node 版本"Non-JSON stdout"的处理方式
        // (它也是 logger.warn 之后继续,不是完全静默)。
        Err(e) => {
            eprintln!("[transport] 解析 stdout 失败,已跳过: {e}: {raw}");
            return false;
        }
    };

    match parsed {
        StdoutMessage::System(sys) => {
            match sys.subtype.as_str() {
                "init" => {
                    if let Some(sid) = &sys.session_id {
                        *known_session_id = sid.clone();
                    }
                    let _ = events_tx.send(AppEvent::SessionInit {
                        session_id: known_session_id.clone(),
                        model: sys.model,
                    });
                }
                "compact_boundary" => {
                    let _ = events_tx.send(AppEvent::ContextCompact {
                        session_id: known_session_id.clone(),
                        metadata: sys.compact_metadata.unwrap_or(Value::Null),
                    });
                }
                _ => {}
            }
            false
        }
        StdoutMessage::Assistant(asm) => {
            // Text/Thinking 块特意跳过——`--include-partial-messages` 恒定开启,这两类内容
            // 已经通过下面 StreamEvent 分支的 text_delta/thinking_delta 逐 token 推送过一遍了,
            // 这里的"完整版"只是同一内容的重复快照,真正需要从这里拿的是 tool_use 的完整 input
            // (增量的 input_json_delta 是局部 JSON 片段,拼接/重新解析成本不划算,直接等这里的整版)。
            for block in asm.message.content {
                if let ContentBlock::ToolUse { id, name, input } = block {
                    let _ = events_tx.send(AppEvent::ToolUseStart {
                        session_id: known_session_id.clone(),
                        tool_call_id: id,
                        tool_name: name,
                        tool_input: input,
                    });
                }
            }
            false
        }
        StdoutMessage::User(usr) => {
            for block in usr.message.content {
                if let ContentBlock::ToolResult { tool_use_id, content, is_error } = block {
                    let result = match &content {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    let _ = events_tx.send(AppEvent::ToolUseResult {
                        session_id: known_session_id.clone(),
                        tool_call_id: tool_use_id,
                        result,
                        is_error,
                    });
                }
            }
            false
        }
        StdoutMessage::Result(res) => {
            let _ = events_tx.send(AppEvent::TaskComplete {
                session_id: known_session_id.clone(),
                result: res.result.unwrap_or_default(),
                cost_usd: res.total_cost_usd,
                duration_ms: res.duration_ms,
                num_turns: res.num_turns,
                is_error: res.is_error,
            });
            true
        }
        StdoutMessage::StreamEvent(ev) => {
            let event_type = ev.event.get("type").and_then(Value::as_str).unwrap_or("");
            match event_type {
                "message_start" => {
                    let _ = events_tx.send(AppEvent::NewTurn {
                        session_id: known_session_id.clone(),
                    });
                }
                "content_block_delta" => {
                    if let Some(delta) = ev.event.get("delta") {
                        match delta.get("type").and_then(Value::as_str) {
                            Some("text_delta") => {
                                if let Some(text) = delta.get("text").and_then(Value::as_str) {
                                    let _ = events_tx.send(AppEvent::AssistantTextDelta {
                                        session_id: known_session_id.clone(),
                                        text: text.to_string(),
                                    });
                                }
                            }
                            Some("thinking_delta") => {
                                if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                                    let _ = events_tx.send(AppEvent::AssistantThinkingDelta {
                                        session_id: known_session_id.clone(),
                                        text: text.to_string(),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
            false
        }
        StdoutMessage::ControlRequest(req) => {
            if req.request.subtype == "can_use_tool" {
                let request_id = req.request_id;
                let tool_use_id = req.request.tool_use_id.clone().unwrap_or_default();
                let tool_name = req.request.tool_name.unwrap_or_default();
                let tool_input = req.request.input.unwrap_or_else(|| serde_json::json!({}));
                pending_inputs.insert(request_id.clone(), tool_input.clone());

                let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
                pending_cancels.insert(request_id.clone(), cancel_tx);
                let timeout_tx2 = timeout_tx.clone();
                let rid2 = request_id.clone();
                tokio::spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(60)) => {
                            let _ = timeout_tx2.send(rid2);
                        }
                        _ = cancel_rx => {}
                    }
                });

                let _ = events_tx.send(AppEvent::PermissionRequest {
                    session_id: known_session_id.clone(),
                    request_id,
                    tool_use_id,
                    tool_name,
                    tool_input,
                    decision_reason: req.request.decision_reason,
                });
            }
            false
        }
        StdoutMessage::ControlCancelRequest(c) => {
            if pending_cancels.remove(&c.request_id).is_some() {
                pending_inputs.remove(&c.request_id);
                let _ = events_tx.send(AppEvent::PermissionCancelled { request_id: c.request_id });
            }
            false
        }
        StdoutMessage::Other => false,
    }
}

async fn resolve_permission(
    request_id: &str,
    decision: PermissionDecision,
    stdin: &mut ChildStdin,
    pending_cancels: &mut HashMap<String, oneshot::Sender<()>>,
    pending_inputs: &mut HashMap<String, Value>,
) {
    // 竞态防护的核心:能从 map 里 remove 到,才说明这次是"第一个到达的决策"
    // (UI 决策 vs 60s 超时,谁先到谁生效),避免对同一 request_id 重复写 control_response。
    if pending_cancels.remove(request_id).is_none() {
        return;
    }
    let original_input = pending_inputs.remove(request_id);

    let frame = match decision {
        PermissionDecision::Allow { updated_input } => {
            let input = updated_input.or(original_input).unwrap_or_else(|| serde_json::json!({}));
            stdin_frames::permission_allow(request_id, input)
        }
        PermissionDecision::Deny { reason } => stdin_frames::permission_deny(request_id, &reason),
    };
    let _ = write_frame(stdin, &frame).await;
}
