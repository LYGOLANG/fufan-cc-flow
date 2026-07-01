//! syntect 语法高亮 -> egui LayoutJob,外加一个可用的"复制"按钮。

use egui::text::{LayoutJob, TextFormat};
use egui::{Color32, FontId};
use syntect::easy::HighlightLines;
use syntect::highlighting::{Color as SynColor, Theme, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

pub struct CodeHighlighter {
    syntax_set: SyntaxSet,
    theme: Theme,
}

impl CodeHighlighter {
    pub fn new() -> Self {
        let syntax_set = SyntaxSet::load_defaults_newlines();
        let theme_set = ThemeSet::load_defaults();
        let theme = theme_set
            .themes
            .get("base16-ocean.dark")
            .cloned()
            .unwrap_or_else(|| theme_set.themes.values().next().unwrap().clone());
        Self { syntax_set, theme }
    }

    fn highlight(&self, code: &str, lang: &str) -> LayoutJob {
        let syntax = self
            .syntax_set
            .find_syntax_by_token(lang)
            .unwrap_or_else(|| self.syntax_set.find_syntax_plain_text());
        let mut h = HighlightLines::new(syntax, &self.theme);
        let mut job = LayoutJob::default();
        for line in LinesWithEndings::from(code) {
            let Ok(ranges) = h.highlight_line(line, &self.syntax_set) else {
                job.append(line, 0.0, TextFormat { font_id: FontId::monospace(13.0), ..Default::default() });
                continue;
            };
            for (style, text) in ranges {
                job.append(
                    text,
                    0.0,
                    TextFormat {
                        font_id: FontId::monospace(13.0),
                        color: syn_color_to_egui(style.foreground),
                        ..Default::default()
                    },
                );
            }
        }
        job
    }
}

fn syn_color_to_egui(c: SynColor) -> Color32 {
    Color32::from_rgb(c.r, c.g, c.b)
}

/// 渲染一个代码块:语言标签 + 复制按钮 + 高亮后的代码。
pub fn code_block_ui(ui: &mut egui::Ui, highlighter: &CodeHighlighter, lang: &str, code: &str) {
    egui::Frame::group(ui.style()).show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.weak(if lang.is_empty() { "text" } else { lang });
            if ui.small_button("复制").clicked() {
                ui.ctx().copy_text(code.to_string());
            }
        });
        let job = highlighter.highlight(code, lang);
        ui.label(job);
    });
}
