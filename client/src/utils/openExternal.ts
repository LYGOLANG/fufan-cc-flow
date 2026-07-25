import { isTauriRuntime } from "./tauri";

/**
 * 用系统默认浏览器打开外部链接。
 *
 * 背景:桌面壳里点 http(s) 链接若走 WebView 自身导航,整个应用会被替换成那个网页,
 * 且没有地址栏/后退按钮——用户视角就是「应用卡死在一个网页上,回不来了」。
 * 浏览器形态下 target="_blank" 本就正确,故仅在 Tauri 内改走系统 opener。
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    // 插件不可用时兜底:总比把应用导航走了强
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** 只有 http/https 才交给外部浏览器;其余(mailto、相对路径、锚点等)不拦截。 */
export function isExternalUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * 全局兜底:捕获阶段拦截所有指向外部链接的点击。
 *
 * 相比逐个组件改 onClick,这里一次覆盖全应用——包括 AI 回复的 Markdown 里
 * 动态生成的链接、将来新增的任何 <a href="http...">,不会再漏。
 * 返回清理函数。
 */
export function installExternalLinkHandler(): () => void {
  const onClick = (e: MouseEvent) => {
    // 尊重修饰键(用户可能想用自己的方式打开)与非左键
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as HTMLElement | null)?.closest?.("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!isExternalUrl(href)) return;

    e.preventDefault();
    void openExternal(href);
  };

  // 捕获阶段:早于组件自身的 onClick,避免被 stopPropagation 掉
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
