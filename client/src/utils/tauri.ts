declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = globalThis as typeof globalThis & { isTauri?: boolean };
  return runtime.isTauri === true || "__TAURI_INTERNALS__" in window;
}

/**
 * 双击启动的桌面应用是 explorer.exe 的子进程,继承不到用户在终端 profile 里临时设的
 * HTTP_PROXY/HTTPS_PROXY(只在 shell 会话内生效),而 plugin-updater 底层 reqwest 默认
 * 只按环境变量探测代理——结果更新检查请求直连 GitHub,在依赖代理才能稳定访问外网的
 * 网络环境下偶发 "error sending request for url" 失败。
 * 这里读 Rust 端 system_proxy 命令(解析 Windows 系统代理注册表),显式传给
 * check({proxy})。整个会话内只读一次并缓存,非 Windows / 未配置代理时返回 undefined。
 */
let systemProxyPromise: Promise<string | undefined> | null = null;
export function getSystemProxy(): Promise<string | undefined> {
  if (!isTauriRuntime()) return Promise.resolve(undefined);
  if (!systemProxyPromise) {
    systemProxyPromise = import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string | null>("system_proxy"))
      .then((proxy) => proxy ?? undefined)
      .catch(() => undefined);
  }
  return systemProxyPromise;
}
