//! 把 assistant 回复文本按 ``` 围栏代码块切成 段落/代码 交替的片段。
//! 不是完整 CommonMark 解析——只负责把代码块摘出来交给 syntect 高亮渲染,
//! 段落部分交给 `egui_commonmark` 处理内联 markdown。

use egui_commonmark::{CommonMarkCache, CommonMarkViewer};

use crate::code_view::CodeHighlighter;

pub enum Segment {
    Prose(String),
    Code { lang: String, code: String },
}

pub fn split_into_segments(text: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut rest = text;

    loop {
        match rest.find("```") {
            None => {
                if !rest.is_empty() {
                    segments.push(Segment::Prose(rest.to_string()));
                }
                break;
            }
            Some(start) => {
                if start > 0 {
                    segments.push(Segment::Prose(rest[..start].to_string()));
                }
                let after_fence = &rest[start + 3..];
                let (lang, after_lang) = match after_fence.find('\n') {
                    Some(nl) => (after_fence[..nl].trim().to_string(), &after_fence[nl + 1..]),
                    None => (String::new(), after_fence),
                };
                match after_lang.find("```") {
                    Some(end) => {
                        segments.push(Segment::Code {
                            lang,
                            code: after_lang[..end].to_string(),
                        });
                        rest = &after_lang[end + 3..];
                    }
                    None => {
                        // 围栏还没闭合(流式渲染中间态),把剩下的都当代码块显示。
                        segments.push(Segment::Code {
                            lang,
                            code: after_lang.to_string(),
                        });
                        rest = "";
                    }
                }
            }
        }
    }

    segments
}

/// 段落走 CommonMark 渲染(处理内联加粗/列表/标题等),代码块走 syntect 高亮 + 复制按钮。
pub fn render_markdown(
    ui: &mut egui::Ui,
    cache: &mut CommonMarkCache,
    highlighter: &CodeHighlighter,
    text: &str,
) {
    for seg in split_into_segments(text) {
        match seg {
            Segment::Prose(s) => {
                CommonMarkViewer::new().show(ui, cache, &s);
            }
            Segment::Code { lang, code } => {
                crate::code_view::code_block_ui(ui, highlighter, &lang, &code);
            }
        }
    }
}
