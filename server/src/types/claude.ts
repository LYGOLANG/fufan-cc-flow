export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
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
  content: string | unknown[];  // MCP 工具可能返回内容块数组（含 image 等）
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/* ── Agent SDK Options ── */

// 与 Agent SDK 的 EffortLevel 严格对齐（low/medium/high/xhigh/max）。
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentServiceOptions {
  prompt: string;
  projectPath: string;
  sessionId?: string;         // resume 已有 session
  forkSession?: boolean;      // fork 而非 resume
  /**
   * 客户端发送时正处于流式中(有一轮在跑)= 这条消息是对当前活跃会话的续发。
   * 用于修复:新会话首条消息还在流式、session_init 尚未回传时,客户端拿不到 sessionId,
   * 追发的第二条会因 sessionId 为空而误走 endLive 把正在跑的任务杀掉。带此标记时
   * 即便 sessionId 为空也复用常驻进程排队,而不是另起炉灶。
   */
  continueActive?: boolean;
  model?: string;
  effort?: EffortLevel;
  // ultracode（CLI effort 菜单第六档）= xhigh + 动态多智能体工作流编排。
  // 为 true 时 effort 取 "xhigh"，并向 SDK 传 settings.ultracode=true。
  ultracode?: boolean;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  maxBudget?: number;
  /** 主模型失败(过载/限流)时自动降级的备用模型;仅官方端点注入 */
  fallbackModel?: string;
  /** 扩展思考预算(tokens)。未设 = SDK 默认 adaptive;设置后经 thinking.budgetTokens 注入 */
  thinkingBudget?: number;
  /** MCP 配置版本号:MCP 面板每次改动自增,纳入进程指纹使改动下一轮生效 */
  mcpVersion?: number;
  allowedTools?: string[];
  apiKey?: string;
  /** Anthropic 兼容第三方端点(DeepSeek/MiniMax/Kimi/GLM/自定义)。设置后注入 ANTHROPIC_BASE_URL */
  baseUrl?: string;
  /** 兼容端点的 API Key(注入 ANTHROPIC_AUTH_TOKEN) */
  authToken?: string;
  httpProxy?: string;
  httpsProxy?: string;
  socksProxy?: string;
}
