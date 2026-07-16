export type ChatHandler = (
  event: string,
  payload: Record<string, unknown>
) => void;

export interface ChatConnection {
  connect(): void;
  send(action: string, payload?: Record<string, unknown>): boolean;
  subscribe(handler: ChatHandler): () => void;
  readonly connected: boolean;
  close(): void;
}

export interface ChatEventEnvelope {
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface TransportError {
  code: string;
  message: string;
  details?: unknown;
}
