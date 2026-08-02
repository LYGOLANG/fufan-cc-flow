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
         export CC_FLOW_LOG_LEVEL=info; \
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
        // 首次连接自动接受主机密钥,之后密钥变更一律拒绝。
        //
        // 三选一里这是唯一可用的:
        //   - 默认(ask):BatchMode 下不能交互,首次连接必定失败,且错误信息
        //     完全指不到"你需要先手工 ssh 一次"这个真实原因;
        //   - no:永远不校验主机密钥,等于对中间人门户大开——远程连接传的是
        //     完整接口令牌和项目代码,不能这么办;
        //   - accept-new:首次信任(与 SSH 常规的 TOFU 一致),之后主机密钥
        //     一旦变化立即拒绝连接。
        //
        // 这条是 Rust 集成测试逼出来的:先前的 Node 验证脚本图方便用了
        // StrictHostKeyChecking=no,把这个缺口整个盖住了。
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
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

    // ssh 的 stderr 里藏着**唯一**能指明失败原因的信息("Permission denied"、
    // "bad permissions"、"Host key verification failed"...)。既转进日志,也留一份
    // 在内存里:连接失败时要把它带进错误信息给用户看,否则界面上只有一句
    // "ssh 提前退出(255)",而真正的原因可能是私钥权限这种毫不相干的东西。
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    if let Some(err) = child.stderr.take() {
        let sink = std::sync::Arc::clone(&stderr_lines);
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                log::warn!("[remote/ssh] {line}");
                if let Ok(mut v) = sink.lock() {
                    // 只留开头若干行:失败原因总在最前面,而长连接后期可能刷出
                    // 大量无关输出,无限累积等于内存泄漏
                    if v.len() < 24 {
                        v.push(line);
                    }
                }
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

    match wait_until_ready(local_port, Duration::from_secs(60), &mut child, auth_token) {
        Ok(()) => {
            log::info!("[remote] backend ready on local port {local_port}");
            Ok(RemoteSession { child, local_port })
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            let raw = stderr_lines.lock().map(|v| v.join("\n")).unwrap_or_default();
            Err(match explain_ssh_failure(&raw) {
                Some(hint) => format!("{e}\n\n{hint}"),
                None if raw.trim().is_empty() => e,
                None => format!("{e}\n\nssh 输出:\n{}", raw.trim()),
            })
        }
    }
}

/// 把 ssh 的原始报错翻译成用户能据以行动的话。
///
/// 这些串每一条都对应一次真实的排查:光看 "exit code 255" 谁也想不到问题
/// 出在私钥的 Windows ACL 上。
fn explain_ssh_failure(stderr: &str) -> Option<String> {
    let s = stderr.to_ascii_lowercase();

    if s.contains("bad permissions") || s.contains("unprotected private key") {
        return Some(
            "私钥文件权限过于开放,Windows 版 OpenSSH 会拒绝使用它。\n\
             用管理员 PowerShell 执行(把路径换成你的私钥):\n\
             \x20 icacls \"C:\\Users\\你\\.ssh\\id_ed25519\" /inheritance:r /grant:r \"$env:USERNAME:F\"\n\
             注意:Git Bash 里的 ssh 不做这项检查,所以在终端里能连通不代表这里也能。"
                .into(),
        );
    }
    if s.contains("permission denied (publickey") {
        return Some(
            "服务器拒绝了这把密钥。请确认:\n\
             \x20 · 公钥已写入远程账户的 ~/.ssh/authorized_keys\n\
             \x20 · 私钥路径填的是私钥本身(不是 .pub)\n\
             \x20 · 私钥没有密码短语 —— 图形界面下无处输入,带密码的密钥用不了"
                .into(),
        );
    }
    if s.contains("host key verification failed") {
        return Some(
            "服务器的主机密钥与本机记录的不一致。若确属正常变更(重装系统、换机器),\n\
             删除 ~/.ssh/known_hosts 中该主机对应的那一行后重试。\n\
             若并未变更过,请先排查网络是否被中间人劫持。"
                .into(),
        );
    }
    if s.contains("connection refused") {
        return Some("远程主机拒绝连接:该地址/端口上没有 SSH 服务在监听。请检查主机、端口,以及远端 sshd 是否运行。".into());
    }
    if s.contains("could not resolve hostname") {
        return Some("无法解析主机名。请检查拼写,或改用 IP 地址。".into());
    }
    if s.contains("connection timed out") || s.contains("operation timed out") {
        return Some("连接超时:通常是防火墙拦截或主机不可达。".into());
    }
    if s.contains("cannot listen to port") || s.contains("address already in use") {
        return Some("本地端口转发失败,该端口已被占用。重启应用会重新分配端口。".into());
    }
    None
}

