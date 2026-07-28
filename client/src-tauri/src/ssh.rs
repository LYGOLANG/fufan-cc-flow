//! 远程后端:通过 SSH 隧道连到另一台机器上的 Node 后端。
//!
//! # 为什么这样设计
//!
//! 远程后端**由本机经 SSH 启动**,而不是去连一个别人已经跑着的服务。这个选择
//! 让三处本来会致命的约束自动失效:
//!
//! - `tauri.conf.json` 的 CSP 只允许 `connect-src localhost/127.0.0.1`。隧道把
//!   远程端口映射到本机端口,前端连的仍然是 `localhost:<本地端口>`,CSP 无需放宽
//!   ——而放宽它等于拆掉当前安全模型的一层。
//! - 后端的 CORS 白名单只放行本地来源。Guest 端 Origin 仍是 `tauri://localhost`。
//! - 后端只绑 `127.0.0.1`。隧道出口就在远程本机,源 IP 正是 `127.0.0.1`。
//!
//! 更关键的是令牌:既然后端是我们启动的,就能像本机一样注入 `CC_FLOW_AUTH_TOKEN`,
//! 于是前端「渲染前阻塞取令牌」的时序一行都不用改,也就不存在异步取令牌带来的
//! 401 竞态。
//!
//! # 两个被实测逼出来的细节(改动前先读完)
//!
//! 1. **远程命令不能用 `exec node ...`**。SSH 断开时远端进程收不到任何信号,
//!    后端会一直裸跑——用户每开一次应用就在服务器上多堆一个僵尸后端,还各自
//!    占着端口。故用包装 shell 读 stdin 至 EOF(ssh 一断即 EOF)后主动收子进程。
//! 2. **令牌必须走 stdin,不能进命令行**。远程往往是多用户机器,`ps aux` 全局
//!    可见;令牌落到那里,等于把读写文件、执行命令、读取存有 API Key 的配置
//!    这些权限交给了那台机器上的所有用户。
//!
//! 两条都有 `scripts/verify-remote-tunnel.mjs` 的端到端断言看着,别"顺手简化"。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// 远程连接配置。字段名与前端设置项一一对应(camelCase)。
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfig {
    /// 目标主机名或 IP
    pub host: String,
    /// SSH 端口
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    /// 登录用户名
    pub user: String,
    /// 私钥路径。为 None 时交给 ssh 自己决定(~/.ssh/id_* 或 ssh-agent)
    #[serde(default)]
    pub identity_file: Option<String>,
    /// 远程后端的安装目录,即 `scripts/install-remote.sh` 的 target-dir
    pub remote_dir: String,
    /// 后端在远端监听的端口(仅在远端 127.0.0.1 上,不对外)
    #[serde(default = "default_remote_port")]
    pub remote_port: u16,
}

fn default_ssh_port() -> u16 {
    22
}
fn default_remote_port() -> u16 {
    3001
}

impl RemoteConfig {
    /// 配置自检。这些值最终会拼进 ssh 参数,空值或带控制字符的值要么让 ssh 报出
    /// 难懂的错,要么造成参数注入,故在进入命令行之前就挡掉。
    pub fn validate(&self) -> Result<(), String> {
        fn clean(name: &str, v: &str) -> Result<(), String> {
            if v.trim().is_empty() {
                return Err(format!("{name} 不能为空"));
            }
            // 换行会把一个参数劈成两个;`-` 开头会被 ssh 当成选项
            if v.chars().any(|c| c.is_control()) {
                return Err(format!("{name} 含有控制字符"));
            }
            if v.starts_with('-') {
                return Err(format!("{name} 不能以 - 开头"));
            }
            Ok(())
        }
        clean("主机", &self.host)?;
        clean("用户名", &self.user)?;
        clean("远程目录", &self.remote_dir)?;
        if let Some(id) = &self.identity_file {
            clean("私钥路径", id)?;
        }
        if self.ssh_port == 0 || self.remote_port == 0 {
            return Err("端口不能为 0".into());
        }
        Ok(())
    }

    pub fn label(&self) -> String {
        format!("{}@{}:{}", self.user, self.host, self.ssh_port)
    }
}

/// 正在运行的远程连接。持有 ssh 进程句柄——它同时承载隧道与远端后端的生命周期,
/// 杀掉它,远端包装 shell 收到 stdin EOF 后会自行收掉后端。
pub struct RemoteSession {
    pub child: Child,
    pub local_port: u16,
}

