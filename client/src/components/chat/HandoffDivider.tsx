import { useState } from "react";
import { GitBranch, ChevronDown, Info } from "lucide-react";

interface Props {
  /** 触发交接时旧会话的上下文用量百分比 */
  pct: number;
  /** 旧会话 id,便于用户回历史里找原文 */
  fromSessionId?: string;
}

/**
 * 「已交接到新会话」的分隔符。
 *
 * 与 CompactDivider 的区别不只是文案:压缩是同一个会话里历史被换成摘要,
 * 交接是**换了一个会话**——这条分隔符之上不会有任何旧消息,交接文档本身
 * 就在它下面那条用户消息里,原文完整可见,不需要额外的折叠区。
 */
export default function HandoffDivider({ pct, fromSessionId }: Props) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="my-4 flex flex-col items-center gap-1.5 select-none">
      <div className="w-full flex items-center gap-3">
        <div className="flex-1 h-px bg-violet-info/15" />
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-violet-info/20 bg-violet-info/5">
          <GitBranch size={11} className="text-violet-info/70" />
          <span className="text-[11px] text-violet-info/80 font-medium">已交接到新会话</span>
        </div>
        <div className="flex-1 h-px bg-violet-info/15" />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-slate-500">
          上一会话用量 {Math.round(pct)}%
        </span>
        <button
          onClick={() => setShowTip(!showTip)}
          className="text-slate-600 hover:text-slate-400 transition-colors"
        >
          {showTip ? <ChevronDown size={11} /> : <Info size={11} />}
        </button>
      </div>

      {showTip && (
        <div className="max-w-xs text-center text-[10px] text-slate-500 leading-relaxed px-4 py-2 rounded-lg bg-white/3 border border-white/5">
          上一会话上下文将满，已由它写下交接文档并开启新会话（下方第一条消息即该文档）。
          历史不做压缩，原会话的完整记录仍可在历史会话中查看。
          {fromSessionId && (
            <span className="block mt-1 font-mono text-slate-600 break-all">
              原会话 {fromSessionId.slice(0, 8)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