/// 轮询本地隧道端口上的 `/api/health` 直到后端就绪。
///
/// 同时监视 ssh 进程本身:它先退出说明连接就没建起来(认证失败、端口占用等),
/// 此时应立刻报错,而不是傻等满 60 秒。
fn wait_until_ready(
    port: u16,
    timeout: Duration,
    child: &mut Child,
    auth_token: &str,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = String::from("未知原因");
    // 连上了后端、但令牌对不上的次数。这是孤儿后端的特征信号。
    let mut unauthorized_hits = 0u32;

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "ssh 提前退出({status})。常见原因:认证失败、主机密钥未信任、\
                 本地端口被占用。详细信息见应用日志中的 [remote/ssh] 行。"
            ));
        }

        // 探**带鉴权**的端点,不能只探 /api/health。
        //
        // /api/health 是免鉴权的(auth.ts 的 EXEMPT_PATHS),于是上一次运行残留的
        // 孤儿后端也会回 200 —— 应用据此认定"连上了",而之后每个带新令牌的请求
        // 都被那个旧后端 401,WS 升级也被拒。表现是重连循环 + 提示"需重启应用",
        // 而重启后孤儿还在,症状一模一样:一个自己修不好、且提示词把用户
        // 推向无效动作的死循环。
        //
        // 孤儿是怎么来的:应用崩溃/被强杀时 ExitRequested 不触发,本机 ssh 存活,
        // 远端 wrapper 的 `cat > /dev/null` 仍阻塞着,远端 node 继续占着 remote_port。
        // 下次启动的新 node 撞 EADDRINUSE 直接退出,但 wrapper 不退、ssh 也不退。
        match http_status(port, "/api/providers", Some(auth_token)) {
            Ok(200) => return Ok(()),
            Ok(401) | Ok(403) => {
                unauthorized_hits += 1;
                last_err = "端口上有后端在响应,但它不认本次的访问令牌".into();
                // 连续多次 401 基本可以断定不是"还没起来",而是别人占着端口
                if unauthorized_hits >= 3 {
                    return Err(format!(
                        "远端 {} 端口被另一个后端占用(它不认本次的访问令牌)。\n\n\
                         这通常是上一次运行残留的孤儿进程 —— 应用崩溃或被强杀时\
                         远端后端不会自动退出。**重启应用无法解决**,需要先清理它:\n\
                         \x20 ssh <user>@<host> \"pkill -f 'node dist/index.js'\"\n\n\
                         清理后再重新连接。",
                        port
                    ));
                }
            }
            Ok(code) => last_err = format!("健康检查返回 HTTP {code}"),
            Err(e) => last_err = e,
        }
        std::thread::sleep(Duration::from_millis(800));
    }
    Err(format!("远程后端在 {}s 内未就绪({last_err})。请确认远端已用 scripts/install-remote.sh 安装,且 node 可用。", timeout.as_secs()))
}