/// 解析 ssh 可执行文件的绝对路径。
///
/// 不直接用 `Command::new("ssh")` 依赖 PATH 查找:PATH 可被同名程序劫持,而这条
/// 命令会拿到用户的私钥。Windows 上优先系统自带的 OpenSSH。
fn resolve_ssh() -> Result<std::path::PathBuf, String> {
    #[cfg(windows)]
    {
        if let Ok(sysroot) = std::env::var("SystemRoot") {
            let p = std::path::Path::new(&sysroot)
                .join("System32")
                .join("OpenSSH")
                .join("ssh.exe");
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    #[cfg(not(windows))]
    {
        for p in ["/usr/bin/ssh", "/bin/ssh", "/usr/local/bin/ssh"] {
            let p = std::path::Path::new(p);
            if p.is_file() {
                return Ok(p.to_path_buf());
            }
        }
    }
    Err("未找到 ssh 客户端。Windows 请安装「OpenSSH 客户端」可选功能。".into())
}

/// 远端执行的命令。
///
/// 注意 `node dist/index.js &` + `cat > /dev/null` 这个组合:前者让后端在后台跑,
/// 后者阻塞到 stdin 关闭(即 ssh 断开)。缺了它,断线后远端后端会变成孤儿。
fn build_remote_command(cfg: &RemoteConfig) -> String {
    format!(
        "read -r CC_FLOW_AUTH_TOKEN; export CC_FLOW_AUTH_TOKEN; \
         export PORT={port}; \
         cd '{dir}' || {{ echo 'AGENT_FLOW_BAD_DIR' >&2; exit 1; }}; \
         node dist/index.js & \
         NODE_PID=$!; \
         trap 'kill -TERM $NODE_PID 2>/dev/null' EXIT INT TERM HUP; \
         cat > /dev/null; \
         kill -TERM $NODE_PID 2>/dev/null; \
         wait $NODE_PID 2>/dev/null",
        port = cfg.remote_port,
        dir = cfg.remote_dir.replace('\'', r"'\''"),
    )
}

/// 建立隧道并启动远程后端。返回时后端已通过健康检查,可以直接用。
pub fn start(
    cfg: &RemoteConfig,
    auth_token: &str,
    local_port: u16,
) -> Result<RemoteSession, String> {
    cfg.validate()?;
    let ssh = resolve_ssh()?;

    let mut args: Vec<String> = vec![
        "-p".into(),
        cfg.ssh_port.to_string(),
        // 隧道:本机 local_port -> 远端 127.0.0.1:remote_port
        "-L".into(),
        format!("{local_port}:127.0.0.1:{}", cfg.remote_port),
        // 端口占用等转发失败必须直接失败,否则会连上一个没有隧道的会话,
        // 表现为"后端一直不就绪",排查方向完全跑偏
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        // 不弹交互提示:密码/passphrase 输入在 GUI 场景下无处可输,只会挂死
        "-o".into(),
        "BatchMode=yes".into(),
        // 断线检测:每 15s 一次,连续 3 次无响应即断开,避免半死连接长期挂着
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
    ];
    if let Some(id) = &cfg.identity_file {
        args.push("-i".into());
        args.push(id.clone());
    }
    args.push(format!("{}@{}", cfg.user, cfg.host));
    args.push(build_remote_command(cfg));

    log::info!(
        "[remote] connecting {} -> local port {local_port}",
        cfg.label()
    );

    let mut child = Command::new(&ssh)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ssh 失败: {e}"))?;

    // 令牌走 stdin。写完不关闭 stdin——远端那句 `cat > /dev/null` 正靠它保持打开,
    // 一旦关闭,远端会立刻认为"客户端断开"并把后端收掉。
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "无法写入 ssh stdin".to_string())?;
        stdin
            .write_all(format!("{auth_token}\n").as_bytes())
            .map_err(|e| format!("写入令牌失败: {e}"))?;
        stdin.flush().ok();
    }

    // 把 ssh 的 stderr 转进应用日志。"Permission denied"、"Host key verification
    // failed" 这类信息只出现在这里,不转发的话用户只会看到一句干巴巴的"连接失败"。
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                log::warn!("[remote/ssh] {line}");
            }
        });
    }
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                log::info!("[remote/server] {line}");
            }
        });
    }

    match wait_until_ready(local_port, Duration::from_secs(60), &mut child) {
        Ok(()) => {
            log::info!("[remote] backend ready on local port {local_port}");
            Ok(RemoteSession { child, local_port })
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

/// 轮询本地隧道端口上的 `/api/health` 直到后端就绪。
///
/// 同时监视 ssh 进程本身:它先退出说明连接就没建起来(认证失败、端口占用等),
/// 此时应立刻报错,而不是傻等满 60 秒。
fn wait_until_ready(port: u16, timeout: Duration, child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = String::from("未知原因");

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "ssh 提前退出({status})。常见原因:认证失败、主机密钥未信任、\
                 本地端口被占用。详细信息见应用日志中的 [remote/ssh] 行。"
            ));
        }
        match http_get_ok(port, "/api/health") {
            Ok(true) => return Ok(()),
            Ok(false) => last_err = "健康检查返回非 200".into(),
            Err(e) => last_err = e,
        }
        std::thread::sleep(Duration::from_millis(800));
    }
    Err(format!("远程后端在 {}s 内未就绪({last_err})。请确认远端已用 scripts/install-remote.sh 安装,且 node 可用。", timeout.as_secs()))
}

