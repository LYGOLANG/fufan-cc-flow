//! M4 集成验证——用默认 permission_mode(会真的触发 can_use_tool 确认),
//! 收到 PermissionRequest 后调用 `SessionHandle::send_permission_response(..., Allow)`,
//! 跟 GUI 里点"允许"按钮走的是同一个方法,验证这条路径能让工具调用真正执行下去
//! (而不是超时 60s 自动拒绝)。
//!
//! 用法: cargo run -p cc-core --example permission_check

use cc_core::{spawn_session, AppEvent, PermissionDecision, SpawnConfig};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;
    let scratch = cwd.join("permission_check_scratch.txt");
    let _ = std::fs::remove_file(&scratch);

    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();
    let cfg = SpawnConfig::default(); // permission_mode 保持默认("default"),真的会问权限
    let prompt = format!(
        "Use the Write tool to create a file at {} containing the text permission-check-ok, then reply with exactly the word done.",
        scratch.display()
    );
    let handle = spawn_session(cwd, cfg, prompt, tx).await?;

    let mut allowed_count = 0u32;
    let mut tool_use_result = false;
    let mut task_complete = false;
    let mut process_close = false;

    loop {
        match timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(ev)) => {
                match &ev {
                    AppEvent::PermissionRequest { request_id, tool_name, tool_input, .. } => {
                        println!(">> PermissionRequest tool={tool_name} input={tool_input} -> 模拟点击「允许」");
                        handle.send_permission_response(
                            request_id.clone(),
                            PermissionDecision::Allow { updated_input: Some(tool_input.clone()) },
                        );
                        allowed_count += 1;
                    }
                    AppEvent::ToolUseResult { result, is_error, .. } => {
                        tool_use_result = true;
                        println!(">> ToolUseResult error={is_error} {result}");
                    }
                    AppEvent::PermissionTimedOut { request_id } => {
                        println!(">> !!! PermissionTimedOut {request_id} (不应该发生,说明 Allow 没生效)");
                    }
                    AppEvent::TaskComplete { .. } => {
                        task_complete = true;
                        println!(">> TaskComplete");
                    }
                    AppEvent::ProcessClose { code, .. } => {
                        process_close = true;
                        println!(">> ProcessClose code={code:?}");
                        break;
                    }
                    other => println!(">> {other:?}"),
                }
            }
            Ok(None) => break,
            Err(_) => {
                println!("timeout waiting for next event");
                break;
            }
        }
    }

    let file_written = std::fs::read_to_string(&scratch).map(|s| s.contains("permission-check-ok")).unwrap_or(false);
    let _ = std::fs::remove_file(&scratch);

    println!(
        "\n=== summary: allowed_count={allowed_count} tool_use_result={tool_use_result} task_complete={task_complete} process_close={process_close} file_written={file_written} ==="
    );
    anyhow::ensure!(allowed_count > 0, "未收到 PermissionRequest");
    anyhow::ensure!(tool_use_result, "允许后未收到 ToolUseResult");
    anyhow::ensure!(task_complete, "允许后未收到 TaskComplete");
    anyhow::ensure!(process_close, "权限会话未收到 ProcessClose");
    anyhow::ensure!(file_written, "允许后目标文件未写入预期内容");
    Ok(())
}
