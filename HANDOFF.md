# HANDOFF

状态: 进行中

## 当前任务

v0.1.20 打包 + **桌面端鉴权链路实测**。这是接口鉴权改动的最后一环，前面所有
验证都是在裸后端上做的，真正的桌面链路只有装上才能验。

## 已完成（均已提交，工作区干净）

| commit | 内容 |
|---|---|
| `5a65614` | settingSources 补 local（「始终允许」重启后失效）、转发 permission_timeout（权限卡永久卡死）、修长会话自动滚动被永久锁死 |
| `c124de6` | 路径穿越与 scope 提权：hooks RCE、projectRoot 改必填、10 处 name 加 assertSafeName、scope 白名单、teamService 同前缀绕过、统一错误出口 |
| `830dd83` | 接口鉴权：Tauri 生成令牌注入 sidecar，REST 走 header、WS 走 verifyClient；files/content 限定读取范围 |
| （最新） | 令牌获取改 allSettled，避免拖垮端口解析；版本升 0.1.20 |

线上已发布版本：**v0.1.19**（GitHub Releases，含 STATUS_BREAKPOINT 根治）。
v0.1.20 尚未发布。

## 下一步（按顺序）

1. **打包 v0.1.20**（若尚未完成）
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat 'D:/cc-flow-secrets/fufan-ccflow.key')"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   pnpm package:desktop
   ```
   必须带签名密钥，否则不生成 updater 产物（`.sig`）。

2. **安装并实测鉴权链路** ← 卡在这里的原因见下方「注意」
   装完后要验证三件事：
   - 应用能正常加载（不是白屏）。白屏 = 前端没拿到令牌，
     去 DevTools console 找 `[desktop] failed to resolve auth token`
   - 日志 `%LOCALAPPDATA%\com.fufan.ccflow\logs\Agent Flow.log` 里应有
     `[auth] 接口鉴权已启用`
   - 外部 curl 打后端应被拒：
     ```bash
     # 端口是随机的，从日志里找 "server running on http://127.0.0.1:<port>"
     curl -s --noproxy '*' http://127.0.0.1:<port>/api/providers -w " <- %{http_code}"
     # 期望 401
     ```

3. 实测通过后再决定是否发布 v0.1.20（发布流程见下）

## 注意（重要）

- **安装需要关闭 Agent Flow，而助手的会话跑在它的 sidecar 里**
  （`PORT` 环境变量继承自桌面版，实测 51815）。关掉应用 = 会话断开。
  所以这一步通常需要用户自己执行，或者接受会话中断。
- 打包前确认没有残留 sidecar `node.exe` 占着 `server-dist`，否则 EBUSY。
  按命令行精确 kill，**不要**按进程名批量杀（会误杀用户的其它 node 进程）。

## 发布流程（实测可用）

```bash
node scripts/release-update.mjs --notes "$(cat <notes.md>)"
gh release create v0.1.20 --repo LYGOLANG/fufan-cc-flow-releases \
  --title "..." --notes-file <notes.md> \
  "release/updates/AgentFlow_0.1.20_x64-setup.exe" \
  "release/updates/latest.json"
```

发布前必查（曾经差点踩坑）：
- `.sig` 的 mtime 必须 >= `.exe` —— `release-update.mjs` 分别按文件名找两者，
  不校验是否同一次构建。不带签名密钥打包时 NSIS 会覆盖 exe 但留下旧 `.sig`，
  发出去所有人验签失败。
- 应用内固化公钥与签名私钥必须配对（`tauri.conf.json` 的 `plugins.updater.pubkey`
  base64 解码后应等于 `D:/cc-flow-secrets/fufan-ccflow.key.pub` 解码后的内容）。

## 关键文件

- `server/src/middleware/auth.ts` — 鉴权判定（含 6 条单测）
- `client/src-tauri/src/sidecar.rs` — 令牌生成 + 环境变量注入
- `client/src/main.tsx` — 前端取令牌（渲染前必须完成）
- `client/src/services/endpoint.ts` — `authHeaders()` / `withAuthQuery()`
- `server/src/utils/pathUtils.ts` — `assertSafeName` / `assertWithinRoot`

## 死路（别重走）

- WS 鉴权**不能**写在 `connection` 回调里 `ws.close()`：那时握手已完成，
  无令牌也能连上。必须用 `verifyClient` 在升级阶段拒绝。已实测确认。
- server 的 test 脚本原先硬编码 `src/services/*.test.ts src/utils/*.test.ts`，
  新目录的测试会静默不跑。已改为 `src/**/*.test.ts`。
- Bash heredoc + python 改含反斜杠/控制字符的正则会被吞转义，
  用 Edit 工具或 Write 整文件重写。

## 尚未处理的已知问题（按优先级）

1. 闪断后永久卡「正在思考…」（`task_complete` 在断线窗口被丢弃，重连时
   `isTurnActive()` 已为 false，重同步分支不触发）
2. 断线时点「停止」/「允许」帧被静默丢弃，但 UI 已标记为成功
3. 新会话第一条消息后立刻点停止无效（`activeSessionId` 还是 null）
4. Codex 引擎下「压缩上下文」是假的（`/compact` 被当普通 prompt 发出去，
   后端那 50 行 `case "compact"` 完全不可达）
5. 「扩展思考」开关关掉等于没关（无 `type:"disabled"` 分支）
6. `costCalculator` 漏了 opus：`claude-opus-5` 会被判 200K，
   导致自动压缩在真实用量 ~19% 时就触发
7. `hooksStore` 乐观更新且失败不回滚（界面说谎）
8. 三个 `runClaude`（mcp/plugin/marketplace）无超时，Promise 永不 settle
9. 打包缺 `mtime(sig) >= mtime(exe)` 守卫
10. 对话主链路零测试（`claudeAgentService` 1392 行、`sessionManager` 961 行）
