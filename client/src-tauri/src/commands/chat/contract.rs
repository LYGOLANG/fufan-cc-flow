use cc_core::SpawnConfig;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub(super) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendMessagePayload {
    pub prompt: String,
    pub project_path: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub run_mode: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub fork_session: Option<bool>,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub attachment_paths: Vec<String>,
    #[serde(default)]
    pub thinking_budget: Option<u64>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub max_budget: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AbortPayload {
    pub project_path: String,
    #[serde(default)]
    pub project_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionResponsePayload {
    pub project_path: String,
    #[serde(default)]
    pub project_key: Option<String>,
    pub request_id: String,
    pub decision: String,
    #[serde(default)]
    pub always_allow: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

pub(super) fn build_cfg(payload: &SendMessagePayload) -> SpawnConfig {
    SpawnConfig {
        model: payload.model.clone(),
        effort: payload.effort.clone(),
        permission_mode: Some(
            payload
                .run_mode
                .clone()
                .unwrap_or_else(|| "default".to_string()),
        ),
        fork_session: payload.fork_session.unwrap_or(false),
        max_budget_usd: payload.max_budget,
        ..Default::default()
    }
}

pub(super) fn validate_payload(payload: &SendMessagePayload) -> Result<(), CommandError> {
    if payload.project_path.trim().is_empty() {
        return Err(CommandError::new("NO_PROJECT", "请先选择项目文件夹"));
    }
    if payload.prompt.trim().is_empty() {
        return Err(CommandError::new("EMPTY_PROMPT", "消息不能为空"));
    }
    if payload.engine.as_deref().unwrap_or("claude") != "claude" {
        return Err(CommandError::new(
            "UNSUPPORTED_ENGINE",
            "Rust transport 暂只接管 Claude，Codex 将在 Phase 7 迁移",
        ));
    }
    if payload.provider_id.as_deref().unwrap_or("anthropic") != "anthropic" {
        return Err(CommandError::new(
            "UNSUPPORTED_PROVIDER",
            "Rust transport 暂不支持 Anthropic 兼容供应商",
        ));
    }
    if !payload.attachment_paths.is_empty() {
        return Err(CommandError::new(
            "UNSUPPORTED_ATTACHMENTS",
            "Rust transport 的附件能力将在 Phase 6 迁移",
        ));
    }
    if payload.thinking_budget.unwrap_or(0) > 0 || payload.effort.as_deref() == Some("ultracode") {
        return Err(CommandError::new(
            "UNSUPPORTED_THINKING_MODE",
            "Rust transport 暂不支持 SDK 专属思考参数",
        ));
    }
    if payload
        .api_key
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err(CommandError::new(
            "UNSUPPORTED_TEMP_KEY",
            "Rust transport 暂不接收前端临时 API Key",
        ));
    }
    Ok(())
}

pub(super) fn canonical_project_path(project_path: &str) -> Result<String, CommandError> {
    let canonical = std::fs::canonicalize(Path::new(project_path)).map_err(|error| {
        CommandError::new("INVALID_PROJECT", format!("项目目录不可访问: {error}"))
    })?;
    if !canonical.is_dir() {
        return Err(CommandError::new("INVALID_PROJECT", "项目路径不是目录"));
    }
    Ok(canonical.to_string_lossy().to_string())
}

pub(super) fn existing_session_key(
    project_path: &str,
    project_key: Option<&str>,
) -> Result<String, CommandError> {
    if let Some(key) = project_key.filter(|key| !key.trim().is_empty()) {
        if !Path::new(key).is_absolute() {
            return Err(CommandError::new(
                "INVALID_PROJECT_KEY",
                "会话项目标识必须是绝对路径",
            ));
        }
        return Ok(key.to_string());
    }
    canonical_project_path(project_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_payload() -> SendMessagePayload {
        SendMessagePayload {
            prompt: "hello".to_string(),
            project_path: "/tmp/project".to_string(),
            model: Some("sonnet".to_string()),
            effort: Some("high".to_string()),
            run_mode: Some("default".to_string()),
            session_id: None,
            fork_session: None,
            engine: Some("claude".to_string()),
            provider_id: Some("anthropic".to_string()),
            attachment_paths: Vec::new(),
            thinking_budget: None,
            api_key: None,
            max_budget: Some(1.0),
        }
    }

    #[test]
    fn accepts_supported_claude_payload() {
        assert!(validate_payload(&valid_payload()).is_ok());
        assert_eq!(build_cfg(&valid_payload()).max_budget_usd, Some(1.0));
    }

    #[test]
    fn rejects_features_that_have_not_migrated() {
        let mut payload = valid_payload();
        payload.engine = Some("codex".to_string());
        assert!(validate_payload(&payload).is_err());

        let mut payload = valid_payload();
        payload.attachment_paths.push("image.png".to_string());
        assert!(validate_payload(&payload).is_err());

        let mut payload = valid_payload();
        payload.thinking_budget = Some(16_000);
        assert!(validate_payload(&payload).is_err());
    }

    #[test]
    fn canonicalizes_equivalent_project_paths() {
        let root = std::env::temp_dir();
        let direct = canonical_project_path(root.to_string_lossy().as_ref()).unwrap();
        let equivalent = root.join(".");
        let normalized = canonical_project_path(equivalent.to_string_lossy().as_ref()).unwrap();
        assert_eq!(direct, normalized);
    }

    #[test]
    fn saved_session_key_survives_missing_original_path() {
        let key = std::env::temp_dir().to_string_lossy().to_string();
        assert_eq!(
            existing_session_key("/path/that/no/longer/exists", Some(&key)).unwrap(),
            key
        );
        assert!(existing_session_key("/tmp", Some("relative/path")).is_err());
    }
}
