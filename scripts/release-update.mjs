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

const exe = fs.readdirSync(bundleDir).find((f) => f.endsWith("-setup.exe"));
const sig = fs.readdirSync(bundleDir).find((f) => f.endsWith("-setup.exe.sig"));
if (!exe || !sig) {
  console.error(
    `产物不全: exe=${exe ?? "缺"} sig=${sig ?? "缺"}\n` +
      `.sig 缺失说明打包时没带签名私钥。设置 TAURI_SIGNING_PRIVATE_KEY_PATH 后重新 build。`
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
console.log(
  `   下一步: gh release create v${version} --repo ${repo} --title "v${version}" ` +
    `--notes "${notes}" "release/updates/${assetName}" "release/updates/latest.json"`
);
console.log(
  `\n🔑 提醒: 应用内固化的公钥必须与打包私钥(~/.tauri/fufan-ccflow.key)配对,\n` +
    `   否则所有更新都会校验失败。换过密钥就要重发一版全量安装包。`
);
