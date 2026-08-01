# HANDOFF

状态: 进行中

## 当前任务

**Phase 15 + 16 代码完成**，v0.1.24 已安装并通过本机回归。

Phase 16（跨机语义）已完成 5/6 项，详见 DEV-PLAN。新增基础设施：
- `client/src/stores/connectionStore.ts` — 「连的哪台后端」的单一事实源
- `client/src/utils/hostPath.ts` — 按目标平台处理路径（10 个用例）
- `GET /api/system/host-info` — 后端上报自己的 platform/分隔符/大小写敏感性
- Rust `forward_remote_port` — 按需给远端端口开 SSH 转发（预览链接用）

**唯一未做项**：隧道中断时前端无明确提示（`http-chat.ts:48` 的重连状态机
没有「地址失效」概念，会永远以同样间隔重试同一地址）。

**下面这段是历史记录**：

**Phase 15 远程连接底座**：代码已完成，待打包安装后在真实桌面环境验证。

已完成：
- `scripts/verify-remote-tunnel.mjs` 端到端验证**全部通过**（WSL Ubuntu 靶机，
  真跨 OS：Windows 客户端 → Linux 后端）：隧道连通、鉴权 401/401/200、
  令牌不进远程命令行、ssh 断开后远端无残留
- `client/src-tauri/src/ssh.rs` — 隧道与远端后端生命周期
- `client/src-tauri/src/connection.rs` — 运行时连接策略，默认路径与改造前逐字一致
- `client/src/components/settings/remote-connection-panel.tsx` — 设置页配置面板
- **cargo test 21 passed（含真连靶机的集成测试）** / typecheck / lint 0 error

跑真实连接测试（默认 ignored）：
```bash
# 先保活 WSL 并起 sshd（见下方靶机说明）
cd client/src-tauri
CC_FLOW_TEST_SSH_KEY="C:/Users/Administrator/.ssh/cc-flow-wsl-test" \
  cargo test --lib -- --include-ignored --nocapture
```

**这个集成测试抓到了两个 Node 验证脚本盖住的问题**（别把它当可有可无的慢测删掉）：
1. 缺主机密钥策略 —— Node 脚本用了 `StrictHostKeyChecking=no`，生产不能那样写；
   默认的 `ask` 在 BatchMode 下必失败。现用 `accept-new`。
2. 私钥 ACL —— Windows 版 System32 OpenSSH 拒绝权限过开的私钥，而 Git Bash 的
   MSYS ssh **不检查** Windows ACL。症状是「终端里 ssh 连得通，应用里连不上」。

待验证（打包 v0.1.24 后）：
1. 设置页能保存远程配置
2. 重启后真的连上 WSL 靶机
3. 本机模式行为无变化（回归）

**未验证的部分**：对话功能在远程下没跑通过——WSL 靶机没装 Claude Code CLI。
后端起得来、鉴权通、隧道稳都已验证，但"远程真能对话"还差这一步。

## v0.1.23 发布记录（已完成）

- Release: https://github.com/LYGOLANG/fufan-cc-flow-releases/releases/tag/v0.1.23
- 端点 `releases/latest/download/latest.json` 实测返回 `"version": "0.1.23"`
- 安装包线上 HTTP 200，Content-Length 94642193 与本地一致
- **验签实测通过**：`node scripts/verify-signature.mjs`
  → `alg=ED, keyid=19d9f96e097fbd06`，应用内固化公钥能验过这个包
- 本机已安装 v0.1.23 并验证：鉴权 401 全绿、工作流排序正确、
  新模块（编排引擎 / auth / forkDecision / jsonlSanitize）确认进了安装包

线上此前停在 v0.1.19，这一版把 v0.1.20～v0.1.23 的改动一次带上。

## 已完成（全部已提交并推送，工作区干净）

**工作流编排引擎（DEV-PLAN Phase 12-14）**
- 内核：状态机 + StepRunner 抽象接口 + 可移植性守卫测试
- 接真实执行：事件流→Promise 适配层、chatHandler 接线、运行态 UI
- 编辑器：outputVar / onFailure 配置、前后端校验（含跨端一致性核验）
- 端到端实测过顺序执行与数据传递

**安全**
- 接口鉴权（Rust 生成令牌 → 环境变量 → sidecar → Tauri 命令 → 前端）
- 路径穿越与 scope 提权（hooks RCE、projectRoot 必填、assertSafeName 铺开）

**10 条已知问题全部清完**（详见 git log）

**Hooks** `.claude/hooks/` 下 7 个脚本已注册并实测。
**stop-gate.sh 故意未注册** —— 它 fail-closed，会 block 会话停止直到
code-reviewer 通过，应由用户明确选择开启。

**发布流程**：`scripts/verify-signature.mjs` 用应用内固化公钥端到端验签，
已接进 `release-update.mjs`，不通过即中止发布。替掉了原先那行文字提醒——
密钥对不上时产物看着完全正常，失败只发生在用户那侧，发布方收不到反馈。

测试 232 条，typecheck / lint(0 error) / 前端构建全绿。

