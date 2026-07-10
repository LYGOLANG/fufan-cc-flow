import { useEffect } from "react";
import AppLayout from "./components/layout/AppLayout";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import InterruptedTasksBanner from "./components/shared/InterruptedTasksBanner";
import { useWebSocket } from "./hooks/useWebSocket";
import { restoreOnBoot } from "./utils/openProject";

export default function App() {
  // Connect WebSocket (always, regardless of projectPath)
  useWebSocket();

  // 页面加载后:恢复当前项目会话视图 + 预热所有项目连接(认领寄存的后台任务)
  useEffect(() => {
    void restoreOnBoot();
  }, []);

  return (
    <ErrorBoundary scope="App">
      <AppLayout />
      <InterruptedTasksBanner />
    </ErrorBoundary>
  );
}
