import { create } from "zustand";
import type { Workflow } from "../types/workflow";
import { api } from "../services/api";

/** 单步在一次运行中的状态，与服务端 workflow/types.ts 保持一致 */
export interface WorkflowStepState {
  index: number;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "aborted";
  output?: string;
  error?: string;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

/** 一次运行的完整状态，由服务端经 workflow_state 事件推送 */
export interface WorkflowRunState {
  workflowId: string;
  workflowName: string;
  status: "running" | "awaiting" | "completed" | "aborted";
  currentStep: number;
  steps: WorkflowStepState[];
  variables: Record<string, string>;
  startedAt: number;
  finishedAt?: number;
  message?: string;
}

interface WorkflowState {
  workflows: Workflow[];
  loading: boolean;
  editing: Workflow | null;
  /**
   * 当前运行态。null 表示没有工作流在跑。
   *
   * 这份状态**完全由服务端推送**，前端不自行推进 —— 编排的真相在服务端，
   * 前端猜测下一步只会在断线重连后与实际状态打架。
   */
  run: WorkflowRunState | null;

  loadWorkflows: (project?: string) => Promise<void>;
  saveWorkflow: (workflow: Workflow, project?: string) => Promise<void>;
  deleteWorkflow: (id: string, project?: string) => Promise<void>;
  setEditing: (wf: Workflow | null) => void;
  createNew: () => void;
  setRun: (run: WorkflowRunState | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflows: [],
  loading: false,
  editing: null,
  run: null,

  loadWorkflows: async (project) => {
    set({ loading: true });
    try {
      const { workflows } = await api.getWorkflows(project);
      set({ workflows, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  saveWorkflow: async (workflow, project) => {
    await api.saveWorkflow(workflow, project);
    const { workflows } = await api.getWorkflows(project);
    set({ workflows, editing: null });
  },

  deleteWorkflow: async (id, project) => {
    await api.deleteWorkflow(id, project);
    const { workflows } = await api.getWorkflows(project);
    set({ workflows });
  },

  setEditing: (wf) => set({ editing: wf }),

  setRun: (run) => set({ run }),

  createNew: () =>
    set({
      editing: {
        id: "",
        name: "",
        steps: [{ agent: null, prompt: "" }],
        variables: [],
      },
    }),
}));
