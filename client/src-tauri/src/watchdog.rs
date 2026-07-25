//! WebView 崩溃自愈看门狗。
//!
//! 背景:WebView2 渲染进程崩溃(实测错误码 STATUS_BREAKPOINT)后,窗口会被
//! Edge 的「无法打开此页」错误页接管——应用形同死机,用户只能强杀重开,
//! 且当次会话的现场随日志轮转丢失、无从定位根因。
//!
//! Tauri 2.11 的 WebviewEvent 只有 DragDrop 变体,拿不到崩溃回调,所以用
//! 「前端心跳 + Rust 看门狗」间接探测:渲染进程一旦崩溃,JS 停止执行,心跳
//! 自然断流;看门狗连续多个周期收不到心跳即判定崩溃,自动 reload 拉活,
//! 并把现场写进独立日志(不随会话轮转),供事后定位。
//!
//! 设计取舍:
//! - 判定阈值取「连续 N 次миss」而非单次超时,避免主线程偶发长任务(大列表
//!   渲染、GC)造成误判把用户正在看的页面刷掉。
//! - 自愈次数设上限:若重载后仍反复崩溃(说明是启动即崩的确定性 bug),
//!   继续无限重载只会陷入闪烁循环,不如停手把现场留给用户和日志。

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// 前端心跳间隔(前端侧同值),看门狗按其倍数判定
const HEARTBEAT_INTERVAL_MS: u64 = 5_000;
/// 连续多少个心跳周期收不到消息即判定渲染进程已死
const MISSED_BEATS_BEFORE_DEAD: u64 = 3;
/// 看门狗轮询周期
const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// 启动后的宽限期:首屏加载 + JS 初始化期间不判定
const STARTUP_GRACE: Duration = Duration::from_secs(20);
/// 最多自动恢复几次——超过说明是确定性崩溃,再刷也是徒劳
const MAX_RECOVERIES: u32 = 5;

/// 最近一次心跳的 unix 毫秒时间戳
pub struct Heartbeat {
    pub last_beat_ms: AtomicU64,
    pub recoveries: AtomicU32,
}

impl Default for Heartbeat {
    fn default() -> Self {
        Self {
            last_beat_ms: AtomicU64::new(now_ms()),
            recoveries: AtomicU32::new(0),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 前端每 HEARTBEAT_INTERVAL_MS 调用一次,证明渲染进程还活着。
#[tauri::command]
pub fn webview_heartbeat(state: tauri::State<'_, Arc<Heartbeat>>) {
    state.last_beat_ms.store(now_ms(), Ordering::Relaxed);
}

/// 前端上报 JS 侧未捕获错误(见 utils/crashReporter.ts)。
///
/// 渲染进程崩溃前通常先有 JS 异常,而 Crashpad 的 dump 二进制且会被自动清理、
/// 系统事件日志不记录 WebView 内部崩溃——这条通道是目前唯一能拿到「崩溃前
/// 发生了什么」的可靠证据来源。
#[tauri::command]
pub fn record_frontend_error(app: AppHandle, kind: String, detail: String) {
    log::error!("[frontend] {kind}: {}", detail.lines().next().unwrap_or(""));
    record_crash(&app, &format!("[{kind}] {detail}"));
}

/// 把崩溃现场追加进独立日志文件(与会话日志分开,不被轮转覆盖)。
fn record_crash(app: &AppHandle, detail: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("webview-crashes.log");
    let line = format!(
        "[{}] {}\n",
        chrono_like_timestamp(),
        detail
    );
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 不引 chrono 依赖,用 unix 秒 + 本地偏移的粗略可读时间戳
fn chrono_like_timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

/// 启动看门狗后台线程。
pub fn spawn(app: AppHandle, heartbeat: Arc<Heartbeat>) {
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_GRACE);
        let dead_threshold_ms = HEARTBEAT_INTERVAL_MS * MISSED_BEATS_BEFORE_DEAD;

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let last = heartbeat.last_beat_ms.load(Ordering::Relaxed);
            let silence = now_ms().saturating_sub(last);
            if silence < dead_threshold_ms {
                continue;
            }

            let count = heartbeat.recoveries.load(Ordering::Relaxed);
            if count >= MAX_RECOVERIES {
                // 已反复恢复无效:停止自愈,把现场留给用户,避免无限刷新闪烁
                log::error!(
                    "[watchdog] webview unresponsive for {silence}ms; recovery limit ({MAX_RECOVERIES}) reached, giving up"
                );
                record_crash(
                    &app,
                    &format!("give-up after {MAX_RECOVERIES} recoveries; silence={silence}ms"),
                );
                return;
            }

            log::error!(
                "[watchdog] webview silent for {silence}ms (>{dead_threshold_ms}ms) — assuming renderer crash, reloading"
            );
            record_crash(
                &app,
                &format!("renderer assumed dead: silence={silence}ms, recovery #{}", count + 1),
            );

            if let Some(win) = app.get_webview_window("main") {
                match win.reload() {
                    Ok(()) => {
                        heartbeat.recoveries.fetch_add(1, Ordering::Relaxed);
                        // 重载后给前端重新起心跳的时间,否则会立刻二次误判
                        heartbeat.last_beat_ms.store(now_ms(), Ordering::Relaxed);
                        std::thread::sleep(STARTUP_GRACE);
                    }
                    Err(e) => {
                        log::error!("[watchdog] reload failed: {e}");
                        record_crash(&app, &format!("reload failed: {e}"));
                    }
                }
            }
        }
    });
}
