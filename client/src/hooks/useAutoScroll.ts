import { useRef, useEffect, useCallback } from "react";

/**
 * @param deps - dependencies that trigger auto-scroll
 * @param instant - when true, use instant scroll (no CSS animation overhead during streaming)
 */
export function useAutoScroll(deps: unknown[], instant = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 80;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    userScrolledUp.current = !atBottom;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: instant ? "auto" : "smooth",
      });
    }
  }, deps);

  /** 强制滚到底部并重置"用户已上翻"标记——用户主动发消息时调用 */
  const scrollToBottom = useCallback(() => {
    userScrolledUp.current = false;
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  return { containerRef, handleScroll, scrollToBottom };
}