## 已知限制（不要当成 bug 重新调查）

- **工作流步骤指定的 Agent 是「提示词点名」而非强制分派**：模型可以无视，
  填不存在的 Agent 名也不报错（已实测确认）。真正的强制分派需在 SDK 的
  agents(AgentDefinition) 层面声明约束。详见 REQUIREMENTS.md F5.3。

## 待规划功能

远程会话与会话共享（SSH / 共享会话）的调研成果在 REQUIREMENTS.md 第 4 节：
含「lumen 不是 SSH 工具」这一关键澄清、三个待用户拍板的决策点、
以及与「不监听端口」的冲突解法。**不要重新调研。**

三个决策点：
1. Guest 触发工具调用时权限卡弹给谁（建议只弹 Host）
2. 两端同时发消息如何处理（建议先到先执行、另一方排队）
3. 通道走 SSH 隧道还是自建中继（建议第一版走 SSH 隧道）

与 Product-Spec「运行期间无后端 TCP 监听」冲突，建议解法：
改为默认状态而非绝对约束。

## 回滚办法

若某版白屏或不可用：
- 重装上一版（`release/updates/AgentFlow_<ver>_x64-setup.exe` 有历史包）
- 或去掉 `client/src-tauri/src/sidecar.rs` 里的 `.env("CC_FLOW_AUTH_TOKEN", ...)`
  重新打包（后端无该变量即整体放行鉴权）

## 关键文件

- `server/src/services/workflow/` — 编排引擎（engine / stepRunner / claudeStepRunner / validate）
- `server/src/middleware/auth.ts` — 接口鉴权
- `server/src/services/forkDecision.ts` — 分叉判定（从 start() 抽出，有测试）
- `server/src/services/jsonlSanitize.ts` — 会话历史净化（与文件 IO 分离，有测试）
- `scripts/verify-auth.mjs` — 鉴权链路实测
- `scripts/verify-signature.mjs` — 发布验签（已接进 release-update.mjs）
- `scripts/install-desktop.ps1` — 独立进程安装（ASCII-only，见死路）

## 值得复查的模式：界面说谎

两类，都已各修一处，但模式本身值得长期警惕：

**① 把「不知道」当成「否定」** —— 见下节。

**② 同一份语义在前后端各存一份，各自演化。**
v0.1.25 修的「任务在跑但运行指示灭掉」，根因是前端 `TERMINAL_EVENTS` 比
后端那份多了个 `error`，于是运行中的局部失败（压缩失败、闪断超时、
工具报错）都会熄灯，而任务还在服务端跑着、还在计费。

判据：**界面说"没在跑"而实际在跑，比没有指示更糟** —— 用户会重复发送，
或以为可以直接关掉应用。任何"根据某个事件推断任务结束"的地方，
都要问一句：这个事件真的意味着结束了吗，还是只是"出了点问题"？

已知的同类多份定义（改一处要同步）：
- 模型显示名三处（见 CLAUDE.md）
- `TERMINAL_EVENTS` 前后端各一份 —— **语义不同，不要强行统一**，
  两边已加交叉注释说明

## 值得复查的模式：把「不知道」当成「否定」

v0.1.25 修的那个「每次启动误报未安装 CLI」，根因是探测失败的 catch 里写死
`{ installed: false }`。三态（未知 / 是 / 否）被压成两态，于是"后端还没起来"
和"确实没装"变得无法区分。

同类写法值得排查：任何 `catch { set({ xxx: false }) }` 或
`catch { return [] }`，只要调用方会据此显示结论性的 UI，就可能在
后端冷启动期间说谎。判据是问一句：**这个 false 是"查过了，没有"，
还是"没查到"？** 后者必须保持 null / undefined。

已修：`systemStore` 的 `loadClaudeInfo` / `loadCodexInfo`。

顺带教训：给 store 里的函数加可选参数后，务必 grep 一遍
`onClick={fn}` 这类直接当回调传的地方 —— React 会把事件对象塞给第一个参数。
这次四处「重新检测」按钮全中，而它们恰好是用户绕过该 bug 的唯一手段。

## 死路（别重走）

- WS 鉴权不能写在 connection 回调里 `ws.close()`：那时握手已完成，无令牌也能连上。
  必须用 `verifyClient` 在升级阶段拒绝。
- 编排每一步必须走 `handleClientMessage` 的完整 send_message 路径，不要自己拼
  `claude.start` —— 漏带字段会让常驻进程指纹对不上、白白杀进程重启。
- **`spawnFingerprint` 有两处刻意的例外**（`fallbackModel` 不入、`model` 只在第三方
  端点入），看着像遗漏但不是，"顺手修复"会架空进程复用。已有测试拦着。
- `install-desktop.ps1` 必须保持 ASCII-only：Windows PowerShell 在中文 locale 下按
  GBK 读 .ps1，UTF-8 中文会被误解析成引号导致脚本根本起不来且不留日志。
