//! PTY 会话管理。portable-pty 的读写是阻塞 API,不能直接丢进 tokio 任务——
//! 输出读取和子进程等待各起一个专门的 OS 线程,通过回调把数据/退出码交给调用方
//! (调用方是 cc-app,会把回调接到 channel + repaint 上;cc-core 这一层不碰 GUI/tokio)。
//!
//! Windows shell 硬编码 `cmd.exe`(不是用户默认 shell),对齐现有 Node 版 ptyService.ts。

use std::io::{Read, Write};
use std::path::Path;

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

pub struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

impl PtyHandle {
    pub fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("pty resize failed")
    }
}

/// 起一个 shell。`on_output` 在专门的读线程上被反复调用(每次一块字节);
/// `on_exit` 在子进程退出时调用一次,拿到退出码。
pub fn spawn_shell(
    cwd: &Path,
    cols: u16,
    rows: u16,
    on_output: impl Fn(Vec<u8>) + Send + 'static,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> Result<PtyHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .context("openpty failed")?;

    let mut cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string()))
    };
    cmd.cwd(cwd);

    let mut child = pair.slave.spawn_command(cmd).context("spawn shell failed")?;
    // slave 端在子进程接手后就不需要了,不 drop 的话某些平台上 master 读端会一直阻塞等不到 EOF。
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().context("clone pty reader failed")?;
    let writer = pair.master.take_writer().context("take pty writer failed")?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => on_output(buf[..n].to_vec()),
                Err(_) => break,
            }
        }
    });

    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        on_exit(code);
    });

    Ok(PtyHandle { writer, master: pair.master })
}
