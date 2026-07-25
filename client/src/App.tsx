import { useEffect } from "react";
import AppLayout from "./components/layout/AppLayout";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import InterruptedTasksBanner from "./components/shared/InterruptedTasksBanner";
import UpdatePrompt from "./components/shared/UpdatePrompt";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAutoCompact } from "./hooks/useAutoCompact";
import { restoreOnBoot } from "./utils/openProject";
import { installExternalLinkHandler } from "./utils/openExternal";
import { installHeartbeat } from "./utils/heartbeat";
import { installCrashReporter } from "./utils/crashReporter";
import { useUIStore } from "./stores/uiStore";

export default function App() {
  // Connect WebSocket (always, regardless of projectPath)
  useWebSocket();

  // 上下文用量达阈值自动压缩(此前 autoCompactThreshold 是死配置,无人消费)
  useAutoCompact();

  // 页面加载后:恢复当前项目会话视图 + 预热所有项目连接(认领寄存的后台任务)
  useEffect(() => {
    void restoreOnBoot();
  }, []);

  // 外链拦截:桌面端送内置浏览器面板(右侧栏预览、自动切到该标签),
  // 既不会把主窗口导航走,也不用离开应用去看网页
  useEffect(
    () =>
      installExternalLinkHandler((url) => {
        const ui = useUIStore.getState();
        ui.setBrowserUrl(url);
        ui.setRightSidebarTab("browser");
        if (!ui.rightPanelOpen) ui.setRightPanelOpen(true);
      }),
    []
  );

  // 心跳:让 Rust 看门狗能感知渲染进程存活,崩溃时自动重载而非留下死屏
  useEffect(() => installHeartbeat(), []);

  // 抓 JS 侧未捕获异常并落盘——渲染进程崩溃前通常先有它们,
  // 这是目前唯一能拿到「崩溃前发生了什么」的证据来源
  useEffect(() => installCrashReporter(), []);

  return (
    <ErrorBoundary scope="App">
      <AppLayout />
      <InterruptedTasksBanner />
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
