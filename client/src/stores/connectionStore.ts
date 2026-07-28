import { create } from "zustand";
import { isTauriRuntime } from "../utils/tauri";
import { httpBase, authHeaders } from "../services/endpoint";

/**
 * 「当前连的是哪台后端」的单一事实源。
 *
 * 存在的理由:远程连接时前端跑在本机、后端可能在另一台机器上,而前端有大量
 * 地方在**猜**对端的路径语义 —— 靠"路径里有没有反斜杠"判断分隔符、用
 * toLowerCase() 归一化路径再比较。本机形态下这些猜测碰巧总是对的,所以问题
 * 一直没暴露;后端一搬到 Linux,/Src 和 /src 就会被判成同一个目录。
 *
 * 纪律(Product-Spec 第 71 行):业务组件不要自己判断「本机还是远程」,
 * 一律从这里读。否则这类分支会散落到几十个组件里,将来迁移 Rust 后端时
 * 变成翻译不动、只能重写的死账。
 */

export interface HostInfo {
  /** 后端所在机器的平台 */
  platform: string;
  /** 该平台的路径分隔符 */
  pathSep: "\\" | "/";
  /** 该平台文件系统是否区分大小写 */
  caseSensitive: boolean;
  /** 后端机器上的用户主目录 */
  homedir: string;
}

export type ConnectionKind = "local" | "remote";

interface ConnectionState {
  kind: ConnectionKind;
  /** 远程时的显示名,如 dev@192.168.1.10 */
  label: string | null;
  host: HostInfo | null;
  loaded: boolean;
  load: () => Promise<void>;
}

/**
 * 后端不可达时的兜底:按前端自己所在的平台推断。
 *
 * 这个兜底只在本机形态下是对的,但那恰好也是唯一会用到它的场景 ——
 * 远程连接必须先拿到 host-info 才能建立,拿不到就根本连不上。
 */
function fallbackHostInfo(): HostInfo {
  const win = typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");
  return {
    platform: win ? "win32" : "linux",
    pathSep: win ? "\\" : "/",
    caseSensitive: !win,
    homedir: "",
  };
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  kind: "local",
  label: null,
  host: null,
  loaded: false,

  load: async () => {
    // 连接种类只有桌面壳知道(它才是发起 SSH 的那一方)
    let kind: ConnectionKind = "local";
    let label: string | null = null;
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cfg = await invoke<{
          mode?: ConnectionKind;
          remote?: { user?: string; host?: string; sshPort?: number } | null;
        }>("get_connection_config");
        kind = cfg?.mode === "remote" ? "remote" : "local";
        if (kind === "remote" && cfg?.remote) {
          const { user, host, sshPort } = cfg.remote;
          label = `${user}@${host}${sshPort && sshPort !== 22 ? `:${sshPort}` : ""}`;
        }
      } catch {
        // 旧版桌面壳没有这个 command。当作本机处理 —— 那也确实是它唯一支持的形态。
        kind = "local";
      }
    }

    // 路径语义只有后端知道(它跑在目标机器上)
    let host: HostInfo | null = null;
    try {
      const res = await fetch(`${httpBase()}/system/host-info`, { headers: authHeaders() });
      if (res.ok) host = (await res.json()) as HostInfo;
    } catch {
      /* 落到兜底 */
    }

    set({ kind, label, host: host ?? fallbackHostInfo(), loaded: true });
  },
}));

/** 供非 React 代码(工具函数)读取,避免到处 useStore */
export function currentHost(): HostInfo {
  return useConnectionStore.getState().host ?? fallbackHostInfo();
}

export function isRemote(): boolean {
  return useConnectionStore.getState().kind === "remote";
}
