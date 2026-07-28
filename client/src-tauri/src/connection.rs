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
///
/// 一并存下 RemoteConfig:按需转发预览端口时还要再发 ssh,而那时配置文件
/// 可能已被用户改过 —— 必须用**当前连接实际使用的**那份,否则会把转发建到
/// 另一台机器上。
pub struct RemoteBackendState {
    pub session: Mutex<Option<RemoteSession>>,
    pub config: RemoteConfig,
    /// 已建立的预览端口转发:远端端口 -> 本机转发。
    /// 复用而非每次新建,否则用户多点几次预览就攒出一堆 ssh 进程。
    pub forwards: Mutex<std::collections::HashMap<u16, crate::ssh::ForwardedPort>>,
}

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
            app.manage(RemoteBackendState {
                session: Mutex::new(Some(session)),
                config: remote,
                forwards: Mutex::new(std::collections::HashMap::new()),
            });
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
        // 先收预览端口转发:它们是独立的 ssh 进程,不随主隧道一起消失,
        // 漏掉就会在用户退出应用后继续挂在后台
        if let Ok(mut fwd) = state.forwards.lock() {
            for (_, f) in fwd.iter_mut() {
                crate::ssh::stop_forward(f);
            }
            fwd.clear();
        }
        if let Some(mut session) = state.session.lock().unwrap().take() {
            crate::ssh::stop(&mut session);
        }
    }
    crate::sidecar::kill(app);
}

/// 为远端端口开(或复用)一条转发,返回本机端口。本机模式下原样返回。
pub fn forward_remote_port(app: &tauri::AppHandle, remote_port: u16) -> Result<u16, String> {
    let Some(state) = app.try_state::<RemoteBackendState>() else {
        // 本机模式:localhost:N 本来就指向这台机器,不需要任何转发
        return Ok(remote_port);
    };
    let mut forwards = state
        .forwards
        .lock()
        .map_err(|_| "端口转发表被污染".to_string())?;

    let known_locals: Vec<u16> = forwards.values().map(|f| f.local_port).collect();
    match resolve_forward_target(&forwards.iter().map(|(k, v)| (*k, v.local_port)).collect(), &known_locals, remote_port) {
        ForwardDecision::Reuse(local) | ForwardDecision::AlreadyLocal(local) => Ok(local),
        ForwardDecision::NeedNew => {
            let f = crate::ssh::forward_port(&state.config, remote_port)?;
            let local = f.local_port;
            forwards.insert(remote_port, f);
            Ok(local)
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ForwardDecision {
    /// 该远端端口已经转发过,复用现有的本机端口
    Reuse(u16),
    /// 传入的值本身就是一个已转发出来的本机端口(而非待转发的远端端口)
    AlreadyLocal(u16),
    NeedNew,
}

/// 纯决策逻辑,从副作用(真正建立 ssh 转发)中拆出来以便测试。
///
/// `known: 远端端口 -> 本机端口` 的既有映射;`known_locals` 是其值的集合,
/// 用于判断"幂等保护"那一支 —— 调用方可能把已解析出的本机端口当参数
/// 再传一次(典型场景:地址栏已显示 127.0.0.1:X,用户点"用系统浏览器打开"
/// 时原样把它又送进来)。此时它是本机端口而非待转发的远端端口,应原样放行,
/// 否则会把这个本机端口号误当成远端端口去转发,建出一条指向错误目标的隧道。
fn resolve_forward_target(
    known: &std::collections::HashMap<u16, u16>,
    known_locals: &[u16],
    requested: u16,
) -> ForwardDecision {
    if let Some(&local) = known.get(&requested) {
        return ForwardDecision::Reuse(local);
    }
    if known_locals.contains(&requested) {
        return ForwardDecision::AlreadyLocal(requested);
    }
    ForwardDecision::NeedNew
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

    #[test]
    fn 未知远端端口触发新建转发() {
        let known = std::collections::HashMap::new();
        assert_eq!(resolve_forward_target(&known, &[], 3000), ForwardDecision::NeedNew);
    }

    #[test]
    fn 已转发过的远端端口直接复用() {
        let mut known = std::collections::HashMap::new();
        known.insert(3000u16, 51000u16);
        assert_eq!(
            resolve_forward_target(&known, &[51000], 3000),
            ForwardDecision::Reuse(51000)
        );
    }

    #[test]
    fn 已解析出的本机端口原样放行不二次转发() {
        // 这是双重解析的场景:BrowserPanel 把地址栏里已经是 127.0.0.1:51000
        // 的 URL 又送进 resolveExternalUrl 一次(比如点"用系统浏览器打开")。
        // 51000 是本机端口,不是远端端口,不能拿去发起新的 ssh 转发。
        let mut known = std::collections::HashMap::new();
        known.insert(3000u16, 51000u16);
        assert_eq!(
            resolve_forward_target(&known, &[51000], 51000),
            ForwardDecision::AlreadyLocal(51000)
        );
    }
}
