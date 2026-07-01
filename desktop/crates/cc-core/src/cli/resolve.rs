//! 解析 `claude` 可执行文件的绝对路径 —— 不依赖进程 PATH 快照。
//!
//! 移植自 `server/src/utils/claudeBin.ts`：每次调用都重新解析（不缓存），
//! 顺序为 环境变量覆盖 → PATH 查找(where/which) → 已知安装目录兜底。
//! 这是刻意的：桌面 App 是长驻进程，若解析结果被缓存，用户在 App 运行期间
//! 安装/更新 claude CLI 就需要重启 App 才能生效。

use std::env;
use std::path::{Path, PathBuf};

const IS_WIN: bool = cfg!(target_os = "windows");

use crate::util::home_dir;

/// 各包管理器的 bin/shim 目录,按平台区分。
fn known_dirs() -> Vec<PathBuf> {
    let home = home_dir();
    if IS_WIN {
        let appdata = env::var("APPDATA").unwrap_or_default();
        let localappdata = env::var("LOCALAPPDATA").unwrap_or_default();
        let programdata = env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
        let scoop = env::var("SCOOP").unwrap_or_else(|_| home.join("scoop").to_string_lossy().to_string());
        let scoop_global = env::var("SCOOP_GLOBAL")
            .unwrap_or_else(|_| Path::new(&programdata).join("scoop").to_string_lossy().to_string());
        vec![
            home.join(".local").join("bin"),
            PathBuf::from(&appdata).join("npm"),
            PathBuf::from(&localappdata).join("Microsoft").join("WinGet").join("Links"),
            PathBuf::from(&scoop).join("shims"),
            PathBuf::from(&scoop_global).join("shims"),
        ]
    } else {
        vec![
            home.join(".local").join("bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
            home.join(".linuxbrew").join("bin"),
            home.join(".npm-global").join("bin"),
        ]
    }
}

/// 用 where(win)/which(posix) 在 PATH 中查找,优先 .exe,其次 .cmd/.bat,跳过 .ps1。
fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let finder = if IS_WIN { "where" } else { "which" };
    let out = std::process::Command::new(finder).arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut paths: Vec<&str> = stdout.lines().map(str::trim).filter(|s| !s.is_empty()).collect();
    if !IS_WIN {
        return paths.first().map(PathBuf::from);
    }
    paths.retain(|p| !p.to_lowercase().ends_with(".ps1"));
    let rank = |p: &str| -> u8 {
        let l = p.to_lowercase();
        if l.ends_with(".exe") {
            0
        } else if l.ends_with(".cmd") || l.ends_with(".bat") {
            1
        } else {
            2
        }
    };
    paths.sort_by_key(|p| rank(p));
    paths.first().map(PathBuf::from)
}

/// 解析 claude 可执行文件的绝对路径;找不到返回 None。每次实时解析,不缓存。
pub fn resolve_claude_bin() -> Option<PathBuf> {
    if let Ok(over) = env::var("CLAUDE_BIN").or_else(|_| env::var("CC_CLAUDE_BIN")) {
        let p = PathBuf::from(&over);
        if p.exists() {
            return Some(p);
        }
    }

    if let Some(p) = resolve_on_path("claude") {
        return Some(p);
    }

    let names: &[&str] = if IS_WIN { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    for dir in known_dirs() {
        for name in names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}
