/// 前端在检查/下载更新前调用,拿到 Windows 系统代理配置传给 plugin-updater 的
/// `check({proxy})`。背景:双击启动的桌面应用是 explorer.exe 的子进程,继承不到
/// 用户在终端 profile 里临时设的 HTTP_PROXY/HTTPS_PROXY(那只在 shell 会话内生效),
/// 而 reqwest 默认只按环境变量探测代理——结果更新检查请求直连 GitHub,在依赖代理
/// 才能稳定访问外网的网络环境下偶发 "error sending request for url" 失败。
/// Windows 的系统代理(控制面板"Internet 选项"/大多数代理客户端如 Clash 会写)存在
/// 注册表 Internet Settings 里,和 shell 环境变量是两码事,这里显式读出来。
#[tauri::command]
pub fn system_proxy() -> Option<String> {
    read_windows_proxy()
}

/// 把注册表 ProxyServer 原始值解析成可用的代理 URL。独立成纯函数便于脱离真实
/// 注册表做单元测试;两种输入形态见函数内注释。
fn parse_proxy_server(enabled: u32, server: &str) -> Option<String> {
    if enabled != 1 {
        return None;
    }
    let server = server.trim();
    if server.is_empty() {
        return None;
    }

    // ProxyServer 值有两种形态:
    // ① "host:port"                              — 所有协议统一走这一个代理
    // ② "http=host:port;https=host:port;ftp=..."  — 按协议分别配置,取 https 优先、http 兜底
    // 注意:必须分两轮独立扫描——单轮 find_map 里做 https→http 兜底,一旦分号分隔的
    // 第一段恰好是 "http=...",会在扫到后面的 "https=..." 之前就被兜底命中提前返回。
    let target = if server.contains('=') {
        server
            .split(';')
            .find_map(|part| part.strip_prefix("https="))
            .or_else(|| server.split(';').find_map(|part| part.strip_prefix("http=")))
            .map(|s| s.to_string())
    } else {
        Some(server.to_string())
    }?;

    if target.is_empty() {
        return None;
    }

    // 代理隧道协议是 http(即便目标是 https,本地代理客户端普遍用 HTTP CONNECT 转发),
    // 这里的 scheme 描述的是"如何连接代理"而非"代理转发什么协议"。
    Some(format!("http://{target}"))
}

#[cfg(target_os = "windows")]
fn read_windows_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;

    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    let server: String = key.get_value("ProxyServer").ok()?;
    parse_proxy_server(enabled, &server)
}

#[cfg(not(target_os = "windows"))]
fn read_windows_proxy() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::parse_proxy_server;

    #[test]
    fn disabled_returns_none() {
        assert_eq!(parse_proxy_server(0, "127.0.0.1:7897"), None);
    }

    #[test]
    fn empty_server_returns_none() {
        assert_eq!(parse_proxy_server(1, ""), None);
        assert_eq!(parse_proxy_server(1, "   "), None);
    }

    #[test]
    fn unified_host_port_form() {
        assert_eq!(
            parse_proxy_server(1, "127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_string())
        );
    }

    #[test]
    fn per_protocol_form_prefers_https() {
        assert_eq!(
            parse_proxy_server(1, "http=127.0.0.1:7890;https=127.0.0.1:7897;ftp=127.0.0.1:7891"),
            Some("http://127.0.0.1:7897".to_string())
        );
    }

    #[test]
    fn per_protocol_form_falls_back_to_http() {
        assert_eq!(
            parse_proxy_server(1, "http=127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn real_machine_value_matches_this_session() {
        // 本机实测值(本次调试确认): ProxyEnable=1, ProxyServer=127.0.0.1:7897
        assert_eq!(
            parse_proxy_server(1, "127.0.0.1:7897"),
            Some("http://127.0.0.1:7897".to_string())
        );
    }
}
