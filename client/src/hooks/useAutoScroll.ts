import { useRef, useEffect, useLayoutEffect, useCallback } from "react";

/** 距底多少像素以内算「贴着底部」 */
const AT_BOTTOM_THRESHOLD = 80;
/** 程序化滚动后,多久之内到达的 scroll 事件视为它自己产生的回声 */
const SUPPRESS_MS = { auto: 150, smooth: 1000 } as const;

/**
 * 消息列表的自动跟随滚动。
 *
 * @param deps  变化时触发跟随滚动的依赖
 * @param instant  true 时用瞬时滚动(流式输出中,避免动画开销)
 *
 * 这里有三个此前踩过的坑,改动时请连注释一起读:
 *
 * 1. **不能把自己滚动产生的事件当成「用户上翻」**。滚动容器上绑了 onScroll,
 *    而平滑滚动在整个动画期间会持续派发 scroll 事件。原实现在每个事件里都
 *    无条件更新 userScrolledUp,于是只要动画没能精确停在底部(见第 3 点),
 *    该标志就被永久置为 true —— 此后整个会话的自动跟随全部失效,直到用户
 *    手动滚回底部。现在用「抑制窗口 + 方向判定」把回声滤掉:程序化滚动只会
 *    向下,所以窗口期内向上的滚动仍然认定是用户操作,不会误伤真实上翻。
 *
 * 2. **首屏必须瞬时定位,而且要在 paint 之前**。原实现用 useEffect(paint 之后)
 *    且首屏 instant 为 false(此时没在流式) => 用户先看到会话顶部,再眼看着
 *    几百条历史动画式飞过。改用 useLayoutEffect + behavior:"auto"。
 *
 * 3. **滚动目标是移动的**。MessageList 给非当前消息用了 content-visibility:auto
 *    + containIntrinsicSize(长会话渲染优化),视口外消息先按估算高度计算,
 *    真实布局到位后 scrollHeight 会继续变。所以滚动之后还要在高度稳定时补一次,
 *    否则会停在「当时的底部」而不是真正的底部。这里用 ResizeObserver 兜住。
 */
export function useAutoScroll(deps: unknown[], instant = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  /** 在此时间戳之前到达的向下滚动事件,视为程序化滚动的回声 */
  const suppressUntil = useRef(0);
  /** 上一次的 scrollTop,用于判断滚动方向 */
  const lastTop = useRef(0);
  /** 首次布局尚未完成 —— 首屏要瞬时定位而不是动画 */
  const isFirstLayout = useRef(true);

  /** 滚到底部,并开启抑制窗口屏蔽它自己产生的 scroll 回声 */
  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const el = containerRef.current;
    if (!el) return;
    suppressUntil.current =
      Date.now() + (behavior === "smooth" ? SUPPRESS_MS.smooth : SUPPRESS_MS.auto);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /**
   * 用户的「向上」意图，必须在 scroll 事件之前就登记。
   *
   * 踩过的坑：流式输出时 ResizeObserver 每来一批内容就触发一次，而它只看
   * userScrolledUp —— 那个标志却要等 scroll 事件才更新。浏览器的实际顺序是
   *   ① 滚轮改变 scrollTop
   *   ② 新内容到达 → layout → **ResizeObserver 回调先跑**（标志仍是 false）
   *      → 把视图拉回底部
   *   ③ scroll 事件这才派发 → 位置已在底部 → 判定 atBottom → 标志压根没置位
   * 结果就是「任务运行期间根本滚不上去，任务一结束就正常了」。
   *
   * wheel / touchmove 在滚动发生**之前**派发，用它们抢在 ResizeObserver 前面
   * 登记意图，竞态就不成立了。
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) userScrolledUp.current = true;
  }, []);

  const handleTouchMove = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // 触摸滚动方向要等位置变化才知道，这里保守处理：只要不在底部就停止跟随
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    if (!atBottom) userScrolledUp.current = true;
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const goingUp = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;

    // 抑制窗口内的「向下」滚动是我们自己滚的,不代表用户意图。
    // 向上的一律放行 —— 用户在动画途中想往回看,必须立刻生效。
    if (!goingUp && Date.now() < suppressUntil.current) return;

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    userScrolledUp.current = !atBottom;
  }, []);

  // 首屏用 layout effect + 瞬时定位:在浏览器绘制之前就位,不闪、不动画。
  useLayoutEffect(() => {
    if (userScrolledUp.current) return;
    scrollToEnd(isFirstLayout.current || instant ? "auto" : "smooth");
    isFirstLayout.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // content-visibility 让视口外消息的高度在滚动后才落定,scrollHeight 会继续长。
  // 高度还在变且用户没上翻时,补一次瞬时对齐,确保真的停在底部。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const target = el.firstElementChild ?? el;
    const ro = new ResizeObserver(() => {
      if (userScrolledUp.current) return;
      const node = containerRef.current;
      if (!node) return;

      // 二次确认，兜住 wheel/touchmove 覆盖不到的输入方式（PageUp、Home、
      // 拖动滚动条）—— 它们同样只产生 scroll 事件，同样可能慢于本回调。
      //
      // 判据用「上一次已知位置」而不是当前距底距离：内容长高本身就会让距底
      // 变大，拿它当判据会把正常的流式增长误判成用户上翻。而 scrollTop 变小
      // 只可能是有人主动往回滚 —— 程序化滚动只会让它变大。
      if (node.scrollTop < lastTop.current - 1) {
        userScrolledUp.current = true;
        lastTop.current = node.scrollTop;
        return;
      }
      scrollToEnd("auto");
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [scrollToEnd]);

  /** 强制滚到底部并重置"用户已上翻"标记——用户主动发消息时调用 */
  const scrollToBottom = useCallback(() => {
    userScrolledUp.current = false;
    scrollToEnd("auto");
  }, [scrollToEnd]);

  return { containerRef, handleScroll, handleWheel, handleTouchMove, scrollToBottom };
}
