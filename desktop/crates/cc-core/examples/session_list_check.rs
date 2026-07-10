//! M5 集成验证——用这台机器上真实存在的 `~/.claude` 数据(前面 M0-M4 的测试全在
//! `desktop/` 这个项目目录下跑,已经积累了好几个真实 session),验证:
//!   1. path_to_hash + 目录扫描能找到这些 session
//!   2. sessions-index.json 的标题/时间戳读取正常
//!   3. load_transcript 能把 JSONL 还原成可渲染的 ChatEntry(文本/工具调用/工具结果都对得上)
//!
//! 用法: cargo run -p cc-core --example session_list_check

use cc_core::chat_model::ChatEntry;
use cc_core::session::{list_sessions, load_transcript};
use cc_core::session::paths::path_to_hash;
use cc_core::session::transcript::transcript_path;

fn main() {
    let cwd = std::env::current_dir().expect("cwd");
    println!("project path: {}", cwd.display());
    println!("path_to_hash: {}", path_to_hash(&cwd));

    let sessions = list_sessions(&cwd);
    println!("found {} sessions\n", sessions.len());

    for s in sessions.iter().take(5) {
        println!(
            "- id={} name={:?} model={:?} msgs={} updated_at={:?}",
            s.id, s.name, s.model, s.message_count, s.updated_at
        );
    }

    let Some(first) = sessions.first() else {
        println!("\n(no sessions found, skip transcript check)");
        return;
    };

    let path = transcript_path(&cwd, &first.id);
    let entries = load_transcript(&path);
    println!("\n=== transcript for {} ({} entries) ===", first.id, entries.len());
    for e in entries.iter().take(20) {
        match e {
            ChatEntry::UserText(t) => println!("[user] {}", truncate(t)),
            ChatEntry::SystemNote(t) => println!("[note] {}", truncate(t)),
            ChatEntry::AssistantTurn(turn) => {
                if !turn.text.is_empty() {
                    println!("[assistant] {}", truncate(&turn.text));
                }
                for call in &turn.tool_calls {
                    println!(
                        "  [tool] {} input={} result={:?}",
                        call.name,
                        truncate(&call.input.to_string()),
                        call.result.as_deref().map(truncate)
                    );
                }
            }
        }
    }

    println!(
        "\n=== summary: sessions_found={} first_session_entries={} ===",
        sessions.len(),
        entries.len()
    );
}

fn truncate(s: &str) -> String {
    let t: String = s.chars().take(80).collect();
    if s.chars().count() > 80 {
        format!("{t}…")
    } else {
        t
    }
}
