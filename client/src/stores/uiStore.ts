import { create } from "zustand";

/** Default project when nothing real has been selected (forward slashes work on the file API). */
const DEFAULT_PROJECT_PATH = "C:/Users/Administrator/Desktop/fufan-cc-flow";
/** Paths treated as "not a real project" — force the default instead (e.g. the empty cc-tool dir). */
const IGNORED_PROJECT_PATHS = ["C:/Users/Administrator/Desktop/cc-tool"];
const normPath = (p: string) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const isIgnoredProject = (p: string) =>
  !p || IGNORED_PROJECT_PATHS.some((ig) => normPath(ig) === normPath(p));

/** Resolve the initial project: force the default if stored value is empty/ignored. */
const RESOLVED_PROJECT_PATH = (() => {
  const stored = localStorage.getItem("fufan_projectPath") || "";
  const resolved = isIgnoredProject(stored) ? DEFAULT_PROJECT_PATH : stored;
  if (resolved !== stored) localStorage.setItem("fufan_projectPath", resolved);
  return resolved;
})();

type SidebarTab = "sessions" | "files" | "agents" | "extensions" | "settings";
export type LeftNavPanel = "files" | "search" | "checkpoints";
export type RightSidebarTab = "monitor" | "extensions" | "agent";
export type RunMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

interface UIState {
  // Left sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarTab: SidebarTab;
  leftNavPanel: LeftNavPanel;

  // Right panel
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightSidebarTab: RightSidebarTab;

  // Right-panel terminal (collapsed by default)
  terminalOpen: boolean;
  terminalHeight: number;

  // Connection + project
  wsConnected: boolean;
  projectPath: string;
  /** Recently opened project folders (most recent first). */
  recentProjects: string[];
  /** Open project tabs (multi-project workspace). */
  openProjects: string[];
  /** Each project's last active session id, so switching tabs resumes it. */
  projectSessions: Record<string, string>;
  /** Projects with a task currently running server-side (incl. backgrounded tabs). */
  busyProjects: string[];

  // Input run mode
  runMode: RunMode;

  // Modal visibility
  historyModalOpen: boolean;
  fileViewModalOpen: boolean;
  settingsModalOpen: boolean;
  settingsActiveTab: "model" | "environment";
  folderBrowserOpen: boolean;
  skillBrowserOpen: boolean;
  skillBrowserInitialSelection: { tab: "project" | "user" | "plugin"; name: string } | null;
  createSkillModalOpen: boolean;

  // Settings full page
  settingsPageOpen: boolean;

  // Extensions sub-tab (driven externally by slash commands)
  extensionsSubTab: "mcp" | "skills" | "plugins" | "memory" | "hooks";

  // Agent prefill (set by AgentManager "launch" button, consumed by InputBar)
  prefillInput: string;

  // Actions
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setLeftNavPanel: (panel: LeftNavPanel) => void;

  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (w: number) => void;
  setRightSidebarTab: (tab: RightSidebarTab) => void;

  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalHeight: (h: number) => void;

  setWsConnected: (c: boolean) => void;
  setProjectPath: (p: string) => void;
  removeRecentProject: (p: string) => void;
  closeOpenProject: (p: string) => void;
  setProjectSession: (projectPath: string, sessionId: string) => void;
  /** Mark a project's task as running/idle (drives the tab "running" indicator). */
  setProjectBusy: (projectPath: string, busy: boolean) => void;

  setRunMode: (mode: RunMode) => void;

  setHistoryModalOpen: (open: boolean) => void;
  setFileViewModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setSettingsActiveTab: (tab: "model" | "environment") => void;
  setFolderBrowserOpen: (open: boolean) => void;
  setSkillBrowserOpen: (open: boolean) => void;
  setSkillBrowserInitialSelection: (sel: { tab: "project" | "user" | "plugin"; name: string } | null) => void;
  setCreateSkillModalOpen: (open: boolean) => void;

  setSettingsPageOpen: (open: boolean) => void;

  setExtensionsSubTab: (tab: "mcp" | "skills" | "plugins" | "memory" | "hooks") => void;

