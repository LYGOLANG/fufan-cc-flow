use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;

use cc_core::cli::resolve_claude_bin;
use cc_core::{spawn_session, AppEvent, PermissionDecision, SessionHandle, SpawnConfig};
use egui_commonmark::CommonMarkCache;
use tokio::sync::mpsc as tokio_mpsc;

use cc_core::chat_model::{AssistantTurn, ChatEntry, PendingPermission, ToolCallView};

use crate::bridge::Bridge;
use crate::code_view::CodeHighlighter;
use crate::terminal_state::TerminalPanelState;
use crate::theme;
use crate::ui::chat_panel::chat_log_ui;
use crate::ui::session_sidebar::{session_sidebar_ui, SidebarAction};
use crate::ui::terminal_panel::terminal_panel_ui;
use crate::ui::tool_call_card::PermissionAction;

/// 只读/无副作用的工具永不打扰用户,直接放行——对齐现有 Node 后端 chatHandler.ts 的清单。
const AUTO_APPROVE_TOOLS: &[&str] = &[
    "Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoRead", "Task", "Agent", "TodoWrite", "NotebookRead", "LS",
];

pub struct App {
    bridge: Bridge,
    resolved_bin: Option<PathBuf>,
    project_path: PathBuf,

    raw_events_tx: tokio_mpsc::UnboundedSender<AppEvent>,
    ui_events_rx: std_mpsc::Receiver<AppEvent>,
    handle_tx: std_mpsc::Sender<SessionHandle>,
    handle_rx: std_mpsc::Receiver<SessionHandle>,

    prompt_input: String,
    chat_log: Vec<ChatEntry>,
    sending: bool,
    current_session_id: Option<String>,
    current_handle: Option<SessionHandle>,

    md_cache: CommonMarkCache,
    highlighter: CodeHighlighter,

    sessions: Vec<cc_core::session::SessionInfo>,

    egui_ctx: egui::Context,
    show_terminal: bool,
    terminal: Option<TerminalPanelState>,
}

impl App {
    pub fn new(ctx: egui::Context) -> Self {
        let bridge = Bridge::new();
        let resolved_bin = resolve_claude_bin();
        let project_path = std::env::current_dir().unwrap_or_default();

        let (raw_events_tx, mut raw_events_rx) = tokio_mpsc::unbounded_channel::<AppEvent>();
        let (ui_events_tx, ui_events_rx) = std_mpsc::channel::<AppEvent>();
        let (handle_tx, handle_rx) = std_mpsc::channel::<SessionHandle>();

        let egui_ctx = ctx.clone();
        bridge.handle.spawn(async move {
            while let Some(ev) = raw_events_rx.recv().await {
                ctx.request_repaint();
                if ui_events_tx.send(ev).is_err() {
                    break;
                }
            }
        });

        let sessions = cc_core::session::list_sessions(&project_path);

        Self {
            bridge,
            resolved_bin,
            project_path,
            raw_events_tx,
            ui_events_rx,
            handle_tx,
            handle_rx,
            prompt_input: String::new(),
            chat_log: Vec::new(),
            sending: false,
            current_session_id: None,
            current_handle: None,
            md_cache: CommonMarkCache::default(),
            highlighter: CodeHighlighter::new(),
            sessions,
            egui_ctx,
            show_terminal: false,
            terminal: None,
        }
    }

    fn toggle_terminal(&mut self) {
        self.show_terminal = !self.show_terminal;
        if self.show_terminal && self.terminal.is_none() {
            match TerminalPanelState::spawn(&self.project_path, 100, 30, self.egui_ctx.clone()) {
                Ok(term) => self.terminal = Some(term),
                Err(e) => {
                    self.chat_log.push(ChatEntry::SystemNote(format!("[terminal] 启动失败: {e}")));
                    self.show_terminal = false;
                }
            }
        }
    }

    fn refresh_sessions(&mut self) {
        self.sessions = cc_core::session::list_sessions(&self.project_path);
    }

