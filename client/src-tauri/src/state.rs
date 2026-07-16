use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex};

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
    /// 每次开始新任务或取消任务都会递增；异步 spawn 只允许把 handle 写回同一代状态。
    pub generation: u64,
}

impl ProjectSession {
    pub fn begin_turn(&mut self) -> u64 {
        self.busy = true;
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    pub fn is_generation(&self, generation: u64) -> bool {
        self.generation == generation
    }

    pub fn is_active_generation(&self, generation: u64) -> bool {
        self.busy && self.is_generation(generation)
    }

    pub fn invalidate_turn(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.busy = false;
        self.queue.clear();
    }
}

#[derive(Default)]
struct LifecycleState {
    exiting: bool,
    pending_spawns: usize,
}

#[derive(Clone, Default)]
pub struct AppState {
    /// key = 项目路径(前端 uiStore.projectPath 的值)。
    pub sessions: Arc<Mutex<HashMap<String, ProjectSession>>>,
    /// Release 桌面端内置 Node 后端监听端口。dev 模式后端由开发者自行启动。
    pub backend_port: Arc<Mutex<Option<u16>>>,
    /// 覆盖“已开始 spawn、尚未把 SessionHandle 写回 sessions”的窗口。
    /// ExitRequested 先封门并等待 pending_spawns 清零，再 drain sessions。
    lifecycle: Arc<(Mutex<LifecycleState>, Condvar)>,
}

impl AppState {
    pub fn try_begin_spawn(&self) -> bool {
        let (lock, _) = &*self.lifecycle;
        let mut lifecycle = lock.lock().unwrap();
        if lifecycle.exiting {
            return false;
        }
        lifecycle.pending_spawns += 1;
        true
    }

    pub fn finish_spawn(&self) {
        let (lock, ready) = &*self.lifecycle;
        let mut lifecycle = lock.lock().unwrap();
        debug_assert!(lifecycle.pending_spawns > 0);
        lifecycle.pending_spawns = lifecycle.pending_spawns.saturating_sub(1);
        if lifecycle.pending_spawns == 0 {
            ready.notify_all();
        }
    }

    pub fn begin_exit_and_wait_for_spawns(&self) {
        let (lock, ready) = &*self.lifecycle;
        let mut lifecycle = lock.lock().unwrap();
        lifecycle.exiting = true;
        while lifecycle.pending_spawns > 0 {
            lifecycle = ready.wait(lifecycle).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn cancelled_generation_rejects_a_late_spawn() {
        let mut project = ProjectSession::default();
        let spawning_generation = project.begin_turn();
        assert!(project.is_active_generation(spawning_generation));

        project.invalidate_turn();
        assert!(!project.is_active_generation(spawning_generation));
        assert!(!project.busy);

        let cancelled_generation = project.generation;
        let replacement_generation = project.begin_turn();
        assert_ne!(replacement_generation, cancelled_generation);
        assert!(project.busy);
        assert!(!project.is_generation(cancelled_generation));
    }

    #[test]
    fn exit_waits_for_in_flight_spawn_and_blocks_new_ones() {
        let state = AppState::default();
        assert!(state.try_begin_spawn());

        let exit_state = state.clone();
        let (done_tx, done_rx) = mpsc::channel();
        let exit_thread = std::thread::spawn(move || {
            exit_state.begin_exit_and_wait_for_spawns();
            done_tx.send(()).unwrap();
        });

        assert!(matches!(
            done_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        state.finish_spawn();
        done_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        exit_thread.join().unwrap();
        assert!(!state.try_begin_spawn());
    }
}
