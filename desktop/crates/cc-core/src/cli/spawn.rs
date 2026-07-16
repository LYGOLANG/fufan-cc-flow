//! 构造可直接 `.spawn()` 的 claude 子进程命令。
//!
//! 若解析到的可执行文件是 `.cmd`/`.bat`(常见于 Windows npm 全局安装的 shim),
//! 必须通过 `cmd.exe /d /s /c <path> <args...>` 调用 —— 参数按数组传递、
//! 不经 shell 解析,直接 spawn 一个 .cmd 会被 Rust 拒绝(不是可执行的 PE)。

use anyhow::{bail, Context, Result};
use std::path::Path;
use tokio::process::Command;

use super::resolve::resolve_claude_bin;

fn is_cmd_shim(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()),
        Some(ref ext) if ext == "cmd" || ext == "bat"
    )
}

/// 解析并构造 claude 命令(未 spawn)。调用方可继续配置 stdin/stdout/stderr 再 spawn。
pub fn build_claude_command(args: &[String]) -> Result<Command> {
    let bin = resolve_claude_bin()
        .context("未找到 claude 可执行文件;可设置环境变量 CLAUDE_BIN 指向 claude 可执行文件")?;

    if !bin.exists() {
        bail!("解析到的路径不存在: {}", bin.display());
    }

    let mut cmd = if cfg!(target_os = "windows") && is_cmd_shim(&bin) {
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut c = Command::new(comspec);
        c.arg("/d").arg("/s").arg("/c").arg(&bin);
        c.args(args);
        c
    } else {
        let mut c = Command::new(&bin);
        c.args(args);
        c
    };

    // 不给这个子进程分配新控制台——不然桌面壳(无控制台的 GUI 程序)每次发消息
    // spawn 一个 claude/cmd 子进程,都会弹一个黑框窗口。
    // tokio::process::Command 在 Windows 上原生就有 creation_flags(),不需要额外 import CommandExt。
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    // 独立进程组让退出兜底能终止 Claude 以及它启动的 Bash/工具后代，
    // 而不是只杀直接 Child 后把 `sleep` 等工具进程留给系统。
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    // Tauri 退出会直接丢弃 Tokio runtime；此时必须同步终止仍由 actor 持有的 Claude，
    // 否则仅发送异步 Shutdown 信号来不及回收，会留下脱离桌面壳的孤儿进程。
    cmd.kill_on_drop(true);
    Ok(cmd)
}