- server 的 test 脚本曾硬编码目录导致新测试静默不跑，现为 `src/**/*.test.ts`。
- Bash heredoc + python 改含反斜杠/控制字符的正则会被吞转义，用 Edit 或 Write。
- `pkill -f "tsx src/index.ts"` 杀不干净（tsx 派生子进程树），会留下无鉴权裸跑的
  孤儿后端，还会干扰 verify-auth 的端口探测。按命令行精确列出再逐个杀。
- 验证「签名/产物守卫」时别用 `cp` 还原备份：`cp` 会把 mtime 刷成当前时间，
  构造出的场景是假的（sig 反而比 exe 新），会误判成「守卫没拦住」。用 `touch`。
- **私钥的 Windows ACL**：System32 的 `ssh.exe` 拒绝权限过开的私钥，Git Bash 的
  MSYS `ssh` 不检查。所以「Git Bash 里连得通」证明不了应用里能连通——应用走的是
  System32 那个。修：`icacls <key> /inheritance:r /grant:r "Administrator:F"`。
- **WSL 实例会在空闲后整个关闭，sshd 随之消失**（表现为刚验证过的连接突然
  `Connection refused`）。测试前先起一个保活进程：
  `wsl -d Ubuntu-22.04 -- bash -lc "mkdir -p /run/sshd; /usr/sbin/sshd -e; sleep 3600"`
  （放后台跑）。
- **WSL 靶机（远程功能的测试环境）**：`wsl -d Ubuntu-22.04`，sshd 监听 2222，
  从 Windows 用 `ssh -i ~/.ssh/cc-flow-wsl-test -p 2222 root@127.0.0.1` 连入
  （**走 localhost 转发，不要用 WSL 的 172.x IP**——那条路被 Hyper-V 防火墙挡）。
  Node v22.11.0 装在 `/opt/node-v22.11.0-linux-x64`，后端部署在 `/opt/agent-flow-server`。
- **从 Git Bash 调 `wsl` 有两处路径/引号陷阱**：
  ① Git Bash 会把 `/mnt/c/...` 改写成 `C:/Program Files/Git/mnt/c/...`（MSYS 路径转换），
     必须前置 `MSYS_NO_PATHCONV=1`；
  ② `wsl -- bash -lc '<脚本>'` 里的单引号在 Windows 命令行层不生效，含空格的路径会被
     重新分割，脚本里的变量静默变成空串（症状：`mkdir: cannot create directory ''`）。
     把脚本写成文件再 `wsl -- bash <文件>` 传参，比内联字符串可靠得多。
- **WSL 的 `&` 后台进程会随 `wsl -- cmd` 结束被清理**：sshd 要用自带守护模式
  （`/usr/sbin/sshd` 不加 `-D`），否则下一条命令就发现它没了。
- **sshd 启动前必须有 `/run/sshd` 且属主 root:root 0755**：`/run` 是 tmpfs，
  WSL 实例重启即清空。缺了只报 `Missing privilege separation directory`。
- **Hyper-V 防火墙默认 Block 入站到 WSL**（WSL 2.5+，网卡名就叫
  `vEthernet (WSL (Hyper-V firewall))`）。症状极具误导性：**ping 得通**（ICMP 有放行规则）
  但 TCP 一律拒。加规则用 `New-NetFirewallHyperVRule -VMCreatorId '{40E0AC32-...}'`。
  本次加的测试规则名 `cc-flow-wsl-ssh-test`，删除：`Remove-NetFirewallHyperVRule -Name 'cc-flow-wsl-ssh-test'`。
  （实测走 localhost 转发时并不需要这条规则，留着仅为直连 IP 备用。）
- **node-gyp 的头文件走 `disturl`，与 npm registry 是两个设置**：设了
  `--registry=npmmirror` 后包下载飞快，编译却卡在
  `https://nodejs.org/download/release/vX/node-vX-headers.tar.gz` 直到 ETIMEDOUT。
  报错通篇是 node-gyp，看着像工具链坏了，实为网络。解法
  `npm_config_disturl=https://cdn.npmmirror.com/binaries/node`。
  `install-remote.sh` 已内置探测与自动回退。
- **WSL 继承的 Windows PATH 里含 `(x86)` 等括号**：`export PATH=/usr/local/bin:$PATH`
  不加引号会直接 `syntax error near unexpected token '('`。WSL 内脚本一律
  `export PATH="/usr/local/bin:/usr/bin:/bin"` 或给 `$PATH` 加引号。
- **node-pty 没有 linux 预编译二进制**：npm 包 `node-pty@1.1.0` 的 `prebuilds/` 只有
  darwin-arm64/x64 与 win32-arm64/x64。**不是打包裁剪的**，pnpm store 里也一样。
  所以远程 Linux 部署不能直接拷 Windows 的 `server-dist`，必须在目标机
  `npm install` 现场编译，前置依赖 `python3` + `build-essential`。
- 打包产物名带空格（`Agent Flow_x.y.z_x64-setup.exe`），发布时去空格
  （GitHub 会把资产名里的空格转成点，去空格才能让 latest.json 的 url 对得上）。
  签名 trusted comment 里记的是**带空格**的原名，这是正常的，tauri 验签不看文件名。
