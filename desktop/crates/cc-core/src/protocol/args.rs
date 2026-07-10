//! CLI argv 构造。对齐 `@anthropic-ai/claude-agent-sdk` 的 `ProcessTransport.initialize()`
//! 实际拼出的参数表(见 M0 spike 验证结果)。

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub effort: Option<String>,
    pub model: Option<String>,
    /// 必须显式传,不能留空——留空会继承本机全局 settings.json 的 defaultMode,
    /// 在很多机器上默认是 "auto"(完全不触发 can_use_tool 确认),M0 spike 已验证过这一点。
    pub permission_mode: Option<String>,
    pub resume: Option<String>,
    pub fork_session: bool,
    pub session_id: Option<String>,
    pub include_partial_messages: bool,
    pub setting_sources: Option<Vec<String>>,
    pub add_dirs: Vec<String>,
    pub max_turns: Option<u32>,
    pub max_budget_usd: Option<f64>,
    pub allowed_tools: Option<Vec<String>>,
    pub disallowed_tools: Option<Vec<String>>,
}

impl Default for SpawnConfig {
    fn default() -> Self {
        Self {
            effort: None,
            model: None,
            permission_mode: Some("default".to_string()),
            resume: None,
            fork_session: false,
            session_id: None,
            include_partial_messages: true,
            setting_sources: Some(vec!["user".to_string(), "project".to_string()]),
            add_dirs: Vec::new(),
            max_turns: None,
            max_budget_usd: None,
            allowed_tools: None,
            disallowed_tools: None,
        }
    }
}

/// 构造完整 argv(不含程序名本身)。`--permission-prompt-tool stdio` 恒定携带——
/// 我们总是自己接管权限确认,不使用 CLI 内建的其他 permission-prompt-tool。
pub fn build_args(cfg: &SpawnConfig) -> Vec<String> {
    let mut args = vec![
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--permission-prompt-tool".to_string(),
        "stdio".to_string(),
    ];

    if cfg.include_partial_messages {
        args.push("--include-partial-messages".to_string());
    }
    if let Some(v) = &cfg.effort {
        args.push("--effort".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &cfg.model {
        args.push("--model".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &cfg.permission_mode {
        args.push("--permission-mode".to_string());
        args.push(v.clone());
    }
    if let Some(v) = &cfg.resume {
        args.push("--resume".to_string());
        args.push(v.clone());
    }
    if cfg.fork_session {
        args.push("--fork-session".to_string());
    }
    if let Some(v) = &cfg.session_id {
        args.push("--session-id".to_string());
        args.push(v.clone());
    }
    if let Some(sources) = &cfg.setting_sources {
        args.push(format!("--setting-sources={}", sources.join(",")));
    }
    for d in &cfg.add_dirs {
        args.push("--add-dir".to_string());
        args.push(d.clone());
    }
    if let Some(v) = cfg.max_turns {
        args.push("--max-turns".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = cfg.max_budget_usd {
        args.push("--max-budget-usd".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = &cfg.allowed_tools {
        args.push("--allowedTools".to_string());
        args.push(v.join(","));
    }
    if let Some(v) = &cfg.disallowed_tools {
        args.push("--disallowedTools".to_string());
        args.push(v.join(","));
    }

    args
}
