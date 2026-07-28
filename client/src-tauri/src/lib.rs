mod commands;
mod connection;
mod sidecar;
mod ssh;
mod state;
mod watchdog;

use commands::chat::{
    abort, permission_response, resolve_project_path, send_message, shutdown_all, shutdown_project,
};
use commands::system::system_proxy;
use watchdog::{crash_recovery_state, record_frontend_error, webview_heartbeat, Heartbeat};
use state::AppState;
use tauri::{Manager, State};

#[tauri::command]
fn backend_port(state: State<'_, AppState>) -> Option<u16> {
    *state.backend_port.lock().unwrap()
}

/// 前端取本次运行的接口访问令牌。
///
/// 只有跑在本应用 WebView 里的前端能调到这个 command,所以令牌不会落到其它
/// 进程手里 —— 这正是「谁能调后端接口」这条边界的实现方式。dev 模式返回
/// None(后端也没启用鉴权)。
#[tauri::command]
fn backend_auth_token(state: State<'_, AppState>) -> Option<String> {
    state.auth_token.lock().unwrap().clone()
}

/// 后端为什么没起来。前端在拿不到端口时用它给出具体原因,
/// 而不是让用户对着一个连不上的界面猜。
#[tauri::command]
fn backend_error(state: State<'_, AppState>) -> Option<String> {
    state.backend_error.lock().unwrap().clone()
}

#[tauri::command]
fn get_connection_config(app: tauri::AppHandle) -> connection::ConnectionConfig {
    connection::load(&app)
}

/// 把远端的某个端口映射到本机,返回本机端口。本机模式下原样返回。
///
/// 给"打开 http://localhost:3000 预览"这类链接用:那个 localhost 指的是
/// 远程机器,直接在本机浏览器打开只会访问用户自己电脑的同号端口。
#[tauri::command]
fn forward_remote_port(app: tauri::AppHandle, port: u16) -> Result<u16, String> {
    connection::forward_remote_port(&app, port)
}

/// 保存连接配置。**下次启动生效** —— 不做热切换。
///
/// 热切换意味着要在运行中把所有 WebSocket、正在跑的会话、终端 PTY 全部迁移到
/// 新后端,而这些状态有一半在远端。为一个低频操作(改服务器地址)引入这种复杂度
/// 不划算,重启一次是更诚实的答案。
#[tauri::command]
fn set_connection_config(
    app: tauri::AppHandle,
    config: connection::ConnectionConfig,
) -> Result<(), String> {
    connection::save(&app, &config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // 自动升级:检查/下载/安装由前端经 plugin-updater JS API 触发,
        // 安装完成后经 plugin-process 的 relaunch 重启应用
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // 外链用系统默认浏览器打开:桌面壳里点 http(s) 链接若走 WebView 自身导航,
        // 会把应用整个变成浏览器且无返回入口(用户视角=应用卡死在网页上)。
        // 只给"打开 URL"能力,不给 shell 执行权限。
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .manage(std::sync::Arc::new(Heartbeat::default()))
        .invoke_handler(tauri::generate_handler![
            send_message,
            abort,
            permission_response,
            shutdown_project,
            resolve_project_path,
            backend_port,
            backend_auth_token,
            backend_error,
            get_connection_config,
            set_connection_config,
            forward_remote_port,
            system_proxy,
            webview_heartbeat,
            crash_recovery_state,
            record_frontend_error
        ])
        .setup(|app| {
            // release 也注册日志(写入 %LOCALAPPDATA%\com.fufan.ccflow\logs),否则 sidecar
            // 的 stderr / Terminated 事件全被吞掉,打包后无从排障。
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            if cfg!(debug_assertions) {
                // dev 模式下后端由开发者自己用 `pnpm --filter server dev` 起,不重复拉一份。
            } else {
                // 连本机 sidecar 还是连远程(SSH 隧道)由运行时配置决定,见 connection.rs。
                // 无论走哪条,拿到的都是「本机某端口 + 令牌」,前端不感知差异。
                match connection::start_backend(app.handle()) {
                    Ok((port, token)) => {
                        let state = app.state::<AppState>();
                        *state.backend_port.lock().unwrap() = Some(port);
                        // 令牌只存在内存里,前端经 backend_auth_token 取。不落盘、不进命令行。
                        *state.auth_token.lock().unwrap() = Some(token);
                    }
                    Err(e) => {
                        // 远程连接失败不该让整个应用起不来(原先本机 spawn 用 `?`,
                        // 失败即启动失败)。远端不可达是常态:关机、换网、密钥过期。
                        // 让窗口正常打开,前端会因拿不到端口而显示连接错误,用户还能
                        // 进设置改回本机模式——否则就是"改错一个配置,应用再也打不开"。
                        log::error!("[connection] 后端启动失败: {e}");
                        *app.state::<AppState>().backend_error.lock().unwrap() = Some(e);
                    }
                }
            }

            // WebView 崩溃自愈看门狗:渲染进程崩了(实测 STATUS_BREAKPOINT)窗口会被
            // Edge 错误页接管、应用形同死机。Tauri 2.11 拿不到崩溃回调,故用前端心跳
            // 断流间接探测,超时自动 reload 拉活,并把现场写进独立日志。
            let hb = app.state::<std::sync::Arc<Heartbeat>>().inner().clone();
            watchdog::spawn(app.handle().clone(), hb);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_all(&app_handle.state::<AppState>());
                // 先让后端优雅收尾(中止运行中任务 + 落盘"被中止"登记,限时),再硬杀 sidecar 兜底
                let port = *app_handle.state::<AppState>().backend_port.lock().unwrap();
                if let Some(port) = port {
                    // 后端启用鉴权后,这个内部请求同样要带令牌,否则收尾会被 401 挡掉。
                    // 远程模式下这条请求经隧道送到远端后端 —— 那个后端是本应用启动的、
                    // 独占的,关它是对的。将来做会话共享时这里要改:那时后端可能还有
                    // 其他连接方在用,不能说关就关。
                    let token = app_handle.state::<AppState>().auth_token.lock().unwrap().clone();
                    sidecar::graceful_shutdown(port, token.as_deref());
                }
                // 本机模式杀 sidecar,远程模式关隧道(杀掉 ssh 即可,远端包装 shell
                // 会因 stdin EOF 自行收掉后端进程)
                connection::stop_backend(app_handle);
            }
        });
}
