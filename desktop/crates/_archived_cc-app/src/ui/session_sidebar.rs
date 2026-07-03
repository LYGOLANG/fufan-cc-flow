use cc_core::session::SessionInfo;

use crate::theme;

pub enum SidebarAction {
    NewChat,
    Refresh,
    LoadSession(String),
}

pub fn session_sidebar_ui(
    ui: &mut egui::Ui,
    sessions: &[SessionInfo],
    current_session_id: Option<&str>,
) -> Option<SidebarAction> {
    let mut action = None;

    ui.horizontal(|ui| {
        if ui.add(theme::primary_button("+ 新对话")).clicked() {
            action = Some(SidebarAction::NewChat);
        }
        if ui.button("刷新").clicked() {
            action = Some(SidebarAction::Refresh);
        }
    });
    ui.add_space(6.0);
    ui.weak("历史会话");
    ui.separator();

    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        for s in sessions {
            let selected = current_session_id == Some(s.id.as_str());
            let title = s.name.clone().unwrap_or_else(|| s.id.clone());
            let subtitle = format!("{} · {} 条消息", s.updated_at.as_deref().unwrap_or("-"), s.message_count);

            let frame = egui::Frame::new()
                .corner_radius(6)
                .inner_margin(egui::vec2(8.0, 6.0))
                .fill(if selected { theme::PURPLE_GLOW.gamma_multiply(0.28) } else { egui::Color32::TRANSPARENT });

            let resp = frame
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new(title).color(theme::TEXT_SLATE_200));
                        ui.label(egui::RichText::new(subtitle).color(theme::TEXT_SLATE_400).small());
                    });
                })
                .response
                .interact(egui::Sense::click());

            if resp.clicked() {
                action = Some(SidebarAction::LoadSession(s.id.clone()));
            }
            if resp.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            ui.add_space(2.0);
        }
    });

    action
}
