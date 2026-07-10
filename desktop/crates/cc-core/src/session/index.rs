//! `sessions-index.json`——每个项目目录下一份,CLI 写入,我们只读(MVP 阶段不做改名等写操作)。

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionsIndexEntry {
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, rename = "gitBranch")]
    pub git_branch: Option<String>,
    #[serde(default, rename = "messageCount")]
    pub message_count: Option<u32>,
    #[serde(default, rename = "parentSessionId")]
    pub parent_session_id: Option<String>,
    #[serde(default, rename = "lastActiveAt")]
    pub last_active_at: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionsIndex {
    #[serde(default)]
    pub sessions: HashMap<String, SessionsIndexEntry>,
}

pub fn read_sessions_index(project_dir: &Path) -> SessionsIndex {
    let path = project_dir.join("sessions-index.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
