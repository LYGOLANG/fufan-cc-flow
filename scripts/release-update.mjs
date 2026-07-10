/**
 * F1.14 自动升级 · 发布助手
 *
 * 用法（在仓库根目录）:
 *   1. 打包（需要签名私钥,一次性设好环境变量）:
 *        set TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.tauri\fufan-ccflow.key
 *        pnpm --filter client tauri build
 *   2. 生成更新产物:
 *        node scripts/release-update.mjs [--notes "本次更新说明"]
 *      可选环境变量 UPDATE_BASE_URL 覆盖下载根地址(默认 http://121.15.193.215:3001)
 *   3. 把 release/updates/ 整个目录放到服务器上,以 /updates/ 路径静态可访问:
 *        http://<服务器>/updates/latest.json      ← updater 检查端点
 *        http://<服务器>/updates/<安装包>.exe     ← 下载地址
 *
 * 产出 release/updates/:
 *   latest.json + Agent Flow_<version>_x64-setup.exe
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
const baseUrl = (process.env.UPDATE_BASE_URL || "http://121.15.193.215:3001").replace(/\/+$/, "");

// --notes "..." 参数
const notesIdx = process.argv.indexOf("--notes");
const notes = notesIdx !== -1 ? process.argv[notesIdx + 1] : `v${version}`;

const bundleDir = path.join(root, "client/src-tauri/target/release/bundle/nsis");
if (!fs.existsSync(bundleDir)) {
  console.error(`未找到打包产物目录: ${bundleDir}\n先跑 pnpm --filter client tauri build（带签名私钥环境变量）`);
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

const outDir = path.join(root, "release/updates");
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(bundleDir, exe), path.join(outDir, exe));

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(path.join(bundleDir, sig), "utf-8"),
      url: `${baseUrl}/updates/${encodeURIComponent(exe)}`,
    },
  },
};
fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(manifest, null, 2));

console.log(`✅ 更新产物已生成: ${outDir}`);
console.log(`   版本: v${version}`);
console.log(`   下载地址: ${manifest.platforms["windows-x86_64"].url}`);
console.log(`   下一步: 把 release/updates/ 上传到服务器的 /updates/ 静态路径`);

if (baseUrl.startsWith("http://")) {
  console.warn(
    `\n⚠️  更新端点为明文 http(公网)。签名校验可挡住安装包篡改(无私钥无法伪造),\n` +
      `   但仍有降级攻击(投递旧版合法包)/更新行为可被观测的残余风险。建议尽早换 HTTPS。`
  );
}
console.log(
  `\n🔑 提醒: 应用内固化的公钥必须与打包私钥(~/.tauri/fufan-ccflow.key)配对,\n` +
    `   否则所有更新都会校验失败。换过密钥就要重发一版全量安装包。`
);
