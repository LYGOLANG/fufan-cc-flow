import { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  AT_BOTTOM_THRESHOLD,
  onScroll as reduceScroll,
  onWheel as reduceWheel,
  shouldPin,
  type ScrollMetrics,
} from "../utils/scrollFollow";

/**
 * 消息列表的自动跟随滚动 —— 把视图钉在底部。
 *
 * 判定逻辑在 `utils/scrollFollow.ts`（纯函数 + 单测），本文件只读 DOM、
 * 派发滚动、接事件。这个分工是刻意的：滚动行为在本机没法端到端验证
 * （生产是 Tauri 的 WKWebView，Playwright 的 chromium/webkit 都复现不出问题），
 * 至少让判定本身有测试网兜着。
 *
 * ## 两条铁律，改动前必读
 *
 * **① 不允许存在永久性的死状态。**
 * 这套逻辑被改过四轮，每轮失败都是同一形状：某个布尔标志被误置后自动跟随
 * 永久关闭、再也不自愈，用户表现为「无论发送还是接收都不滚到底」。
 * 所以现在用**带过期时间的暂停**而不是布尔开关，任何误判最多影响
 * `SUSPEND_MS` 就必然自愈。**不要把它改回布尔标志。**
 *
 * **② 补救机制的启动不能被待补救的状态挡住。**
 * 上一版把 `startPinning()` 写在 `if (!following) return` 之后 ——
 * 标志一旦为假，连补救都启动不了，死得更彻底。现在钉住循环**无条件启动**，
 * 该不该真的滚由循环内部每帧自己判断。
 *
 * ## 为什么是「每帧钉一次」而不是「内容变了滚一次」
 *
 * 单次 `scrollTo` 要求调用那一刻就知道最终高度，而这个前提在本应用里从不成立：
 * Markdown 排版落定、代码高亮异步着色、图片/视频加载完才撑开、工具卡展开、
 * 字体替换回流 —— 全都发生在滚动之后。原实现靠 ResizeObserver 追这些变化，
 * 但 RO 只在被观察元素**自身尺寸**变化时触发，漏的情况足够多，
 * 且它与 scroll 事件的先后顺序在不同引擎上不一致。
 *
 * 与其枚举「什么时候该补一次」，不如在一段时间内**每帧都钉一次**：
 * 每帧代价是一次属性读写，可忽略；而它对所有异步撑高天然免疫，不需要枚举。
 *
 * @param deps  变化时触发跟随的依赖
 * @param instant  true 时用瞬时滚动（流式输出中，避免动画开销）
 */
