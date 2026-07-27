mod commands;
mod sidecar;
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
                // 先收割上次运行残留的孤儿 sidecar(崩溃/强杀时 ExitRequested 不触发,
                // 清理逻辑跑不到),否则残留会持续攥着 node.exe 句柄导致安装失败
                sidecar::reap_orphans(app.handle());
                let (port, token) = sidecar::spawn(app.handle())?;
                let state = app.state::<AppState>();
                *state.backend_port.lock().unwrap() = Some(port);
                // 令牌只存在内存里,前端经 backend_auth_token 取。不落盘、不进命令行。
                *state.auth_token.lock().unwrap() = Some(token);
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
                    // 后端启用鉴权后,这个内部请求同样要带令牌,否则收尾会被 401 挡掉
                    let token = app_handle.state::<AppState>().auth_token.lock().unwrap().clone();
                    sidecar::graceful_shutdown(port, token.as_deref());
                }
                sidecar::kill(app_handle);
            }
        });
}
