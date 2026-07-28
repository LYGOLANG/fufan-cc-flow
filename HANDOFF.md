# HANDOFF

状态: 进行中

## 当前任务

v0.1.23 已发布到 GitHub Releases。下一步待用户拍板：做远程会话/共享会话功能。

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
- 打包产物名带空格（`Agent Flow_x.y.z_x64-setup.exe`），发布时去空格
  （GitHub 会把资产名里的空格转成点，去空格才能让 latest.json 的 url 对得上）。
  签名 trusted comment 里记的是**带空格**的原名，这是正常的，tauri 验签不看文件名。
