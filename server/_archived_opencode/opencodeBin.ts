/**
 * opencode 可执行文件解析与 spawn 封装
 *
 * Windows 上 PATH 里的 `opencode` 是 npm shim(opencode.ps1/.cmd),直接 spawn
 * 需要过 shell,任意 prompt 文本会有引号/换行转义风险。npm 包实际上带了
 * 平台二进制(opencode-windows-x64/bin/opencode.exe),优先直接 spawn 它;
 * 找不到再退回 `cmd /c opencode.cmd`(prompt 建议只含安全字符时才可靠)。
 */
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { logger } from "./logger.js";

let cachedBin: string | null | undefined;

function findWindowsBinary(): string | null {
  const npmRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "opencode-ai", "node_modules")
    : null;
  if (!npmRoot) return null;
  for (const pkg of ["opencode-windows-x64", "opencode-windows-x64-baseline"]) {
    const p = path.join(npmRoot, pkg, "bin", "opencode.exe");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 解析 opencode 可执行文件;null = 未安装 */
export function resolveOpencodeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  if (process.platform === "win32") {
    cachedBin = findWindowsBinary();
    if (cachedBin) {
      logger.info(`[opencode] binary: ${cachedBin}`);
      return cachedBin;
    }
  }
  // 非 Windows 或未找到平台二进制:交给 PATH(unix 下 shim 是普通脚本,spawn 可直接执行)
  cachedBin = "opencode";
  return cachedBin;
}

/** spawn opencode。Windows 优先平台二进制(无 shell,参数安全);兜底 cmd /c shim */
export function spawnOpencode(args: string[], opts: SpawnOptions): ChildProcess | null {
  const bin = resolveOpencodeBin();
  if (!bin) return null;
  try {
    if (process.platform === "win32" && bin === "opencode") {
      // 平台二进制缺失,退回 shim(cmd 解析,复杂 prompt 可能被转义破坏)
      return spawn("cmd", ["/c", "opencode.cmd", ...args], { ...opts, windowsHide: true });
    }
    return spawn(bin, args, { ...opts, windowsHide: true });
  } catch (err) {
    logger.error(`[opencode] spawn failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
