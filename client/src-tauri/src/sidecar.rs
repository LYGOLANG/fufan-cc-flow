use std::sync::Mutex;
use std::net::TcpListener;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 打包后(release)桌面壳自己拉起的本地 Node 后端子进程句柄。放进 AppState 只是为了
/// 关闭窗口时能把它一起杀掉——不然装了这个 app 的用户退出后,后端还会在后台裸跑。
pub struct SidecarProcess(pub Mutex<Option<CommandChild>>);

fn reserve_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

pub fn spawn(app: &tauri::AppHandle) -> Result<u16, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let entry = resource_dir.join("server-dist").join("dist").join("index.js");
    let port = reserve_port()?;

    // resource_dir() 在 Windows 返回 \\?\ 前缀的 verbatim 路径,Node v24 模块加载器
    // 解析不了(EISDIR lstat 'D:'),子进程秒退 → 打包后"后端没起来"。剥掉前缀再传。
    let entry_str = entry.to_string_lossy().to_string();
    let entry_str = entry_str
        .strip_prefix(r"\\?\")
        .map(str::to_string)
        .unwrap_or(entry_str);

    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .args([entry_str])
        .env("PORT", port.to_string())
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
    Ok(port)
}

pub fn kill(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarProcess>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

/// 退出前的优雅收尾:调后端 POST /api/system/shutdown-all,让它中止所有运行中任务
/// 并把「被中止的任务」同步落盘(下次启动提醒)。用 std TcpStream 手写 HTTP,
/// 不引额外依赖;整体限时 ~3s,失败/超时不阻塞退出,随后仍会硬杀 sidecar 兜底。
pub fn graceful_shutdown(port: u16) {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        log::warn!("[shutdown] backend not reachable on port {port}, skip graceful shutdown");
        return;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));

    let req = format!(
        "POST /api/system/shutdown-all HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_ok() {
        // 等后端处理完(它同步落盘登记后才响应),读到响应或超时即继续退出
        let mut buf = [0u8; 512];
        let _ = stream.read(&mut buf);
        log::info!("[shutdown] backend graceful shutdown done");
    }
}