/// 极简 HTTP GET,返回状态码。沿用 `sidecar::graceful_shutdown` 的做法,
/// 用 std TcpStream 手写,不为一次健康检查引入 HTTP 客户端依赖。
///
/// 带 token 时会加 `x-cc-flow-token` 头 —— 就绪探测靠它区分「端口通了」
/// 与「通到的是不是我刚启动的那个后端」(见 wait_until_ready)。
fn http_status(port: u16, path: &str, token: Option<&str>) -> Result<u16, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800))
        .map_err(|e| format!("连接本地隧道端口失败: {e}"))?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();

    let auth = match token {
        Some(t) => format!("x-cc-flow-token: {t}\r\n"),
        None => String::new(),
    };
    let req =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth}Connection: close\r\n\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("发送健康检查失败: {e}"))?;

    let mut buf = [0u8; 256];
    let n = stream
        .read(&mut buf)
        .map_err(|e| format!("读取健康检查响应失败: {e}"))?;
    let head = String::from_utf8_lossy(&buf[..n]);
    // 状态行形如 "HTTP/1.1 200 OK"
    head.split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or_else(|| format!("无法解析响应状态行: {}", head.lines().next().unwrap_or("")))
}

/// 极简 HTTP GET,只关心状态行是不是 200。保留给不需要区分状态码的调用点。
#[allow(dead_code)]
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

/// 一条按需建立的额外端口转发(与主隧道分开的独立 ssh 进程)。
pub struct ForwardedPort {
    pub local_port: u16,
    child: Child,
}

/// 为远端的某个端口开一条转发,返回本机上对应的端口。
///
/// 用途:远程开发时模型常说「打开 http://localhost:3000 预览」。那个 localhost
/// 指的是**远程机器**,而本机浏览器打开它只会访问用户自己电脑的 3000 端口 ——
/// 要么打不开,要么打开了完全不相干的东西,且没有任何迹象表明发生了什么。
///
/// 这里不复用主隧道:主隧道的存活与后端生命周期绑定,而预览端口来去自由,
/// 混在一起会让「关掉一个预览」变成「断开整个后端」。
pub fn forward_port(cfg: &RemoteConfig, remote_port: u16) -> Result<ForwardedPort, String> {
    cfg.validate()?;
    let ssh = resolve_ssh()?;
    let local_port = crate::sidecar::reserve_port().map_err(|e| format!("无法分配本地端口: {e}"))?;

    let mut args: Vec<String> = vec![
        "-p".into(),
        cfg.ssh_port.to_string(),
        // -N:只做转发,不执行远程命令
        "-N".into(),
        "-L".into(),
        format!("{local_port}:127.0.0.1:{remote_port}"),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
    ];
    if let Some(id) = &cfg.identity_file {
        args.push("-i".into());
        args.push(id.clone());
    }
    args.push(format!("{}@{}", cfg.user, cfg.host));

    let child = Command::new(&ssh)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("建立端口转发失败: {e}"))?;

    log::info!("[remote] forwarding local {local_port} -> remote {remote_port}");
    Ok(ForwardedPort { local_port, child })
}

