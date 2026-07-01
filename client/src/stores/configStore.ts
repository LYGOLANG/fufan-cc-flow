import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelId, EffortChoice } from "../types/claude";

/** 当前对话引擎:Claude Code 或 OpenAI Codex。 */
export type Engine = "claude" | "codex";
/** Codex 推理强度(low/medium/high/xhigh),UI 上做成点击切换。 */
export type CodexEffort = "low" | "medium" | "high" | "xhigh";
/** Codex 模型档位 —— 不同档位本身就代表了速度/能力的取舍(旗舰/均衡/轻量/超快)。 */
export type CodexModel = "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.3-codex-spark";

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

  setModel: (m: ModelId) => void;
  setEffort: (e: EffortChoice) => void;
  setThinking: (t: boolean) => void;
  setAutoCompactThreshold: (v: number) => void;
  setApiKey: (k: string) => void;
  setEngine: (e: Engine) => void;
  setCodexModel: (m: CodexModel) => void;
  setCodexEffort: (e: CodexEffort) => void;
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

      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      setThinking: (thinking) => set({ thinking }),
      setAutoCompactThreshold: (autoCompactThreshold) =>
        set({ autoCompactThreshold }),
      setApiKey: (apiKey) => set({ apiKey }),
      setEngine: (engine) => set({ engine }),
      setCodexModel: (codexModel) => set({ codexModel }),
      setCodexEffort: (codexEffort) => set({ codexEffort }),
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
      }),
    }
  )
);
