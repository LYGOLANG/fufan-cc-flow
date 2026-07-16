//! JSONL 会话记录的读取——列表用的轻量元信息扫描,以及完整历史转成 `ChatEntry` 供 GUI 渲染。
//!
//! MVP 阶段的刻意简化(相对 Node 版 sessionManager.ts 的完整实现):
//!   - 不做 UUID/parentUuid 回滚链检测(不显示"已回滚"删除线),也不做 compact 摘要回填、
//!     synthetic taskResult 计算——这些是历史展示的视觉打磨,不影响"能不能正常读历史/续接对话"。
//!   - 一次性读整份 JSONL,不分页——桌面单用户场景,文件大小通常不构成问题。
//!   - 不写 `sessions-index.json`(改名等)——只读。

use std::io::BufRead;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::chat_model::{AssistantTurn, ChatEntry, ToolCallView};
use crate::session::index::read_sessions_index;
use crate::session::paths::project_dir;

#[derive(Debug, Clone, Default)]
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub project_path: Option<String>,
    pub message_count: usize,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub summary: Option<String>,
    pub git_branch: Option<String>,
    pub parent_session_id: Option<String>,
}

/// `sessions-index.json` 在实测中经常压根不存在(至少这次 M0-M4 用 stream-json 编程式
/// 驱动 CLI 跑出来的 session 全都没有——推测是交互式 TUI 才会写这份索引),所以时间戳
/// 必须有文件系统兜底,不能假设索引一定有数据。
fn system_time_to_rfc3339(t: std::time::SystemTime) -> Option<String> {
    time::OffsetDateTime::from(t).format(&time::format_description::well_known::Rfc3339).ok()
}

fn is_internal_message(text: &str) -> bool {
    text.starts_with('[') || text.starts_with('<') || text.starts_with("This session is being continued")
}

fn extract_user_text(v: &Value) -> Option<String> {
    match v.pointer("/message/content") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(blocks)) => {
            let mut s = String::new();
            for b in blocks {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                        s.push_str(t);
                    }
                }
            }
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    }
}

#[derive(Default)]
struct SessionMeta {
    first_user_text: Option<String>,
    project_path: Option<String>,
    message_count: usize,
}

fn read_session_meta(path: &Path) -> SessionMeta {
    let mut meta = SessionMeta::default();
    let Ok(file) = std::fs::File::open(path) else { return meta };
    let reader = std::io::BufReader::new(file);

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }
        meta.message_count += 1;
        let Ok(v): Result<Value, _> = serde_json::from_str(&line) else { continue };

        if meta.project_path.is_none() {
            if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                meta.project_path = Some(cwd.to_string());
            }
        }

        if meta.first_user_text.is_none() && v.get("type").and_then(|t| t.as_str()) == Some("user") {
            if let Some(text) = extract_user_text(&v) {
                if !is_internal_message(&text) {
                    let truncated: String = text.chars().take(60).collect();
                    meta.first_user_text =
                        Some(if text.chars().count() > 60 { format!("{truncated}…") } else { truncated });
                }
            }
        }
    }

    meta
}

