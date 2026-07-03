mod app;
mod bridge;
mod code_view;
mod fonts;
mod markdown;
mod terminal_grid;
mod terminal_state;
mod theme;
mod ui;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1360.0, 860.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Fufan-CC Flow",
        options,
        Box::new(|cc| {
            fonts::install_cjk_fonts(&cc.egui_ctx);
            theme::apply(&cc.egui_ctx);
            Ok(Box::new(app::App::new(cc.egui_ctx.clone())))
        }),
    )
}
