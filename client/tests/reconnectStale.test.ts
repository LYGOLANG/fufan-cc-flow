import assert from "node:assert/strict";
import test from "node:test";

/**
 * 重连状态机的「失效判定」。
 *
 * 背景:原先断线后永远以同样的节奏重试同一个地址,界面一直显示"重连中"。
 * 本机模式下这是对的(sidecar 崩了会被看门狗拉起来),但远程模式下有一类
 * 故障重试一万次也没用 —— SSH 隧道由桌面壳在启动时建立,隧道进程一死
 * (换网、休眠、服务器重启),本机那个端口就再没人监听,只有重启应用才会
 * 重建。那时还显示"正在重连"就是在骗人。
 *
 * 这里复刻 http-chat.ts 里的计数规则,锁住两条性质:阈值前不误报、
 * 成功一次即清零。真实实现依赖 WebSocket,不适合在单测里起真连接。
 */

const STALE_AFTER = 4;

/** 与 http-chat.ts 的 onopen/onclose 同构的最小状态机 */
class ReconnectState {
  failures = 0;
  onClose(closedByUser = false): { stale: boolean } | null {
    if (closedByUser) return null;
    this.failures += 1;
    return { stale: this.failures >= STALE_AFTER };
  }
  onOpen() {
    this.failures = 0;
  }
}

test("阈值之前不报失效——短暂抖动不该惊动用户", () => {
  const s = new ReconnectState();
  for (let i = 1; i < STALE_AFTER; i++) {
    assert.equal(s.onClose()?.stale, false, `第 ${i} 次失败不应判定为失效`);
  }
});

test("连续失败达到阈值即判定失效", () => {
  const s = new ReconnectState();
  let last: { stale: boolean } | null = null;
  for (let i = 0; i < STALE_AFTER; i++) last = s.onClose();
  assert.equal(last?.stale, true);
});

test("成功连上一次就清零——之前失败多少次都不算数", () => {
  const s = new ReconnectState();
  for (let i = 0; i < STALE_AFTER; i++) s.onClose();
  assert.equal(s.failures, STALE_AFTER);

  s.onOpen();
  assert.equal(s.failures, 0, "连上后计数必须归零");

  // 归零后要重新累计满阈值才再次判定失效，
  // 否则一次抖动就会让界面永久停在"连接已断开"
  assert.equal(s.onClose()?.stale, false);
});

test("用户主动关闭不计入失败", () => {
  const s = new ReconnectState();
  assert.equal(s.onClose(true), null, "主动关闭不产生事件");
  assert.equal(s.failures, 0, "主动关闭不该累加失败次数");
});

test("阈值对应的等待时间在可接受范围", () => {
  // 退避 3s 起、每次翻倍、上限 30s：3+6+12 = 21s 后触发第 4 次失败判定。
  // 太短会让 sidecar 正常重启期间误报，太长则用户对着假的"重连中"干等。
  let delay = 3000;
  let total = 0;
  for (let i = 1; i < STALE_AFTER; i++) {
    total += delay;
    delay = Math.min(delay * 2, 30000);
  }
  assert.ok(total >= 15_000, `判定过快(${total}ms)，会在后端正常重启时误报`);
  assert.ok(total <= 60_000, `判定过慢(${total}ms)，用户会对着假的"重连中"干等`);
});
