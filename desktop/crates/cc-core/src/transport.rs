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
#[cfg(unix)]
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Condvar, Mutex};
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
    pid: Option<u32>,
    cleanup: Arc<(Mutex<bool>, Condvar)>,
}

impl SessionHandle {
    pub fn send_permission_response(&self, request_id: String, decision: PermissionDecision) {
        let _ = self.cmd_tx.send(Command::PermissionResponse {
            request_id,
            decision,
        });
    }

    pub fn interrupt(&self) {
        let _ = self.cmd_tx.send(Command::Interrupt);
    }

    pub fn shutdown(&self) {
        let _ = self.cmd_tx.send(Command::Shutdown);
    }

    /// 请求 actor 完成完整回收，并同步等待子进程已经退出。
    ///
    /// 只有 actor 完成 `Child::wait` 并设置共享 cleanup 标记才返回 `true`；
    /// command 通道断开本身不再被当作已回收证明。
    pub fn shutdown_and_wait(&self, wait_timeout: Duration) -> bool {
        let _ = self.cmd_tx.send(Command::Shutdown);
        if self.wait_for_cleanup(wait_timeout) {
            return true;
        }
        if let Some(pid) = self.pid {
            let _ = force_kill_process_tree(pid);
        }
        self.wait_for_cleanup(Duration::from_secs(1))
    }

