import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, X } from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { httpBase } from "../../services/endpoint";
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
  return `${httpBase()}/files/raw?path=${encodeURIComponent(src)}${base}`;
}

/**
 * 从消息文本中提取本地图片路径(模型通常只说「图片已保存到 xxx.png」,
 * 不写 markdown 图片语法)。排除远程 URL 和已有 markdown 图片语法的路径。
 */
function extractImagePaths(content: string): string[] {
  const mdImageSrcs = new Set(
    [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1].trim())
  );
  const out: string[] = [];
  const re = /[\w一-鿿~:.\\/-]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[0];
    if (s.includes("://")) continue; // 远程 URL 交给 markdown img 处理
    if (mdImageSrcs.has(s)) continue; // 已是 ![](path),img 组件会渲染
    out.push(s);
  }
  return [...new Set(out)].slice(0, 6);
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

/** 图片预览:点击在应用内放大;加载失败时整体隐藏 */
function InlineImage({ url, alt }: { url: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  if (broken) return null;
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
    () => (detectImages ? extractImagePaths(content) : []),
    [detectImages, content]
  );

  return (
    <div className="prose-obsidian text-[14px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
            return <InlineImage url={localImageUrl(String(src ?? ""), projectPath)} alt={alt} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {detectedPaths.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {detectedPaths.map((p) => (
            <InlineImage key={p} url={localImageUrl(p, projectPath)} alt={p} />
          ))}
        </div>
      )}
    </div>
  );
}
