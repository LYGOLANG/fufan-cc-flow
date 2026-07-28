import { isTauriRuntime } from "./tauri";
import { isRemote } from "../stores/connectionStore";

const LOCALHOST_RE = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:(\d+))?(\/.*)?$/i;

/** 纯解析部分,拆出来独立测试 —— 不依赖 Tauri 运行时或连接状态。 */
export function parseLocalhostUrl(
  url: string,
): { scheme: string; port: number; rest: string } | null {
  const m = url.match(LOCALHOST_RE);
  if (!m) return null;
  return {
    scheme: m[1],
    port: parseInt(m[4] || (m[1].startsWith("https") ? "443" : "80"), 10),
    rest: m[5] || "",
  };
}

/**
 * AI 回复里常见的「打开 http://localhost:3000 预览」——那个 localhost 指的是
 * **跑代码的机器**。本机形态下这就是用户自己的电脑,原样打开是对的;
 * 远程连接时那台机器是别的服务器,本机浏览器打开只会访问用户自己电脑上
 * 恰好同号的端口(打不开,或打开了完全不相干的东西),且没有任何迹象
 * 表明发生了什么——用户会以为是应用坏了。
 *
 * 解法:远程模式下识别出 localhost 链接,经桌面壳按需建一条到该端口的
 * SSH 转发,把链接改写成指向那条转发的本机端口。非 localhost 的链接
 * (用户访问外部网站)不受影响。
 */
export async function resolveExternalUrl(url: string): Promise<string> {
  if (!isTauriRuntime() || !isRemote()) return url;
  const parsed = parseLocalhostUrl(url);
  if (!parsed) return url;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const localPort = await invoke<number>("forward_remote_port", { port: parsed.port });
    return `${parsed.scheme}127.0.0.1:${localPort}${parsed.rest}`;
  } catch {
    // 转发建立失败:原样返回好过静默打开一个错误的本机端口 ——
    // 至少用户能看到"连接被拒绝"之类的浏览器报错,而不是一个看似正常
    // 却指向错误机器的空白页。
    return url;
  }
}

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
  const resolved = await resolveExternalUrl(url);
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(resolved);
  } catch {
    // 插件不可用时兜底:总比把应用导航走了强
    window.open(resolved, "_blank", "noopener,noreferrer");
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
export function installExternalLinkHandler(
  /** 提供时,桌面端的外链交给它(内置浏览器面板);不提供则一律走系统浏览器 */
  onInternalOpen?: (url: string) => void
): () => void {
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
    // 桌面端优先送内置浏览器面板(右侧栏预览,不打断对话);
    // 面板里另有「用系统浏览器打开」出口,应对拒绝嵌入的站点。
    // 浏览器形态下没有内置面板的意义,直接开新标签页。
    if (isTauriRuntime() && onInternalOpen) {
      onInternalOpen(href);
      return;
    }
    void openExternal(href);
  };

  // 捕获阶段:早于组件自身的 onClick,避免被 stopPropagation 掉
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
