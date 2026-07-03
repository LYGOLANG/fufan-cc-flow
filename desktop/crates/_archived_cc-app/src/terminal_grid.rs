//! 极简终端仿真:vte 解析字节流,喂进一个固定尺寸的字符网格。
//! 不追求 xterm 级别的完整功能(没有回滚缓冲区、没有真彩色/256 色调色板之外的样式),
//! 但光标定位/移动、擦除、基础 8/16 色 SGR 都实现了——这些是 TUI 程序(比如全屏编辑器、
//! 进度条)画对位置所必需的,是"能不能用"和"完全还原 xterm"之间的分界线。

use egui::Color32;

#[derive(Clone, Copy, Default, PartialEq)]
pub struct Cell {
    pub ch: char,
    pub fg: Option<Color32>,
    pub bold: bool,
}

pub struct TerminalGrid {
    pub cols: usize,
    pub rows: usize,
    cells: Vec<Cell>,
    pub cursor_row: usize,
    pub cursor_col: usize,
    cur_fg: Option<Color32>,
    cur_bold: bool,
    /// ConPTY 托管的 cmd.exe 初始化时会发 DSR(`\x1b[6n`)查询光标位置,
    /// 卡住等回复才会继续往下走(实测验证过,不响应的话进程直接卡死,不是崩溃)。
    /// vte::Perform 的方法不能直接拿到 pty 写端,所以查询产生的回复先攒在这里,
    /// 由 `TerminalPanelState::drain()` 在 feed() 之后取走写回 pty。
    pub pending_replies: Vec<Vec<u8>>,
}

impl TerminalGrid {
    pub fn new(cols: usize, rows: usize) -> Self {
        Self {
            cols: cols.max(1),
            rows: rows.max(1),
            cells: vec![Cell::default(); cols.max(1) * rows.max(1)],
            cursor_row: 0,
            cursor_col: 0,
            cur_fg: None,
            cur_bold: false,
            pending_replies: Vec::new(),
        }
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        let (cols, rows) = (cols.max(1), rows.max(1));
        if cols == self.cols && rows == self.rows {
            return;
        }
        let mut new_cells = vec![Cell::default(); cols * rows];
        for r in 0..self.rows.min(rows) {
            for c in 0..self.cols.min(cols) {
                new_cells[r * cols + c] = self.cells[r * self.cols + c];
            }
        }
        self.cols = cols;
        self.rows = rows;
        self.cells = new_cells;
        self.cursor_row = self.cursor_row.min(rows - 1);
        self.cursor_col = self.cursor_col.min(cols - 1);
    }

    pub fn cell(&self, row: usize, col: usize) -> Cell {
        self.cells[row * self.cols + col]
    }

    fn cell_mut(&mut self, row: usize, col: usize) -> &mut Cell {
        &mut self.cells[row * self.cols + col]
    }

    fn carriage_return(&mut self) {
        self.cursor_col = 0;
    }

    fn line_feed(&mut self) {
        if self.cursor_row + 1 >= self.rows {
            self.scroll_up(1);
        } else {
            self.cursor_row += 1;
        }
    }

    fn scroll_up(&mut self, n: usize) {
        let n = n.min(self.rows);
        self.cells.drain(0..n * self.cols);
        self.cells.resize(self.cols * self.rows, Cell::default());
    }

    fn erase_line(&mut self, mode: u16) {
        let row = self.cursor_row;
        let (start, end) = match mode {
            0 => (self.cursor_col, self.cols),
            1 => (0, self.cursor_col + 1),
            2 => (0, self.cols),
            _ => (0, 0),
        };
        for c in start..end.min(self.cols) {
            *self.cell_mut(row, c) = Cell::default();
        }
    }

    fn erase_display(&mut self, mode: u16) {
        match mode {
            0 => {
                self.erase_line(0);
                for r in (self.cursor_row + 1)..self.rows {
                    for c in 0..self.cols {
                        *self.cell_mut(r, c) = Cell::default();
                    }
                }
            }
            1 => {
                self.erase_line(1);
                for r in 0..self.cursor_row {
                    for c in 0..self.cols {
                        *self.cell_mut(r, c) = Cell::default();
                    }
                }
            }
            2 | 3 => {
                self.cells.fill(Cell::default());
            }
            _ => {}
        }
    }

    fn apply_sgr(&mut self, params: &[u16]) {
        if params.is_empty() {
            self.cur_fg = None;
            self.cur_bold = false;
            return;
        }
        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => {
                    self.cur_fg = None;
                    self.cur_bold = false;
                }
                1 => self.cur_bold = true,
                22 => self.cur_bold = false,
                n @ 30..=37 => self.cur_fg = Some(ansi_color((n - 30) as u8, self.cur_bold)),
                38 => {
                    // 38;5;N (256 色) 或 38;2;r;g;b(真彩色);不认识的形式直接跳过。
                    if params.get(i + 1) == Some(&5) {
                        if let Some(&idx) = params.get(i + 2) {
                            self.cur_fg = Some(palette_256(idx as u8));
                        }
                        i += 2;
                    } else if params.get(i + 1) == Some(&2) {
                        if let (Some(&r), Some(&g), Some(&b)) =
                            (params.get(i + 2), params.get(i + 3), params.get(i + 4))
                        {
                            self.cur_fg = Some(Color32::from_rgb(r as u8, g as u8, b as u8));
                        }
                        i += 4;
                    }
                }
                39 => self.cur_fg = None,
                n @ 90..=97 => self.cur_fg = Some(ansi_color((n - 90) as u8, true)),
                _ => {}
            }
            i += 1;
        }
    }

    pub fn feed(&mut self, parser: &mut vte::Parser, bytes: &[u8]) {
        parser.advance(self, bytes);
    }
}

