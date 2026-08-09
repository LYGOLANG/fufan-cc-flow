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
//! - 判定阈值取「连续 N 次 miss」而非单次超时,避免主线程偶发长任务(大列表
//!   渲染、GC)造成误判把用户正在看的页面刷掉。
//! - 恢复预算按「连续失败」计,健康满 HEALTHY_RESET 即清零。曾经用终身计数,
//!   零星崩溃几天就耗光预算,下一次崩溃直接留死屏——2026-07-26 实录。
//! - 连败达 SAFE_MODE_AFTER 次进入安全模式(前端启动时查询,跳过会话自动恢复),
//!   打破「恢复的内容本身就是崩因」的启动即崩循环。
//! - 永不永久放弃:连败再多也只是退到 SLOW_RETRY_INTERVAL 慢速重试。一分钟
//!   刷一次死页不构成闪烁骚扰,而放弃 = 用户面对死屏,是最坏结局。

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// 前端心跳间隔(前端侧同值),看门狗按其倍数判定
const HEARTBEAT_INTERVAL_MS: u64 = 5_000;
/// 连续多少个心跳周期收不到消息即判定渲染进程已死。
///
/// **从 3（15 秒）放宽到 12（60 秒）**：实测误判把用户的主窗口反复重载了
/// 24 次（日志 `consecutive #24`）。根因是 Chromium 会节流不可见窗口里的
/// setInterval —— 窗口被完全遮挡、挪到没在看的显示器上、或系统进入低功耗时，
/// 心跳间隔会被拉长到分钟级，而那时渲染进程完全健康。
///
/// 误判的代价比迟判大得多：reload 会打断正在进行的会话，而真崩溃时晚 45 秒
/// 恢复只是多等一会儿。判定条件里另外加了「窗口不可见就不判死」，见 spawn。
const MISSED_BEATS_BEFORE_DEAD: u64 = 12;
/// 看门狗轮询周期
const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// 启动后的宽限期:首屏加载 + JS 初始化期间不判定
const STARTUP_GRACE: Duration = Duration::from_secs(20);
/// 连续失败达到该次数后,前端启动进入安全模式(跳过会话自动恢复)
const SAFE_MODE_AFTER: u32 = 3;
/// 连续失败达到该次数后,重载间隔退到慢速档,避免快速闪烁
const SLOW_RETRY_AFTER: u32 = 5;
/// 慢速重试间隔
const SLOW_RETRY_INTERVAL: Duration = Duration::from_secs(60);
/// 距上次重载持续健康满该时长,连续失败计数清零(渡过了这一阵)
const HEALTHY_RESET: Duration = Duration::from_secs(300);

/// 看门狗共享状态:心跳时间戳 + 恢复统计。
pub struct Heartbeat {
    /// 最近一次心跳的 unix 毫秒时间戳
    pub last_beat_ms: AtomicU64,
    /// 本轮不健康期内的连续重载次数;健康满 HEALTHY_RESET 清零
    pub consecutive_failures: AtomicU32,
    /// 最近一次重载的 unix 毫秒时间戳(0 = 从未重载)
    pub last_recovery_ms: AtomicU64,
    /// 前端心跳捎带的 JS 堆用量(MB),崩溃时写进现场——区分 OOM 与运行时 bug
    pub last_heap_mb: AtomicU32,
}

impl Default for Heartbeat {
    fn default() -> Self {
        Self {
            last_beat_ms: AtomicU64::new(now_ms()),
            consecutive_failures: AtomicU32::new(0),
            last_recovery_ms: AtomicU64::new(0),
            last_heap_mb: AtomicU32::new(0),
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
/// heap_mb 可选携带当前 JS 堆用量,为下一次崩溃留下「是否内存耗尽」的证据。
#[tauri::command]
pub fn webview_heartbeat(state: tauri::State<'_, Arc<Heartbeat>>, heap_mb: Option<u32>) {
    state.last_beat_ms.store(now_ms(), Ordering::Relaxed);
    if let Some(mb) = heap_mb {
        state.last_heap_mb.store(mb, Ordering::Relaxed);
    }
}

/// 前端启动时查询:是否应进入安全模式(跳过会话自动恢复)。
/// 连续崩溃说明「恢复的内容可能就是崩因」,先以最小状态活下来。
#[tauri::command]
pub fn crash_recovery_state(state: tauri::State<'_, Arc<Heartbeat>>) -> serde_json::Value {
    let failures = state.consecutive_failures.load(Ordering::Relaxed);
    serde_json::json!({
        "consecutiveFailures": failures,
        "safeMode": failures >= SAFE_MODE_AFTER,
    })
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
    let line = format!("[{}] {}\n", chrono_like_timestamp(), detail);
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

            // 窗口不可见（最小化、或被系统挂起）时不判死：那时 Chromium 会
            // 节流甚至冻结 JS 定时器，心跳断流是**预期行为**而非崩溃。
            // 这里顺手把心跳时间推到当下，避免窗口一恢复可见就因为攒下的
            // 静默期立刻被判死。
            if let Some(win) = app.get_webview_window("main") {
                let invisible =
                    win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true);
                if invisible {
                    heartbeat.last_beat_ms.store(now_ms(), Ordering::Relaxed);
                    continue;
                }
            }

            let last = heartbeat.last_beat_ms.load(Ordering::Relaxed);
            let silence = now_ms().saturating_sub(last);
            if silence < dead_threshold_ms {
                // 健康。若上一阵曾重载且已持续健康足够久,视为渡过,预算清零。
                let failures = heartbeat.consecutive_failures.load(Ordering::Relaxed);
                if failures > 0 {
                    let recovered_at = heartbeat.last_recovery_ms.load(Ordering::Relaxed);
                    if now_ms().saturating_sub(recovered_at) >= HEALTHY_RESET.as_millis() as u64 {
                        log::info!(
                            "[watchdog] healthy for {}s after {failures} recovery(ies) — resetting counter",
                            HEALTHY_RESET.as_secs()
                        );
                        heartbeat.consecutive_failures.store(0, Ordering::Relaxed);
                    }
                }
                continue;
            }

            // 判定已死:重载拉活。连续失败越多,越可能是确定性崩溃——
            // 达阈值后前端会以安全模式启动;再不行退慢速重试,但永不放弃。
            let failures = heartbeat.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
            let heap_mb = heartbeat.last_heap_mb.load(Ordering::Relaxed);
            log::error!(
                "[watchdog] webview silent for {silence}ms (>{dead_threshold_ms}ms) — reloading (consecutive #{failures}, last heap≈{heap_mb}MB)"
            );
            record_crash(
                &app,
                &format!(
                    "renderer assumed dead: silence={silence}ms, consecutive #{failures}, last heap≈{heap_mb}MB{}",
                    if failures >= SAFE_MODE_AFTER { ", next boot = safe mode" } else { "" }
                ),
            );

            if let Some(win) = app.get_webview_window("main") {
                match win.reload() {
                    Ok(()) => {
                        heartbeat.last_recovery_ms.store(now_ms(), Ordering::Relaxed);
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

            // 连败过多:退慢速档,防闪烁但不放弃——每分钟仍尝试把页面拉活
            if failures >= SLOW_RETRY_AFTER {
                log::error!(
                    "[watchdog] {failures} consecutive failed recoveries — backing off to {}s retry interval",
                    SLOW_RETRY_INTERVAL.as_secs()
                );
                std::thread::sleep(SLOW_RETRY_INTERVAL);
            }
        }
    });
}
