import { isTauriRuntime } from "./tauri";

/** 与 Rust 侧 watchdog.rs 的 HEARTBEAT_INTERVAL_MS 保持一致 */
const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * 向 Rust 看门狗上报「渲染进程还活着」。
 *
 * WebView2 渲染进程崩溃后 JS 停止执行,心跳自然断流——Rust 侧据此判定崩溃
 * 并自动重载页面,避免用户面对 Edge 的「无法打开此页」死屏。
 * 详见 src-tauri/src/watchdog.rs。
 *
 * 用 setInterval 而非 requestAnimationFrame:窗口最小化/后台时 rAF 会被节流
 * 甚至暂停,会被误判成崩溃。
 */
export function installHeartbeat(): () => void {
  if (!isTauriRuntime()) return () => {};

  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (disposed) return;
      const beat = () => {
        void invoke("webview_heartbeat").catch(() => {
          // 后端未就绪或命令缺失时静默:心跳失败不该打扰用户,
          // 看门狗侧有恢复次数上限兜底
        });
      };
      beat(); // 立即发一次,不等第一个周期
      timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    } catch {
      // 非 Tauri 环境或 API 不可用——无需心跳
    }
  })();

  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
  };
}
