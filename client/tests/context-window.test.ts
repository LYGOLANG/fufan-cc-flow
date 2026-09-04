import assert from "node:assert/strict";
import test from "node:test";
import { inferContextMax } from "../src/utils/costCalculator";

/**
 * 上下文窗口推断的测试。
 *
 * 这个函数只有几十行却很要害：它的返回值是自动压缩的分母。判小了，压缩会在
 * 真实用量远未到阈值时就触发，无声吞掉用户的对话历史 —— 而用户只会觉得
 * 「怎么老是在压缩」，很难联想到是窗口判错。此前它零测试。
 */

const M = 1_000_000;
const K200 = 200_000;

test("当代 Claude 模型判 1M", () => {
  for (const id of [
    "claude-fable-5",
    "claude-mythos-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
  ]) {
    assert.equal(inferContextMax(id), M, `${id} 应为 1M`);
  }
});

test("回归：opus-5 不能掉进 200K 兜底", () => {
  // 原正则是 (fable|mythos|sonnet)-5，唯独漏了 opus。Opus 5 一发布就会踩到：
  // 窗口判成 200K → 自动压缩在真实用量约 19% 时触发。
  assert.equal(inferContextMax("claude-opus-5"), M);
});

test("更高代次同样判 1M，不必每出一版就改代码", () => {
  for (const id of [
    "claude-opus-6",
    "claude-sonnet-6",
    "claude-fable-7",
    "claude-opus-4-9",
    "claude-sonnet-4-9",
    "claude-opus-10",
  ]) {
    assert.equal(inferContextMax(id), M, `${id} 应为 1M`);
  }
});

test("裸别名解析到当代 → 1M", () => {
  assert.equal(inferContextMax("opus"), M);
  assert.equal(inferContextMax("sonnet"), M);
});

test("Haiku 系列仍是 200K", () => {
  for (const id of ["haiku", "claude-haiku-4-5", "claude-3-5-haiku-20241022"]) {
    assert.equal(inferContextMax(id), K200, `${id} 应为 200K`);
  }
});

test("旧 Claude 走 200K 兜底", () => {
  for (const id of ["claude-opus-4-5", "claude-sonnet-4-5", "claude-3-5-sonnet-20241022"]) {
    assert.equal(inferContextMax(id), K200, `${id} 应为 200K`);
  }
});

test("[1m] 后缀强制 1M，优先于目录", () => {
  assert.equal(inferContextMax("claude-haiku-4-5[1m]"), M);
});

test("第三方与 Codex 模型按各自目录", () => {
  assert.equal(inferContextMax("gpt-5.6-terra"), 1_000_000, "gpt-5.6 三档统一 1M");
  assert.equal(inferContextMax("gpt-5.4"), 272_000);
  assert.equal(inferContextMax("gpt-5.5"), 400_000);
  assert.equal(inferContextMax("deepseek-chat"), 128_000);
  assert.equal(inferContextMax("kimi-k2.5"), 256_000);
});

test("未知模型给保守的 200K，不给 0", () => {
  // 返回 0 会让 autoHandoff 里的 contextMax > 0 判定失败而整体跳过，
  // 表现为「自动压缩静默失灵」——宁可保守也不能给 0。
  assert.equal(inferContextMax("某个没见过的模型"), K200);
  assert.equal(inferContextMax(""), K200);
});
