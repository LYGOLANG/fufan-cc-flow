import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelId, EffortChoice } from "../types/claude";

/** 当前对话引擎:Claude Code 或 OpenAI Codex。 */
export type Engine = "claude" | "codex";
/** Codex 推理强度(low/medium/high/xhigh),UI 上做成点击切换。 */
export type CodexEffort = "low" | "medium" | "high" | "xhigh";
/** Codex 模型 id。历史上是固定档位联合类型,现在模型列表来自供应商配置,放宽为 string。 */
export type CodexModel = string;

interface ConfigState {
  model: ModelId;
  effort: EffortChoice;
  thinking: boolean;
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

  setModel: (m: ModelId) => void;
  setEffort: (e: EffortChoice) => void;
  setThinking: (t: boolean) => void;
  setAutoCompactThreshold: (v: number) => void;
  setApiKey: (k: string) => void;
  setEngine: (e: Engine) => void;
  setCodexModel: (m: CodexModel) => void;
  setCodexEffort: (e: CodexEffort) => void;
  /** 切换供应商:恢复该供应商上次的模型(否则用 defaultModel),并同步 engine 供旧逻辑使用 */
  setProvider: (providerId: string, opts?: { kind?: string; defaultModel?: string; models?: string[] }) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      model: "opus",
      effort: "high",
      thinking: true,
      autoCompactThreshold: 95,
      apiKey: "",
      engine: "claude",
      codexModel: "gpt-5.5",
      codexEffort: "high",
      providerId: "anthropic",
      providerModels: {},

      setModel: (model) =>
        set((s) => ({
          model,
          providerModels: { ...s.providerModels, [s.providerId]: model },
        })),
      setEffort: (effort) => set({ effort }),
      setThinking: (thinking) => set({ thinking }),
      setAutoCompactThreshold: (autoCompactThreshold) =>
        set({ autoCompactThreshold }),
      setApiKey: (apiKey) => set({ apiKey }),
      setEngine: (engine) => set({ engine }),
      setCodexModel: (codexModel) => set({ codexModel }),
      setCodexEffort: (codexEffort) => set({ codexEffort }),
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
        autoCompactThreshold: s.autoCompactThreshold,
        engine: s.engine,
        codexModel: s.codexModel,
        codexEffort: s.codexEffort,
        providerId: s.providerId,
        providerModels: s.providerModels,
      }),
    }
  )
);
