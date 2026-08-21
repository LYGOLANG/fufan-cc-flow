/**
 * 从文本里认出会话产出的本地媒体文件路径。
 *
 * 模型通常只说「视频已导出到 out/demo.mp4」，不写 markdown 语法，所以得
 * 从自然语言里把路径捞出来才能内联预览 —— 否则"做完了"和"看得见"之间
 * 就隔着一道让用户自己去文件管理器翻的墙。
 *
 * 抽成独立模块是为了能被单元测试覆盖：这条正则里既有中文字符范围、又有
 * Windows 反斜杠，改动时极易被转义吃掉一层而**静默失效**（识别不到任何
 * 路径，界面什么都不显示，且不报错）。实际改这块时就连踩三次。
 */

/** 支持内联预览的扩展名。与后端 routes/files.ts 的 IMAGE_TYPES/MEDIA_TYPES 对应。 */
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "ogg", "flac"];

/**
 * 媒体路径正则。
 *
 * **必须写成正则字面量，不要用 new RegExp(模板字符串) 拼。** 拼字符串要多写
 * 一层转义（`\\w` 才是 `\w`），少一层就变成匹配字面的 `w` —— 整条正则什么都
 * 匹配不到，而且**不报任何错**：界面上媒体一个都不显示，看起来像是"功能没做"。
 * 这一版就是这么写坏的，靠单元测试才当场抓住。
 *
 * 字符类里 `\\` 是反斜杠（Windows 路径），`/` 是斜杠，两种分隔符都要认。
 */
const MEDIA_RE =
  /[\w一-鿿~:.\\/-]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v|ogv|mp3|wav|m4a|ogg|flac)\b/gi;

/** 每次调用新建，避免共享 lastIndex 造成的隔次漏匹配 */
/**
 * 每次调用新建正则实例。
 *
 * 不共享上面那个字面量：带 /g 的正则会保留 lastIndex，跨调用共享会让隔次
 * 匹配从上次结束位置开始 —— 表现为「有时能预览有时不能」这种最难查的样子。
 */
function mediaRegex(): RegExp {
  return new RegExp(MEDIA_RE.source, MEDIA_RE.flags);
}

export type MediaKind = "image" | "video" | "audio";

/** 按扩展名判定类型；不是受支持的媒体返回 null */
export function mediaKindOf(pathOrUrl: string): MediaKind | null {
  const ext = pathOrUrl.split("?")[0].split("#")[0].toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"].includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

/**
 * 提取文本中的本地媒体路径。
 *
 * @param content 待扫描文本（AI 消息正文或工具输出）
 * @param exclude 已由别的渲染路径处理掉的路径（如 markdown 的 ![](x)），避免重复渲染
 * @param limit   最多取几个 —— 一次输出里报十几个路径时全渲染会把界面撑爆
 */
export function extractMediaPaths(content: string, exclude?: Set<string>, limit = 6): string[] {
  const out: string[] = [];
  const re = mediaRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[0];
    if (s.includes("://")) continue; // 远程 URL 交给 <img>/<video> 直接加载
    if (exclude?.has(s)) continue;
    out.push(s);
  }
  return [...new Set(out)].slice(0, limit);
}
