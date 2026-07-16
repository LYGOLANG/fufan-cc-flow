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
const TEMPLATE_EXCLUDES = new Set([
  "attachments",
  "workflows",
  "settings.local.json",
  "launch.json",
  path.join("evolution", "signals.jsonl"),
  path.join("evolution", "proposals.md"),
]);

function isTemplateExcluded(root, source) {
  const rel = path.relative(root, source);
  if (!rel) return false;
  return TEMPLATE_EXCLUDES.has(rel) || TEMPLATE_EXCLUDES.has(rel.split(path.sep)[0]);
}

console.log("[prepare-sidecar] bundling project templates...");
for (const item of [".claude", ".codex", ".agents", "AGENTS.md"]) {
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

console.log("[prepare-sidecar] copying node runtime as sidecar binary...");
mkdirSync(binariesDir, { recursive: true });
rmSync(sidecarExe, { force: true });
copyFileSync(await resolveNodeRuntime(), sidecarExe);
chmodSync(sidecarExe, 0o755);

console.log(`[prepare-sidecar] done: ${sidecarExe}`);
