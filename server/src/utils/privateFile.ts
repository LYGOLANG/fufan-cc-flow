import { promises as fs } from "fs";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/**
 * Windows 上收紧 ACL:移除继承、只留当前用户完全控制。
 *
 * 背景:POSIX 的 mode/chmod 在 NTFS 上是 no-op——文件按父目录继承的 ACL 创建,
 * 通常包含 Users 组可读。对存明文 API Key 的 providers.json / settings.json 而言,
 * 「0600」曾经只是注释里的承诺,代码层面在本项目主平台完全没有落实。
 *
 * icacls 语义:
 *   /inheritance:r  移除继承来的 ACE(否则父目录的宽松权限会一直生效)
 *   /grant:r <用户>:(F)  重置并授予该用户完全控制
 * 失败只告警不抛错:权限收紧属加固,不该让保存配置这类主流程失败。
 */
async function tightenWindowsAcl(target: string): Promise<void> {
  const user = process.env.USERNAME
    ? `${process.env.USERDOMAIN || process.env.COMPUTERNAME || "."}\\${process.env.USERNAME}`
    : undefined;
  if (!user) {
    logger.warn(`[privateFile] cannot resolve current user, skip ACL tighten: ${target}`);
    return;
  }
  try {
    await execFileAsync("icacls", [target, "/inheritance:r", "/grant:r", `${user}:(F)`], {
      windowsHide: true,
    });
  } catch (err) {
    // 常见于非 NTFS 卷、网络盘、或组策略限制——记录但不阻断
    logger.warn(`[privateFile] icacls failed for ${target}: ${String(err).slice(0, 200)}`);
  }
}

/** Write sensitive local configuration and tighten existing permissions. */
export async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  const isWin = process.platform === "win32";

  await fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (!isWin) await fs.chmod(directory, PRIVATE_DIR_MODE);

  await fs.writeFile(filePath, contents, {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  if (!isWin) await fs.chmod(filePath, PRIVATE_FILE_MODE);

  // Windows 走 ACL 而非 mode(见 tightenWindowsAcl 注释)。目录先收紧,
  // 保证后续在其中新建的文件继承到的就是紧的权限。
  if (isWin) {
    await tightenWindowsAcl(directory);
    await tightenWindowsAcl(filePath);
  }
}
