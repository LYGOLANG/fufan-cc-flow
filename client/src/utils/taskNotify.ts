import { isTauriRuntime } from "./tauri";

/**
 * 任务完成提醒。
 *
 * 核心前提：**这个功能只在用户没看着屏幕时才有意义**。
 * 长任务跑起来，人多半切去干别的了 —— 那时界面里的任何指示（状态栏、
 * 项目标签的运行灯）都看不见。系统通知是唯一能穿透窗口的方式。
 *
 * 反过来说：用户正盯着应用时弹通知纯属打扰，他本来就能看见。
 * 所以下面每一条都以「窗口是否聚焦」为前置判断。
 */

/** 是否已提示过权限被拒 —— 只提醒一次，别每轮任务都刷日志 */
let deniedWarned = false;

/**
 * 窗口当前是否在前台。
 *
 * 用 Tauri 的窗口状态而不是 document.hidden：后者在窗口被别的程序盖住时
 * 仍然是 false（页面并没有隐藏），而那恰恰是最需要通知的场景。
 */
async function isWindowFocused(): Promise<boolean> {
  if (!isTauriRuntime()) return !document.hidden;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    // 最小化也算「看不见」，两个条件都要
    const [focused, minimized] = await Promise.all([
      win.isFocused(),
      win.isMinimized(),
    ]);
    return focused && !minimized;
  } catch {
    // 拿不到状态时保守处理：当作在前台，不发通知。
    // 宁可漏一次提醒，也不要在用户正看着的时候弹窗。
    return true;
  }
}

/**
 * 共享的 AudioContext。
 *
 * 不能在要播放的那一刻才 new：浏览器/WebView 的自动播放策略下，
 * 新建的 AudioContext 处于 suspended 状态，而解除挂起必须发生在**用户手势的
 * 调用栈里**。任务完成是后台事件，那时再 resume 已经晚了 —— 表现就是
 * 「通知弹了但没有声音」，且不报任何错。
 *
 * 所以改成：首次用户交互时就把它建起来并解挂，之后一直复用。
 */
let audioCtx: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  // 已经挂起的话尽力恢复。在用户手势栈里调用才会真正生效。
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/**
 * 在首次用户交互时解锁音频。由 App 启动时调用一次。
 *
 * 监听 once + 捕获阶段：只要用户点过一次界面、按过一次键，之后的提示音
 * 就都能出声。不这么做的话，用户可能整个会话都听不到任何提示。
 */
export function installAudioUnlock(): void {
  const unlock = () => {
    ensureAudioContext();
  };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
}

/** 播放一声提示音。用 Web Audio 合成，不引入音频文件、不增加包体积。 */
function beep(): void {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    // 中频短音，不刺耳也不容易被忽略
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    // 不 close：这个 context 要复用。close 掉下次又得重新解锁。
  } catch {
    /* 音频不可用不影响主流程 */
  }
}

/**
 * 任务结束时提醒用户。
 *
 * @param title 通知标题，通常是项目名
 * @param body  一句话说明结果
 * @param opts.sound 是否同时响一声
 */
export async function notifyTaskDone(
  title: string,
  body: string,
  opts: { sound?: boolean } = {},
): Promise<void> {
  // 在前台就什么都不做 —— 用户已经看见了
  if (await isWindowFocused()) return;

  if (opts.sound !== false) beep();

  if (!isTauriRuntime()) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) {
      if (!deniedWarned) {
        deniedWarned = true;
        console.info("[notify] 系统通知权限未授予，任务完成将只有提示音");
      }
      return;
    }
    sendNotification({ title, body });
  } catch (err) {
    // 通知失败不该影响任何主流程，但要留痕 —— 否则"提醒没来"这类问题无从查起
    console.warn("[notify] 发送通知失败:", err);
  }
}
