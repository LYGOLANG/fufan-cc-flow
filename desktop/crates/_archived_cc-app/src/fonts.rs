//! egui 默认字体不含中文字形(会渲染成方块),这里加载 Windows 系统自带的
//! 微软雅黑作为兜底——项目约定界面/交流以中文为主,这个必须在第一个窗口画出来之前装好。

use std::sync::Arc;

const CANDIDATE_FONTS: &[&str] = &[
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
];

pub fn install_cjk_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();

    let Some(bytes) = CANDIDATE_FONTS.iter().find_map(|p| std::fs::read(p).ok()) else {
        eprintln!("[fonts] 未找到可用的中文字体,界面中文可能显示为方块");
        return;
    };

    fonts
        .font_data
        .insert("cjk".to_owned(), Arc::new(egui::FontData::from_owned(bytes)));

    fonts
        .families
        .entry(egui::FontFamily::Proportional)
        .or_default()
        .insert(0, "cjk".to_owned());
    fonts
        .families
        .entry(egui::FontFamily::Monospace)
        .or_default()
        .push("cjk".to_owned());

    ctx.set_fonts(fonts);
}
