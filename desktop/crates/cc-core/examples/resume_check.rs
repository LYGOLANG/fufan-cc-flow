//! M5 集成验证——确认"续接同一个 session"是真的续接(同一个 JSONL 文件行数增长),
//! 而不是每次都新建一个 session 文件。
//!
//! 用法: cargo run -p cc-core --example resume_check

use cc_core::session::transcript::transcript_path;
use cc_core::{spawn_session, AppEvent, SpawnConfig};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

async fn run_turn(cwd: &std::path::Path, prompt: &str, resume: Option<String>) -> anyhow::Result<String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();
    let cfg = SpawnConfig { resume, ..Default::default() };
    let _handle = spawn_session(cwd.to_path_buf(), cfg, prompt.to_string(), tx).await?;

    let mut session_id = String::new();
    loop {
        match timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(AppEvent::SessionInit { session_id: sid, .. })) => session_id = sid,
            Ok(Some(AppEvent::ProcessClose { .. })) => break,
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    Ok(session_id)
}

fn line_count(path: &std::path::Path) -> usize {
    std::fs::read_to_string(path).map(|s| s.lines().filter(|l| !l.trim().is_empty()).count()).unwrap_or(0)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;

    let sid1 = run_turn(&cwd, "Reply with exactly the word one.", None).await?;
    let path1 = transcript_path(&cwd, &sid1);
    let count_after_turn1 = line_count(&path1);
    println!("turn1: session_id={sid1} lines={count_after_turn1}");

    let sid2 = run_turn(&cwd, "Reply with exactly the word two.", Some(sid1.clone())).await?;
    let count_after_turn2 = line_count(&path1);
    println!("turn2: session_id={sid2} lines_in_same_file={count_after_turn2}");

    let same_session = sid1 == sid2;
    let same_file_grew = count_after_turn2 > count_after_turn1;

    println!(
        "\n=== summary: same_session_id={same_session} same_file_grew={same_file_grew} (before={count_after_turn1} after={count_after_turn2}) ==="
    );
    Ok(())
}
