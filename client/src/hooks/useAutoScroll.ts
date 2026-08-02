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
    if (e.deltaY >= 0) return;
    const el = containerRef.current;
    if (!el) return;

    // 两道闸，缺一不可 —— 否则这个"修复"比它要修的 bug 更容易触发：
    //
    // ① React 的 onWheel **会冒泡**（onScroll 不会）。工具卡片里有十几个
    //    `max-h-* overflow-y-auto` 的内嵌滚动框（ToolCallCard 里 Bash 输出、
    //    diff、参数 JSON 都是）。在那些框里往上滚一格，事件会冒泡到这里，
    //    而外层容器**根本没动** → 不产生 scroll 事件 → handleScroll 没机会
    //    复位 → 自动跟随永久关闭。读一眼工具输出就再也不跟随了。
    //    判据：事件源是否就在本容器的直接滚动链上 —— 用「本容器当前能否上滚」
    //    来兜，配合下面第 ② 条。
    // ② 内容不足一屏时（没有滚动条）滚轮同样不产生 scroll 事件，
    //    置位后永远无人复位。此时压根没有"上翻"这回事。
    if (el.scrollTop <= 0) return;

    // 事件发生在内层滚动容器里时，让内层自己消化：只有当事件目标到本容器之间
    // 不存在"还能继续上滚的滚动容器"时，才认为用户是在滚外层。
    const target = e.target as HTMLElement | null;
    for (let n = target; n && n !== el; n = n.parentElement) {
      const style = n instanceof HTMLElement ? getComputedStyle(n) : null;
      const scrollable =
        style &&
        /(auto|scroll)/.test(style.overflowY) &&
        n.scrollHeight > n.clientHeight;
      if (scrollable && n.scrollTop > 0) return; // 内层还能上滚，这一格是它的
    }

    userScrolledUp.current = true;
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
      // 判据不能只看「scrollTop 是否变小」。这里原先的注释断言「变小只可能是
      // 有人主动往回滚」，**那是错的**：内容变矮时浏览器会把 scrollTop 夹到
      // scrollHeight - clientHeight，同样让它变小。而内容变矮在本项目里很常见：
      //   - content-visibility:auto 的消息滚出视口时收缩回估算高度
      //   - 用户折叠一张 ToolCallCard
      //   - 流式文本提交进消息时的瞬时回缩
      // 只看变小的话，任务运行中折叠一个工具卡片就会永久关闭自动跟随。
      //
      // 改为看「距底距离」是否明显超出阈值：被夹住时 scrollTop 会紧贴新的底部
      // （距底 ≈ 0），而真正的上翻会离底很远。
      const distToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (node.scrollTop < lastTop.current - 1 && distToBottom > AT_BOTTOM_THRESHOLD) {
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
