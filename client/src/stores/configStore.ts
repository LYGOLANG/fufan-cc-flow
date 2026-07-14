import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelId, EffortChoice } from "../types/claude";

/** 当前对话引擎:Claude Code 或 OpenAI Codex。 */
export type Engine = "claude" | "codex";
/** Codex 推理强度,与 Codex CLI 的 model_reasoning_effort 五档对齐。 */
export type CodexEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
/** Codex 模型 id。历史上是固定档位联合类型,现在模型列表来自供应商配置,放宽为 string。 */
export type CodexModel = string;

/** 一个项目的模型选择档案:供应商 + 模型 + 力度 + 引擎(选择器两级联动,必须整组保存)。 */
export interface ProjectSelection {
  providerId: string;
  model: ModelId;
  effort: EffortChoice;
  engine: Engine;
  codexModel: CodexModel;
  codexEffort: CodexEffort;
}

interface ConfigState {
  model: ModelId;
  effort: EffortChoice;
  thinking: boolean;
  /** 扩展思考预算(tokens)。0 = 自适应(SDK adaptive);>0 经 thinking.budgetTokens 注入 */
  thinkingBudget: number;
  autoCompactThreshold: number;
  // API Key — 仅存内存，不持久化，不写日志（持久化由 ~/.claude/settings.json 负责）
  apiKey: string;

  // 引擎选择 + Codex 模型/推理强度(持久化)
  engine: Engine;
  codexModel: CodexModel;
  codexEffort: CodexEffort;

  // 模型供应商(OpenCode 式两级切换:供应商 → 模型)
  providerId: string;
  /** 每个供应商上次选过的模型,切回时恢复 */
  providerModels: Record<string, string>;

  /**
   * 每个项目独立的模型选择档案(供应商/模型/力度/引擎一整组)。
   * 切项目时由 openProject 保存/恢复,使「在项目 A 换模型」不影响其它项目。
   */
  projectSelections: Record<string, ProjectSelection>;

  setModel: (m: ModelId) => void;
  setEffort: (e: EffortChoice) => void;
  setThinking: (t: boolean) => void;
  setThinkingBudget: (n: number) => void;
  setAutoCompactThreshold: (v: number) => void;
  setApiKey: (k: string) => void;
  setEngine: (e: Engine) => void;
  setCodexModel: (m: CodexModel) => void;
  setCodexEffort: (e: CodexEffort) => void;
  /** 切换供应商:恢复该供应商上次的模型(否则用 defaultModel),并同步 engine 供旧逻辑使用 */
  setProvider: (providerId: string, opts?: { kind?: string; defaultModel?: string; models?: string[] }) => void;
  /** 把当前模型选择整组存为某项目的档案(切走项目时调用) */
  saveProjectSelection: (projectPath: string) => void;
  /** 恢复某项目的模型选择档案;首次打开的项目以当前选择为初始档案并登记 */
  restoreProjectSelection: (projectPath: string) => void;
}

/** 从完整状态中取出"整组选择"字段。 */
function pickSelection(s: ConfigState): ProjectSelection {
  return {
    providerId: s.providerId,
    model: s.model,
    effort: s.effort,
    engine: s.engine,
    codexModel: s.codexModel,
    codexEffort: s.codexEffort,
  };
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      model: "opus",
      effort: "high",
      thinking: true,
      thinkingBudget: 0,
      autoCompactThreshold: 95,
      apiKey: "",
      engine: "claude",
      codexModel: "gpt-5.6-terra",
      codexEffort: "high",
      providerId: "anthropic",
      providerModels: {},
      projectSelections: {},

      setModel: (model) =>
        set((s) => ({
          model,
          providerModels: { ...s.providerModels, [s.providerId]: model },
        })),
      setEffort: (effort) => set({ effort }),
      setThinking: (thinking) => set({ thinking }),
      setThinkingBudget: (thinkingBudget) => set({ thinkingBudget }),
      setAutoCompactThreshold: (autoCompactThreshold) =>
        set({ autoCompactThreshold }),
      setApiKey: (apiKey) => set({ apiKey }),
      setEngine: (engine) => set({ engine }),
      setCodexModel: (codexModel) => set({ codexModel }),
      setCodexEffort: (codexEffort) => set({ codexEffort }),
      saveProjectSelection: (projectPath) =>
        set((s) => ({
          projectSelections: { ...s.projectSelections, [projectPath]: pickSelection(s) },
        })),

      restoreProjectSelection: (projectPath) =>
        set((s) => {
          const sel = s.projectSelections[projectPath];
          // 首次打开的项目:继承当前选择作为初始档案并立即登记,
          // 此后它就独立了——在别的项目换模型不会再影响它
          if (!sel) {
            return {
              projectSelections: { ...s.projectSelections, [projectPath]: pickSelection(s) },
            };
          }
          return { ...sel };
        }),

      setProvider: (providerId, opts) =>
        set((s) => {
          // 记住的模型必须仍在供应商的合法列表里(预置列表修订后旧 id 可能失效)
          let remembered: string | undefined = s.providerModels[providerId];
          if (remembered && opts?.models?.length && !opts.models.includes(remembered)) {
            remembered = undefined;
          }
          const model = remembered || opts?.defaultModel || s.model;
          return {
            providerId,
            model,
            // 同步旧的 engine 字段,让 Codex 相关旧逻辑(状态徽标等)继续工作
            engine: opts?.kind === "codex" ? ("codex" as Engine) : ("claude" as Engine),
          };
        }),
    }),
    {
      name: "fufan-cc-config",
      // Persist user preferences but NEVER the API key (lives in settings.json).
      partialize: (s) => ({
        model: s.model,
        effort: s.effort,
        thinking: s.thinking,
        thinkingBudget: s.thinkingBudget,
        autoCompactThreshold: s.autoCompactThreshold,
        engine: s.engine,
        codexModel: s.codexModel,
        codexEffort: s.codexEffort,
        providerId: s.providerId,
        providerModels: s.providerModels,
        projectSelections: s.projectSelections,
      }),
    }
  )
);