/// 极简 HTTP GET,只关心状态行是不是 200。沿用 `sidecar::graceful_shutdown` 的
/// 做法,用 std TcpStream 手写,不为一次健康检查引入 HTTP 客户端依赖。
fn http_get_ok(port: u16, path: &str) -> Result<bool, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800))
        .map_err(|e| format!("连接本地隧道端口失败: {e}"))?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();

    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("发送健康检查失败: {e}"))?;

    let mut buf = [0u8; 256];
    let n = stream
        .read(&mut buf)
        .map_err(|e| format!("读取健康检查响应失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 200"))
}

/// 断开远程连接。杀掉 ssh 进程即可——远端包装 shell 会因 stdin EOF 自行收掉后端。
pub fn stop(session: &mut RemoteSession) {
    log::info!("[remote] closing tunnel on local port {}", session.local_port);
    let _ = session.child.kill();
    // 等一下,让远端有机会走完 trap 里的清理
    let _ = session.child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> RemoteConfig {
        RemoteConfig {
            host: "example.com".into(),
            ssh_port: 22,
            user: "dev".into(),
            identity_file: None,
            remote_dir: "/opt/agent-flow-server".into(),
            remote_port: 3001,
        }
    }

    #[test]
    fn 拒绝空值与控制字符() {
        let mut c = cfg();
        c.host = "".into();
        assert!(c.validate().is_err(), "空主机名应被拒绝");

        let mut c = cfg();
        c.user = "de\nv".into();
        assert!(c.validate().is_err(), "含换行的用户名应被拒绝:会把一个参数劈成两个");

        let mut c = cfg();
        // 以 - 开头会被 ssh 当作选项解析,是典型的参数注入入口
        c.host = "-oProxyCommand=calc".into();
        assert!(c.validate().is_err(), "以 - 开头的主机名应被拒绝");
    }

    #[test]
    fn 端口为零不合法() {
        let mut c = cfg();
        c.remote_port = 0;
        assert!(c.validate().is_err());
    }

    #[test]
    fn 远程命令必须保留断线清理逻辑() {
        // 这三段决定了 ssh 断开后远端后端会不会变成孤儿。
        // 若有人把它简化成 `exec node ...`,这个测试要立刻失败。
        let cmd = build_remote_command(&cfg());
        assert!(cmd.contains("cat > /dev/null"), "缺少 stdin EOF 阻塞,断线后远端会残留");
        assert!(cmd.contains("trap "), "缺少 trap,异常退出时不会收子进程");
        assert!(cmd.contains("kill -TERM $NODE_PID"), "缺少收尾 kill");
        assert!(!cmd.contains("exec node"), "不得用 exec:那样断线后收不掉后端");
    }

    #[test]
    fn 令牌不出现在远程命令里() {
        // 令牌只能走 stdin。远程命令行对该机所有用户可见(ps aux)。
        let cmd = build_remote_command(&cfg());
        assert!(cmd.contains("read -r CC_FLOW_AUTH_TOKEN"), "应从 stdin 读取令牌");
        assert!(!cmd.contains("CC_FLOW_AUTH_TOKEN="), "令牌不得以赋值形式出现在命令行");
    }

    #[test]
    fn 目录中的单引号被正确转义() {
        let mut c = cfg();
        c.remote_dir = "/opt/it's here".into();
        let cmd = build_remote_command(&c);
        // 未转义的话会提前闭合引号,后面的内容就变成了可执行命令
        assert!(cmd.contains(r"'\''"), "单引号应被转义");
    }
}
