//! `~/.claude` 下的磁盘布局——CLI 自己拥有这些文件,我们只是读(以后可能写)。
//! 路径哈希算法必须跟 CLI 字节级一致,否则目录对不上,一个 session 都读不到。

use std::path::{Path, PathBuf};

use crate::util::home_dir;

pub fn claude_home() -> PathBuf {
    home_dir().join(".claude")
}

/// 移植自 Node 版 `pathToHash`:先把 `\` 换成 `/`,再把非字母数字字符换成 `-`。
/// 顺序不能反,大小写/字符集也要完全一致。
pub fn path_to_hash(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub fn project_dir(project_path: &Path) -> PathBuf {
    claude_home().join("projects").join(path_to_hash(project_path))
}

pub fn projects_root() -> PathBuf {
    claude_home().join("projects")
}