impl vte::Perform for TerminalGrid {
    fn print(&mut self, c: char) {
        if self.cursor_col >= self.cols {
            self.carriage_return();
            self.line_feed();
        }
        let (row, col) = (self.cursor_row, self.cursor_col);
        let (fg, bold) = (self.cur_fg, self.cur_bold);
        let cell = self.cell_mut(row, col);
        cell.ch = c;
        cell.fg = fg;
        cell.bold = bold;
        self.cursor_col += 1;
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\r' => self.carriage_return(),
            b'\n' => self.line_feed(),
            0x08 => {
                if self.cursor_col > 0 {
                    self.cursor_col -= 1;
                }
            }
            b'\t' => {
                let next_stop = ((self.cursor_col / 8) + 1) * 8;
                self.cursor_col = next_stop.min(self.cols.saturating_sub(1));
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &vte::Params, _intermediates: &[u8], _ignore: bool, action: char) {
        let nums: Vec<u16> = params.iter().map(|group| group.first().copied().unwrap_or(0)).collect();
        let n1 = || nums.first().copied().unwrap_or(1).max(1) as usize;

        match action {
            'A' => self.cursor_row = self.cursor_row.saturating_sub(n1()),
            'B' => self.cursor_row = (self.cursor_row + n1()).min(self.rows - 1),
            'C' => self.cursor_col = (self.cursor_col + n1()).min(self.cols - 1),
            'D' => self.cursor_col = self.cursor_col.saturating_sub(n1()),
            'H' | 'f' => {
                let row = nums.first().copied().unwrap_or(1).max(1) as usize;
                let col = nums.get(1).copied().unwrap_or(1).max(1) as usize;
                self.cursor_row = (row - 1).min(self.rows - 1);
                self.cursor_col = (col - 1).min(self.cols - 1);
            }
            'J' => self.erase_display(nums.first().copied().unwrap_or(0)),
            'K' => self.erase_line(nums.first().copied().unwrap_or(0)),
            'm' => self.apply_sgr(&nums),
            'n' if nums.first().copied().unwrap_or(0) == 6 => {
                let reply = format!("\x1b[{};{}R", self.cursor_row + 1, self.cursor_col + 1);
                self.pending_replies.push(reply.into_bytes());
            }
            _ => {}
        }
    }
}

fn ansi_color(n: u8, bright: bool) -> Color32 {
    match (n, bright) {
        (0, false) => Color32::from_rgb(0x00, 0x00, 0x00),
        (1, false) => Color32::from_rgb(0xcd, 0x31, 0x31),
        (2, false) => Color32::from_rgb(0x0d, 0xbc, 0x79),
        (3, false) => Color32::from_rgb(0xe5, 0xe5, 0x10),
        (4, false) => Color32::from_rgb(0x24, 0x72, 0xc8),
        (5, false) => Color32::from_rgb(0xbc, 0x3f, 0xbc),
        (6, false) => Color32::from_rgb(0x11, 0xa8, 0xcd),
        (7, false) => Color32::from_rgb(0xe5, 0xe5, 0xe5),
        (0, true) => Color32::from_rgb(0x66, 0x66, 0x66),
        (1, true) => Color32::from_rgb(0xf1, 0x4c, 0x4c),
        (2, true) => Color32::from_rgb(0x23, 0xd1, 0x8b),
        (3, true) => Color32::from_rgb(0xf5, 0xf5, 0x43),
        (4, true) => Color32::from_rgb(0x3b, 0x8e, 0xea),
        (5, true) => Color32::from_rgb(0xd6, 0x70, 0xd6),
        (6, true) => Color32::from_rgb(0x29, 0xb8, 0xdb),
        _ => Color32::from_rgb(0xe5, 0xe5, 0xe5),
    }
}

fn palette_256(idx: u8) -> Color32 {
    if idx < 16 {
        return ansi_color(idx % 8, idx >= 8);
    }
    if idx < 232 {
        let idx = idx - 16;
        let levels = [0u8, 95, 135, 175, 215, 255];
        let r = levels[(idx / 36) as usize % 6];
        let g = levels[(idx / 6) as usize % 6];
        let b = levels[(idx % 6) as usize];
        return Color32::from_rgb(r, g, b);
    }
    let gray = 8 + (idx - 232) * 10;
    Color32::from_rgb(gray, gray, gray)
}
