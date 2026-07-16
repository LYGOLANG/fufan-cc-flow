export interface ClaudeStreamMessage {
  type: "system" | "assistant" | "result";
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: {
    id: string;
    role: string;
    content: ContentBlock[];
    usage?: RawTokenUsage;
  };
  result?: string;
  is_partial?: boolean;
  usage?: RawTokenUsage;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface RawTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeProcessOptions {
  prompt: string;
  projectPath: string;
  sessionId?: string;
  model?: string;
  effort?: EffortLevel;
  maxBudget?: number;
  allowedTools?: string[];
  apiKey?: string;
}

// ─── Client-specific types ───────────────────────────────────

// Model id is a free-form string: either a CLI alias ("opus"/"sonnet"/"haiku")
// or a full model id returned by /v1/models (e.g. "claude-opus-4-8-...").
export type ModelId = string;
// 与 Agent SDK 的 EffortLevel 严格对齐（low/medium/high/xhigh/max）。
// 具体生效档位由所选模型的 supportedEffortLevels 决定，CLI 会对不支持的档位静默降级。
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

// UI 层「推理力度」可选项，对齐 Claude Code CLI 的六档菜单：
// 前五档即 EffortLevel；第六档 "ultracode" 不是 API 的真实 effort 值，
// 而是 xhigh + 动态多智能体工作流编排（后端翻译为 effort:"xhigh" + settings.ultracode:true）。
export type EffortChoice = EffortLevel | "ultracode";

/** One selectable model in the dropdown. */
export interface ModelOption {
  id: string;
  label: string;
  /** 真实上下文窗口(来自 /v1/models 的 max_input_tokens);缺省时按目录推断 */
  contextWindow?: number;
}

/** Static labels for the CLI aliases, mirroring Claude Code CLI's /model list. */
export const MODEL_LABELS: Record<string, string> = {
  opus: "Claude Opus 4.8",
  sonnet: "Claude Sonnet 4.6",
  haiku: "Claude Haiku 4.5",
};

export interface ToolCall {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "pending" | "running" | "done" | "error" | "awaiting_permission";
  /** HIL permission request ID (present when status === "awaiting_permission") */
  permissionRequestId?: string;
}

/** Pending permission request from backend */
export interface PermissionRequest {
  requestId: string;
  /** Tool card ID; distinct from the control-channel request ID. */
  toolCallId?: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Human-readable reason why permission is needed */
  decisionReason?: string;
  /** File path that triggered the request */
  blockedPath?: string;
  /** Whether SDK provided "always allow" suggestions */
  hasSuggestions?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
  serverPath?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  thinking?: string;
  toolCalls?: ToolCall[];
  taskResult?: TaskResult;
  attachments?: Attachment[];
  /** Present only when role === "system" and this is a compact divider */
  compactData?: { tokensBefore: number; tokensAfter: number; summary?: string };
  /** True if this message was part of a rolled-back segment */
  rolledBack?: boolean;
  /** 产生这条 assistant 消息的供应商显示名(发送时盖章,切换供应商后历史署名不变) */
  senderName?: string;
}

export interface TaskResult {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

/** Token usage with camelCase keys (client-side) */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}
