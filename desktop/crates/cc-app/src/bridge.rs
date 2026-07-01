//! 后台 tokio 运行时线程 + 到 egui 帧循环的桥接。
//!
//! eframe::run_native 必须占住真正的主线程,所以 tokio runtime 挪到一个专门的
//! 后台线程上跑;UI 侧只留一个 `tokio::runtime::Handle`,用它 `.spawn()` 异步任务。

use tokio::runtime::Handle;

pub struct Bridge {
    pub handle: Handle,
    _rt_thread: std::thread::JoinHandle<()>,
}

impl Bridge {
    pub fn new() -> Self {
        let (handle_tx, handle_rx) = std::sync::mpsc::channel();
        let rt_thread = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("build tokio runtime");
            handle_tx.send(rt.handle().clone()).expect("send tokio handle");
            rt.block_on(std::future::pending::<()>());
        });
        let handle = handle_rx.recv().expect("receive tokio handle");
        Self { handle, _rt_thread: rt_thread }
    }
}
