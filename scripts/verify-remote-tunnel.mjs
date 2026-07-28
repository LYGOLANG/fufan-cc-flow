#!/usr/bin/env node
/**
 * 远程后端 + SSH 隧道的端到端验证。
 *
 * 验的是「桌面客户端连远程后端」这条链路的全部关键环节,一次跑完:
 *   1. 一条 ssh 同时建隧道并启动远程后端(进程退出则两者一并回收)
 *   2. 令牌经 stdin 送达,不进命令行 —— 远程机器上 `ps aux` 看不到它
 *   3. 隧道出口落在远程的 127.0.0.1,后端的绑定与 CORS 都无需放宽
 *   4. 鉴权真的生效:无令牌 401、错令牌 401、对令牌 200
 *   5. 退出后远程不残留进程
 *
 * 为什么要有这个脚本:这条链路横跨 ssh、远程 Node、端口转发和鉴权中间件,
 * 任何一环坏掉的表象都是「连不上」。手工排查每次都要从头试一遍,
 * 而这里每一步都单独断言,坏在哪一步一目了然。
 *
 * 用法:
 *   node scripts/verify-remote-tunnel.mjs \
 *     --host 127.0.0.1 --port 2222 --user root \
 *     --key ~/.ssh/cc-flow-wsl-test \
 *     --remote-dir /opt/agent-flow-server
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SSH_HOST = arg("host", "127.0.0.1");
const SSH_PORT = arg("port", "2222");
const SSH_USER = arg("user", "root");
const SSH_KEY = arg("key", `${process.env.USERPROFILE || process.env.HOME}/.ssh/cc-flow-wsl-test`);
const REMOTE_DIR = arg("remote-dir", "/opt/agent-flow-server");
const REMOTE_PORT = arg("remote-port", "3011");

let failures = 0;
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => {
  console.error(`  ❌ ${m}`);
  failures++;
};

/** 取一个当前空闲的本地端口作为隧道入口 */
function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(localPort, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${localPort}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) return true;
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(1000);
  }
  console.error(`     最后一次错误: ${lastErr}`);
  return false;
}

