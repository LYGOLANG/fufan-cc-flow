// Builds the Node/Express server into a standalone, dependency-complete bundle
// and copies a standalone Node runtime as a Tauri sidecar binary, so the packaged
// desktop app can spawn its own backend instead of requiring one to be running
// already (see client/src-tauri/src/sidecar.rs for the Rust side that spawns it).
//
// Cross-platform: Tauri's sidecar convention requires the binary to be named
// `<name>-<rust-host-target-triple>[.exe]`. We ask rustc for the *host* triple
// (not a cross-compile target — this script only ever runs natively on the build
// machine). On macOS, Homebrew's node may depend on unbundled dylibs, so we pin
// and verify the official standalone Node.js LTS binary instead.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, rmSync, copyFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(clientDir, "..");
const tauriDir = path.join(clientDir, "src-tauri");
const serverDistDir = path.join(tauriDir, "server-dist");
const binariesDir = path.join(tauriDir, "binaries");
const runtimeCacheDir = path.join(clientDir, ".cache", "node-runtime");

const NODE_RUNTIME_VERSION = "22.23.1";
const MAC_NODE_RELEASES = {
  "aarch64-apple-darwin": {
    platformArch: "darwin-arm64",
    sha256: "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953",
  },
  "x86_64-apple-darwin": {
    platformArch: "darwin-x64",
    sha256: "b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81",
  },
};

const rustcOutput = execSync("rustc -vV", { encoding: "utf-8" });
const hostMatch = rustcOutput.match(/^host:\s*(\S+)/m);
if (!hostMatch) {
  throw new Error("[prepare-sidecar] could not determine host target triple from `rustc -vV`");
}
const targetTriple = hostMatch[1];
const exeSuffix = targetTriple.includes("windows") ? ".exe" : "";
const sidecarExe = path.join(binariesDir, `node-${targetTriple}${exeSuffix}`);

async function resolveNodeRuntime() {
  if (process.platform !== "darwin") return process.execPath;

  const release = MAC_NODE_RELEASES[targetTriple];
  if (!release) {
    throw new Error(`[prepare-sidecar] unsupported macOS target triple: ${targetTriple}`);
  }

  const archiveName = `node-v${NODE_RUNTIME_VERSION}-${release.platformArch}.tar.gz`;
  const archivePath = path.join(runtimeCacheDir, archiveName);
  const extractedDir = path.join(runtimeCacheDir, path.basename(archiveName, ".tar.gz"));
  const runtimePath = path.join(extractedDir, "bin", "node");
  mkdirSync(runtimeCacheDir, { recursive: true });

  if (!existsSync(archivePath)) {
    const url = `https://nodejs.org/download/release/v${NODE_RUNTIME_VERSION}/${archiveName}`;
    console.log(`[prepare-sidecar] downloading official Node.js runtime: ${url}`);
    execFileSync(
      "curl",
      ["-fL", "--retry", "3", "--connect-timeout", "15", "-o", archivePath, url],
      { stdio: "inherit" }
    );
  }

  const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actualSha256 !== release.sha256) {
    rmSync(archivePath, { force: true });
    throw new Error(
      `[prepare-sidecar] Node.js runtime checksum mismatch: expected ${release.sha256}, got ${actualSha256}`
    );
  }

  if (!existsSync(runtimePath)) {
    rmSync(extractedDir, { recursive: true, force: true });
    execFileSync("tar", ["-xzf", archivePath, "-C", runtimeCacheDir], { stdio: "inherit" });
  }
  if (!existsSync(runtimePath)) {
    throw new Error(`[prepare-sidecar] extracted Node.js runtime is missing: ${runtimePath}`);
  }
  return runtimePath;
}

console.log("[prepare-sidecar] building server...");
execSync("pnpm --filter server build", { cwd: repoRoot, stdio: "inherit" });

// `pnpm --filter server deploy` looked like the "correct" pnpm-native way to do this, but on
// this machine it only ever populated node_modules/.pnpm (the content-addressable store)
// without the top-level symlinks/junctions Node's resolver needs — every bare import
// (`express`, `ws`, ...) failed with ERR_MODULE_NOT_FOUND when the bundled sidecar actually
// ran (silently, since a release build has no console/log sink to surface it). Copying
// dist+package.json by hand and doing a plain `pnpm install --node-linker=hoisted` instead
// produces an ordinary flat node_modules with no symlink reliance, which just works.
console.log("[prepare-sidecar] assembling production server bundle...");
if (existsSync(serverDistDir)) rmSync(serverDistDir, { recursive: true, force: true });
mkdirSync(serverDistDir, { recursive: true });
cpSync(path.join(repoRoot, "server", "dist"), path.join(serverDistDir, "dist"), { recursive: true });
copyFileSync(path.join(repoRoot, "server", "package.json"), path.join(serverDistDir, "package.json"));
execSync(
  "pnpm install --prod --node-linker=hoisted --ignore-workspace --config.onlyBuiltDependencies=node-pty --config.onlyBuiltDependencies=esbuild",
  { cwd: serverDistDir, stdio: "inherit" }
);

