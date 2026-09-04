import { lazy, Suspense, useEffect } from "react";
import Sidebar from "./Sidebar";
import RightPanel from "./RightPanel";
import ProjectTabs from "./ProjectTabs";
import ChatPanel from "../chat/ChatPanel";
import { useSystemStore } from "../../stores/systemStore";
import { useProviderStore } from "../../stores/providerStore";
import { useUIStore } from "../../stores/uiStore";
import { useDoubleEsc } from "../../hooks/useDoubleEsc";

// ── 弹窗懒加载 ──
// 这五个弹窗约 1900 行,原先被静态 import 且无条件渲染(各自在组件内部
// `if (!xxxOpen) return null`)。那种写法下 lazy 是白做的:组件一挂载就会
// 触发 chunk 下载。所以开关条件必须上提到这里,让它们在真正被打开前
// 完全不参与渲染。各弹窗内部的 gate 保留不动,作为双保险。
const HistoryModal = lazy(() => import("../modals/HistoryModal"));
const FileViewModal = lazy(() => import("../modals/FileViewModal"));
const FolderBrowserModal = lazy(() => import("../modals/FolderBrowserModal"));
const SkillBrowserModal = lazy(() => import("../modals/SkillBrowserModal"));
const CreateSkillModal = lazy(() => import("../modals/CreateSkillModal"));

export default function AppLayout() {
  const {
    loadClaudeInfo,
    loadAuthStatus,
    loadClaudeSettings,
    loadCodexInfo,
    loadCodexAuthStatus,
  } = useSystemStore();
  const loadProviders = useProviderStore((s) => s.loadProviders);
  // 逐个订阅开关(而不是整体解构),避免无关的 UI 状态变化触发本组件重渲染
  const historyModalOpen = useUIStore((s) => s.historyModalOpen);
  const fileViewModalOpen = useUIStore((s) => s.fileViewModalOpen);
  const folderBrowserOpen = useUIStore((s) => s.folderBrowserOpen);
  const skillBrowserOpen = useUIStore((s) => s.skillBrowserOpen);
  const createSkillModalOpen = useUIStore((s) => s.createSkillModalOpen);

  useEffect(() => {
    loadClaudeInfo();
    loadAuthStatus();
    loadClaudeSettings();
    loadCodexInfo();
    loadCodexAuthStatus();
    loadProviders();
  }, [loadClaudeInfo, loadAuthStatus, loadClaudeSettings, loadCodexInfo, loadCodexAuthStatus, loadProviders]);

  useDoubleEsc();

  return (
    <div className="h-screen flex overflow-hidden bg-obsidian-900">

      {/* ── 左侧栏：纯暗色，无光晕穿透 ── */}
      <Sidebar />

      {/* ── 中+右区域：光晕仅在这里（与参考样式保持一致）── */}
      {/* min-h-0 不能省，即使已有 overflow-hidden。
          规范上 overflow≠visible 会让 flex 子项的 min-height:auto 解析为 0，
          Chromium 严格照做（所以 Windows 上一直没事），WebKit 在嵌套 flex 里
          处理有出入 —— 高度被撑成内容全高，消息列表那层就**根本不滚动**：
          新消息堆在看不见的底部、scrollTo 对不滚动的容器无效（自动跟随失效）、
          只有滚外层才看得到内容。Mac 上报的三个滚动症状都源于此。
          显式写死，不赌浏览器的宽容度。 */}
      <div className="relative flex-1 flex overflow-hidden min-w-0 min-h-0">
        {/* Ambient glow — solid color + blur，参考 bg-secondary-900/20 + bg-primary-900/10 */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
          <div
            className="absolute rounded-full blur-[120px]"
            style={{
              top: "-10%", left: "-10%", width: "50%", height: "50%",
              background: "rgba(76, 29, 149, 0.20)",
            }}
          />
          <div
            className="absolute rounded-full blur-[100px]"
            style={{
              bottom: "-10%", right: "-10%", width: "40%", height: "40%",
              background: "rgba(112, 49, 35, 0.10)",
            }}
          />
        </div>

        {/* 内容列（z-10 覆盖在光晕之上）*/}
        <div className="relative z-10 flex flex-1 overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <ProjectTabs />
            <ChatPanel />
          </div>
          <RightPanel />
        </div>
      </div>

      {/* Global modals —— 打开时才加载对应 chunk;fallback 为空:弹窗本就是
          覆盖层,加载的一瞬间显示占位反而比什么都不显示更突兀 */}
      <Suspense fallback={null}>
        {historyModalOpen && <HistoryModal />}
        {fileViewModalOpen && <FileViewModal />}
        {folderBrowserOpen && <FolderBrowserModal />}
        {skillBrowserOpen && <SkillBrowserModal />}
        {createSkillModalOpen && <CreateSkillModal />}
      </Suspense>
    </div>
  );
}