    fn wait_for_cleanup(&self, wait_timeout: Duration) -> bool {
        let (lock, ready) = &*self.cleanup;
        let cleaned = lock.lock().unwrap();
        let (cleaned, _) = ready
            .wait_timeout_while(cleaned, wait_timeout, |cleaned| !*cleaned)
            .unwrap();
        *cleaned
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
    let child_pid = child.id();
    let stdin = child.stdin.take().context("child has no stdin")?;
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

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Command>();
    let initial = stdin_frames::initial_user_prompt(&prompt);
    let cleanup = Arc::new((Mutex::new(false), Condvar::new()));
    let actor_cleanup = cleanup.clone();

    tokio::spawn(async move {
        run_actor(
            child,
            stdin,
            stdout,
            initial,
            cmd_rx,
            events_tx,
            actor_cleanup,
        )
        .await;
    });

    Ok(SessionHandle {
        cmd_tx,
        pid: child_pid,
        cleanup,
    })
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
    initial_prompt: Value,
    mut cmd_rx: mpsc::UnboundedReceiver<Command>,
    events_tx: mpsc::UnboundedSender<AppEvent>,
    cleanup: Arc<(Mutex<bool>, Condvar)>,
) {
    let child_pid = child.id();
    let initial_write = timeout(
        Duration::from_secs(5),
        write_frame(&mut stdin, &initial_prompt),
    )
    .await;
    if !matches!(initial_write, Ok(Ok(()))) {
        let message = match initial_write {
            Ok(Err(error)) => format!("写入 Claude 初始消息失败: {error}"),
            Err(_) => "写入 Claude 初始消息超时".to_string(),
            Ok(Ok(())) => unreachable!(),
        };
        let _ = events_tx.send(AppEvent::Error {
            session_id: String::new(),
            code: "INITIAL_WRITE_FAILED".to_string(),
            message,
        });
        drop(stdin);
        let status = reap_child(&mut child, child_pid).await;
        mark_cleanup_complete(&cleanup);
        let _ = events_tx.send(AppEvent::ProcessClose {
            session_id: String::new(),
            code: status.and_then(|value| value.code()),
        });
        return;
    }

    let mut lines = BufReader::new(stdout).lines();
    let mut known_session_id = String::new();
    let mut seen_assistant_turn = false;
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
                            &mut seen_assistant_turn,
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
                    Some(Command::Shutdown) => {
                        break;
                    }
                    None => break,
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
    let status = reap_child(&mut child, child_pid).await;

    mark_cleanup_complete(&cleanup);
    let _ = events_tx.send(AppEvent::ProcessClose {
        session_id: known_session_id,
        code: status.and_then(|s| s.code()),
    });
}

fn mark_cleanup_complete(cleanup: &Arc<(Mutex<bool>, Condvar)>) {
    let (lock, ready) = &**cleanup;
    let mut cleaned = lock.lock().unwrap();
    *cleaned = true;
    ready.notify_all();
}

async fn reap_child(child: &mut Child, child_pid: Option<u32>) -> Option<std::process::ExitStatus> {
    // 每轮 Claude 进程结束时都必须清理整棵树。不能只在读到 Shutdown 时做：
    // select 可能与退出信号竞态，先读到 result/EOF，后台 Bash 仍需要被回收。
    if let Some(pid) = child_pid {
        let _ = force_kill_process_tree(pid);
    }
    let _ = child.start_kill();
    let status = match timeout(Duration::from_secs(2), child.wait()).await {
        Ok(Ok(status)) => Some(status),
        _ => {
            if let Some(pid) = child_pid {
                let _ = force_kill_process_tree(pid);
            }
            let _ = child.start_kill();
            child.wait().await.ok()
        }
    };
    status
}

#[cfg(unix)]
fn force_kill_process_tree(pid: u32) -> std::io::Result<()> {
    let root_pid = i32::try_from(pid)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "PID 超出 i32"))?;

    // Claude 的 Bash 工具会自行创建新进程组，单杀 Claude PGID 抓不到这类后代。
    // 先冻结根组，再反复快照 PPID 树并冻结新后代，直到没有新 PID，最后叶到根强杀。
    // SAFETY: PID 均来自当前 Child 及本机 `ps` 的 PPID 关系；SIGSTOP/SIGKILL
    // 只作用于这些进程，不读写 Rust 内存。
    unsafe {
        let _ = libc::kill(-root_pid, libc::SIGSTOP);
        let _ = libc::kill(root_pid, libc::SIGSTOP);
    }

    let mut known = HashSet::new();
    let mut descendants = Vec::new();
    for _ in 0..8 {
        let snapshot = unix_descendants_deepest_first(root_pid);
        let mut found_new = false;
        unsafe {
            for descendant in &snapshot {
                if known.insert(*descendant) {
                    found_new = true;
                }
                let _ = libc::kill(*descendant, libc::SIGSTOP);
            }
        }
        descendants = snapshot;
        if !found_new {
            break;
        }
    }
    let mut kill_seen = HashSet::new();
    let kill_order = descendants
        .into_iter()
        .chain(known)
        .filter(|descendant| kill_seen.insert(*descendant));
    unsafe {
        for descendant in kill_order {
            let _ = libc::kill(descendant, libc::SIGKILL);
        }
        let _ = libc::kill(-root_pid, libc::SIGKILL);
    }

    // 单独再杀一次根 PID，覆盖 setpgid 失败或目标已离开原进程组的异常情况。
    let result = unsafe { libc::kill(root_pid, libc::SIGKILL) };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error);
        }
    }
    Ok(())
}

#[cfg(unix)]
fn unix_descendants_deepest_first(root_pid: i32) -> Vec<i32> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid="])
        .output()
        .or_else(|_| {
            std::process::Command::new("ps")
                .args(["-axo", "pid=,ppid="])
                .output()
        });
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut columns = line.split_whitespace();
        let (Some(pid), Some(ppid)) = (columns.next(), columns.next()) else {
            continue;
        };
        let (Ok(pid), Ok(ppid)) = (pid.parse::<i32>(), ppid.parse::<i32>()) else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }

    fn visit(
        parent: i32,
        children: &HashMap<i32, Vec<i32>>,
        visited: &mut HashSet<i32>,
        result: &mut Vec<i32>,
    ) {
        if let Some(direct_children) = children.get(&parent) {
            for child in direct_children {
                if !visited.insert(*child) {
                    continue;
                }
                visit(*child, children, visited, result);
                result.push(*child);
            }
        }
    }

    let mut visited = HashSet::new();
    let mut result = Vec::new();
    visit(root_pid, &children, &mut visited, &mut result);
    result
}

#[cfg(target_os = "windows")]
fn force_kill_process_tree(pid: u32) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let pid = pid.to_string();
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!("taskkill 退出码: {status}")))
    }
}

