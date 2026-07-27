# HANDOFF

状态: 进行中

## 当前任务

安装 v0.1.22 并验证。安装过程会切断助手会话（助手跑在 Agent Flow 的 sidecar 里），
故用独立进程执行「关闭 → 安装 → 重启」。

## 装完请确认这几件事

1. **应用能正常打开**（不是白屏）
   白屏 = 前端没拿到鉴权令牌 → 打开 DevTools console 找
   `[desktop] failed to resolve auth token`。回滚办法见文末。

2. **鉴权链路**（新增，本版第一次实装）
   ```bash
   node scripts/verify-auth.mjs
   ```
   期望：日志显示「接口鉴权已启用」、外部调用全部 401、`/api/health` 仍 200。

3. **工作流编排**（本版核心新功能）
   打开右侧「工作流」标签页：
   - 列表应按名称排序（①②③④⑤⑥ 按序，此前是乱的）
   - 点「🏦 量化总流程」的 ▷ → 应看到步骤逐个执行，第 2 步等第 1 步的
     `run_flow.py` 真正结束才启动
   - 运行中可点 × 停止；某步失败会停下来问「重试/跳过/中止」

## 本轮已完成（均已提交）

工作流编排引擎 Phase 12-14 全部完成：
- Phase 12 内核：状态机 + StepRunner 抽象接口 + 22 条测试 + 可移植性守卫
- Phase 13 接真实执行：事件流→Promise 适配层、chatHandler 接线、运行态 UI
- Phase 14 编辑器：outputVar / onFailure 配置、前后端校验（含跨端一致性核验）

安全与缺陷修复：
- 接口鉴权（Tauri 生成令牌注入 sidecar，REST 走 header、WS 走 verifyClient）
- 路径穿越与 scope 提权（hooks RCE、projectRoot 必填、assertSafeName 铺开）
- settingSources 补 local（「始终允许」重启后失效）
- permission_timeout 转发（权限卡永久卡死）
- 长会话自动滚动被永久锁死
- 后台任务/审计倒序、工作流列表排序

测试 174 条，typecheck / lint(0 error) / 前端构建全绿。

## 已知限制（重要，不要当成 bug 重新调查）

- **步骤指定的 Agent 是「提示词点名」而非强制分派**。实现把 Agent 名字包装进
  提示词交给主会话，模型可以无视、自己把活干了；填一个不存在的 Agent 名也
  不会报错（已实测确认）。真正的强制分派需在 SDK 的 agents(AgentDefinition)
  层面声明约束，属后续改进。详见 REQUIREMENTS.md F5.3。

## 尚未处理的已知问题（按优先级）

1. 闪断后永久卡「正在思考…」（task_complete 在断线窗口被丢弃，重连时
   isTurnActive() 已为 false，重同步分支不触发）
2. 断线时点「停止」/「允许」帧被静默丢弃，但 UI 已标记为成功
3. 新会话第一条消息后立刻点停止无效（activeSessionId 还是 null）
4. Codex 引擎下「压缩上下文」是假的（/compact 被当普通 prompt 发出去）
5. 「扩展思考」开关关掉等于没关（无 type:"disabled" 分支）
6. costCalculator 漏了 opus：claude-opus-5 会被判 200K，导致自动压缩在真实
   用量 ~19% 时就触发
7. hooksStore 乐观更新且失败不回滚（界面说谎）
8. 三个 runClaude（mcp/plugin/marketplace）无超时
9. 打包缺 mtime(sig) >= mtime(exe) 守卫
10. 对话主链路零测试（claudeAgentService 1392 行、sessionManager 961 行）

## 待规划功能

远程会话与会话共享（SSH / 共享会话）的调研成果已落盘在
REQUIREMENTS.md 第 4 节，含 lumen 不是 SSH 工具这一关键澄清、三个待拍板
决策点、与「不监听端口」的冲突解法。不要重新调研。

## 回滚办法

若 v0.1.22 白屏或无法使用：
- 重装 v0.1.19（线上版本，`release/updates/AgentFlow_0.1.19_x64-setup.exe`）
- 或临时去掉 `client/src-tauri/src/sidecar.rs` 里的
  `.env("CC_FLOW_AUTH_TOKEN", ...)` 重新打包（后端无该变量即整体放行鉴权）

## 关键文件

- `server/src/services/workflow/` — 编排引擎（engine / stepRunner / claudeStepRunner / validate）
- `server/src/middleware/auth.ts` — 接口鉴权
- `server/src/websocket/chatHandler.ts` — workflow_start/resolve/abort 接线
- `client/src/components/agent/WorkflowManager.tsx` — 编辑器 + 运行态面板
- `scripts/verify-auth.mjs` — 鉴权链路实测脚本

## 死路（别重走）

- WS 鉴权不能写在 connection 回调里 ws.close()：那时握手已完成，无令牌也能
  连上。必须用 verifyClient 在升级阶段拒绝。
- 编排的每一步必须走 handleClientMessage 的完整 send_message 路径，不要自己
  拼 claude.start —— 漏带字段会让常驻进程指纹对不上、白白杀进程重启。
- server 的 test 脚本曾硬编码目录导致新测试静默不跑，现已改为 src/**/*.test.ts。
- Bash heredoc + python 改含反斜杠/控制字符的正则会被吞转义，用 Edit 或 Write。
