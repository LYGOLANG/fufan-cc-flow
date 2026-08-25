/**
 * 消息列表「是否把视图钉在底部」的判定。
 *
 * ## 设计原则：不允许存在永久性的死状态
 *
 * 这套逻辑被改过四轮，每一轮的失败都是同一个形状：**某个布尔标志被误置之后，
 * 自动跟随永久关闭，再也不会自愈**。用户表现为「无论发送还是接收都不滚到底」。
 *
 * 历代死状态的来源：
 *   1. `userScrolledUp = !atBottom` —— 把「程序化滚动收敛途中不在底部」当成用户上翻
 *   2. `scrollTop < lastTop → 停止跟随` —— 把「浏览器夹住 / 橡皮筋回弹 / 内容回缩」当成用户上翻
 *   3. 钉住循环的启动被 `if (!following) return` 挡在门外 —— 标志一旦为假，
 *      连补救机制都启动不了
 *
 * 前两条都是**猜用户心思**，而猜错的代价是功能彻底失效、且不可恢复 ——
 * 代价与收益完全不成比例。第三条更糟：补救机制自己被死状态锁住了。
 *
 * 现在改成**带过期时间的暂停**，而不是布尔开关：
 *   - 用户明确上翻 → 暂停跟随 `SUSPEND_MS`
 *   - 每次继续上翻都会续期（用户还在读，就一直别打扰）
 *   - 停手 `SUSPEND_MS` 后自动恢复跟随
 *   - 回到底部 → 立即恢复
 *   - 发送消息 / 切换会话 → 立即恢复
 *
 * 关键性质：**任何误判最多影响 SUSPEND_MS，之后必然自愈。** 没有死状态。
 */

/** 距底多少像素以内算「贴着底部」 */
export const AT_BOTTOM_THRESHOLD = 80;

/** 用户上翻后，暂停自动跟随多久（毫秒）。到点自动恢复 —— 这是「无死状态」的保证 */
export const SUSPEND_MS = 5000;

/**
 * 小于这个绝对值的滚轮增量一律忽略。
 *
 * macOS 触控板的惯性滚动与橡皮筋回弹会产生一串**方向朝上的碎小增量**，
 * 哪怕用户其实是在往下滚。不设阈值的话，一次正常的向下滚动就能把跟随关掉。
 */
export const WHEEL_NOISE_PX = 8;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function distanceToBottom(m: ScrollMetrics): number {
  return m.scrollHeight - m.scrollTop - m.clientHeight;
}

export function isAtBottom(m: ScrollMetrics, threshold = AT_BOTTOM_THRESHOLD): boolean {
  return distanceToBottom(m) < threshold;
}

/** 该不该把视图钉到底部：没在暂停期内就钉 */
export function shouldPin(suspendUntil: number, now: number): boolean {
  return now >= suspendUntil;
}

/**
 * 滚轮事件 → 新的暂停截止时间。
 *
 * @param deltaY  负值为向上
 * @param current 当前暂停截止时间
 * @returns 新的暂停截止时间（不变则原样返回）
 */
export function onWheel(
  deltaY: number,
  current: number,
  now: number,
  suspendMs = SUSPEND_MS,
): number {
  // 只有「明确的向上滚动」才算用户想往回看。
  // 向下滚（deltaY > 0）不该暂停跟随 —— 用户是在追最新内容。
  // 碎小增量一律当噪声：那是惯性与回弹，不是意图。
  if (deltaY > -WHEEL_NOISE_PX) return current;
  return Math.max(current, now + suspendMs);
}

/**
 * scroll 事件 → 新的暂停截止时间。
 *
 * **只做一件事：回到底部就立刻解除暂停。**
 * 绝不根据位置反推「用户想上翻」—— 那正是历代死状态的来源（见文件头注释）。
 */
export function onScroll(
  m: ScrollMetrics,
  current: number,
  threshold = AT_BOTTOM_THRESHOLD,
): number {
  return isAtBottom(m, threshold) ? 0 : current;
}