    fn handle_sidebar_action(&mut self, action: SidebarAction) {
        match action {
            SidebarAction::NewChat => {
                self.chat_log.clear();
                self.current_session_id = None;
                self.current_handle = None;
                self.sending = false;
            }
            SidebarAction::Refresh => {
                self.refresh_sessions();
            }
            SidebarAction::LoadSession(id) => {
                let path = cc_core::session::transcript::transcript_path(&self.project_path, &id);
                self.chat_log = cc_core::session::load_transcript(&path);
                self.current_session_id = Some(id);
                self.current_handle = None;
                self.sending = false;
            }
        }
    }

    fn drain_events(&mut self) {
        while let Ok(ev) = self.handle_rx.try_recv() {
            self.current_handle = Some(ev);
        }
        while let Ok(ev) = self.ui_events_rx.try_recv() {
            self.apply_event(ev);
        }
        if let Some(term) = &mut self.terminal {
            term.drain();
        }
    }

    /// 拿到"当前正在增长的 assistant turn":如果最后一条记录是尚未 done 的 AssistantTurn 就复用,
    /// 否则新开一条。文本/思考/工具调用 delta 都通过这个方法路由到同一条 turn 里。
    fn current_turn_mut(&mut self) -> &mut AssistantTurn {
        let needs_new = !matches!(self.chat_log.last(), Some(ChatEntry::AssistantTurn(t)) if !t.done);
        if needs_new {
            self.chat_log.push(ChatEntry::AssistantTurn(AssistantTurn::default()));
        }
        match self.chat_log.last_mut() {
            Some(ChatEntry::AssistantTurn(t)) => t,
            _ => unreachable!("just pushed an AssistantTurn"),
        }
    }

    fn finish_current_turn(&mut self) {
        if let Some(ChatEntry::AssistantTurn(t)) = self.chat_log.last_mut() {
            t.done = true;
        }
    }

    fn find_tool_call_mut(&mut self, id: &str) -> Option<&mut ToolCallView> {
        for entry in self.chat_log.iter_mut().rev() {
            if let ChatEntry::AssistantTurn(turn) = entry {
                if let Some(call) = turn.tool_calls.iter_mut().find(|c| c.id == id) {
                    return Some(call);
                }
            }
        }
        None
    }

    /// `ToolUseStart`(来自完整 assistant 消息)和 `PermissionRequest`(来自 control 通道)
    /// 谁先到达没有保证,所以两边都通过这个方法按 tool_use_id 找/建卡片,而不是各自 push 一条。
    fn get_or_create_tool_call(&mut self, id: &str) -> &mut ToolCallView {
        let turn = self.current_turn_mut();
        if let Some(idx) = turn.tool_calls.iter().position(|c| c.id == id) {
            return &mut turn.tool_calls[idx];
        }
        turn.tool_calls.push(ToolCallView {
            id: id.to_string(),
            name: String::new(),
            input: serde_json::Value::Null,
            result: None,
            is_error: false,
            pending_permission: None,
        });
        turn.tool_calls.last_mut().expect("just pushed")
    }

    fn find_tool_call_by_request_id_mut(&mut self, request_id: &str) -> Option<&mut ToolCallView> {
        for entry in self.chat_log.iter_mut().rev() {
            if let ChatEntry::AssistantTurn(turn) = entry {
                if let Some(call) = turn.tool_calls.iter_mut().find(|c| {
                    c.pending_permission.as_ref().is_some_and(|p| p.request_id == request_id)
                }) {
                    return Some(call);
                }
            }
        }
        None
    }

    fn has_pending_permission(&self) -> bool {
        self.chat_log.iter().any(|e| {
            matches!(e, ChatEntry::AssistantTurn(t) if t.tool_calls.iter().any(|c| c.pending_permission.is_some()))
        })
    }

