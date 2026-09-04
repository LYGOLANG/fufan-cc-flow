import { useEffect, useState } from "react";
import AppLayout from "./components/layout/AppLayout";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import InterruptedTasksBanner from "./components/shared/InterruptedTasksBanner";
import SafeModeBanner from "./components/shared/SafeModeBanner";
import UpdatePrompt from "./components/shared/UpdatePrompt";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAutoHandoff } from "./hooks/useAutoHandoff";
import { restoreOnBoot } from "./utils/openProject";
import { getCrashRecoveryState } from "./utils/crashRecovery";
import { installExternalLinkHandler, openExternal } from "./utils/openExternal";
import { installHeartbeat } from "./utils/heartbeat";
import { installCrashReporter } from "./utils/crashReporter";
import { useUIStore } from "./stores/uiStore";
import { useConnectionStore } from "./stores/connectionStore";
import { installAudioUnlock } from "./utils/taskNotify";

export default function App() {
  // Connect WebSocket (always, regardless of projectPath)
  useWebSocket();

  // 上下文用量达阈值时交接到新会话(取代自动压缩,见 utils/autoHandoff.ts)
  useAutoHandoff();

  const [safeModeFailures, setSafeModeFailures] = useState(0);

  // 页面加载后:恢复当前项目会话视图 + 预热所有项目连接(认领寄存的后台任务)。
  // 例外:看门狗报告连续崩溃时进入安全模式——跳过整个自动恢复(会话加载与
  // 寄存认领都可能是崩因),以最小状态启动并挂横幅告知,打破「加载即崩」循环
  useEffect(() => {
    void (async () => {
      // 首次用户交互时解锁音频。自动播放策略下 AudioContext 建出来就是
      // suspended，而解挂必须发生在用户手势的调用栈里 —— 等任务完成那一刻
      // 再 resume 已经晚了，表现是「通知弹了但没声音」且不报错。
      installAudioUnlock();

      // 先拿到「连的是哪台后端、它的路径语义如何」——路径比较、目录选择、
      // 外链转发都依赖它。安全模式下同样要取:它本身不碰会话,而缺了它
      // 路径处理会退回按本机平台猜,在远程连接下全是错的。
      void useConnectionStore.getState().load();

      const recovery = await getCrashRecoveryState();
      if (recovery.safeMode) {
        setSafeModeFailures(recovery.consecutiveFailures);
        return;
      }
      void restoreOnBoot();
    })();
  }, []);

  // 外链拦截:改走**系统浏览器**。
  //
  // 内置浏览器面板已移除 —— 它是个半成品 WebView:没有地址栏、前进后退、
  // 书签、扩展、登录态,滚动行为也和真浏览器不一致,用户宁可去 Chrome。
  // 与其维护一个不好用的替身,不如把链接交给系统里那个真正好用的。
  //
  // openExternal 内部会做远程端口转发(远程模式下 localhost 指的是远端机器)
  // 并在非 Tauri 形态回退到 window.open。
  useEffect(() => installExternalLinkHandler((url) => void openExternal(url)), []);

  // 心跳:让 Rust 看门狗能感知渲染进程存活,崩溃时自动重载而非留下死屏
  useEffect(() => installHeartbeat(), []);

  // 抓 JS 侧未捕获异常并落盘——渲染进程崩溃前通常先有它们,
  // 这是目前唯一能拿到「崩溃前发生了什么」的证据来源
  useEffect(() => installCrashReporter(), []);

  return (
    <ErrorBoundary scope="App">
      <AppLayout />
      <InterruptedTasksBanner />
      {safeModeFailures > 0 && (
        <SafeModeBanner
          failures={safeModeFailures}
          onDismiss={() => setSafeModeFailures(0)}
        />
      )}
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