/// 解析一行 stdout。返回 true 表示这一轮已经结束(收到 `result`),外层应回收进程。
fn handle_stdout_line(
    raw: &str,
    known_session_id: &mut String,
    seen_assistant_turn: &mut bool,
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
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } = block
                {
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
            let is_execution_error = res.is_error || res.subtype == "error_during_execution";
            if is_execution_error {
                let message = res
                    .result
                    .unwrap_or_else(|| format!("Claude 执行失败 ({})", res.subtype));
                let _ = events_tx.send(AppEvent::Error {
                    session_id: known_session_id.clone(),
                    code: "EXECUTION_ERROR".to_string(),
                    message,
                });
            } else {
                let _ = events_tx.send(AppEvent::TaskComplete {
                    session_id: known_session_id.clone(),
                    result: res.result.unwrap_or_default(),
                    cost_usd: res.total_cost_usd,
                    duration_ms: res.duration_ms,
                    num_turns: res.num_turns,
                    is_error: false,
                });
            }
            true
        }
        StdoutMessage::StreamEvent(ev) => {
            let event_type = ev.event.get("type").and_then(Value::as_str).unwrap_or("");
            match event_type {
                "message_start" => {
                    // 前端在发送时已经创建第一条 assistant 气泡；只有同一任务里的
                    // 第二个及后续 assistant message 才需要 new_turn。与 Node 基线一致。
                    if *seen_assistant_turn {
                        let _ = events_tx.send(AppEvent::NewTurn {
                            session_id: known_session_id.clone(),
                        });
                    } else {
                        *seen_assistant_turn = true;
                    }
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
                let _ = events_tx.send(AppEvent::PermissionCancelled {
                    request_id: c.request_id,
                });
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
            let input = updated_input
                .or(original_input)
                .unwrap_or_else(|| serde_json::json!({}));
            stdin_frames::permission_allow(request_id, input)
        }
        PermissionDecision::Deny { reason } => stdin_frames::permission_deny(request_id, &reason),
    };
    let _ = write_frame(stdin, &frame).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_message_start_reuses_existing_bubble_then_emits_new_turns() {
        let mut session_id = "session-1".to_string();
        let mut seen_assistant_turn = false;
        let mut pending_cancels = HashMap::new();
        let mut pending_inputs = HashMap::new();
        let (timeout_tx, _timeout_rx) = mpsc::unbounded_channel();
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let line =
            r#"{"type":"stream_event","event":{"type":"message_start"},"session_id":"session-1"}"#;

        assert!(!handle_stdout_line(
            line,
            &mut session_id,
            &mut seen_assistant_turn,
            &mut pending_cancels,
            &mut pending_inputs,
            &timeout_tx,
            &events_tx,
        ));
        assert!(seen_assistant_turn);
        assert!(events_rx.try_recv().is_err());

        assert!(!handle_stdout_line(
            line,
            &mut session_id,
            &mut seen_assistant_turn,
            &mut pending_cancels,
            &mut pending_inputs,
            &timeout_tx,
            &events_tx,
        ));
        assert!(matches!(
            events_rx.try_recv(),
            Ok(AppEvent::NewTurn { session_id }) if session_id == "session-1"
        ));
    }

    #[test]
    fn execution_error_result_is_not_reported_as_task_complete() {
        let mut session_id = "session-1".to_string();
        let mut seen_assistant_turn = false;
        let mut pending_cancels = HashMap::new();
        let mut pending_inputs = HashMap::new();
        let (timeout_tx, _timeout_rx) = mpsc::unbounded_channel();
        let (events_tx, mut events_rx) = mpsc::unbounded_channel();
        let line = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"authentication failed"}"#;

        assert!(handle_stdout_line(
            line,
            &mut session_id,
            &mut seen_assistant_turn,
            &mut pending_cancels,
            &mut pending_inputs,
            &timeout_tx,
            &events_tx,
        ));
        assert!(matches!(
            events_rx.try_recv(),
            Ok(AppEvent::Error { code, message, .. })
                if code == "EXECUTION_ERROR" && message == "authentication failed"
        ));
        assert!(events_rx.try_recv().is_err());
    }
}