// 项目初始化模板(.claude/.codex/.agents/AGENTS.md)随包分发:projectInitService
// 沿 serviceDir 向上扫描模板根,把模板放进 server-dist 根即可被打包后的 sidecar 命中。
// 不带上它们的话,桌面端"初始化项目"会报 TEMPLATE_ITEM_MISSING(模板源缺失)。
// 模板只带框架文件；开发期个人数据、调试配置和进化运行时状态不随包分发。
//
// 这份包会分发给所有用户,所以排除规则宁可过严:漏掉一个含对话片段的文件
// (进化信号里就存着用户原话)就是随安装包外泄。原先逐个文件名列举,
// 新增一个运行时文件就会漏 —— 现在整目录排除 + 按模式兜底。
const TEMPLATE_EXCLUDES = new Set([
  "attachments",
  "workflows",
  "settings.local.json",
  "launch.json",
  // evolution 整个目录都是运行时状态(signals.jsonl 存用户原话、
  // proposals.md 存待办建议),没有一个文件属于"模板框架"
  "evolution",
]);

/** 无论出现在哪一层,都不该随包分发的文件名模式 */
const TEMPLATE_EXCLUDE_PATTERNS = [
  /\.local\.[^/\\]+$/i, // settings.local.json 之类的本机覆盖
  /^\.env($|\.)/i,
  /\.log$/i,
  /\.jsonl$/i, // 各类追加式运行记录
];

function isTemplateExcluded(root, source) {
  const rel = path.relative(root, source);
  if (!rel) return false;
  if (TEMPLATE_EXCLUDES.has(rel) || TEMPLATE_EXCLUDES.has(rel.split(path.sep)[0])) return true;
  const base = path.basename(source);
  return TEMPLATE_EXCLUDE_PATTERNS.some((re) => re.test(base));
}

console.log("[prepare-sidecar] bundling project templates...");
// bundled-plugins：随包分发但**不自动安装**的插件（界面在「拓展 → 插件 →
// 市场」列出，装不装由用户点按钮决定）。必须随包，否则换台电脑装完
// Agent Flow 就少了内置插件，而界面仍然列着它 —— 又一次界面说谎。
for (const item of [".claude", ".codex", ".agents", "AGENTS.md", "bundled-plugins"]) {
  const src = path.join(repoRoot, item);
  if (existsSync(src)) {
    cpSync(src, path.join(serverDistDir, item), {
      recursive: true,
      filter: (source) => !isTemplateExcluded(src, source),
    });
  } else {
    throw new Error(`[prepare-sidecar] required template item missing in repo root: ${item}`);
  }
}

// pnpm 安装元数据含本机 store 绝对路径，Node 运行时不读取它，发布包中必须删除。
rmSync(path.join(serverDistDir, "node_modules", ".modules.yaml"), { force: true });

// 模板完整性校验。
//
// 上面那个 existsSync 只保证目录**存在**，不保证内容还在。曾经 .gitignore
// 把 .claude/hooks 整个排除在版本控制外，于是：维护者本机文件还在 → 打出的包
// 是好的；任何 fresh clone → 打出的包里 settings.json 注册了 7 个不存在的脚本，
// 用户新建的每个项目都拿到一份指向空气的配置。而全程零报错。
//
// 判据不能只数文件个数（将来增删就会误报），而是核对 settings.json 里真正
// 注册了的那些脚本是否都在。
{
  const claudeDir = path.join(serverDistDir, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  if (!existsSync(settingsPath)) {
    throw new Error("[prepare-sidecar] 模板缺少 .claude/settings.json");
  }
  const settingsText = readFileSync(settingsPath, "utf8");
  // 从 hook 命令里提取引用到的脚本文件名，逐个核对是否随包带上了
  const referenced = new Set(
    [...settingsText.matchAll(/([A-Za-z0-9_-]+\.sh)/g)].map((m) => m[1]),
  );
  const missing = [...referenced].filter(
    (name) => !existsSync(path.join(claudeDir, "hooks", name)),
  );
  if (missing.length > 0) {
    throw new Error(
      `[prepare-sidecar] settings.json 注册的 hook 脚本未随包分发: ${missing.join(", ")}\n` +
        `  这会让用户新建的每个项目都得到一份指向不存在脚本的配置。\n` +
        `  多半是 .gitignore 把 .claude/hooks 排除了，检查 git ls-files .claude/hooks`,
    );
  }
  console.log(
    `[prepare-sidecar] template check ok (${referenced.size} hook scripts referenced, all present)`,
  );
}

console.log("[prepare-sidecar] copying node runtime as sidecar binary...");
mkdirSync(binariesDir, { recursive: true });
rmSync(sidecarExe, { force: true });
copyFileSync(await resolveNodeRuntime(), sidecarExe);
chmodSync(sidecarExe, 0o755);

console.log(`[prepare-sidecar] done: ${sidecarExe}`);
