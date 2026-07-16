import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(repoRoot, "release");
const tauriReleaseDir = path.join(repoRoot, "client", "src-tauri", "target", "release");
const bundleDir = path.join(tauriReleaseDir, "bundle");
const nsisDir = path.join(tauriReleaseDir, "nsis");
const tauriConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "client", "src-tauri", "tauri.conf.json"), "utf-8")
);
const productName = tauriConfig.productName ?? "Agent Flow";
const version = tauriConfig.version ?? "0.1.0";
const configuredTargets = Array.isArray(tauriConfig.bundle?.targets)
  ? tauriConfig.bundle.targets
  : [tauriConfig.bundle?.targets ?? "all"];
const allowNsis = process.platform === "win32" &&
  (configuredTargets.includes("all") || configuredTargets.includes("nsis"));
const allowMsi = process.platform === "win32" &&
  (configuredTargets.includes("all") || configuredTargets.includes("msi"));
const allowDmg = process.platform === "darwin";

function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function isInstallerArtifact(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const ext = path.extname(name);
  if (name.startsWith("rw.")) return false;
  if (ext === ".exe" && !allowNsis) return false;
  if (ext === ".msi" && !allowMsi) return false;
  if (ext === ".dmg" && !allowDmg) return false;
  if (ext !== ".exe" && ext !== ".msi" && ext !== ".dmg") return false;
  if (name === "app.exe" || name === "nsis-output.exe") return false;
  return name.includes("agent flow");
}

function isReleaseInstaller(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const ext = path.extname(name);
  if (name.startsWith("rw.")) return false;
  if (ext !== ".exe" && ext !== ".msi" && ext !== ".dmg") return false;
  if (name === "app.exe" || name === "nsis-output.exe") return false;
  return name.includes("agent flow");
}

const buildStartedAt = Date.now();

console.log("[package-desktop] building Tauri desktop package...");
let buildError = null;
try {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const buildArgs = ["--filter", "client", "tauri", "build"];
  if (process.platform === "darwin") buildArgs.push("--bundles", "app,dmg");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    buildArgs.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  }
  const inheritedRustFlags = process.env.RUSTFLAGS?.trim() ?? "";
  const remapHome = `--remap-path-prefix=${os.homedir()}=/build`;
  execFileSync(pnpmCommand, buildArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    // Windows: pnpm.cmd 是批处理脚本,execFileSync 不带 shell:true 直接调用
    // 会抛 EINVAL(Node 在 Windows 下的已知行为,.cmd/.bat 必须经 shell 转发)。
    // macOS/Linux 上 pnpm 是真实可执行文件,shell:true 无副作用,统一按平台判断即可。
    shell: process.platform === "win32",
    env: {
      ...process.env,
      RUSTFLAGS: [inheritedRustFlags, remapHome].filter(Boolean).join(" "),
    },
  });
} catch (err) {
  buildError = err;
  console.warn("[package-desktop] tauri build exited non-zero; checking for generated installer artifacts...");
}

const bundledArtifacts = walk(bundleDir)
  .filter(isInstallerArtifact)
  .map((source) => ({ source, targetName: path.basename(source) }));

const fallbackNsisArtifacts = walk(nsisDir)
  .filter(() => allowNsis)
  .filter((source) => path.basename(source).toLowerCase() === "nsis-output.exe")
  .map((source) => ({ source, targetName: `${productName}_${version}_x64-setup.exe` }));

const freshCutoff = buildStartedAt - 2000;
const artifacts = [...bundledArtifacts, ...fallbackNsisArtifacts]
  .filter((artifact) => statSync(artifact.source).mtimeMs >= freshCutoff)
  .sort((a, b) => statSync(b.source).mtimeMs - statSync(a.source).mtimeMs);

if (artifacts.length === 0) {
  if (buildError) throw buildError;
  throw new Error(`[package-desktop] no fresh installer artifacts found under ${bundleDir} or ${nsisDir}`);
}

const artifactExtensions = new Set(artifacts.map((artifact) => path.extname(artifact.targetName).toLowerCase()));
if (allowNsis && !artifactExtensions.has(".exe")) {
  throw new Error("[package-desktop] NSIS target is enabled, but no fresh .exe installer was generated");
}
if (allowMsi && !artifactExtensions.has(".msi")) {
  throw new Error("[package-desktop] MSI target is enabled, but no fresh .msi installer was generated");
}
if (allowDmg && !artifactExtensions.has(".dmg")) {
  throw new Error("[package-desktop] macOS target is enabled, but no fresh .dmg installer was generated");
}

mkdirSync(releaseDir, { recursive: true });
for (const filePath of readdirSync(releaseDir)) {
  const fullPath = path.join(releaseDir, filePath);
  if (statSync(fullPath).isFile() && isReleaseInstaller(fullPath)) {
    try {
      rmSync(fullPath, { force: true });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : "unknown";
      console.warn(
        `[package-desktop] warning: could not remove old installer ${path.relative(repoRoot, fullPath)} (${code}); continuing`
      );
    }
  }
}

for (const artifact of artifacts) {
  const target = path.join(releaseDir, artifact.targetName);
  copyFileSync(artifact.source, target);
  console.log(`[package-desktop] copied ${path.relative(repoRoot, artifact.source)} -> ${path.relative(repoRoot, target)}`);
}

console.log("[package-desktop] done. Use the installers in ./release.");
