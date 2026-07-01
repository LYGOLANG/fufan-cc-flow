use egui_commonmark::CommonMarkCache;

use cc_core::chat_model::ChatEntry;

use crate::code_view::CodeHighlighter;
use crate::markdown::render_markdown;
use crate::theme;
use crate::ui::tool_call_card::{tool_call_card_ui, PermissionAction};

fn bubble(ui: &mut egui::Ui, accent: egui::Color32, add_contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(theme::PANEL_BG)
        .corner_radius(10)
        .inner_margin(egui::vec2(12.0, 10.0))
        .stroke(egui::Stroke::new(1.0, accent.gamma_multiply(0.35)))
        .show(ui, |ui| add_contents(ui));
    ui.add_space(6.0);
}

pub fn chat_log_ui(
    ui: &mut egui::Ui,
    entries: &[ChatEntry],
    md_cache: &mut CommonMarkCache,
    highlighter: &CodeHighlighter,
) -> Vec<PermissionAction> {
    let mut actions = Vec::new();

    for entry in entries {
        match entry {
            ChatEntry::UserText(text) => {
                bubble(ui, theme::AMBER_GLOW, |ui| {
                    ui.label(egui::RichText::new("你").color(theme::AMBER_GLOW).strong());
                    ui.label(egui::RichText::new(text).color(theme::TEXT_SLATE_200));
                });
            }
            ChatEntry::SystemNote(text) => {
                ui.weak(text);
            }
            ChatEntry::AssistantTurn(turn) => {
                bubble(ui, theme::PURPLE_GLOW, |ui| {
                    let label = if turn.done { "✨ Claude" } else { "✨ Claude (正在输入...)" };
                    ui.label(egui::RichText::new(label).color(theme::PURPLE_GLOW).strong());

                    if !turn.thinking.is_empty() {
                        egui::CollapsingHeader::new(
                            egui::RichText::new("💭 思考过程").color(theme::TEXT_SLATE_400),
                        )
                        .default_open(false)
                        .show(ui, |ui| {
                            ui.weak(&turn.thinking);
                        });
                    }

                    for call in &turn.tool_calls {
                        if let Some(action) = tool_call_card_ui(ui, call) {
                            actions.push(action);
                        }
                    }

                    if !turn.text.is_empty() {
                        render_markdown(ui, md_cache, highlighter, &turn.text);
                    }
                });
            }
        }
    }

    actions
}
