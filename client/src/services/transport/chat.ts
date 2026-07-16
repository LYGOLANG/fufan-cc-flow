import { isTauriRuntime } from "../../utils/tauri";
import { HttpChatConnection } from "./http-chat";
import { selectChatTransport } from "./routing";
import { TauriChatConnection } from "./tauri-chat";
import type { ChatConnection } from "./types";

export function createChatConnection(projectPath: string): ChatConnection {
  const rustChatEnabled = import.meta.env.VITE_RUST_CHAT === "1";
  return selectChatTransport(isTauriRuntime(), rustChatEnabled) === "tauri"
    ? new TauriChatConnection(projectPath)
    : new HttpChatConnection(projectPath);
}
