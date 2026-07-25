import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Globe, RotateCw, X } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { openExternal } from "../../utils/openExternal";

/**
 * 内置浏览器面板 —— 在右侧栏里预览网页,不打断对话。
 *
 * 用 iframe 而非新开 WebView 窗口:后者会额外拉起一个渲染进程,而本应用
 * 已在排查 WebView 渲染进程崩溃(STATUS_BREAKPOINT)问题,不宜再加负载。
 * iframe 与主界面共享渲染进程,但被 sandbox 限制,崩溃风险可控。
 *
 * 已知限制(诚实告知用户,而非让他们对着白屏猜):
 * 很多站点(GitHub、Google 等)会发 X-Frame-Options / CSP frame-ancestors
 * 拒绝被嵌入,此时 iframe 必然空白——这是对方站点的策略,不是本应用的 bug。
 * 故面板提供「用系统浏览器打开」出口,并在加载后给出提示。
 */
export default function BrowserPanel() {
  const { browserUrl, setBrowserUrl } = useUIStore();
  const [input, setInput] = useState(browserUrl ?? "");
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [hint, setHint] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setInput(browserUrl ?? "");
  }, [browserUrl]);

  // 站点拒绝嵌入时 iframe 既不报错也不触发 onload 的失败回调,
  // 只会一直空白。用延时提示兜底,避免用户对着白屏干等。
  useEffect(() => {
    if (!browserUrl) return;
    setHint(false);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(true), 3500);
    return () => clearTimeout(hintTimer.current);
  }, [browserUrl, loadedAt]);

  const normalize = (raw: string): string | null => {
    const s = raw.trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    // 看着像域名就补 https,否则当搜索词
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s)) return `https://${s}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
  };

  const go = useCallback(() => {
    const url = normalize(input);
    if (url) setBrowserUrl(url);
  }, [input, setBrowserUrl]);

  const reload = useCallback(() => {
    setLoadedAt(Date.now());
  }, []);

  if (!browserUrl) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-2 border-b border-white/5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="输入网址或搜索内容，回车打开"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-white/20"
          />
          <button
            onClick={go}
            className="text-xs px-3 py-1.5 rounded-md bg-[#ca5d3d] hover:bg-amber-glow text-white font-medium transition-colors flex-shrink-0"
          >
            打开
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600">
          <Globe size={28} />
          <p className="text-xs">在上方输入网址，在这里预览网页</p>
          <p className="text-[11px] text-slate-700">对话里的链接也可以在这里打开</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 地址栏 */}
      <div className="flex items-center gap-1.5 p-2 border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => setBrowserUrl(null)}
          title="返回"
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          onClick={reload}
          title="刷新"
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <RotateCw size={13} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          className="flex-1 min-w-0 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-slate-300 outline-none focus:border-white/20 font-mono"
        />
        <button
          onClick={() => void openExternal(browserUrl)}
          title="用系统浏览器打开"
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {/* 网页内容 */}
      <div className="flex-1 min-h-0 relative bg-white">
        <iframe
          ref={iframeRef}
          key={`${browserUrl}#${loadedAt}`}
          src={browserUrl}
          title="内置浏览器"
          className="w-full h-full border-0"
          // 给足常用能力但不放开 allow-top-navigation:
          // 否则被嵌页面能把整个应用窗口导航走(正是之前修掉的问题)
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => setHint(false)}
        />
        {hint && (
          <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-obsidian-800/95 border border-white/10 shadow-lg">
            <Globe size={13} className="text-amber-glow mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-300 leading-relaxed">
                页面空白？部分网站（如 GitHub、Google）不允许被嵌入显示，这是对方站点的限制。
              </p>
              <button
                onClick={() => void openExternal(browserUrl)}
                className="mt-1 text-[11px] text-sky-link hover:underline"
              >
                改用系统浏览器打开 →
              </button>
            </div>
            <button
              onClick={() => setHint(false)}
              className="p-0.5 rounded text-slate-500 hover:text-white flex-shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
