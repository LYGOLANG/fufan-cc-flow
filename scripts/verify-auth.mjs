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

// ── 1. 找出后端端口 ──
//
// 优先从日志取；取不到就退回扫描端口。日志会轮转，应用跑久了启动那几行
// （含端口与鉴权状态）就被滚掉了 —— 实测踩过：应用 21:21 启动，一小时后
// 日志首行已是 22:13，脚本据此误报「可能装的是旧版本」。
console.log("=== 1. 定位后端端口 ===");
let port = null;
const portMatches = [...log.matchAll(/server running on http:\/\/127\.0\.0\.1:(\d+)/g)];
if (portMatches.length > 0) {
  port = portMatches[portMatches.length - 1][1];
  console.log(`   ${port}（取自日志）`);
} else {
  // 从 sidecar 进程的命令行拿不到端口（它由 Rust 经环境变量注入），
  // 所以直接探测：健康检查是唯一免鉴权的端点，正好用来认门。
  console.log("   日志中无启动行（已轮转），改为探测…");
  const { execSync } = await import("node:child_process");
  let candidates = [];
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true });
    candidates = [
      ...new Set(
        [...out.matchAll(/127\.0\.0\.1:(\d+)\s+.*LISTENING/g)].map((m) => m[1])
      ),
    ];
  } catch {
    fail("无法枚举监听端口，请手动指定：node scripts/verify-auth.mjs <port>");
  }
  const argPort = process.argv[2];
  if (argPort) candidates = [argPort];
  for (const c of candidates) {
    try {
      const res = await fetch(`http://127.0.0.1:${c}/api/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.ok && (await res.json())?.status === "ok") {
        port = c;
        console.log(`   ${port}（探测到）`);
        break;
      }
    } catch {
      /* 不是它 */
    }
  }
  if (!port) fail("没找到运行中的后端。应用是否已启动？也可手动指定端口作为参数。");
}

// ── 2. 鉴权是否已启用 ──
//
// 以**实际行为**为准而不是日志文案：日志会轮转，而「无令牌能否调通」是
// 此刻的事实。
console.log("\n=== 2. 鉴权是否生效 ===");
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/providers`);
  if (res.status === 401) {
    console.log("   ✅ 无令牌被拒（401）—— 鉴权已启用");
  } else {
    fail(
      `无令牌竟然拿到 HTTP ${res.status} —— 鉴权【未】生效。\n` +
        "   Tauri 外壳可能没把 CC_FLOW_AUTH_TOKEN 注入 sidecar，\n" +
        '   检查 client/src-tauri/src/sidecar.rs 的 .env("CC_FLOW_AUTH_TOKEN", ...)'
    );
  }
} catch (err) {
  fail(`探测失败：${err.message}`);
}

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
