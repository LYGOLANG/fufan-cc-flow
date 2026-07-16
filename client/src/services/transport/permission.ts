export function permissionEventIds(payload: Record<string, unknown>) {
  const requestId = payload.requestId as string;
  return {
    requestId,
    toolCallId: (payload.toolCallId as string) || requestId,
  };
}
