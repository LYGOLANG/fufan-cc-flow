export type ChatTransportKind = "http" | "tauri";

export function selectChatTransport(
  tauriRuntime: boolean,
  rustChatEnabled: boolean
): ChatTransportKind {
  return tauriRuntime && rustChatEnabled ? "tauri" : "http";
}

export function shouldUseRustChat(payload: Record<string, unknown>): boolean {
  const engine = typeof payload.engine === "string" ? payload.engine : "claude";
  const providerId =
    typeof payload.providerId === "string" ? payload.providerId : "anthropic";
  const attachments = Array.isArray(payload.attachmentPaths)
    ? payload.attachmentPaths
    : [];
  const thinkingBudget =
    typeof payload.thinkingBudget === "number" ? payload.thinkingBudget : 0;

  return (
    engine === "claude" &&
    providerId === "anthropic" &&
    attachments.length === 0 &&
    thinkingBudget === 0 &&
    !payload.apiKey &&
    payload.effort !== "ultracode"
  );
}
