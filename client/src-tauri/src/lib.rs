mod commands;
mod sidecar;
mod state;

use commands::chat::{abort, permission_response, send_message};
use state::AppState;
use tauri::{Manager, State};

#[tauri::command]
fn backend_port(state: State<'_, AppState>) -> Option<u16> {
  *state.backend_port.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    // 自动升级:检查/下载/安装由前端经 plugin-updater JS API 触发,
    // 安装完成后经 plugin-process 的 relaunch 重启应用
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![send_message, abort, permission_response, backend_port])
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
        let port = sidecar::spawn(app.handle())?;
        let state = app.state::<AppState>();
        *state.backend_port.lock().unwrap() = Some(port);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::ExitRequested { .. } = event {
        // 先让后端优雅收尾(中止运行中任务 + 落盘"被中止"登记,限时),再硬杀 sidecar 兜底
        let port = app_handle
          .state::<AppState>()
          .backend_port
          .lock()
          .unwrap()
          .clone();
        if let Some(port) = port {
          sidecar::graceful_shutdown(port);
        }
        sidecar::kill(app_handle);
      }
    });
}
