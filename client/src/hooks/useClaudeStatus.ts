import { useSystemStore } from "../stores/systemStore";

export type ClaudeStatus = "not-installed" | "unauthorized" | "ready";

/**
 * Derive 3-state Claude Code status from the CLI-backed auth probe.
 *
 * 🔴 not-installed  — claude CLI not found
 * 🟡 unauthorized   — installed but no OAuth / API key
 * 🟢 ready          — installed + CLI explicitly reports authenticated
 */
export function useClaudeStatus(): ClaudeStatus {
  const { claudeInfo, authStatus } = useSystemStore();

  // Prefer authStatus (more accurate); fall back to claudeInfo.installed
  const installed = authStatus?.installed ?? claudeInfo?.installed ?? true;

  if (!installed) return "not-installed";

  if (authStatus?.authenticated) return "ready";
  return "unauthorized";
}
