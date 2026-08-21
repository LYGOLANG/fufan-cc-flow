import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SyntaxHighlighter, oneDark } from "../../utils/syntaxHighlighter";
import { Copy, Check, X } from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { httpBase, withAuthQuery } from "../../services/endpoint";
import MediaPreview from "./MediaPreview";
import { extractMediaPaths, mediaKindOf } from "../../utils/mediaPaths";
import { useUIStore } from "../../stores/uiStore";

interface Props {
  content: string;
  /** 自动识别文本中的本地图片路径并在下方内联预览(用于 AI 消息) */
  detectImages?: boolean;
}

/** 本地图片路径 → 后端 /files/raw 流地址;http/data/blob 原样返回 */
function localImageUrl(src: string, projectPath: string | null): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const base = projectPath ? `&base=${encodeURIComponent(projectPath)}` : "";
  // withAuthQuery 不能省：<img> 请求由浏览器直接发出、带不了自定义头，
  // 桌面版开着鉴权时会被 401 挡下，而 onError 只是静默隐藏 —— 表现为
  // 「图片就是不显示」且毫无提示。详见 MediaPreview.localMediaUrl 的注释。
  return withAuthQuery(`${httpBase()}/files/raw?path=${encodeURIComponent(src)}${base}`);
}

/**
 * 从消息文本中提取本地媒体路径(模型通常只说「视频已导出到 xxx.mp4」,
 * 不写 markdown 语法)。识别逻辑在 utils/mediaPaths，有单元测试覆盖。
 */
function detectPaths(content: string): string[] {
  // 已写成 ![](path) 的交给下面的 img 组件渲染，这里排除掉避免重复显示
  const mdImageSrcs = new Set(
    [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1].trim())
  );
  return extractMediaPaths(content, mdImageSrcs);
}

/** 全屏灯箱:点击遮罩任意处 / Esc / 右上角 × 关闭 */
function ImageLightbox({ url, alt, onClose }: { url: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-8 cursor-zoom-out"
      style={{ background: "rgba(0, 0, 0, 0.85)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        title="关闭 (Esc)"
        className="absolute top-4 right-4 p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={20} />
      </button>
      <img
        src={url}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-lg shadow-2xl cursor-default"
      />
    </div>,
    document.body
  );
}

/** 图片预览:点击在应用内放大 */
function InlineImage({ url, alt }: { url: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);

  // 加载失败**不再静默隐藏**。原先失败就 return null，于是「后端 401 挡下」
  // 「文件不存在」「路径写错」三种情况在界面上长得一模一样 —— 都是什么都
  // 没有、也没有任何提示，用户只会说"图片没显示"，我也只能靠猜。
  // 现在把文件名摆出来，至少能分清是"没生成"还是"读不到"。
  if (broken) {
    const name = (alt || url).split(/[\\/]/).pop()?.split("?")[0] || "图片";
    return (
      <span className="inline-block my-1 text-[10px] text-slate-500 px-2 py-1 rounded-md bg-white/5 break-all">
        图片无法加载：<span className="font-mono">{name}</span>
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="点击放大" className="block w-fit cursor-zoom-in">
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          onError={() => setBroken(true)}
          className="my-2 max-h-80 max-w-full rounded-lg border border-white/10 hover:border-white/25 transition-colors"
        />
      </button>
      {open && <ImageLightbox url={url} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="group relative my-3">
      <div className="flex items-center justify-between rounded-t-lg bg-obsidian-700/80 px-4 py-1.5 border border-b-0 border-obsidian-600/50">
        <span className="text-[11px] font-mono text-obsidian-300 uppercase tracking-wider">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] text-obsidian-300 hover:text-obsidian-50 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: "0 0 8px 8px",
          border: "1px solid color-mix(in srgb, #222833 90%, transparent)",
          borderTop: "none",
          background: "#06080b",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
        showLineNumbers
        lineNumberStyle={{
          color: "#3d4556",
          fontSize: "11px",
          paddingRight: "16px",
          minWidth: "2.5em",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

export default function MarkdownRenderer({ content, detectImages = false }: Props) {
  const projectPath = useUIStore((s) => s.projectPath);
  const detectedPaths = useMemo(
    () => (detectImages ? detectPaths(content) : []),
    [detectImages, content]
  );

  return (
    <div className="prose-obsidian text-[14px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // AI 回复里的链接:显式 target=_blank(浏览器形态正确),桌面壳则由
          // App 的全局处理器改走系统浏览器——两种形态都不会把当前页面导航走。
          a(props) {
            const { children, ...rest } = props;
            return (
              <a {...rest} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const text = String(children).replace(/\n$/, "");
            if (match) {
              return <CodeBlock language={match[1]}>{text}</CodeBlock>;
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          img({ src, alt }) {
            const s = String(src ?? "");
            // 模型常写成 ![](out.mp4) —— 那样会渲染出一个永远加载失败的
            // <img>。按扩展名分派，非图片交给 MediaPreview。
            if (mediaKindOf(s) && mediaKindOf(s) !== "image") {
              return <MediaPreview path={s} projectPath={projectPath} />;
            }
            return <InlineImage url={localImageUrl(s, projectPath)} alt={alt} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {detectedPaths.length > 0 && (
        <div className="mt-1 flex flex-col gap-2">
          {detectedPaths.map((p) =>
            mediaKindOf(p) === "image" ? (
              // 图片沿用原有 InlineImage：它自带灯箱与错误态，行为已被验证过
              <InlineImage key={p} url={localImageUrl(p, projectPath)} alt={p} />
            ) : (
              // 视频/音频走 MediaPreview：<video> + 后端 Range 流式，
              // 不整读进内存，进度条能拖
              <MediaPreview key={p} path={p} projectPath={projectPath} />
            )
          )}
        </div>
      )}
    </div>
  );
}
