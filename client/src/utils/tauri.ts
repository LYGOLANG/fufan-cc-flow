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
