use egui::text::{LayoutJob, TextFormat};
use egui::{Color32, FontId};

use crate::terminal_grid::TerminalGrid;
use crate::terminal_state::TerminalPanelState;

const CHAR_WIDTH: f32 = 7.8;
const CHAR_HEIGHT: f32 = 16.0;
const DEFAULT_FG: Color32 = Color32::from_rgb(0xd4, 0xd4, 0xd4);

pub fn terminal_panel_ui(ui: &mut egui::Ui, state: &mut TerminalPanelState) {
    let available = ui.available_size();
    let cols = ((available.x / CHAR_WIDTH) as u16).max(20);
    let rows = ((available.y / CHAR_HEIGHT) as u16).max(6);
    if cols as usize != state.grid.cols || rows as usize != state.grid.rows {
        state.resize(cols, rows);
    }

    let job = build_layout_job(&state.grid);
    let galley = ui.fonts_mut(|f| f.layout_job(job));
    let (rect, response) = ui.allocate_exact_size(galley.size(), egui::Sense::click());
    ui.painter().galley(rect.min, galley, DEFAULT_FG);

    if response.clicked() {
        response.request_focus();
    }
    if response.has_focus() {
        ui.painter().rect_stroke(
            rect,
            0,
            egui::Stroke::new(1.0, crate::theme::AMBER_GLOW.gamma_multiply(0.6)),
            egui::StrokeKind::Outside,
        );

        for ev in ui.input(|i| i.events.clone()) {
            match ev {
                egui::Event::Text(text) => state.write_input(text.as_bytes()),
                egui::Event::Key { key, pressed: true, modifiers, .. } => {
                    let bytes: &[u8] = match key {
                        egui::Key::Enter => b"\r",
                        egui::Key::Backspace => b"\x7f",
                        egui::Key::Tab => b"\t",
                        egui::Key::Escape => b"\x1b",
                        egui::Key::ArrowUp => b"\x1b[A",
                        egui::Key::ArrowDown => b"\x1b[B",
                        egui::Key::ArrowRight => b"\x1b[C",
                        egui::Key::ArrowLeft => b"\x1b[D",
                        egui::Key::C if modifiers.ctrl => b"\x03",
                        _ => b"",
                    };
                    if !bytes.is_empty() {
                        state.write_input(bytes);
                    }
                }
                _ => {}
            }
        }
    }

    if let Some(code) = state.exit_code {
        ui.colored_label(Color32::GRAY, format!("[shell 已退出 code={code:?}]"));
    } else if !response.has_focus() {
        ui.weak("点击终端区域获取输入焦点");
    }
}

fn build_layout_job(grid: &TerminalGrid) -> LayoutJob {
    let mut job = LayoutJob::default();
    for row in 0..grid.rows {
        let mut col = 0;
        while col < grid.cols {
            let cell0 = grid.cell(row, col);
            let (fg0, bold0) = (cell0.fg, cell0.bold);
            let mut text = String::new();
            while col < grid.cols {
                let c = grid.cell(row, col);
                if c.fg != fg0 || c.bold != bold0 {
                    break;
                }
                text.push(if c.ch == '\0' { ' ' } else { c.ch });
                col += 1;
            }
            job.append(
                &text,
                0.0,
                TextFormat { font_id: FontId::monospace(13.0), color: fg0.unwrap_or(DEFAULT_FG), ..Default::default() },
            );
        }
        job.append("\n", 0.0, TextFormat::default());
    }
    job
}