  setPrefillInput: (text: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: 240,
  sidebarTab: "sessions",
  leftNavPanel: "files",

  rightPanelOpen: true,
  rightPanelWidth: 380,
  rightSidebarTab: "monitor",

  terminalOpen: false,
  terminalHeight: 260,

  wsConnected: false,
  projectPath: RESOLVED_PROJECT_PATH,
  recentProjects: (JSON.parse(localStorage.getItem("fufan_recentProjects") || "[]") as string[])
    .filter((p) => !isIgnoredProject(p)),
  openProjects: (() => {
    const saved = (JSON.parse(localStorage.getItem("fufan_openProjects") || "[]") as string[])
      .filter((p) => !isIgnoredProject(p));
    if (!saved.includes(RESOLVED_PROJECT_PATH)) saved.unshift(RESOLVED_PROJECT_PATH);
    localStorage.setItem("fufan_openProjects", JSON.stringify(saved));
    return saved;
  })(),
  projectSessions: JSON.parse(localStorage.getItem("fufan_projectSessions") || "{}"),
  busyProjects: [],

  runMode: "bypassPermissions",

  historyModalOpen: false,
  fileViewModalOpen: false,
  settingsModalOpen: false,
  settingsActiveTab: "model",
  settingsPageOpen: false,
  folderBrowserOpen: false,
  skillBrowserOpen: false,
  skillBrowserInitialSelection: null,
  createSkillModalOpen: false,
  extensionsSubTab: "mcp",
  prefillInput: "",

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setLeftNavPanel: (panel) => set({ leftNavPanel: panel }),

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),

  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setTerminalHeight: (h) => set({ terminalHeight: h }),

  setWsConnected: (c) => set({ wsConnected: c }),
  setProjectPath: (p) => {
    localStorage.setItem("fufan_projectPath", p);
    set((s) => {
      let recent = s.recentProjects;
      let open = s.openProjects;
      if (p) {
        recent = [p, ...s.recentProjects.filter((x) => x !== p)].slice(0, 8);
        localStorage.setItem("fufan_recentProjects", JSON.stringify(recent));
        if (!s.openProjects.includes(p)) {
          open = [...s.openProjects, p];
          localStorage.setItem("fufan_openProjects", JSON.stringify(open));
        }
      }
      return { projectPath: p, recentProjects: recent, openProjects: open };
    });
  },
  removeRecentProject: (p) =>
    set((s) => {
      const recent = s.recentProjects.filter((x) => x !== p);
      localStorage.setItem("fufan_recentProjects", JSON.stringify(recent));
      return { recentProjects: recent };
    }),
  closeOpenProject: (p) =>
    set((s) => {
      const open = s.openProjects.filter((x) => x !== p);
      localStorage.setItem("fufan_openProjects", JSON.stringify(open));
      return { openProjects: open };
    }),
  setProjectSession: (projectPath, sessionId) =>
    set((s) => {
      const map = { ...s.projectSessions };
      if (sessionId) map[projectPath] = sessionId;
      else delete map[projectPath];
      localStorage.setItem("fufan_projectSessions", JSON.stringify(map));
      return { projectSessions: map };
    }),
  setProjectBusy: (projectPath, busy) =>
    set((s) => {
      const has = s.busyProjects.includes(projectPath);
      if (busy === has) return s;
      return {
        busyProjects: busy
          ? [...s.busyProjects, projectPath]
          : s.busyProjects.filter((x) => x !== projectPath),
      };
    }),

  setRunMode: (mode) => set({ runMode: mode }),

  setHistoryModalOpen: (open) => set({ historyModalOpen: open }),
  setFileViewModalOpen: (open) => set({ fileViewModalOpen: open }),
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
  setSettingsPageOpen: (open) => set({ settingsPageOpen: open }),
  setFolderBrowserOpen: (open) => set({ folderBrowserOpen: open }),
  setSkillBrowserOpen: (open) => set({ skillBrowserOpen: open }),
  setSkillBrowserInitialSelection: (sel) => set({ skillBrowserInitialSelection: sel }),
  setCreateSkillModalOpen: (open) => set({ createSkillModalOpen: open }),
  setExtensionsSubTab: (tab) => set({ extensionsSubTab: tab }),

  setPrefillInput: (text) => set({ prefillInput: text }),
}));
