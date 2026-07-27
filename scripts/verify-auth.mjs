/**
 * 桌面端鉴权链路实测。
 *
 * 用法(装好 Agent Flow 并把它打开之后):
 *   node scripts/verify-auth.mjs
 *
 * 前面所有鉴权验证都是在裸后端上做的。真正的桌面链路是
 *   Rust 生成令牌 → 环境变量 → sidecar → Tauri command → 前端
 * 这条链只有装上才能验。链路断了的典型症状是「应用打开后一片空白」,
 * 而那时后端日志里只会看到一串 401,不容易联想到根因。
 *
 * 这个脚本从应用日志里定位后端端口,然后以「外部进程」的身份去打接口 ——
 * 正是我们要挡住的那类调用方。期望结果:全部 401。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "com.fufan.ccflow",
  "logs",
  "Agent Flow.log"
);

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

if (!existsSync(LOG)) {
  fail(`找不到应用日志: ${LOG}\n   请确认 Agent Flow 已安装并至少启动过一次。`);
}

const log = readFileSync(LOG, "utf8");

// ── 1. 鉴权是否已启用 ──
const authOn = log.includes("[auth] 接口鉴权已启用");
const authOff = log.includes("[auth] 接口鉴权未启用");
console.log("=== 1. 后端启动时的鉴权状态 ===");
if (authOn) {
  console.log("   ✅ 日志显示:接口鉴权已启用");
} else if (authOff) {
  fail(
    "日志显示鉴权【未】启用 —— Tauri 外壳没能把 CC_FLOW_AUTH_TOKEN 注入 sidecar。\n" +
      "   检查 client/src-tauri/src/sidecar.rs 的 .env(\"CC_FLOW_AUTH_TOKEN\", ...)"
  );
} else {
  fail("日志里找不到鉴权状态行 —— 可能装的仍是旧版本(该日志自 v0.1.20 起才有)。");
}

// ── 2. 找出后端端口 ──
const portMatches = [...log.matchAll(/server running on http:\/\/127\.0\.0\.1:(\d+)/g)];
if (portMatches.length === 0) {
  fail("日志里找不到后端端口。");
}
const port = portMatches[portMatches.length - 1][1];
console.log(`\n=== 2. 后端端口 ===\n   ${port}(取日志中最后一次启动)`);

// ── 3. 以外部进程身份打接口,期望全部被拒 ──
console.log("\n=== 3. 外部进程调用后端(期望全部 401)===");

const base = `http://127.0.0.1:${port}/api`;
const cases = [
  ["无令牌读供应商列表", `${base}/providers`, {}],
  ["伪造令牌", `${base}/providers`, { headers: { "x-cc-flow-token": "forged" } }],
  [
    "无令牌读凭据文件",
    `${base}/files/content?path=${encodeURIComponent(
      path.join(os.homedir(), ".claude", ".credentials.json")
    )}`,
    {},
  ],
];

let allBlocked = true;
for (const [label, url, opts] of cases) {
  try {
    const res = await fetch(url, opts);
    const ok = res.status === 401;
    if (!ok) allBlocked = false;
    console.log(`   ${ok ? "✅" : "❌"} ${label}: HTTP ${res.status}${ok ? "" : "  ← 应为 401!"}`);
  } catch (err) {
    console.log(`   ⚠️  ${label}: 请求失败(${err.message}) —— 后端可能已退出`);
    allBlocked = false;
  }
}

// ── 4. 健康检查必须仍然放行(Tauri 用它探测就绪)──
console.log("\n=== 4. 健康检查豁免(Tauri 探测就绪要用)===");
try {
  const res = await fetch(`${base}/health`);
  console.log(
    `   ${res.status === 200 ? "✅" : "❌"} /api/health: HTTP ${res.status}${
      res.status === 200 ? "" : "  ← 应为 200,否则应用启动时探测不到后端"
    }`
  );
  if (res.status !== 200) allBlocked = false;
} catch (err) {
  console.log(`   ⚠️  健康检查请求失败: ${err.message}`);
  allBlocked = false;
}

console.log(
  allBlocked
    ? "\n✅ 鉴权链路正常:外部进程被挡在门外,应用自身照常工作。"
    : "\n❌ 存在未通过项,见上方标记。"
);
process.exit(allBlocked ? 0 : 1);