    fn apply_event(&mut self, ev: AppEvent) {
        match ev {
            AppEvent::SessionInit { session_id, model } => {
                self.current_session_id = Some(session_id.clone());
                self.chat_log
                    .push(ChatEntry::SystemNote(format!("[session] id={session_id} model={model:?}")));
            }
            AppEvent::AssistantTextDelta { text, .. } => {
                self.current_turn_mut().text.push_str(&text);
            }
            AppEvent::AssistantThinkingDelta { text, .. } => {
                self.current_turn_mut().thinking.push_str(&text);
            }
            AppEvent::NewTurn { .. } => {
                self.finish_current_turn();
            }
            AppEvent::ToolUseStart { tool_call_id, tool_name, tool_input, .. } => {
                let call = self.get_or_create_tool_call(&tool_call_id);
                call.name = tool_name;
                call.input = tool_input;
            }
            AppEvent::ToolInputComplete { .. } => {
                // 现在 ToolUseStart 已经带完整 input 了(见 cc-core transport.rs 的注释),这个事件暂不使用。
            }
            AppEvent::ToolUseResult { tool_call_id, result, is_error, .. } => {
                if let Some(call) = self.find_tool_call_mut(&tool_call_id) {
                    call.result = Some(result);
                    call.is_error = is_error;
                }
            }
            AppEvent::ContextCompact { .. } => {
                self.chat_log.push(ChatEntry::SystemNote("[context_compact]".to_string()));
            }
            AppEvent::TaskComplete { result: _, cost_usd, duration_ms, num_turns, is_error, .. } => {
                self.finish_current_turn();
                self.chat_log.push(ChatEntry::SystemNote(format!(
                    "[done] is_error={is_error} cost=${cost_usd:?} duration_ms={duration_ms:?} turns={num_turns:?}"
                )));
                self.sending = false;
            }
            AppEvent::PermissionRequest { request_id, tool_use_id, tool_name, tool_input, decision_reason, .. } => {
                if AUTO_APPROVE_TOOLS.contains(&tool_name.as_str()) {
                    if let Some(handle) = &self.current_handle {
                        handle.send_permission_response(
                            request_id,
                            PermissionDecision::Allow { updated_input: Some(tool_input) },
                        );
                    }
                } else {
                    let call = self.get_or_create_tool_call(&tool_use_id);
                    if call.name.is_empty() {
                        call.name = tool_name;
                        call.input = tool_input;
                    }
                    call.pending_permission = Some(PendingPermission {
                        request_id,
                        decision_reason,
                        requested_at: std::time::Instant::now(),
                    });
                }
            }
            AppEvent::PermissionCancelled { request_id } => {
                if let Some(call) = self.find_tool_call_by_request_id_mut(&request_id) {
                    call.pending_permission = None;
                }
            }
            AppEvent::PermissionTimedOut { request_id } => {
                if let Some(call) = self.find_tool_call_by_request_id_mut(&request_id) {
                    call.pending_permission = None;
                    call.result = Some("(60 秒未确认,已自动拒绝)".to_string());
                    call.is_error = true;
                }
            }
            AppEvent::ProcessStderr { text, .. } => {
                self.chat_log.push(ChatEntry::SystemNote(format!("[stderr] {text}")));
            }
            AppEvent::ProcessClose { code, .. } => {
                self.finish_current_turn();
                self.chat_log.push(ChatEntry::SystemNote(format!("[process_close] code={code:?}")));
                self.sending = false;
                // 这一轮的 JSONL 这时候已经落盘了,顺手刷新一下侧边栏,不用用户手动点"刷新"。
                self.refresh_sessions();
            }
            AppEvent::Error { code, message, .. } => {
                self.finish_current_turn();
                self.chat_log.push(ChatEntry::SystemNote(format!("[error] {code}: {message}")));
                self.sending = false;
            }
        }
    }

    fn send_prompt(&mut self) {
        let prompt = self.prompt_input.trim().to_string();
        if prompt.is_empty() || self.sending {
            return;
        }
        self.prompt_input.clear();
        self.sending = true;
        self.chat_log.push(ChatEntry::UserText(prompt.clone()));

        let cfg = SpawnConfig {
            resume: self.current_session_id.clone(),
            ..Default::default()
        };
        let project_path = self.project_path.clone();
        let events_tx = self.raw_events_tx.clone();
        let handle_tx = self.handle_tx.clone();

        self.bridge.handle.spawn(async move {
            match spawn_session(project_path, cfg, prompt, events_tx.clone()).await {
                Ok(handle) => {
                    let _ = handle_tx.send(handle);
                }
                Err(e) => {
                    let _ = events_tx.send(AppEvent::Error {
                        session_id: String::new(),
                        code: "SPAWN_FAILED".to_string(),
                        message: e.to_string(),
                    });
                }
            }
        });
    }
}

