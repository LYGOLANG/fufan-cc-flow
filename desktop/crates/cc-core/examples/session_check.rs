//! M2 集成验证——直接调用 GUI 也在用的同一套 `spawn_session`/`AppEvent` 代码,
//! 不经过任何 UI 控件,验证 transport.rs 的类型化协议解析 + actor 状态机是否正确。
//!
//! 用法: cargo run -p cc-core --example session_check

use cc_core::{spawn_session, AppEvent, SpawnConfig};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;
    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();

    let cfg = SpawnConfig::default();
    let _handle = spawn_session(cwd, cfg, "1+1 equals what number? Reply with only the digit, nothing else.".to_string(), tx).await?;

    let mut saw_init = false;
    let mut saw_task_complete = false;
    let mut saw_process_close = false;
    let mut final_text = String::new();

    loop {
        match timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(ev)) => {
                println!(">> {ev:?}");
                match &ev {
                    AppEvent::SessionInit { .. } => saw_init = true,
                    AppEvent::AssistantTextDelta { text, .. } => final_text.push_str(text),
                    AppEvent::TaskComplete { result, .. } => {
                        saw_task_complete = true;
                        final_text = result.clone();
                    }
                    AppEvent::ProcessClose { .. } => {
                        saw_process_close = true;
                        break;
                    }
                    _ => {}
                }
            }
            Ok(None) => {
                println!("channel closed");
                break;
            }
            Err(_) => {
                println!("timeout waiting for next event");
                break;
            }
        }
    }

    println!(
        "\n=== summary: saw_init={saw_init} saw_task_complete={saw_task_complete} saw_process_close={saw_process_close} final_text={final_text:?} ==="
    );
    Ok(())
}
