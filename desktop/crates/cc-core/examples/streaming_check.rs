//! M3 集成验证——确认:
//!   1. assistant 文本是真正的 token 级增量(多条小 AssistantTextDelta,不是一条大文本)
//!   2. 工具调用的 ToolUseStart -> ToolUseResult 事件能正确配对(用 bypassPermissions
//!      跳过还没做的 M4 HIL UI,只验证 transport 这条通路本身)
//!
//! 用法: cargo run -p cc-core --example streaming_check

use cc_core::{spawn_session, AppEvent, SpawnConfig};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;
    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();

    let cfg = SpawnConfig {
        permission_mode: Some("bypassPermissions".to_string()),
        ..Default::default()
    };
    let _handle = spawn_session(
        cwd,
        cfg,
        "Run `echo streaming-check-ok` with the Bash tool, then write a 3-line poem about rust programming.".to_string(),
        tx,
    )
    .await?;

    let mut text_delta_count = 0u32;
    let mut tool_use_start = false;
    let mut tool_use_result = false;
    let mut task_complete = false;
    let mut process_close = false;

    loop {
        match timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(ev)) => {
                match &ev {
                    AppEvent::AssistantTextDelta { text, .. } => {
                        text_delta_count += 1;
                        print!("{text}");
                    }
                    AppEvent::ToolUseStart { tool_name, tool_input, .. } => {
                        tool_use_start = true;
                        println!("\n>> ToolUseStart {tool_name} {tool_input}");
                    }
                    AppEvent::ToolUseResult { result, is_error, .. } => {
                        tool_use_result = true;
                        println!(">> ToolUseResult error={is_error} {result}");
                    }
                    AppEvent::TaskComplete { .. } => {
                        task_complete = true;
                        println!("\n>> TaskComplete");
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

    println!(
        "\n=== summary: text_delta_count={text_delta_count} tool_use_start={tool_use_start} tool_use_result={tool_use_result} task_complete={task_complete} process_close={process_close} ==="
    );
    anyhow::ensure!(text_delta_count > 1, "未收到真正的多段文本流");
    anyhow::ensure!(tool_use_start, "未收到 ToolUseStart");
    anyhow::ensure!(tool_use_result, "未收到 ToolUseResult");
    anyhow::ensure!(task_complete, "未收到 TaskComplete");
    anyhow::ensure!(process_close, "未收到 ProcessClose");
    Ok(())
}