/// 关掉一条端口转发。
pub fn stop_forward(f: &mut ForwardedPort) {
    let _ = f.child.kill();
    let _ = f.child.wait();
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
    fn ssh报错能翻译成可行动的提示() {
        // 私钥权限:这条最反直觉——Git Bash 里 ssh 连得通,应用里却连不上,
        // 因为 MSYS 版不检查 Windows ACL 而 System32 版检查。
        let hint = explain_ssh_failure(
            "Permissions for 'C:/Users/x/.ssh/k' are too open.\nbad permissions",
        )
        .expect("私钥权限问题应给出提示");
        assert!(hint.contains("icacls"), "应给出可直接执行的修复命令");

        assert!(explain_ssh_failure("Permission denied (publickey).")
            .expect("应识别公钥被拒")
            .contains("authorized_keys"));

        assert!(explain_ssh_failure("ssh: connect to host x port 22: Connection refused")
            .expect("应识别连接被拒")
            .contains("sshd"));

        // 认不出来的错误不要硬编一个提示,原样把 ssh 输出带给用户更有用
        assert!(explain_ssh_failure("some unknown failure").is_none());
    }

    /// 就绪探测必须走带鉴权的端点，否则区分不出「孤儿后端占着端口」。
    ///
    /// /api/health 是免鉴权的，上一次运行残留的孤儿后端也会回 200。若拿它当
    /// 就绪判据，应用会认定"连上了"，而之后每个带新令牌的请求都被那个旧后端
    /// 401 —— 表现为重连循环 + 提示"需重启应用"，重启后孤儿还在，症状不变。
    #[test]
    fn 就绪探测不能只依赖免鉴权端点() {
        let src = include_str!("ssh.rs");
        // 定位 wait_until_ready 的函数体
        let body_start = src
            .find("fn wait_until_ready(")
            .expect("wait_until_ready 应存在");
        let body = &src[body_start..body_start + 2600.min(src.len() - body_start)];

        assert!(
            body.contains("/api/providers") || body.contains("Some(auth_token)"),
            "就绪探测必须带令牌打鉴权端点，否则孤儿后端会被误判为就绪"
        );
        assert!(
            body.contains("401"),
            "必须显式处理 401：那正是「端口上有别的后端」的信号"
        );
        // 提示词不能把用户推向无效动作
        assert!(
            body.contains("重启应用无法解决") || body.contains("pkill"),
            "识别出孤儿后，必须告诉用户真正有效的清理办法，而不是让他重启应用"
        );
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

    /// 真连一台靶机跑通整条链路。
    ///
    /// 默认 ignored:它需要一台可 SSH 且已装好后端的机器。上面那些单测只能保证
    /// 命令**拼**得对,证明不了这段 Rust 真能把隧道建起来——而 spawn 参数、stdin
    /// 写入时机、就绪探测这些恰恰是最容易出错的地方。
    ///
    /// 跑法(靶机搭建见 HANDOFF.md):
    ///   CC_FLOW_TEST_SSH_KEY=C:/Users/xxx/.ssh/cc-flow-wsl-test \
    ///   cargo test --lib -- --ignored --nocapture 真实连接靶机
    #[test]
    #[ignore]
    fn 真实连接靶机() {
        let Ok(key) = std::env::var("CC_FLOW_TEST_SSH_KEY") else {
            panic!("需要设置 CC_FLOW_TEST_SSH_KEY 指向靶机私钥");
        };
        let cfg = RemoteConfig {
            host: std::env::var("CC_FLOW_TEST_SSH_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            ssh_port: std::env::var("CC_FLOW_TEST_SSH_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2222),
            user: std::env::var("CC_FLOW_TEST_SSH_USER").unwrap_or_else(|_| "root".into()),
            identity_file: Some(key),
            remote_dir: std::env::var("CC_FLOW_TEST_REMOTE_DIR")
                .unwrap_or_else(|_| "/opt/agent-flow-server".into()),
            // 用一个不常见的端口,避免撞上靶机上已经跑着的后端而测出假通过
            remote_port: 3017,
        };

        let token = generate_test_token();
        let local_port = crate::sidecar::reserve_port().expect("分配本地端口");

        let mut session = start(&cfg, &token, local_port).expect("应能连上靶机并启动远程后端");

        // 隧道确实通到了远端后端
        assert!(
            http_get_ok(local_port, "/api/health").expect("健康检查请求应成功"),
            "隧道已建立但健康检查未返回 200"
        );

        stop(&mut session);

        // 关掉之后端口应该不再可用 —— 否则说明 ssh 没真被杀掉,
        // 或者连上的其实是靶机上一个早就跑着的后端(假通过)
        std::thread::sleep(Duration::from_millis(1500));
        assert!(
            http_get_ok(local_port, "/api/health").is_err(),
            "断开后本地端口仍可连通,说明隧道没有真正关闭"
        );
    }

    #[cfg(test)]
    fn generate_test_token() -> String {
        // 不用 sidecar::generate_auth_token,避免测试依赖 OS 熵源初始化路径
        format!("test-{}", std::process::id())
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
