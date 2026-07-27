import type { BackgroundTask } from "../types/agent";

/**
 * 已完成的后台任务按「最近完成」排前。
 *
 * 抽成纯函数是为了能测边界:completedAt 是可选字段(异常结束的任务可能没写),
 * 如果直接当 0 处理,这些任务会被一律甩到列表最底部 —— 而它们恰恰是出问题
 * 需要被看到的那些。这里用 startedAt 兜底,让它们回到时间线上的合理位置。
 */
export function sortFinishedTasks<T extends Pick<BackgroundTask, "completedAt" | "startedAt">>(
  tasks: T[]
): T[] {
  return [...tasks].sort((a, b) => taskTime(b) - taskTime(a));
}

function taskTime(t: Pick<BackgroundTask, "completedAt" | "startedAt">): number {
  return t.completedAt ?? t.startedAt ?? 0;
}
