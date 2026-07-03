use std::path::Path;
use std::sync::mpsc;

use cc_core::pty::{spawn_shell, PtyHandle};

use crate::terminal_grid::TerminalGrid;

pub struct TerminalPanelState {
    pub grid: TerminalGrid,
    parser: vte::Parser,
    pty: Option<PtyHandle>,
    output_rx: mpsc::Receiver<Vec<u8>>,
    exit_rx: mpsc::Receiver<Option<i32>>,
    pub exit_code: Option<Option<i32>>,
}

impl TerminalPanelState {
    pub fn spawn(cwd: &Path, cols: u16, rows: u16, ctx: egui::Context) -> anyhow::Result<Self> {
        let (out_tx, output_rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<i32>>();

        let ctx_for_output = ctx.clone();
        let ctx_for_exit = ctx;
        let pty = spawn_shell(
            cwd,
            cols,
            rows,
            move |bytes| {
                let _ = out_tx.send(bytes);
                ctx_for_output.request_repaint();
            },
            move |code| {
                let _ = exit_tx.send(code);
                ctx_for_exit.request_repaint();
            },
        )?;

        Ok(Self {
            grid: TerminalGrid::new(cols as usize, rows as usize),
            parser: vte::Parser::new(),
            pty: Some(pty),
            output_rx,
            exit_rx,
            exit_code: None,
        })
    }

    /// 排空 pty 输出 -> 喂给 vte -> 更新网格。在 `logic()` 里每帧调一次。
    pub fn drain(&mut self) {
        while let Ok(bytes) = self.output_rx.try_recv() {
            self.grid.feed(&mut self.parser, &bytes);
        }
        // 光标位置查询(DSR)之类的回复必须写回 pty,否则 ConPTY 托管的 shell 会卡死等待。
        if !self.grid.pending_replies.is_empty() {
            let replies = std::mem::take(&mut self.grid.pending_replies);
            for reply in replies {
                self.write_input(&reply);
            }
        }
        while let Ok(code) = self.exit_rx.try_recv() {
            self.exit_code = Some(code);
        }
    }

    pub fn write_input(&mut self, bytes: &[u8]) {
        if let Some(pty) = &mut self.pty {
            let _ = pty.write(bytes);
        }
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.grid.resize(cols as usize, rows as usize);
        if let Some(pty) = &self.pty {
            let _ = pty.resize(cols, rows);
        }
    }
}
