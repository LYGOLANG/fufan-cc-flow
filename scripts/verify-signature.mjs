#!/usr/bin/env node
/**
 * 用「应用内固化的公钥」验证发布产物的签名。
 *
 * 为什么需要它：release-update.mjs 的同批守卫只比对 mtime，能拦住「新包配旧
 * 签名」，但拦不住「签名用的私钥和应用内公钥对不上」——比如换过密钥、拿错了
 * 密钥文件。那种情况下产物看着完全正常、发布毫无报错，但**每个用户的自动更新
 * 都会验签失败**，而发布方永远不会知道，因为失败发生在用户那侧。
 *
 * 验的是真实链路的三方：latest.json 里的签名 + 实际的安装包 + tauri.conf.json
 * 里的 pubkey。任一不匹配就退出码非 0。
 *
 * 用法：
 *   node scripts/verify-signature.mjs                    # 验本地 release/updates
 *   node scripts/verify-signature.mjs --remote           # 下载线上产物再验
 */
import { readFileSync, existsSync } from "node:fs";
import { createPublicKey, verify, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPDATES_DIR = path.join(ROOT, "release", "updates");
const CONF = path.join(ROOT, "client", "src-tauri", "tauri.conf.json");

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

/** minisign 的 key/sig 文件是「注释行 + base64 行」，取出 base64 行解成字节 */
function minisignPayload(text) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("untrusted comment:") && !l.startsWith("trusted comment:"))[0];
  if (!line) throw new Error("找不到 base64 载荷行");
  return Buffer.from(line, "base64");
}

/** 32 字节裸 ed25519 公钥 → Node 能用的 KeyObject（套 DER SPKI 头） */
function ed25519PublicKey(raw32) {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    raw32,
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

async function main() {
  const remote = process.argv.includes("--remote");

  // ---- 应用内固化的公钥（用户的应用真正拿来验签的那一个）----
  const conf = JSON.parse(readFileSync(CONF, "utf8"));
  const pubkeyB64 = conf?.plugins?.updater?.pubkey;
  if (!pubkeyB64) fail("tauri.conf.json 里没有 plugins.updater.pubkey");
  const pubBytes = minisignPayload(Buffer.from(pubkeyB64, "base64").toString("utf8"));
  const pubAlg = pubBytes.subarray(0, 2).toString("utf8");
  const pubKeyId = pubBytes.subarray(2, 10);
  const pubKey = ed25519PublicKey(pubBytes.subarray(10, 42));

  // ---- latest.json + 安装包 ----
  let manifest, exeBuf, source;
  if (remote) {
    const url = conf.plugins.updater.endpoints[0];
    source = "线上";
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) fail(`拉取 latest.json 失败: HTTP ${r.status}`);
    manifest = await r.json();
    const exeUrl = manifest.platforms["windows-x86_64"].url;
    const er = await fetch(exeUrl, { redirect: "follow" });
    if (!er.ok) fail(`下载安装包失败: HTTP ${er.status}`);
    exeBuf = Buffer.from(await er.arrayBuffer());
  } else {
    source = "本地";
    const mPath = path.join(UPDATES_DIR, "latest.json");
    if (!existsSync(mPath)) fail(`没有 ${mPath}，先跑 release-update.mjs`);
    manifest = JSON.parse(readFileSync(mPath, "utf8"));
    const exeName = path.basename(manifest.platforms["windows-x86_64"].url);
    const ePath = path.join(UPDATES_DIR, exeName);
    if (!existsSync(ePath)) fail(`没有 ${ePath}`);
    exeBuf = readFileSync(ePath);
  }

  const sigText = Buffer.from(
    manifest.platforms["windows-x86_64"].signature,
    "base64",
  ).toString("utf8");
  const sigBytes = minisignPayload(sigText);
  const sigAlg = sigBytes.subarray(0, 2).toString("utf8");
  const sigKeyId = sigBytes.subarray(2, 10);
  const signature = sigBytes.subarray(10, 74);

  console.log(`来源: ${source}   版本: ${manifest.version}   包大小: ${exeBuf.length}`);

  // ---- key id 必须一致，否则就是「私钥换了公钥没换」----
  if (!pubKeyId.equals(sigKeyId)) {
    fail(
      `密钥不匹配：公钥 id=${pubKeyId.toString("hex")} 签名 id=${sigKeyId.toString("hex")}\n` +
        `   这版发布出去后，所有用户的自动更新都会验签失败。`,
    );
  }

  // ---- 真验签。"ED"=对 BLAKE2b-512 摘要签，"Ed"=对原文签 ----
  let payload;
  if (sigAlg === "ED") payload = createHash("blake2b512").update(exeBuf).digest();
  else if (sigAlg === "Ed") payload = exeBuf;
  else fail(`未知签名算法: ${sigAlg}`);

  if (!verify(null, payload, pubKey, signature)) {
    fail("验签失败：安装包与签名对不上（包被改动过，或签名来自另一次构建）");
  }

  // trusted comment 里的文件名对不上不影响 tauri 验签，但说明产物拼装出了错
  const fileInSig = /file:(.+)$/m.exec(sigText)?.[1]?.trim();
  const expectedFile = path.basename(manifest.platforms["windows-x86_64"].url);
  const nameMatches = fileInSig?.replace(/\s+/g, "") === expectedFile.replace(/\s+/g, "");

  console.log(`✅ 验签通过（alg=${sigAlg}, keyid=${pubKeyId.toString("hex")}）`);
  console.log(`   签名时记录的文件: ${fileInSig ?? "(无)"}`);
  if (!nameMatches) {
    console.log(`   ⚠️  与发布名 ${expectedFile} 不同（仅提示，不影响验签）`);
  }
  console.log(`   用户的应用能用内置公钥验过这个包。`);
}

main().catch((e) => fail(e.message));
