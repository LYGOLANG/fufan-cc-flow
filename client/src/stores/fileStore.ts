import { create } from "zustand";
import type { FileNode, FileContent } from "../types/file";
import { api } from "../services/api";
import { useUIStore } from "./uiStore";

interface FileState {
  tree: FileNode | null;
  treeLoading: boolean;
  openFilePath: string | null;
  openFileContent: FileContent | null;
  fileLoading: boolean;
  modifiedFiles: Set<string>;
  searchQuery: string;
  searchResults: { path: string; type: string }[];

  /**
   * 编辑态。原先文件打开了只能看、不能改,这里加的是最小够用的实现:
   * isEditing 时渲染一个朴素文本框而不是语法高亮预览,不引入专业编辑器库。
   * editingContent 是独立于 openFileContent.content 的实时缓冲区——后者是
   * "磁盘上最后已知的内容"(打开时读到的、或保存成功后更新的),用它俩的
   * 差值判定有没有未保存的改动,不额外维护一个 dirty 布尔值防止两边漂移。
   */
  isEditing: boolean;
  editingContent: string | null;
  fileSaving: boolean;
  saveError: string | null;

  loadTree: (projectPath: string) => Promise<void>;
  loadSubtree: (dirPath: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  closeFile: () => void;
  markFileModified: (filePath: string) => void;
  searchFiles: (projectPath: string, query: string) => Promise<void>;
  setSearchQuery: (q: string) => void;

  startEditing: () => void;
  updateEditingContent: (value: string) => void;
  cancelEditing: () => void;
  saveFile: (projectRoot: string) => Promise<boolean>;
}

export const useFileStore = create<FileState>((set, get) => ({
  tree: null,
  treeLoading: false,
  openFilePath: null,
  openFileContent: null,
  fileLoading: false,
  modifiedFiles: new Set(),
  searchQuery: "",
  searchResults: [],
  isEditing: false,
  editingContent: null,
  fileSaving: false,
  saveError: null,

  loadTree: async (projectPath) => {
    set({ treeLoading: true, tree: null });
    try {
      const tree = await api.getFileTree(projectPath);
      set({ tree, treeLoading: false });
    } catch {
      set({ treeLoading: false });
    }
  },

  loadSubtree: async (dirPath) => {
    try {
      const subtree = await api.getFileTree(dirPath);
      const graft = (node: FileNode): FileNode => {
        if (node.path === dirPath) {
          return { ...node, children: subtree.children ?? [] };
        }
        if (!node.children) return node;
        return { ...node, children: node.children.map(graft) };
      };
      const tree = get().tree;
      if (tree) set({ tree: graft(tree) });
    } catch {
      // 加载失败保持原状，用户可重新展开重试
    }
  },

  openFile: async (filePath) => {
    // 切换文件时退出编辑态:editingContent 是上一个文件的缓冲区,留着会在
    // 新文件上显示旧内容(或者更糟——保存时把旧内容写进新文件)。
    set({ fileLoading: true, openFilePath: filePath, isEditing: false, editingContent: null, saveError: null });
    try {
      // 带上当前项目根:后端据此限定可读范围(项目内 + Claude/Codex 配置目录)
      const content = await api.getFileContent(
        filePath,
        useUIStore.getState().projectPath || undefined
      );
      set({ openFileContent: content, fileLoading: false });
    } catch {
      set({ fileLoading: false, openFileContent: null });
    }
  },

  closeFile: () => {
    set({ openFilePath: null, openFileContent: null, isEditing: false, editingContent: null, saveError: null });
  },

  markFileModified: (filePath) => {
    const modified = new Set(get().modifiedFiles);
    modified.add(filePath);
    set({ modifiedFiles: modified });
  },

  searchFiles: async (projectPath, query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    try {
      const { results } = await api.searchFiles(projectPath, query);
      set({ searchResults: results });
    } catch {
      set({ searchResults: [] });
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  startEditing: () => {
    const { openFileContent } = get();
    if (!openFileContent || openFileContent.language === "image") return;
    set({ isEditing: true, editingContent: openFileContent.content, saveError: null });
  },

  updateEditingContent: (value) => set({ editingContent: value }),

  cancelEditing: () => set({ isEditing: false, editingContent: null, saveError: null }),

  saveFile: async (projectRoot) => {
    const { openFilePath, editingContent, openFileContent } = get();
    if (!openFilePath || editingContent === null) return false;
    set({ fileSaving: true, saveError: null });
    try {
      const result = await api.saveFileContent(openFilePath, editingContent, projectRoot);
      // 保存成功后把"磁盘上最后已知内容"推进到刚写入的值,dirty 判定(两者
      // 比较)立刻归零;继续停在编辑态,不强制切回只读预览——保存是为了不
      // 丢改动,不是为了结束编辑。
      set({
        openFileContent: openFileContent
          ? {
              ...openFileContent,
              content: editingContent,
              lines: editingContent.split("\n").length,
              size: result.size,
            }
          : openFileContent,
        fileSaving: false,
      });
      return true;
    } catch (err) {
      set({ fileSaving: false, saveError: err instanceof Error ? err.message : "保存失败" });
      return false;
    }
  },
}));
