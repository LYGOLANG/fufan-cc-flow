use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use cc_core::{SessionHandle, SpawnConfig};

/// 排队等待发送的消息(项目当前正忙时,新消息不新起进程、也不阻塞输入框,先进队列;
/// 等当前轮结束自动用 --resume 接着发出去)。
pub struct QueuedMessage {
    pub prompt: String,
    pub cfg: SpawnConfig,
}

/// 一个项目(以项目路径为 key)的会话状态。每个项目互相独立,互不打断——
/// 用户明确要求"多个项目能同时跑,切换项目不能把另一个项目的任务打断"。
#[derive(Default)]
pub struct ProjectSession {
    /// 最近一次真实 session id(来自 session_init),下一轮 --resume 用这个。
    pub session_id: Option<String>,
    /// 当前活跃进程的句柄(只有正在跑的时候才有)。
    pub handle: Option<SessionHandle>,
    /// 是否有一轮正在处理中。
    pub busy: bool,
    pub queue: VecDeque<QueuedMessage>,
}

#[derive(Clone, Default)]
pub struct AppState {
    /// key = 项目路径(前端 uiStore.projectPath 的值)。
    pub sessions: Arc<Mutex<HashMap<String, ProjectSession>>>,
    /// Release 桌面端内置 Node 后端监听端口。dev 模式后端由开发者自行启动。
    pub backend_port: Arc<Mutex<Option<u16>>>,
}
