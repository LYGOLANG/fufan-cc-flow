import assert from "node:assert/strict";
import test from "node:test";

/**
 * CLI 安装状态探测的失败语义。
 *
 * 原实现在 catch 里写死 { installed: false }，把「探测失败」当成了
 * 「确定未安装」。后果:每次启动应用都误报"未安装 Claude CLI"——因为
 * AppLayout 一 mount 就探测,而那时 Node sidecar 常常还没监听,请求必然失败。
 * 用户得进一趟设置页触发重新探测,提示才消失。
 *
 * 这里复刻 systemStore 的判定规则,锁住两条:失败时保持"未知"、
 * 未知不得触发"未安装"提示。
 */

const CLI_PROBE_RETRIES = 4;

type Info = { installed: boolean; platform: string } | null;

/** 与 systemStore.loadClaudeInfo 同构的最小状态机 */
class Probe {
  info: Info = null;
  attempts = 0;
  /** @returns 是否安排了重试 */
  onFailure(attempt: number): boolean {
    this.attempts += 1;
    // 关键:失败时**不写** info —— 保持 null(未知)
    return attempt < CLI_PROBE_RETRIES;
  }
  onSuccess(info: NonNullable<Info>) {
    this.info = info;
  }
}

/** 与 InputBar.tsx:70 同构:只有明确的 false 才提示未安装 */
const showsInstallPrompt = (info: Info) => info?.installed === false;

test("探测失败不得写成「未安装」", () => {
  const p = new Probe();
  p.onFailure(0);
  assert.equal(p.info, null, "失败后必须保持未知，不能下结论");
  assert.equal(showsInstallPrompt(p.info), false, "未知状态不该弹安装提示");
});

test("重试耗尽后仍然是「未知」而不是「未安装」", () => {
  const p = new Probe();
  for (let i = 0; i <= CLI_PROBE_RETRIES; i++) p.onFailure(i);
  assert.equal(p.info, null, "重试耗尽也不能改口说未安装");
  assert.equal(
    showsInstallPrompt(p.info),
    false,
    "此时更可能是后端不可用，那由连接状态指示器表达，不是这里",
  );
});

test("探测成功且确实未装，才提示安装", () => {
  const p = new Probe();
  p.onSuccess({ installed: false, platform: "win32" });
  assert.equal(showsInstallPrompt(p.info), true);
});

test("探测成功且已安装，不提示", () => {
  const p = new Probe();
  p.onSuccess({ installed: true, platform: "win32" });
  assert.equal(showsInstallPrompt(p.info), false);
});

test("失败次数未达上限时会继续重试", () => {
  const p = new Probe();
  for (let i = 0; i < CLI_PROBE_RETRIES; i++) {
    assert.equal(p.onFailure(i), true, `第 ${i} 次失败后应继续重试`);
  }
  assert.equal(p.onFailure(CLI_PROBE_RETRIES), false, "达到上限后停止重试");
});

test("重试窗口足够覆盖后端冷启动", () => {
  // 600/1200/1800/2400 累计 6 秒。太短则 sidecar 还没起来就放弃，
  // 太长则真的没装 CLI 时用户迟迟看不到提示。
  let total = 0;
  for (let i = 0; i < CLI_PROBE_RETRIES; i++) total += 600 * (i + 1);
  assert.ok(total >= 3000, `重试窗口 ${total}ms 过短，覆盖不了后端冷启动`);
  assert.ok(total <= 15000, `重试窗口 ${total}ms 过长，真未安装时提示来得太晚`);
});
