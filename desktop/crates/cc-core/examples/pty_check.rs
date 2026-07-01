//! M6 风险验证——这版 portable-pty(0.9.0)在 Windows 上只有 ConPTY 一条路
//! (源码里已经没有 winpty 模块了),而 Node 版 node-pty 当年是因为 ConPTY 在
//! shell 初始化阶段偶发 STATUS_CONTROL_C_EXIT 才特意关掉它的。这里先跑一次
//! 真实的 cmd.exe spawn + 输入输出往返,看这个崩溃在 portable-pty 上会不会重现。
//!
//! 用法: cargo run -p cc-core --example pty_check

use cc_core::pty::spawn_shell;
use std::sync::mpsc;
use std::time::Duration;

fn main() -> anyhow::Result<()> {
    let cwd = std::env::current_dir()?;
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    let (exit_tx, exit_rx) = mpsc::channel::<Option<i32>>();

    let mut pty = spawn_shell(
        &cwd,
        80,
        24,
        move |bytes| {
            let _ = out_tx.send(bytes);
        },
        move |code| {
            println!("\n>> shell exited: {code:?}");
            let _ = exit_tx.send(code);
        },
    )?;

    std::thread::sleep(Duration::from_millis(800));
    pty.write(b"echo hello-from-pty-check\r\n")?;
    std::thread::sleep(Duration::from_millis(800));
    pty.write(b"exit\r\n")?;

    let mut all_output = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        while let Ok(bytes) = out_rx.try_recv() {
            // 验证假设:ConPTY 会发 DSR(光标位置查询)`\x1b[6n`,如果没人回复
            // `\x1b[row;colR` 它会一直卡着不往下走。
            if bytes.windows(4).any(|w| w == b"\x1b[6n") {
                println!(">> saw DSR query (\\x1b[6n), replying with a fixed position");
                pty.write(b"\x1b[1;1R")?;
            }
            all_output.extend_from_slice(&bytes);
        }
        if exit_rx.try_recv().is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // 再排空一轮,防止 exit 事件和最后一批输出之间有竞态漏掉数据。
    while let Ok(bytes) = out_rx.try_recv() {
        all_output.extend_from_slice(&bytes);
    }

    let text = String::from_utf8_lossy(&all_output);
    println!("=== raw pty output ===\n{text}\n=== end ===");

    let saw_echo = text.contains("hello-from-pty-check");
    println!("\n=== summary: saw_echo_output={saw_echo} output_len={} ===", all_output.len());
    Ok(())
}
