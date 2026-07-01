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
    let bin = resolve_claude_bin().context(
        "未找到 claude 可执行文件;可设置环境变量 CLAUDE_BIN 指向 claude 可执行文件",
    )?;

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

    cmd.kill_on_drop(false);
    Ok(cmd)
}
