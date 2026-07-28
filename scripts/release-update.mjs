/**
 * F1.14 自动升级 · 发布助手（GitHub Releases 版）
 *
 * 用法（在仓库根目录）:
 *   1. 打包（需要签名私钥,一次性设好环境变量）:
 *        注意必须用 TAURI_SIGNING_PRIVATE_KEY 传私钥「内容」,本 CLI 版本不认 _PATH 变体
 *        export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/fufan-ccflow.key)"
 *        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
 *        pnpm package:desktop   （或 pnpm --filter client tauri build）
 *   2. 生成更新产物:
 *        node scripts/release-update.mjs [--notes "本次更新说明"]
 *      可选环境变量 UPDATE_REPO 覆盖发布仓(默认 LYGOLANG/fufan-cc-flow-releases)
 *   3. 发布到 GitHub Releases（发布仓必须是 public，否则客户端匿名下载 404）:
 *        gh release create v<version> --repo LYGOLANG/fufan-cc-flow-releases \
 *          --title "v<version>" --notes "更新说明" \
 *          "release/updates/AgentFlow_<version>_x64-setup.exe" \
 *          "release/updates/latest.json"
 *
 * 端点 tauri.conf.json plugins.updater.endpoints 固定指向
 *   https://github.com/<UPDATE_REPO>/releases/latest/download/latest.json
 * ——每次 release 都会让 /latest/ 自动指向最新版，老版本应用即可发现更新。
 *
 * 产出 release/updates/:
 *   latest.json + AgentFlow_<version>_x64-setup.exe（文件名去空格：GitHub 会把
 *   资产名里的空格改成点，去空格保证 latest.json 里的 url 与实际下载地址一致）
 * 签名(.sig)内容内嵌进 latest.json,客户端用固化公钥校验,防篡改。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(
  fs.readFileSync(path.join(root, "client/src-tauri/tauri.conf.json"), "utf-8")
);
const version = conf.version;
const repo = process.env.UPDATE_REPO || "LYGOLANG/fufan-cc-flow-releases";

// --notes "..." 参数
const notesIdx = process.argv.indexOf("--notes");
const notes = notesIdx !== -1 ? process.argv[notesIdx + 1] : `v${version}`;

const bundleDir = path.join(root, "client/src-tauri/target/release/bundle/nsis");
if (!fs.existsSync(bundleDir)) {
  console.error(`未找到打包产物目录: ${bundleDir}\n先跑 pnpm package:desktop（带签名私钥环境变量）`);
  process.exit(1);
}

// 必须按「当前版本」精确匹配——bundle 目录可能残留旧版本产物,
// 用 .find() 裸匹配会把旧版 exe/签名错打进新版 latest.json(踩过)。
const exe = fs.readdirSync(bundleDir).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
const sig = fs.readdirSync(bundleDir).find((f) => f.endsWith(`_${version}_x64-setup.exe.sig`));
if (!exe || !sig) {
  console.error(
    `未找到版本 ${version} 的产物: exe=${exe ?? "缺"} sig=${sig ?? "缺"}\n` +
      `确认 tauri.conf.json 的 version 与实际打包版本一致;` +
      `.sig 缺失说明打包时没带签名私钥(TAURI_SIGNING_PRIVATE_KEY)。`
  );
  process.exit(1);
}

// ── 签名与安装包必须来自同一次构建 ──
//
// 版本号相同不代表同批。触发场景很平常:带签名密钥打包出 exe+sig,之后换个
// 没有 export 环境变量的终端重打同一版本 —— package-desktop 此时会**静默**
// 关掉 updater 产物(createUpdaterArtifacts:false),NSIS 覆盖了 exe,而上一次
// 的 .sig 原地不动(tauri 只写新 sig、从不删旧的)。于是新包配旧签名,
// latest.json 照样生成,发出去所有人验签失败 —— 且发布方毫无察觉。
//
// tauri 总是先写 exe、再写 sig,所以 mtime(sig) >= mtime(exe) 是同批的可靠特征。
// 实测:合法产物的 sig 比 exe 晚 1~3 秒。
const exeStat = fs.statSync(path.join(bundleDir, exe));
const sigStat = fs.statSync(path.join(bundleDir, sig));
if (sigStat.mtimeMs < exeStat.mtimeMs) {
  const lagSec = Math.round((exeStat.mtimeMs - sigStat.mtimeMs) / 1000);
  console.error(
    `签名比安装包旧 ${lagSec} 秒 —— 它们不是同一次构建的产物。\n` +
      `  exe: ${exeStat.mtime.toISOString()}\n` +
      `  sig: ${sigStat.mtime.toISOString()}\n` +
      `多半是最近一次打包没带 TAURI_SIGNING_PRIVATE_KEY:NSIS 覆盖了安装包,\n` +
      `旧签名却留了下来。这样发出去,所有用户的自动更新都会验签失败。\n` +
      `请带签名私钥重新打包后再发布。`
  );
  process.exit(1);
}

// GitHub 会把 release 资产文件名中的空格替换成点("Agent Flow_..." → "Agent.Flow_...")，
// 导致 latest.json 里的 url 与真实下载地址对不上。统一去掉空格,所见即所得。
const assetName = exe.replace(/\s+/g, "");

const outDir = path.join(root, "release/updates");
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(bundleDir, exe), path.join(outDir, assetName));

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(path.join(bundleDir, sig), "utf-8"),
      url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(assetName)}`,
    },
  },
};
fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(manifest, null, 2));

console.log(`✅ 更新产物已生成: ${outDir}`);
console.log(`   版本: v${version}`);
console.log(`   下载地址: ${manifest.platforms["windows-x86_64"].url}`);

// 这里曾经只是一行「记得确认公钥和私钥配对」的文字提醒。提醒挡不住任何事:
// 密钥对不上时产物看着完全正常、发布毫无报错,失败只发生在**用户那侧**的
// 自动更新里,发布方永远收不到反馈。所以改成发布前真验一次。
console.log(`\n🔑 用应用内公钥验签...`);
try {
  execFileSync(process.execPath, [path.join(root, "scripts", "verify-signature.mjs")], {
    stdio: "inherit",
  });
} catch {
  console.error(
    `\n❌ 验签未通过,已阻止发布。\n` +
      `   最常见原因: 打包用的私钥(~/.tauri/fufan-ccflow.key)与应用内固化的\n` +
      `   公钥不是一对。换过密钥的话,得重发一版全量安装包才能让老用户接上。`
  );
  process.exit(1);
}

console.log(
  `\n   下一步: gh release create v${version} --repo ${repo} --title "v${version}" ` +
    `--notes-file <说明文件> "release/updates/${assetName}" "release/updates/latest.json"`
);
