//! 后端连接策略:本机 sidecar 还是远程(SSH 隧道)。
//!
//! 改造前 `lib.rs` 里只有一个 `if cfg!(debug_assertions)` 分支,它同时决定了三件事:
//! 要不要清孤儿、要不要起 sidecar、`AppState` 里有没有 port/token。判据是**编译模式**,
//! 运行时无从选择。远程连接需要的正是"运行时可选",故把这个决策抽到这里。
//!
//! # 默认必须等价于现状
//!
//! 配置文件不存在、读不出、或写着 local —— 一律走本机路径,行为与改造前逐字一致:
//! 清孤儿、起 sidecar、拿本机 port/token。这条是硬要求:绝大多数用户永远不会碰
//! 远程功能,他们不该因为这个特性的存在而承担任何行为变化或新增的失败模式。

use std::sync::Mutex;

use tauri::Manager;

use crate::ssh::{RemoteConfig, RemoteSession};

/// 配置文件名(位于 Tauri 的 app config dir)
const CONFIG_FILE: &str = "connection.json";

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// "local" | "remote"。未知值一律当作 local(fail-safe:宁可退回本机,
    /// 也不要因为配置里一个拼写错误就让应用连不上任何后端)。
    #[serde(default)]
    pub mode: ConnectionMode,
    /// 远程连接参数。mode = remote 时必须存在。
    #[serde(default)]
    pub remote: Option<RemoteConfig>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
    #[default]
    Local,
    Remote,
}

/// 运行中的远程会话。放进 Tauri 托管状态,退出时取出来关掉。
pub struct RemoteBackendState(pub Mutex<Option<RemoteSession>>);

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// 读取连接配置。任何异常都退回 Local —— 见文件头「默认必须等价于现状」。
pub fn load(app: &tauri::AppHandle) -> ConnectionConfig {
    let Ok(path) = config_path(app) else {
        return ConnectionConfig::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        // 文件不存在是绝大多数用户的常态,不值得记 warn
        return ConnectionConfig::default();
    };
    match serde_json::from_str::<ConnectionConfig>(&text) {
        Ok(cfg) => cfg,
        Err(e) => {
            log::warn!("[connection] 配置解析失败,退回本机模式: {e}");
            ConnectionConfig::default()
        }
    }
}

pub fn save(app: &tauri::AppHandle, cfg: &ConnectionConfig) -> Result<(), String> {
    // 存的是连接目标,不含任何密码或私钥内容(私钥只存路径,由 ssh 自己去读),
    // 因此不需要与凭据文件同级的 ACL 收紧。
    if cfg.mode == ConnectionMode::Remote {
        let remote = cfg
            .remote
            .as_ref()
            .ok_or_else(|| "选择了远程模式但没有填写连接信息".to_string())?;
        remote.validate()?;
    }
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(())
}

/// 启动后端并返回 (前端该连的端口, 鉴权令牌)。
///
/// 两条路径的返回值语义完全一致 —— 前端拿到的永远是「本机某个端口 + 令牌」,
/// 它不需要知道那个端口后面是本机 Node 还是一条通往另一台机器的隧道。
/// 这正是 CSP / CORS / endpoint.ts 全都不用改的原因。
pub fn start_backend(app: &tauri::AppHandle) -> Result<(u16, String), String> {
    let cfg = load(app);

    match cfg.mode {
        ConnectionMode::Local => {
            // 先收割上次运行残留的孤儿 sidecar(崩溃/强杀时 ExitRequested 不触发)
            crate::sidecar::reap_orphans(app);
            crate::sidecar::spawn(app).map_err(|e| format!("启动本机后端失败: {e}"))
        }
        ConnectionMode::Remote => {
            let remote = cfg
                .remote
                .ok_or_else(|| "配置为远程模式,但缺少连接信息".to_string())?;

            // 注意这里**不**调 reap_orphans:那是清理本机 node.exe 的逻辑,
            // 远程模式下本机压根没起过 sidecar,跑它只会误伤(比如用户同时开着
            // 另一个本机模式的窗口)。
            let token = crate::sidecar::generate_auth_token();
            let local_port = crate::sidecar::reserve_port()
                .map_err(|e| format!("无法分配本地端口: {e}"))?;

            let session = crate::ssh::start(&remote, &token, local_port)?;
            app.manage(RemoteBackendState(Mutex::new(Some(session))));
            Ok((local_port, token))
        }
    }
}

/// 退出时收尾。本机模式杀 sidecar,远程模式关隧道。
///
/// 两者不会同时存在:`start_backend` 只会走其中一条路径。这里都试一遍是因为
/// `try_state` 拿不到就是 None,代价可以忽略,而漏掉一条的后果是进程泄漏。
pub fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<RemoteBackendState>() {
        if let Some(mut session) = state.0.lock().unwrap().take() {
            crate::ssh::stop(&mut session);
        }
    }
    crate::sidecar::kill(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 未知模式退回本机() {
        // fail-safe:配置里的拼写错误不该让应用连不上任何后端
        let cfg: ConnectionConfig = serde_json::from_str(r#"{"mode":"local"}"#).unwrap();
        assert_eq!(cfg.mode, ConnectionMode::Local);

        // 缺字段时也应是 local
        let cfg: ConnectionConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.mode, ConnectionMode::Local);
        assert!(cfg.remote.is_none());
    }

    #[test]
    fn 远程配置能完整往返() {
        let json = r#"{
            "mode": "remote",
            "remote": {
                "host": "192.168.1.10",
                "sshPort": 22,
                "user": "dev",
                "remoteDir": "/opt/agent-flow-server",
                "remotePort": 3001
            }
        }"#;
        let cfg: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.mode, ConnectionMode::Remote);
        let r = cfg.remote.as_ref().unwrap();
        assert_eq!(r.host, "192.168.1.10");
        assert_eq!(r.remote_dir, "/opt/agent-flow-server");
        assert!(r.identity_file.is_none(), "未填私钥时应交给 ssh 自行决定");

        // 再序列化回去仍能解析(设置页保存→重启读取的往返)
        let text = serde_json::to_string(&cfg).unwrap();
        let back: ConnectionConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(back.mode, ConnectionMode::Remote);
    }
}
