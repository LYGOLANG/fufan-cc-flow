import { isTauriRuntime } from "./tauri";

export interface CrashRecoveryState {
  consecutiveFailures: number;
  safeMode: boolean;
}

const NORMAL: CrashRecoveryState = { consecutiveFailures: 0, safeMode: false };

/**
 * 启动时向 Rust 看门狗查询:上一阵是否连续崩溃、本次是否应以安全模式启动。
 *
 * 安全模式 = 跳过会话自动恢复(restoreOnBoot):连续「加载即崩」说明恢复的
 * 内容本身可能就是崩因,先以最小状态把界面拉活,会话数据仍在磁盘,用户可
 * 从历史手动打开。详见 src-tauri/src/watchdog.rs。
 *
 * 任何失败(Web 模式、后端未就绪、命令缺失)都按正常模式处理——
 * 安全模式是崩溃循环的断路器,绝不能反过来挡住正常启动。
 */
export async function getCrashRecoveryState(): Promise<CrashRecoveryState> {
  if (!isTauriRuntime()) return NORMAL;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<CrashRecoveryState>("crash_recovery_state");
    if (res && typeof res.safeMode === "boolean") return res;
    return NORMAL;
  } catch {
    return NORMAL;
  }
}
