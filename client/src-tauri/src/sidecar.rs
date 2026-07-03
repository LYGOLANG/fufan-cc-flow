use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 打包后(release)桌面壳自己拉起的本地 Node 后端子进程句柄。放进 AppState 只是为了
/// 关闭窗口时能把它一起杀掉——不然装了这个 app 的用户退出后,后端还会在后台裸跑。
pub struct SidecarProcess(pub Mutex<Option<CommandChild>>);

pub fn spawn(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let entry = resource_dir.join("server-dist").join("dist").join("index.js");

    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .args([entry.to_string_lossy().to_string()])
        .spawn()?;

    // 把内置后端的 stdout/stderr 转发进应用日志,方便打包后排查"后端没起来"之类的问题。
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => log::info!("[server] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Stderr(line) => log::warn!("[server] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Error(err) => log::error!("[server] spawn error: {err}"),
                CommandEvent::Terminated(payload) => log::warn!("[server] exited: {payload:?}"),
                _ => {}
            }
        }
    });

    app.manage(SidecarProcess(Mutex::new(Some(child))));
    Ok(())
}

pub fn kill(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarProcess>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}
