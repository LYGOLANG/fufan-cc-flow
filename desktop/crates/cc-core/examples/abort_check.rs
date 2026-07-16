//! Phase 3 取消链路实机验证：等 Bash 真正创建 `sleep` 后执行 interrupt +
//! acknowledged shutdown，必须收到 ProcessClose，且真实后代 PID 必须消失。
//!
//! 用法：cargo run -p cc-core --example abort_check

use cc_core::{spawn_session, AppEvent, SpawnConfig};
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration, Instant};

struct ScratchMarker(std::path::PathBuf);

impl Drop for ScratchMarker {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;
    let marker = ScratchMarker(
        std::env::temp_dir().join(format!("cc-core-abort-check-{}.ready", std::process::id())),
    );
    let _ = std::fs::remove_file(&marker.0);
    let marker_path = marker.0.to_string_lossy();
    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();
    let handle = spawn_session(
        cwd,
        SpawnConfig {
            permission_mode: Some("bypassPermissions".to_string()),
            ..Default::default()
        },
        format!(
            "Call the Bash tool once with command exactly `echo $$ > '{}'; exec sleep 30` and run_in_background set to true. Then reply with done.",
            marker_path
        ),
        tx,
    )
    .await?;

    let tool_started = timeout(Duration::from_secs(20), async {
        while let Some(event) = rx.recv().await {
            if let AppEvent::ToolUseStart {
                tool_name,
                tool_input,
                ..
            } = event
            {
                println!(">> ToolUseStart {tool_name} input={tool_input}");
                if tool_name == "Bash" {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    if !tool_started {
        let _ = acknowledged_shutdown(&handle).await;
        anyhow::bail!("20 秒内未观察到 Bash 工具调用");
    }

    let sleep_pid = match wait_for_sleep_pid(&marker.0, &mut rx, Duration::from_secs(10)).await {
        Ok(pid) => pid,
        Err(error) => {
            let _ = acknowledged_shutdown(&handle).await;
            return Err(error);
        }
    };
    if !process_exists(sleep_pid) {
        let _ = acknowledged_shutdown(&handle).await;
        anyhow::bail!("marker 中的 sleep PID {sleep_pid} 在取消前并不存在");
    }
    println!(">> sleep process ready pid={sleep_pid}");

    handle.interrupt();
    let acknowledged = acknowledged_shutdown(&handle).await?;

    let closed = timeout(Duration::from_secs(10), async {
        while let Some(event) = rx.recv().await {
            if let AppEvent::ProcessClose { code, .. } = event {
                println!(">> ProcessClose code={code:?}");
                return true;
            }
        }
        false
    })
    .await
    .unwrap_or(false);

    anyhow::ensure!(acknowledged, "abort + shutdown 未在 4 秒内确认子进程回收");
    anyhow::ensure!(closed, "abort + shutdown 后 10 秒内未收到 ProcessClose");
    anyhow::ensure!(
        wait_for_process_exit(sleep_pid, Duration::from_secs(2)).await,
        "abort 完成后 sleep 子进程 {sleep_pid} 仍然存活"
    );
    println!("=== summary: acknowledged=true process_close=true descendant_reaped=true ===");
    Ok(())
}

async fn acknowledged_shutdown(handle: &cc_core::SessionHandle) -> anyhow::Result<bool> {
    let cleanup_handle = handle.clone();
    Ok(tokio::task::spawn_blocking(move || {
        cleanup_handle.shutdown_and_wait(Duration::from_secs(4))
    })
    .await?)
}

async fn wait_for_sleep_pid(
    path: &std::path::Path,
    events: &mut mpsc::UnboundedReceiver<AppEvent>,
    wait_timeout: Duration,
) -> anyhow::Result<u32> {
    let deadline = Instant::now() + wait_timeout;
    while Instant::now() < deadline {
        if let Ok(value) = std::fs::read_to_string(path) {
            if let Ok(pid) = value.trim().parse::<u32>() {
                return Ok(pid);
            }
        }
        while let Ok(event) = events.try_recv() {
            match event {
                AppEvent::ToolUseResult {
                    result, is_error, ..
                } => {
                    println!(">> ToolUseResult error={is_error} result={result}");
                    if is_error {
                        anyhow::bail!("Bash 工具在创建 PID marker 前失败: {result}");
                    }
                }
                AppEvent::ProcessStderr { text, .. } => {
                    println!(">> ProcessStderr {text}");
                }
                AppEvent::Error { code, message, .. } => {
                    anyhow::bail!("等待 PID marker 时收到 {code}: {message}");
                }
                AppEvent::ProcessClose { code, .. } => {
                    anyhow::bail!("等待 PID marker 时 Claude 已退出: {code:?}");
                }
                _ => {}
            }
        }
        sleep(Duration::from_millis(20)).await;
    }
    anyhow::bail!("10 秒内未拿到真实 sleep PID marker")
}

async fn wait_for_process_exit(pid: u32, wait_timeout: Duration) -> bool {
    let deadline = Instant::now() + wait_timeout;
    while Instant::now() < deadline {
        if !process_exists(pid) {
            return true;
        }
        sleep(Duration::from_millis(20)).await;
    }
    !process_exists(pid)
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only probes existence/permission and does not modify the process.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(target_os = "windows")]
fn process_exists(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let filter = format!("PID eq {pid}");
    std::process::Command::new("tasklist")
        .args(["/FI", &filter, "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
}
