/**
 * 健壮地解析并调用 `codex`(OpenAI Codex CLI)可执行文件 —— **不依赖进程 PATH**。
 *
 * 设计与 claudeBin.ts 完全对称:服务端是长驻 Node 进程,若它在 codex 安装(或 PATH
 * 更新)之前就启动了,`spawn("codex", ...)` 会找不到 → 检测一直报「未安装」。因此每次
 * 都重新解析,保证「重新检测」能反映最新安装状态。
 *
 * 解析顺序:
 *   1) 环境变量覆盖:CODEX_BIN / CC_CODEX_BIN
 *   2) PATH 查找:where(win)/ which(posix)
 *   3) 已知安装位置兜底:npm 全局 / winget / scoop / homebrew
 */
import { spawn, spawnSync, SpawnOptions, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import os from "os";

const isWin = process.platform === "win32";
const HOME = os.homedir();
const APPDATA = process.env.APPDATA || "";
const LOCALAPPDATA = process.env.LOCALAPPDATA || "";
const PROGRAMDATA = process.env.ProgramData || "C:\\ProgramData";
const SCOOP = process.env.SCOOP || join(HOME, "scoop");
const SCOOP_GLOBAL = process.env.SCOOP_GLOBAL || join(PROGRAMDATA, "scoop");

/** 常见安装目录(各包管理器的 bin/shim 目录)。 */
function knownDirs(): string[] {
  return isWin
    ? [
        join(HOME, ".local", "bin"),
        join(APPDATA, "npm"), // npm 全局(codex 常见安装位置)
        join(LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
        join(SCOOP, "shims"),
        join(SCOOP_GLOBAL, "shims"),
      ]
    : [
        join(HOME, ".local", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin", // Homebrew(Apple Silicon)
        "/home/linuxbrew/.linuxbrew/bin", // Homebrew on Linux
        join(HOME, ".linuxbrew", "bin"),
        join(HOME, ".npm-global", "bin"),
      ];
}

/** 用 where/which 在 PATH 中解析(优先 .exe,其次 .cmd/.bat,跳过无法直接 spawn 的 .ps1)。 */
function resolveOnPath(name: string): string | undefined {
  const finder = isWin ? "where" : "which";
  const r = spawnSync(finder, [name], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return undefined;
  const paths = r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!isWin) return paths[0];
  const rank = (p: string) => {
    const l = p.toLowerCase();
    if (l.endsWith(".exe")) return 0;
    if (l.endsWith(".cmd") || l.endsWith(".bat")) return 1;
    return 2;
  };
  return paths.filter((p) => !p.toLowerCase().endsWith(".ps1")).sort((a, b) => rank(a) - rank(b))[0] ?? paths[0];
}

/** 解析 codex 可执行文件的绝对路径;找不到返回 undefined。每次实时解析,不缓存。 */
export function resolveCodexBin(): string | undefined {
  const override = process.env.CODEX_BIN || process.env.CC_CODEX_BIN;
  if (override && existsSync(override)) return override;

  const onPath = resolveOnPath("codex");
  if (onPath) return onPath;

  const names = isWin ? ["codex.exe", "codex.cmd"] : ["codex"];
  for (const d of knownDirs()) {
    for (const n of names) {
      const c = join(d, n);
      if (existsSync(c)) return c;
    }
  }
  return undefined;
}

/**
 * 以解析出的绝对路径调用 codex(避免依赖 PATH / shell 引号问题):
 *   - .cmd/.bat(Windows):用 `cmd /c <path> <args>`,参数按数组传,不经 shell 解析
 *   - 其余(.exe / posix 可执行):直接 spawn 路径
 * 解析不到返回 undefined,调用方按「未安装」处理。
 */
export function spawnCodex(args: string[], opts: SpawnOptions = {}): ChildProcess | undefined {
  const bin = resolveCodexBin();
  if (!bin) return undefined;
  if (isWin && /\.(cmd|bat)$/i.test(bin)) {
    const cmd = process.env.ComSpec || "cmd.exe";
    return spawn(cmd, ["/d", "/s", "/c", bin, ...args], { ...opts, shell: false });
  }
  return spawn(bin, args, { ...opts, shell: false });
}
