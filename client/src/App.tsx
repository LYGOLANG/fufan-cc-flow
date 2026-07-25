import { useEffect } from "react";
import AppLayout from "./components/layout/AppLayout";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import InterruptedTasksBanner from "./components/shared/InterruptedTasksBanner";
import UpdatePrompt from "./components/shared/UpdatePrompt";
import { useWebSocket } from "./hooks/useWebSocket";
import { restoreOnBoot } from "./utils/openProject";
import { installExternalLinkHandler } from "./utils/openExternal";
import { installHeartbeat } from "./utils/heartbeat";

export default function App() {
  // Connect WebSocket (always, regardless of projectPath)
  useWebSocket();

  // 页面加载后:恢复当前项目会话视图 + 预热所有项目连接(认领寄存的后台任务)
  useEffect(() => {
    void restoreOnBoot();
  }, []);

  // 全局兜底:外链一律交给系统浏览器,避免 WebView 被导航走导致应用「回不来」
  useEffect(() => installExternalLinkHandler(), []);

  // 心跳:让 Rust 看门狗能感知渲染进程存活,崩溃时自动重载而非留下死屏
  useEffect(() => installHeartbeat(), []);

  return (
    <ErrorBoundary scope="App">
      <AppLayout />
      <InterruptedTasksBanner />
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
