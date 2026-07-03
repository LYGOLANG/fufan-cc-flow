mod commands;
mod sidecar;
mod state;

use commands::chat::{abort, permission_response, send_message};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![send_message, abort, permission_response])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
        // dev 模式下后端由开发者自己用 `pnpm --filter server dev` 起,不重复拉一份。
      } else {
        sidecar::spawn(app.handle())?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::ExitRequested { .. } = event {
        sidecar::kill(app_handle);
      }
    });
}
