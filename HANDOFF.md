# HANDOFF

状态: 进行中

## 当前任务

打包 v0.1.23 并安装验证。

安装会切断助手会话（助手跑在 Agent Flow 的 sidecar 里），故用独立脚本执行：

```bash
powershell -ExecutionPolicy Bypass -File scripts/install-desktop.ps1 \
  -Installer "release/Agent Flow_0.1.23_x64-setup.exe"
```

该脚本以独立进程运行「关闭 → 清 sidecar → 静默安装 → 校验版本 → 重启」，
助手断线后仍会跑完。日志：`%LOCALAPPDATA%\com.fufan.ccflow\install.log`。

## 装完请确认

1. **应用正常打开**（白屏 = 前端没拿到鉴权令牌，回滚办法见文末）
2. **鉴权链路**：`node scripts/verify-auth.mjs`
   期望：无令牌 401、伪造令牌 401、`/api/health` 200。
   （脚本已改为探测端口 + 看实际行为，不再依赖会轮转的日志）
3. **工作流编排**：右侧「工作流」→ 列表按名称排序 → 点「🏦 量化总流程」▷，
   应看到步骤逐个执行，第 2 步等第 1 步的 `run_flow.py` 真正结束才启动

## 已完成（全部已提交，工作区干净）

**工作流编排引擎（DEV-PLAN Phase 12-14）**
- 内核：状态机 + StepRunner 抽象接口 + 可移植性守卫测试
- 接真实执行：事件流→Promise 适配层、chatHandler 接线、运行态 UI
- 编辑器：outputVar / onFailure 配置、前后端校验（含跨端一致性核验）
- 端到端实测过顺序执行与数据传递

**安全**
- 接口鉴权（Rust 生成令牌 → 环境变量 → sidecar → Tauri 命令 → 前端）
  已在 v0.1.22 真实桌面环境验证通过
- 路径穿越与 scope 提权（hooks RCE、projectRoot 必填、assertSafeName 铺开）

**10 条已知问题全部清完**（详见 git log）
闪断卡死 / 断线丢帧 UI 说谎 / 新会话立刻停止无效 / Codex 压缩是假的 /
扩展思考开关无效 / 上下文窗口漏判 opus-5 / hooks 界面说谎 / 三条命令无超时 /
打包陈旧签名 / 主链路零测试

**Hooks**
`.claude/hooks/` 下 8 个脚本此前**从未生效**（settings.json 的 hooks 为空，
而该目录不会被自动发现）。已注册 7 个并逐个实测。
**stop-gate.sh 故意未注册** —— 它 fail-closed，会 block 会话停止直到
code-reviewer 通过，应由用户明确选择开启。

测试 232 条，typecheck / lint(0 error) / 前端构建全绿。

## 已知限制（不要当成 bug 重新调查）

- **工作流步骤指定的 Agent 是「提示词点名」而非强制分派**：模型可以无视，
  填不存在的 Agent 名也不报错（已实测确认）。真正的强制分派需在 SDK 的
  agents(AgentDefinition) 层面声明约束。详见 REQUIREMENTS.md F5.3。

## 待规划功能

远程会话与会话共享（SSH / 共享会话）的调研成果在 REQUIREMENTS.md 第 4 节：
含「lumen 不是 SSH 工具」这一关键澄清、三个待用户拍板的决策点、
以及与「不监听端口」的冲突解法。**不要重新调研。**

三个决策点：权限卡弹给谁、两端同时发消息如何处理、通道走 SSH 隧道还是自建中继。

## 回滚办法

若 v0.1.23 白屏或不可用：
- 重装 v0.1.19（线上版本，`release/updates/AgentFlow_0.1.19_x64-setup.exe`）
- 或去掉 `client/src-tauri/src/sidecar.rs` 里的 `.env("CC_FLOW_AUTH_TOKEN", ...)`
  重新打包（后端无该变量即整体放行鉴权）

## 关键文件

- `server/src/services/workflow/` — 编排引擎（engine / stepRunner / claudeStepRunner / validate）
- `server/src/middleware/auth.ts` — 接口鉴权
- `server/src/services/forkDecision.ts` — 分叉判定（从 start() 抽出，有测试）
- `server/src/services/jsonlSanitize.ts` — 会话历史净化（与文件 IO 分离，有测试）
- `scripts/verify-auth.mjs` — 鉴权链路实测
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
