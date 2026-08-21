import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Film, Music, Download } from "lucide-react";
import { httpBase, withAuthQuery } from "../../services/endpoint";
import { mediaKindOf } from "../../utils/mediaPaths";

/**
 * 会话里产出的本地媒体的内联预览。
 *
 * 图片一直是能内联的，视频/音频此前只留下一行路径 —— 用户得自己去文件管理器
 * 里翻出来双击，"做完了"和"看得见"之间隔着一道毫无必要的墙。
 *
 * 视频走 <video> + 后端 Range 流式（见 routes/files.ts 的 /raw）：整文件塞进
 * 内存对几十上百 MB 的视频是灾难，而且不支持 Range 时浏览器不给 seek，
 * 进度条会拖不动。
 */

// 判类型与路径识别统一由 utils/mediaPaths 提供 —— 那份有单元测试盯着。
// 这里曾各写一份（本文件 + MarkdownRenderer + ToolCallCard 共三处相同正则），
// 正是「改一处漏两处」的经典结构。
export { mediaKindOf };

/**
 * 本地路径 → 后端 /files/raw 流地址；http/data/blob 原样返回。
 *
 * **必须带上 withAuthQuery。** 桌面版后端开了鉴权，而 `<img>` / `<video>`
 * 的请求由浏览器直接发出，**没法附加自定义请求头** —— 不把令牌放进 query，
 * 请求就会被 401 挡下。更坑的是失败后 `<img onError>` 只会静默隐藏，
 * 界面上什么都没有、也不报错，看起来就像"这功能没做"。
 * （令牌只在本机回环传输，不出网；WebSocket 也是同样的走法。）
 */
export function localMediaUrl(src: string, projectPath?: string | null): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const base = projectPath ? `&base=${encodeURIComponent(projectPath)}` : "";
  return withAuthQuery(`${httpBase()}/files/raw?path=${encodeURIComponent(src)}${base}`);
}

function fileNameOf(p: string): string {
  // 同时切 / 和 \：媒体路径既可能来自 Unix 也可能是 Windows 绝对路径
  return p.split(/[\\/]/).pop() || p;
}

/** 视频全屏灯箱。Esc / 点遮罩 / × 关闭 */
function VideoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-8"
      style={{ background: "rgba(0,0,0,0.9)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        title="关闭 (Esc)"
        className="absolute top-4 right-4 p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={20} />
      </button>
      {/* 阻止冒泡：在播放器上点暂停不该把灯箱关掉 */}
      <video
        src={url}
        controls
        autoPlay
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-lg shadow-2xl"
      />
    </div>,
    document.body
  );
}

export default function MediaPreview({
  path,
  projectPath,
}: {
  path: string;
  projectPath?: string | null;
}) {
  const kind = mediaKindOf(path);
  const url = localMediaUrl(path, projectPath);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  if (!kind) return null;

  // 加载失败要说出来。静默隐藏的话，用户只知道"没显示"，
  // 分不清是文件没生成、路径不对，还是预览本身坏了。
  if (failed) {
    return (
      <div className="text-[10px] text-slate-500 px-2 py-1.5 rounded-md bg-white/5 break-all">
        无法预览 <span className="font-mono">{fileNameOf(path)}</span>（文件不存在或格式不支持）
      </div>
    );
  }

  if (kind === "image") {
    return (
      <img
        src={url}
        alt={fileNameOf(path)}
        onError={() => setFailed(true)}
        className="max-w-full max-h-[420px] rounded-lg border border-white/10 object-contain"
      />
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-white/10 bg-white/5">
        <Music size={13} className="text-purple-glow shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-400 truncate mb-1">{fileNameOf(path)}</div>
          <audio src={url} controls onError={() => setFailed(true)} className="w-full h-8" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg overflow-hidden border border-white/10 bg-black/30">
        <video
          src={url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="max-w-full max-h-[420px] block"
        />
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-white/10">
          <Film size={11} className="text-slate-500 shrink-0" />
          <span className="text-[10px] text-slate-500 truncate flex-1">{fileNameOf(path)}</span>
          <button
            onClick={() => setFull(true)}
            className="text-[10px] text-slate-400 hover:text-white transition-colors"
          >
            全屏
          </button>
          <a
            href={url}
            download={fileNameOf(path)}
            className="text-slate-400 hover:text-white transition-colors"
            title="下载"
          >
            <Download size={11} />
          </a>
        </div>
      </div>
      {full && <VideoLightbox url={url} onClose={() => setFull(false)} />}
    </>
  );
}
