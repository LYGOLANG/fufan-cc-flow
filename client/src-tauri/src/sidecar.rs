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

/// 生成本次运行的接口访问令牌(32 字节 OS 熵源 → 64 位十六进制)。
///
/// 后端只绑 127.0.0.1,但本机上任何进程都能往那个端口发请求,而这套接口能读写
/// 文件、执行 CLI、开终端、读取存着 API Key 的配置。令牌把「谁能调」这条边界
/// 立起来:它只经环境变量传给 sidecar、经 Tauri command 传给前端,不落盘、
/// 不进命令行参数(命令行在进程列表里对其它进程可见)。每次启动都换新的。
fn generate_auth_token() -> String {
    let mut bytes = [0u8; 32];
    // 取不到系统熵源属于严重异常,此时宁可让启动失败也不要退回弱随机
    getrandom::getrandom(&mut bytes).expect("failed to read OS entropy for auth token");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn spawn(app: &tauri::AppHandle) -> Result<(u16, String), Box<dyn std::error::Error>> {
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

    let auth_token = generate_auth_token();
    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .args([entry_str])
        .env("PORT", port.to_string())
        // 后端据此启用鉴权;未设置则整体放行(pnpm dev 的形态)
        .env("CC_FLOW_AUTH_TOKEN", &auth_token)
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
    Ok((port, auth_token))
}

pub fn kill(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarProcess>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            // Windows 上 child.kill() 只终止 sidecar 进程自身,而这个 node 后端会
            // spawn 自己的子进程(Claude CLI、PTY 终端等)——它们会孤儿化存活并继续
            // 攥着安装目录里 node.exe 的文件句柄,导致下次安装报
            // "Error opening file for writing: node.exe"(NSIS 覆盖不了被占用的文件),
            // 且每装一次就多积一个僵尸。故 Windows 走 taskkill /T 按进程树整棵杀。
            #[cfg(windows)]
            {
                let pid = child.pid();
                let _ = child.kill();
                kill_process_tree(pid);
            }
            #[cfg(not(windows))]
            {
                let _ = child.kill();
            }
        }
    }
}

/// Windows: 按 PID 杀掉整棵进程树(/T 含所有后代, /F 强制)。
/// 用 CREATE_NO_WINDOW 避免退出瞬间闪黑框。
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

/// 启动时清理上一次运行残留的孤儿 sidecar。
///
/// 兜底 kill() 覆盖不到的场景:进程崩溃、任务管理器强杀、系统断电——这些情况下
/// Tauri 的 ExitRequested 根本不触发,清理逻辑一次都不跑,残留会持续累积。
/// 判据严格:只杀「可执行文件路径正是本安装目录下 node.exe」的进程,绝不误伤
/// 用户自己的 node(开发服务器、其他 Electron 应用等)。
#[cfg(windows)]
pub fn reap_orphans(app: &tauri::AppHandle) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // sidecar 二进制与主程序同目录(Tauri externalBin 的布局)
    let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().map(|d| d.to_path_buf())) else {
        return;
    };
    let Some(exe_dir) = exe_dir else { return };
    let node_path = exe_dir.join("node.exe");
    let node_path_str = node_path.to_string_lossy().to_string();
    let node_path_str = node_path_str
        .strip_prefix(r"\\?\")
        .map(str::to_string)
        .unwrap_or(node_path_str);

    let self_pid = std::process::id();

    // WMIC 已在新版 Windows 弃用,用 PowerShell CIM 查询;单引号转义防注入
    let escaped = node_path_str.replace('\'', "''");
    let script = format!(
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | \
         Where-Object {{ $_.ExecutablePath -eq '{escaped}' -and $_.ProcessId -ne {self_pid} }} | \
         ForEach-Object {{ $_.ProcessId }}"
    );

    let Ok(out) = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return;
    };

    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            log::warn!("[sidecar] reaping orphan node.exe from previous run: pid {pid}");
            kill_process_tree(pid);
        }
    }
    let _ = app; // 保持签名一致,非 Windows 分支需要
}

#[cfg(not(windows))]
pub fn reap_orphans(_app: &tauri::AppHandle) {}

/// 退出前的优雅收尾:调后端 POST /api/system/shutdown-all,让它中止所有运行中任务
/// 并把「被中止的任务」同步落盘(下次启动提醒)。用 std TcpStream 手写 HTTP,
/// 不引额外依赖;整体限时 ~3s,失败/超时不阻塞退出,随后仍会硬杀 sidecar 兜底。
pub fn graceful_shutdown(port: u16, auth_token: Option<&str>) {
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

    // 后端启用鉴权后,这个内部请求同样要带令牌,否则收尾会被 401 挡掉,
    // 「上次被中止的任务」就登记不上。
    let auth_header = match auth_token {
        Some(t) => format!("x-cc-flow-token: {t}\r\n"),
        None => String::new(),
    };
    let req = format!(
        "POST /api/system/shutdown-all HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth_header}Content-Length: 0\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_ok() {
        // 等后端处理完(它同步落盘登记后才响应),读到响应或超时即继续退出
        let mut buf = [0u8; 512];
        let _ = stream.read(&mut buf);
        log::info!("[shutdown] backend graceful shutdown done");
    }
}
