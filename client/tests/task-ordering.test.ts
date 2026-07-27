import assert from "node:assert/strict";
import test from "node:test";
import { sortFinishedTasks } from "../src/utils/taskOrdering";

type T = { id: string; startedAt: number; completedAt?: number };

const ids = (list: T[]) => list.map((t) => t.id);

test("最近完成的排最上面", () => {
  const tasks: T[] = [
    { id: "old", startedAt: 100, completedAt: 200 },
    { id: "newest", startedAt: 300, completedAt: 900 },
    { id: "mid", startedAt: 200, completedAt: 500 },
  ];
  assert.deepEqual(ids(sortFinishedTasks(tasks)), ["newest", "mid", "old"]);
});

test("没有 completedAt 的任务用 startedAt 兜底,不被一律沉底", () => {
  // 异常结束的任务可能没写 completedAt。若当成 0 处理,它们会被甩到最底部,
  // 而这些恰恰是出了问题、最需要被看到的。
  const tasks: T[] = [
    { id: "finished-early", startedAt: 100, completedAt: 150 },
    { id: "crashed-recent", startedAt: 900 },
  ];
  assert.deepEqual(ids(sortFinishedTasks(tasks)), ["crashed-recent", "finished-early"]);
});

test("不修改传入的数组(避免打乱 store 里的原始顺序)", () => {
  const tasks: T[] = [
    { id: "a", startedAt: 1, completedAt: 1 },
    { id: "b", startedAt: 2, completedAt: 9 },
  ];
  const snapshot = ids(tasks);
  sortFinishedTasks(tasks);
  assert.deepEqual(ids(tasks), snapshot, "原数组应保持不变");
});

test("空列表与单元素不出错", () => {
  assert.deepEqual(sortFinishedTasks([]), []);
  const one: T[] = [{ id: "only", startedAt: 5, completedAt: 6 }];
  assert.deepEqual(ids(sortFinishedTasks(one)), ["only"]);
});

test("完成时间相同的任务不会丢失", () => {
  const tasks: T[] = [
    { id: "a", startedAt: 1, completedAt: 100 },
    { id: "b", startedAt: 2, completedAt: 100 },
  ];
  assert.equal(sortFinishedTasks(tasks).length, 2);
});