impl eframe::App for App {
    fn logic(&mut self, _ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::Panel::bottom("input_panel")
            .frame(egui::Frame::new().fill(theme::PANEL_BG).inner_margin(12.0))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let input = ui.add_enabled(
                        !self.sending,
                        egui::TextEdit::singleline(&mut self.prompt_input)
                            .desired_width(f32::INFINITY)
                            .hint_text("给 Claude 发消息..."),
                    );
                    let enter_pressed = input.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                    let send_clicked =
                        ui.add_enabled(!self.sending, theme::primary_button("发送")).clicked();
                    if send_clicked || enter_pressed {
                        self.send_prompt();
                    }
                });
                if self.sending {
                    ui.weak("正在等待 claude 回复...");
                }
            });

        let mut sidebar_action = None;
        egui::Panel::left("session_sidebar")
            .resizable(true)
            .default_size(240.0)
            .frame(egui::Frame::new().fill(theme::PANEL_BG).inner_margin(10.0))
            .show(ui, |ui| {
                sidebar_action = session_sidebar_ui(ui, &self.sessions, self.current_session_id.as_deref());
            });
        if let Some(action) = sidebar_action {
            self.handle_sidebar_action(action);
        }

        egui::Panel::top("top_bar")
            .frame(egui::Frame::new().fill(theme::OBSIDIAN_900).inner_margin(egui::vec2(14.0, 10.0)))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.heading(egui::RichText::new("Fufan-CC Flow").color(theme::PURPLE_GLOW).strong());
                    ui.separator();
                    match &self.resolved_bin {
                        Some(p) => {
                            ui.weak(format!("claude: {}", p.display()));
                        }
                        None => {
                            ui.colored_label(theme::DANGER, "未找到 claude 可执行文件");
                        }
                    }
                    if ui.button(if self.show_terminal { "隐藏终端" } else { "终端" }).clicked() {
                        self.toggle_terminal();
                    }
                });
                ui.horizontal(|ui| {
                    ui.weak(format!("项目: {}", self.project_path.display()));
                    ui.separator();
                    ui.weak(format!("session: {}", self.current_session_id.as_deref().unwrap_or("(尚未开始)")));
                });
            });

        if self.show_terminal {
            egui::Panel::bottom("terminal_panel")
                .resizable(true)
                .default_size(280.0)
                .frame(egui::Frame::new().fill(egui::Color32::from_rgb(0x0a, 0x09, 0x10)).inner_margin(8.0))
                .show(ui, |ui| {
                    if let Some(term) = &mut self.terminal {
                        terminal_panel_ui(ui, term);
                    }
                });
        }

        egui::CentralPanel::default().frame(egui::Frame::new().fill(theme::OBSIDIAN_900).inner_margin(12.0)).show(ui, |ui| {
            let mut actions = Vec::new();
            egui::ScrollArea::vertical().auto_shrink([false, false]).stick_to_bottom(true).show(ui, |ui| {
                actions = chat_log_ui(ui, &self.chat_log, &mut self.md_cache, &self.highlighter);
            });

            for action in actions {
                match action {
                    PermissionAction::Allow { request_id, updated_input } => {
                        if let Some(handle) = &self.current_handle {
                            handle.send_permission_response(
                                request_id.clone(),
                                PermissionDecision::Allow { updated_input: Some(updated_input) },
                            );
                        }
                        if let Some(call) = self.find_tool_call_by_request_id_mut(&request_id) {
                            call.pending_permission = None;
                        }
                    }
                    PermissionAction::Deny { request_id, reason } => {
                        if let Some(handle) = &self.current_handle {
                            handle.send_permission_response(request_id.clone(), PermissionDecision::Deny { reason });
                        }
                        if let Some(call) = self.find_tool_call_by_request_id_mut(&request_id) {
                            call.pending_permission = None;
                        }
                    }
                }
            }
        });

        // 有待确认的权限请求时,保持倒计时每半秒刷新一次(否则 eframe 默认只在输入事件时重绘)。
        if self.has_pending_permission() {
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(500));
        }
    }
}
