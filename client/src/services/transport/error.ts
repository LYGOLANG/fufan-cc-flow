import type { TransportError } from "./types";

export function normalizeTransportError(
  error: unknown,
  fallbackCode: string
): TransportError {
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    if (typeof value.code === "string" && typeof value.message === "string") {
      return {
        code: value.code,
        message: value.message,
        ...(value.details === undefined ? {} : { details: value.details }),
      };
    }
  }

  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}