async function main() {
  const token = randomBytes(32).toString("hex");
  const localPort = await reservePort();

  console.log(`目标: ${SSH_USER}@${SSH_HOST}:${SSH_PORT}`);
  console.log(`隧道: 127.0.0.1:${localPort} -> 远程 127.0.0.1:${REMOTE_PORT}`);
  console.log(`远程目录: ${REMOTE_DIR}\n`);

  // 上一次失败可能留下裸跑的后端,它会占着端口让本次"就绪探测"连到旧进程上,
  // 从而测出一个完全虚假的通过。开跑前先清干净。
  const stale = await sshExec(`pgrep -x node 2>/dev/null | wc -l`).catch(() => "0");
  if (parseInt(stale.trim(), 10) > 0) {
    console.log(`清理上次残留的 ${stale.trim()} 个后端进程...`);
    await sshExec(`pkill -f 'dist/index.js' 2>/dev/null; true`).catch(() => {});
    await sleep(1500);
  }

  // 一条 ssh 干两件事:建立端口转发 + 在远端启动后端。
  // 令牌不写进命令行,而是由远端的 `read` 从 stdin 取——远程往往是多用户机器,
  // 命令行对 `ps aux` 全局可见,令牌一旦出现在那里,等于把完整接口权限
  // (读写文件/执行命令/读取存有 API Key 的配置)交给了那台机器上的所有人。
  // 关键:不能用 `exec node ...`。SSH 断开时远端进程不会自动收到信号,后端会一直
  // 留在服务器上裸跑——用户每开一次应用就多一个僵尸后端,而且它们还攥着端口。
  // 这里让包装 shell 读 stdin 直到 EOF(ssh 断开即 EOF),然后主动收掉子进程。
  const remoteCmd =
    `read -r CC_FLOW_AUTH_TOKEN; export CC_FLOW_AUTH_TOKEN; ` +
    `export PORT=${REMOTE_PORT}; ` +
    `cd ${REMOTE_DIR} || exit 1; ` +
    `node dist/index.js & ` +
    `NODE_PID=$!; ` +
    `trap 'kill -TERM $NODE_PID 2>/dev/null' EXIT INT TERM HUP; ` +
    `cat > /dev/null; ` + // 阻塞至 stdin 关闭
    `kill -TERM $NODE_PID 2>/dev/null; ` +
    `wait $NODE_PID 2>/dev/null`;

  const ssh = spawn(
    "ssh",
    [
      "-i", SSH_KEY,
      "-p", String(SSH_PORT),
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-L", `${localPort}:127.0.0.1:${REMOTE_PORT}`,
      `${SSH_USER}@${SSH_HOST}`,
      remoteCmd,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  let sshOut = "";
  ssh.stdout.on("data", (d) => (sshOut += d.toString()));
  ssh.stderr.on("data", (d) => (sshOut += d.toString()));
  ssh.on("error", (e) => fail(`ssh 启动失败: ${e.message}`));

  // 令牌走 stdin
  ssh.stdin.write(token + "\n");

  const cleanup = () => {
    try {
      ssh.kill();
    } catch {
      /* 已退出 */
    }
  };
  process.on("exit", cleanup);

  try {
    console.log("=== 1. 等待远程后端就绪 ===");
    const ready = await waitForHealth(localPort);
    if (!ready) {
      fail("远程后端未在 60 秒内就绪");
      console.error("\n--- ssh 输出 ---\n" + sshOut.slice(0, 2000));
      return;
    }
    pass("隧道连通,/api/health 可达");

    console.log("=== 2. 鉴权是否真的生效 ===");
    // 用 /api/providers:它是确定存在的 GET 端点(verify-auth.mjs 也用它)。
    // /api/projects 只挂了 POST 子路径,GET 它会得到 404 而非 401,
    // 那样测出来的"鉴权通过"其实什么都没证明。
    const AUTHED = "/api/providers";
    const noToken = await fetch(`http://127.0.0.1:${localPort}${AUTHED}`, {
      signal: AbortSignal.timeout(5000),
    });
    noToken.status === 401
      ? pass("无令牌 → 401")
      : fail(`无令牌应 401,实得 ${noToken.status}`);

    const badToken = await fetch(`http://127.0.0.1:${localPort}${AUTHED}`, {
      headers: { "x-cc-flow-token": "wrong-token" },
      signal: AbortSignal.timeout(5000),
    });
    badToken.status === 401
      ? pass("错误令牌 → 401")
      : fail(`错误令牌应 401,实得 ${badToken.status}`);

    const good = await fetch(`http://127.0.0.1:${localPort}${AUTHED}`, {
      headers: { "x-cc-flow-token": token },
      signal: AbortSignal.timeout(5000),
    });
    good.ok
      ? pass(`正确令牌 → ${good.status}`)
      : fail(`正确令牌应 2xx,实得 ${good.status}`);

    console.log("=== 3. 令牌是否泄漏进远程进程列表 ===");
    // 直接读后端进程自己的 cmdline,而不是 `ps aux | grep <token>`——后者的
    // grep 命令行本身就含令牌,必然自命中,数出来的永远是假阳性。
    // 只查 cmdline 不查 environ:环境变量仅同用户可读,而 cmdline 对 `ps aux` 全局可见,
    // 后者才是真正的泄漏面。
    const cmdlines = await sshExec(
      `for p in $(pgrep -f 'dist/index.js' 2>/dev/null); do tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null; echo; done`,
    );
    if (!cmdlines.trim()) {
      fail("没找到远程后端进程,无法检查令牌泄漏");
    } else if (cmdlines.includes(token)) {
      fail("令牌出现在远程后端的命令行里(ps aux 全局可见)");
    } else {
      pass(`远程后端命令行不含令牌: ${cmdlines.trim().split("\n")[0].slice(0, 60)}...`);
    }

    console.log("=== 4. 远端确实是另一台机器 ===");
    const uname = await sshExec("uname -s -m");
    pass(`远端系统: ${uname.trim()} (本机 ${process.platform})`);
  } finally {
    console.log("=== 5. 清理 ===");
    cleanup();
    // 给远端包装 shell 一点时间响应 stdin EOF 并收掉子进程
    await sleep(3000);
    const left = await sshExec(
      `pgrep -x node 2>/dev/null | wc -l`,
    ).catch(() => "?");
    const n = parseInt(left.trim(), 10);
    if (n === 0) {
      pass("ssh 断开后远程无残留后端进程");
    } else {
      fail(`远程残留 ${n} 个后端进程 —— 用户每开一次应用就会多堆一个`);
      await sshExec(`pkill -f 'dist/index.js' 2>/dev/null; true`).catch(() => {});
      console.log("     (已强制清理,以免影响下次验证)");
    }
  }
}

/** 另开一条 ssh 执行诊断命令(不复用隧道那条,避免干扰它) */
function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "ssh",
      [
        "-i", SSH_KEY,
        "-p", String(SSH_PORT),
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "BatchMode=yes",
        `${SSH_USER}@${SSH_HOST}`,
        cmd,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", reject);
    p.on("close", () => resolve(out));
  });
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? "\n✅ 全部通过:远程后端 + SSH 隧道链路可用"
        : `\n❌ ${failures} 项失败`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("验证脚本异常:", e);
    process.exit(1);
  });
