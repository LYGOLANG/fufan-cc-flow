// Builds the Node/Express server into a standalone, dependency-complete bundle
// and copies the current Node runtime as a Tauri sidecar binary, so the packaged
// desktop app can spawn its own backend instead of requiring one to be running
// already (see client/src-tauri/src/sidecar.rs for the Rust side that spawns it).
//
// Cross-platform: Tauri's sidecar convention requires the binary to be named
// `<name>-<rust-host-target-triple>[.exe]`. We ask rustc for the *host* triple
// (not a cross-compile target — this script only ever runs natively on the
// machine/CI-runner doing the build) and copy the currently-running Node
// executable (`process.execPath`), which already matches that platform/arch
// since it's the same runtime executing this script.
import { execSync } from "node:child_process";
import { existsSync, rmSync, copyFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(clientDir, "..");
const tauriDir = path.join(clientDir, "src-tauri");
const serverDistDir = path.join(tauriDir, "server-dist");
const binariesDir = path.join(tauriDir, "binaries");

const rustcOutput = execSync("rustc -vV", { encoding: "utf-8" });
const hostMatch = rustcOutput.match(/^host:\s*(\S+)/m);
if (!hostMatch) {
  throw new Error("[prepare-sidecar] could not determine host target triple from `rustc -vV`");
}
const targetTriple = hostMatch[1];
const exeSuffix = targetTriple.includes("windows") ? ".exe" : "";
const sidecarExe = path.join(binariesDir, `node-${targetTriple}${exeSuffix}`);

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
console.log("[prepare-sidecar] bundling project templates...");
for (const item of [".claude", ".codex", ".agents", "AGENTS.md"]) {
  const src = path.join(repoRoot, item);
  if (existsSync(src)) {
    cpSync(src, path.join(serverDistDir, item), { recursive: true });
  } else {
    console.warn(`[prepare-sidecar] template item missing in repo root, skipped: ${item}`);
  }
}

console.log("[prepare-sidecar] copying node runtime as sidecar binary...");
mkdirSync(binariesDir, { recursive: true });
copyFileSync(process.execPath, sidecarExe);

console.log(`[prepare-sidecar] done: ${sidecarExe}`);
