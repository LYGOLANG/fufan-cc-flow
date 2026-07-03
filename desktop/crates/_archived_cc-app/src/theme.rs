//! Void Console 设计系统(对齐现有 React 前端的配色),移植到 egui 的 Visuals/Style。
//! 参考 CLAUDE.md:全局背景 obsidian-900、主操作色 amber-glow、品牌色 purple-glow、
//! 文字层级 white -> slate-200 -> slate-300 -> slate-400。

use egui::{Color32, CornerRadius, Stroke};

pub const OBSIDIAN_900: Color32 = Color32::from_rgb(0x13, 0x11, 0x1C);
/// 比全局背景略浅一档,给卡片/侧边栏这类"面板"一点层次感(对应 React 版"面板背景用内联 rgba()"的做法)。
pub const PANEL_BG: Color32 = Color32::from_rgb(0x1c, 0x19, 0x29);
pub const SUNKEN_BG: Color32 = Color32::from_rgb(0x0e, 0x0c, 0x15);

pub const AMBER_GLOW: Color32 = Color32::from_rgb(0xd9, 0x77, 0x57);
pub const AMBER_DEFAULT: Color32 = Color32::from_rgb(0xca, 0x5d, 0x3d);
pub const PURPLE_GLOW: Color32 = Color32::from_rgb(0x7c, 0x3a, 0xed);

pub const TEXT_SLATE_200: Color32 = Color32::from_rgb(0xe2, 0xe8, 0xf0);
pub const TEXT_SLATE_300: Color32 = Color32::from_rgb(0xcb, 0xd5, 0xe1);
pub const TEXT_SLATE_400: Color32 = Color32::from_rgb(0x94, 0xa3, 0xb8);
pub const DANGER: Color32 = Color32::from_rgb(0xdc, 0x50, 0x50);

const RADIUS: u8 = 8;

pub fn apply(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();

    visuals.panel_fill = OBSIDIAN_900;
    visuals.window_fill = OBSIDIAN_900;
    visuals.extreme_bg_color = SUNKEN_BG; // TextEdit/滚动条背景
    visuals.faint_bg_color = PANEL_BG;
    visuals.code_bg_color = SUNKEN_BG;

    visuals.selection.bg_fill = PURPLE_GLOW.gamma_multiply(0.35);
    visuals.selection.stroke = Stroke::new(1.0, PURPLE_GLOW);
    visuals.hyperlink_color = AMBER_GLOW;

    // 默认(未交互)控件——面板色打底,slate 文字,不抢戏。
    visuals.widgets.noninteractive.bg_fill = OBSIDIAN_900;
    visuals.widgets.noninteractive.weak_bg_fill = OBSIDIAN_900;
    visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT_SLATE_300);
    visuals.widgets.noninteractive.corner_radius = CornerRadius::same(RADIUS);

    visuals.widgets.inactive.bg_fill = PANEL_BG;
    visuals.widgets.inactive.weak_bg_fill = PANEL_BG;
    visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT_SLATE_200);
    visuals.widgets.inactive.corner_radius = CornerRadius::same(RADIUS);

    visuals.widgets.hovered.bg_fill = PANEL_BG.gamma_multiply(1.4);
    visuals.widgets.hovered.weak_bg_fill = PANEL_BG.gamma_multiply(1.4);
    visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, Color32::WHITE);
    visuals.widgets.hovered.corner_radius = CornerRadius::same(RADIUS);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, AMBER_GLOW.gamma_multiply(0.6));

    visuals.widgets.active.bg_fill = AMBER_DEFAULT;
    visuals.widgets.active.weak_bg_fill = AMBER_DEFAULT;
    visuals.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);
    visuals.widgets.active.corner_radius = CornerRadius::same(RADIUS);

    visuals.widgets.open.bg_fill = PANEL_BG;
    visuals.widgets.open.weak_bg_fill = PANEL_BG;
    visuals.widgets.open.corner_radius = CornerRadius::same(RADIUS);

    ctx.set_visuals(visuals);

    let mut style = (*ctx.style_of(egui::Theme::Dark)).clone();
    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.button_padding = egui::vec2(12.0, 6.0);
    ctx.set_style_of(egui::Theme::Dark, style);
}

/// 主操作按钮(发送/允许 这类):对齐 React 版"bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium"。
pub fn primary_button(text: impl Into<String>) -> egui::Button<'static> {
    egui::Button::new(egui::RichText::new(text.into()).color(Color32::WHITE).strong())
        .fill(AMBER_DEFAULT)
        .corner_radius(RADIUS)
}

/// 危险操作按钮(拒绝这类)。
pub fn danger_button(text: impl Into<String>) -> egui::Button<'static> {
    egui::Button::new(egui::RichText::new(text.into()).color(Color32::WHITE).strong())
        .fill(DANGER)
        .corner_radius(RADIUS)
}
