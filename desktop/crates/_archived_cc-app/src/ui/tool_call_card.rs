use cc_core::chat_model::ToolCallView;

use crate::theme;

pub enum PermissionAction {
    Allow { request_id: String, updated_input: serde_json::Value },
    Deny { request_id: String, reason: String },
}

const WARNING: egui::Color32 = egui::Color32::from_rgb(0xe6, 0xb4, 0x3c);

/// 渲染一张工具调用卡片。若这次调用正等待 HIL 确认,内联展示 允许/拒绝 + 60s 倒计时
/// (不是弹窗——对齐现有前端 ToolCallCard.tsx 的"卡片内联确认"交互)。
pub fn tool_call_card_ui(ui: &mut egui::Ui, call: &ToolCallView) -> Option<PermissionAction> {
    let mut action = None;
    let awaiting = call.pending_permission.is_some();
    let header = if awaiting {
        egui::RichText::new(format!("🔧 {} · 需要确认", call.name)).color(WARNING).strong()
    } else {
        egui::RichText::new(format!("🔧 {}", call.name)).color(theme::TEXT_SLATE_300)
    };

    egui::Frame::new()
        .fill(theme::SUNKEN_BG)
        .corner_radius(8)
        .inner_margin(8.0)
        .show(ui, |ui| {
            egui::CollapsingHeader::new(header)
                .id_salt(&call.id)
                .default_open(awaiting)
                .show(ui, |ui| {
                    ui.weak("输入:");
                    ui.code(serde_json::to_string_pretty(&call.input).unwrap_or_default());

                    if let Some(pending) = &call.pending_permission {
                        let remaining = 60u64.saturating_sub(pending.requested_at.elapsed().as_secs());
                        ui.separator();
                        if let Some(reason) = &pending.decision_reason {
                            ui.colored_label(WARNING, reason);
                        }
                        ui.colored_label(WARNING, format!("等待确认 · {remaining}s 后自动拒绝"));
                        ui.horizontal(|ui| {
                            if ui.add(theme::primary_button("✅ 允许")).clicked() {
                                action = Some(PermissionAction::Allow {
                                    request_id: pending.request_id.clone(),
                                    updated_input: call.input.clone(),
                                });
                            }
                            if ui.add(theme::danger_button("❌ 拒绝")).clicked() {
                                action = Some(PermissionAction::Deny {
                                    request_id: pending.request_id.clone(),
                                    reason: "User denied".to_string(),
                                });
                            }
                        });
                    } else {
                        match &call.result {
                            Some(r) => {
                                ui.weak("结果:");
                                if call.is_error {
                                    ui.colored_label(theme::DANGER, r);
                                } else {
                                    ui.label(r);
                                }
                            }
                            None => {
                                ui.weak("等待结果...");
                            }
                        }
                    }
                });
        });

    action
}
