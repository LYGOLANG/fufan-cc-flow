import { isTauriRuntime } from "./tauri";

/**
 * 前端异常上报——把 JS 侧的未捕获错误送到 Rust 落盘。
 *
 * 背景:应用出现过 WebView2 渲染进程崩溃(STATUS_BREAKPOINT),但 Crashpad 的
 * dump 是二进制且会被自动清理、系统事件日志无记录、会话日志随轮转覆盖,
 * 事后完全无从定位。渲染进程崩溃前通常先有 JS 侧异常(未捕获 Promise、
 * 无限递归、超大字符串/数组分配等),这里在崩溃前把它们抓下来落盘。
 *
 * 与 ErrorBoundary 的分工:ErrorBoundary 只能捕获 React 渲染树内的错误,
 * 捕获不到事件回调、异步任务、Promise 中的异常——那些恰恰是最容易搞崩
 * 渲染进程的。
 */

/** 同一条错误短时间内重复上报的抑制窗口,防止错误风暴刷爆日志/拖垮应用 */
const DEDUP_WINDOW_MS = 10_000;
const recentErrors = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  recentErrors.set(key, now);
  // 简单老化,避免 Map 无限增长
  if (recentErrors.size > 50) {
    for (const [k, t] of recentErrors) {
      if (now - t > DEDUP_WINDOW_MS) recentErrors.delete(k);
    }
  }
  return true;
}

async function report(kind: string, detail: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const key = `${kind}:${detail.slice(0, 200)}`;
  if (!shouldReport(key)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("record_frontend_error", { kind, detail: detail.slice(0, 4000) });
  } catch {
    // 上报本身失败时保持静默:诊断设施不该反过来制造问题
  }
}

export function installCrashReporter(): () => void {
  const onError = (e: ErrorEvent) => {
    const stack = e.error instanceof Error ? e.error.stack ?? "" : "";
    void report(
      "uncaught-error",
      `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}\n${stack}`
    );
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    const detail = r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r);
    void report("unhandled-rejection", detail);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