export function useAutoScroll(deps: unknown[], instant = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** 暂停跟随到这个时间戳。0 = 不暂停。到点自动恢复 —— 无死状态的保证 */
  const suspendUntil = useRef(0);
  /** 钉住循环运行到这个时间戳 */
  const pinUntil = useRef(0);
  const pinning = useRef(false);
  const isFirstLayout = useRef(true);

  const read = (el: HTMLElement): ScrollMetrics => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  });

  /** 钉住循环：每帧把视图拉到底部，直到窗口到期 */
  const pin = useCallback(() => {
    const el = containerRef.current;
    if (!el || Date.now() > pinUntil.current) {
      pinning.current = false;
      return;
    }
    // 暂停期内不动视图，但循环继续跑 —— 暂停一到期就能立刻接着钉，
    // 不需要外部再来一次事件把它唤醒。
    if (shouldPin(suspendUntil.current, Date.now())) {
      // 直接赋值而不是 scrollTo({behavior})：后者会和平滑动画打架，
      // 动画途中新内容到达就被中断在半路。
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
        el.scrollTop = el.scrollHeight;
      }
    }
    requestAnimationFrame(pin);
  }, []);

  /** 开启/续期钉住窗口。**无条件执行**，不受暂停状态影响（见铁律 ②） */
  const startPinning = useCallback(
    (ms: number) => {
      pinUntil.current = Math.max(pinUntil.current, Date.now() + ms);
      if (!pinning.current) {
        pinning.current = true;
        requestAnimationFrame(pin);
      }
    },
    [pin],
  );

  /**
   * 用户的「向上」意图。必须在 scroll 事件之前登记 —— wheel 在滚动发生**之前**
   * 派发，而 scroll 在之后，只靠 scroll 会被钉住循环抢先覆盖掉
   * （15c25cc 修的就是这个竞态：「任务运行期间根本滚不上去」）。
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;

    // 两道闸，缺一不可 —— 否则这个"修复"比它要修的 bug 更容易触发：
    //
    // ① React 的 onWheel **会冒泡**（onScroll 不会）。工具卡片里有十几个
    //    `max-h-* overflow-y-auto` 的内嵌滚动框（Bash 输出、diff、参数 JSON）。
    //    在那些框里往上滚一格，事件冒泡到这里，而外层容器**根本没动**
    //    → 不产生 scroll 事件 → 没有任何东西能复位 → 读一眼工具输出就不跟随了。
    // ② 内容不足一屏时（没有滚动条）滚轮同样不产生 scroll 事件。
    //    此时压根没有"上翻"这回事。
    if (el.scrollTop <= 0) return;
    const target = e.target as HTMLElement | null;
    for (let n = target; n && n !== el; n = n.parentElement) {
      const style = n instanceof HTMLElement ? getComputedStyle(n) : null;
      const scrollable =
        style && /(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight;
      if (scrollable && n.scrollTop > 0) return; // 内层还能上滚，这一格是它的
    }

    suspendUntil.current = reduceWheel(e.deltaY, suspendUntil.current, Date.now());
  }, []);

  const handleTouchMove = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const m = read(el);
    // 触摸滚动方向要等位置变化才知道，保守处理：不在底部就暂停跟随。
    // 暂停会自动过期，所以误判的代价有限。
    if (m.scrollHeight - m.scrollTop - m.clientHeight >= AT_BOTTOM_THRESHOLD) {
      suspendUntil.current = Math.max(suspendUntil.current, Date.now() + 5000);
    }
  }, []);

  /**
   * scroll 事件**只用来解除暂停**（回到底部即恢复跟随）。
   *
   * 绝不在这里根据位置反推「用户想上翻」—— 历代死状态全出自那类推断：
   * 浏览器夹住 scrollTop、橡皮筋回弹、内容回缩都会让位置无故变小。
   */
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    suspendUntil.current = reduceScroll(read(el), suspendUntil.current);
  }, []);

  // 首屏用 layout effect + 瞬时定位：在浏览器绘制之前就位，不闪、不动画。
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && shouldPin(suspendUntil.current, Date.now())) {
      if (isFirstLayout.current || instant) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
    isFirstLayout.current = false;
    // 内容每变一次就把钉住窗口续到 1.5 秒后。流式输出 60ms 一批，于是整个回答
    // 期间都在钉；结束后再钉 1.5 秒兜住最后的异步撑高，然后自动停。
    // **无条件调用** —— 见铁律 ②。
    startPinning(1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // 内容高度在滚动之后仍会继续变（异步排版/着色/图片加载）。
  // ResizeObserver 在这里只是辅助：真正的主力是上面的钉住循环。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const target = el.firstElementChild ?? el;
    const ro = new ResizeObserver(() => startPinning(1500));
    ro.observe(target);
    return () => ro.disconnect();
  }, [startPinning]);

  /**
   * 无条件回到底部并立刻恢复跟随。
   * 用户主动发消息、或切换到另一个会话时调用 —— 这两种情况下用户一定想看最新的。
   */
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    suspendUntil.current = 0; // 立即解除暂停，不等过期
    el.scrollTop = el.scrollHeight;
    // 钉 3 秒：发送时新气泡要等 Markdown 排版、切会话时历史是 await 回来的，
    // 这两种情况下「当下的 scrollHeight」都不是最终值，单次滚动必然落空。
    startPinning(3000);
  }, [startPinning]);

  return { containerRef, handleScroll, handleWheel, handleTouchMove, scrollToBottom };
}
