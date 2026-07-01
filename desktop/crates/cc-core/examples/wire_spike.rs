//! M0 协议 spike —— 在写任何 GUI 代码之前,人工验证对 `claude` CLI
//! stream-json 协议的理解是否正确:
//!   1. 初始 prompt 的 stdin 帧格式是否真的能让 CLI 产生回应
//!   2. control 握手 与 `system`/`init` 首帧的先后顺序
//!   3. HIL 的 control_request(can_use_tool) / control_response 握手能否真正放行工具调用
//!   4. 优雅回收(关 stdin)是否符合预期
//!
//! 用法: cargo run -p cc-core --example wire_spike

use anyhow::{Context, Result};
use cc_core::cli::build_claude_command;
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, Duration};

#[tokio::main]
async fn main() -> Result<()> {
    let cwd = std::env::current_dir()?;
    println!("[spike] cwd = {}", cwd.display());

    let bin = cc_core::cli::resolve_claude_bin();
    println!("[spike] resolved claude bin = {:?}", bin);

    let args: Vec<String> = vec![
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--include-partial-messages".into(),
        "--permission-prompt-tool".into(),
        "stdio".into(),
        // 必须显式传,否则会继承本机全局 settings 里的 permissionMode(这台机器上是 "auto",
        // 完全不会触发 can_use_tool 确认)。Node 版 claudeAgentService.ts 的默认值同样是 "default"。
        "--permission-mode".into(),
        "default".into(),
    ];

    let mut cmd = build_claude_command(&args)?;
    cmd.current_dir(&cwd);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    println!("[spike] spawning claude with args: {args:?}");
    let mut child = cmd.spawn().context("spawn claude failed")?;
    let mut stdin = child.stdin.take().context("no stdin")?;
    let stdout = child.stdout.take().context("no stdout")?;
    let stderr = child.stderr.take().context("no stderr")?;

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[spike][stderr] {line}");
        }
    });

    // 关键验证点 1: 初始 prompt 的 stdin 帧格式
    let prompt_frame = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "text",
                "text": "Use the Write tool to create a new file at C:\\Users\\Administrator\\AppData\\Local\\Temp\\claude\\wire_spike_test.txt containing the text hello-from-rust-spike, then reply with exactly the word done."
            }]
        }
    });
    let line = serde_json::to_string(&prompt_frame)? + "\n";
    println!("[spike] >> stdin: {}", line.trim());
    stdin.write_all(line.as_bytes()).await?;
    stdin.flush().await?;

    let mut lines = BufReader::new(stdout).lines();
    let per_line_deadline = Duration::from_secs(120);
    let mut saw_init = false;
    let mut saw_permission_roundtrip = false;

    loop {
        let next = timeout(per_line_deadline, lines.next_line()).await;
        let raw = match next {
            Ok(Ok(Some(l))) => l,
            Ok(Ok(None)) => {
                println!("[spike] << stdout EOF");
                break;
            }
            Ok(Err(e)) => {
                println!("[spike] << stdout read error: {e}");
                break;
            }
            Err(_) => {
                println!("[spike] << timeout waiting for next stdout line, aborting");
                break;
            }
        };
        println!("[spike] << {raw}");

        let parsed: Result<Value, _> = serde_json::from_str(&raw);
        let Ok(v) = parsed else {
            println!("[spike]    (non-JSON line, skipped per spec)");
            continue;
        };

        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // 关键验证点 2: system/init 首帧
        if ty == "system" && v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
            saw_init = true;
            println!(
                "[spike]    *** system/init: session_id={:?} model={:?} saw_init_before_any_control_request={}",
                v.get("session_id"),
                v.get("model"),
                !saw_permission_roundtrip
            );
        }

        // 关键验证点 3: HIL control_request/control_response 握手
        if ty == "control_request" {
            let request_id = v.get("request_id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
            let subtype = v.pointer("/request/subtype").and_then(|x| x.as_str()).unwrap_or_default();
            println!("[spike]    *** control_request subtype={subtype} request_id={request_id}");

            if subtype == "can_use_tool" {
                let tool_name = v.pointer("/request/tool_name").and_then(|x| x.as_str()).unwrap_or_default();
                // 关键坑:"allow" 分支的 updatedInput 是必填 record,不能省略(否则 CLI 侧 Zod
                // 校验直接报 invalid_union 并把这次工具调用判为失败)。必须把原始 input 原样回填。
                let original_input = v.pointer("/request/input").cloned().unwrap_or_else(|| json!({}));
                println!("[spike]    *** permission request for tool `{tool_name}` -> auto ALLOW (spike policy)");
                let response = json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request_id,
                        "response": { "behavior": "allow", "updatedInput": original_input }
                    }
                });
                let resp_line = serde_json::to_string(&response)? + "\n";
                println!("[spike]    >> stdin (control_response): {}", resp_line.trim());
                stdin.write_all(resp_line.as_bytes()).await?;
                stdin.flush().await?;
                saw_permission_roundtrip = true;
            }
        }

        if ty == "result" {
            println!(
                "[spike] === result received. saw_init={saw_init} saw_permission_roundtrip={saw_permission_roundtrip} ==="
            );
            break;
        }
    }

    // 关键验证点 4: 优雅回收 —— 关 stdin(EOF),等一会儿,超时则强杀
    println!("[spike] closing stdin, waiting up to 5s for graceful exit...");
    drop(stdin);
    match timeout(Duration::from_secs(5), child.wait()).await {
        Ok(Ok(status)) => println!("[spike] child exited gracefully: {status:?}"),
        _ => {
            println!("[spike] child did not exit after stdin close, killing");
            let _ = child.kill().await;
        }
    }

    Ok(())
}