/// 列出某个项目目录下的全部 session(按 updated_at 倒序,最新的在前)。
pub fn list_sessions(project_path: &Path) -> Vec<SessionInfo> {
    let dir = project_dir(project_path);
    let index = read_sessions_index(&dir);
    let mut out = Vec::new();

    let Ok(read_dir) = std::fs::read_dir(&dir) else { return out };
    for entry in read_dir.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(session_id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };

        let meta = read_session_meta(&path);
        let idx = index.sessions.get(&session_id);

        let fs_meta = entry.metadata().ok();
        let created_fallback = fs_meta.as_ref().and_then(|m| m.created().ok()).and_then(system_time_to_rfc3339);
        let updated_fallback = fs_meta.as_ref().and_then(|m| m.modified().ok()).and_then(system_time_to_rfc3339);

        out.push(SessionInfo {
            id: session_id,
            name: idx.and_then(|e| e.summary.clone()).or_else(|| meta.first_user_text.clone()),
            model: idx.and_then(|e| e.model.clone()),
            project_path: meta.project_path,
            message_count: meta.message_count,
            created_at: idx.and_then(|e| e.created_at.clone()).or(created_fallback),
            updated_at: idx.and_then(|e| e.last_active_at.clone()).or(updated_fallback),
            summary: idx.and_then(|e| e.summary.clone()),
            git_branch: idx.and_then(|e| e.git_branch.clone()),
            parent_session_id: idx.and_then(|e| e.parent_session_id.clone()),
        });
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

pub fn transcript_path(project_path: &Path, session_id: &str) -> PathBuf {
    project_dir(project_path).join(format!("{session_id}.jsonl"))
}

/// 把一份 JSONL 转成 GUI 能直接渲染的 `ChatEntry` 序列(跟实时对话用的是同一个数据模型)。
pub fn load_transcript(path: &Path) -> Vec<ChatEntry> {
    let mut entries: Vec<ChatEntry> = Vec::new();
    let Ok(content) = std::fs::read_to_string(path) else { return entries };

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v): Result<Value, _> = serde_json::from_str(line) else { continue };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match ty {
            "assistant" => {
                let blocks = v.pointer("/message/content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
                let mut turn = AssistantTurn { done: true, ..Default::default() };
                for block in blocks {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                turn.text.push_str(t);
                            }
                        }
                        Some("thinking") => {
                            if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                                turn.thinking.push_str(t);
                            }
                        }
                        Some("tool_use") => {
                            let id = block.get("id").and_then(|t| t.as_str()).unwrap_or_default().to_string();
                            let name = block.get("name").and_then(|t| t.as_str()).unwrap_or_default().to_string();
                            let input = block.get("input").cloned().unwrap_or(Value::Null);
                            turn.tool_calls.push(ToolCallView {
                                id,
                                name,
                                input,
                                result: None,
                                is_error: false,
                                pending_permission: None,
                            });
                        }
                        _ => {}
                    }
                }
                if !turn.text.is_empty() || !turn.thinking.is_empty() || !turn.tool_calls.is_empty() {
                    entries.push(ChatEntry::AssistantTurn(turn));
                }
            }
            "user" => {
                let mut plain_text = String::new();
                if let Some(Value::Array(blocks)) = v.pointer("/message/content") {
                    for block in blocks {
                        match block.get("type").and_then(|t| t.as_str()) {
                            Some("tool_result") => {
                                let tool_use_id = block.get("tool_use_id").and_then(|t| t.as_str()).unwrap_or_default();
                                let is_error = block.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
                                let result_text = match block.get("content") {
                                    Some(Value::String(s)) => s.clone(),
                                    Some(other) => other.to_string(),
                                    None => String::new(),
                                };
                                for entry in entries.iter_mut().rev() {
                                    if let ChatEntry::AssistantTurn(t) = entry {
                                        if let Some(call) = t.tool_calls.iter_mut().find(|c| c.id == tool_use_id) {
                                            call.result = Some(result_text.clone());
                                            call.is_error = is_error;
                                            break;
                                        }
                                    }
                                }
                            }
                            Some("text") => {
                                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                    plain_text.push_str(t);
                                }
                            }
                            _ => {}
                        }
                    }
                } else if let Some(text) = extract_user_text(&v) {
                    plain_text = text;
                }

                if !plain_text.is_empty() && !is_internal_message(&plain_text) {
                    entries.push(ChatEntry::UserText(plain_text));
                }
            }
            "system" if v.get("subtype").and_then(|s| s.as_str()) == Some("compact_boundary") => {
                entries.push(ChatEntry::SystemNote("[已压缩上下文]".to_string()));
            }
            _ => {}
        }
    }

    entries
}
