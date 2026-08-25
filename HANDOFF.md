# HANDOFF

状态: 进行中

## 当前任务

## 【2026-08-25】用户报四个 bug，正在逐个处理（macOS 本机）

环境：用户改在 **macOS**（aarch64）上使用，本机版本 0.1.51 → 已拉到 **0.1.53**。
用户是**在 Agent Flow 里跟 Claude 对话**的，所以每次重装都会掐断当轮会话。

### Bug 1 ✅ 已修（上游 `3803448`，非本地改动）— 待装机验证

**症状**：图片、视频不显示也放不大。

**根因**：`<img>` / `<video>` 的请求由浏览器直发，**带不了自定义请求头**，
而桌面版后端开着鉴权（`sidecar.rs` 注入 `CC_FLOW_AUTH_TOKEN`），于是每一次
媒体请求都被自己的 `authMiddleware` 401 挡掉。前端 `MarkdownRenderer` 的
`onError` 只是 `if (broken) return null` —— **静默隐藏**，401 / 文件不存在 /
路径写错在界面上完全无法区分，控制台也不出声。这是「界面说谎」的又一实例。

视频则是**根本没实现**：后端 `IMAGE_TYPES` 只认 9 个图片扩展名，`.mp4` 直接 415；
前端把 `![](out.mp4)` 渲染成必然失败的 `<img>`，再被静默吞掉。

**修法**（上游已提交，本地 `git pull` 即得）：媒体 URL 改走 `withAuthQuery`
（令牌走 query，后端 `extractToken` 本来就支持 `?token=`）；后端补
video/audio MIME + `Accept-Ranges` 分段；新增 `MediaPreview.tsx` +
`mediaPaths.ts`（把散在三处的识别正则收口，带 108 行测试）。

**验证**：typecheck 0 error；client 103 测试全过，**已确认新测试真的被收集**
（阳性对照：`✔ 媒体 URL 构造必须经过 withAuthQuery`、`✔ 视频与音频都能认出来`）。

⚠️ **这个 bug 在 `pnpm dev` 下永远复现不了** —— dev 模式不注入令牌、鉴权整体关闭。
又一次「验证环境比生产宽松，那个维度上的 bug 就结构性地看不见」。

### Bug 2 🔍 未定位 —— 切换会话后消息列表是空的

**症状（用户原话）**：「就是切换会话的时候，打开的是什么东西都没有」。

注意：用户最初描述为「回答过程中回复框文字会消失」，追问后才澄清是**切换会话**。
第一轮子 Agent 按「输入框/流式气泡」查了一遍，**方向是错的**（但捞出了 Bug 4）。

**三个待验假设**（子 Agent 正在查，会话被重装打断，结论未落盘）：
- **A. 又是鉴权 401**：与 Bug 1 同源。查历史加载请求是否漏带令牌，
  以及 `catch` 里是不是 `return []` / `setMessages([])` —— 项目记录在案的
  反模式「把『不知道』当成『否定』」，加载失败被渲染成「这个会话本来就是空的」。
- **B. macOS 路径哈希对不上**：项目原本在 Windows 开发，会话 JSONL 按项目路径
  哈希定位（HANDOFF 旧条目：「Windows 下路径哈希先将 `\` 转换为 `/`」）。
  在 macOS 上算出的目录可能与实际不符 → 找不到文件 → 返回空。
- **C. 切换时清空了但没触发重新加载**：`useWebSocket` 的 effect 依赖**只有
  `[projectPath]`**，sessionId 变化不会让它重跑。要查清 sessionId 变化时
  到底谁负责拉历史。

相关文件：`chatStore.ts:408-419 loadHistoryMessages`、`chatStore.ts:456-460`
（persist 只存 `currentSessionId`）、`server/src/routes/sessions.ts`、
`jsonlSanitize.ts`、`utils/pathUtils.ts`。

### ✅ 滚动不跟随：真正的根因是「设计里存在永久性死状态」

**用户实报**：发送消息 / 接收回复时视口都不跟到底部，必须手动滚才能看到；
切换会话打开是空白。用户原话：「hi 是我滚动到底部才看见的」——
**内容一直在，就是视口不动**。

**根因（第七次才找对，前六次全错，见下方复盘）**：
历代实现都用一个**布尔标志**表示「要不要跟随」，而这个标志一旦被误置为
「用户想上翻」，自动跟随就**永久关闭且不可恢复**。三代死状态来源：

1. `userScrolledUp = !atBottom` —— 把「程序化滚动收敛途中不在底部」当成用户上翻
2. `scrollTop < lastTop → 停止跟随` —— 把浏览器夹住 scrollTop、macOS 橡皮筋
   回弹、内容回缩（工具卡折叠）当成用户上翻
3. 钉住循环的启动被写在 `if (!following) return` **之后** ——
   标志一旦为假，连补救机制都启动不了，**补救被它要补救的状态锁死**

前两条本质都是**猜用户心思**，而猜错的代价是功能彻底失效且不自愈 ——
代价与收益完全不成比例。

**修法**（`utils/scrollFollow.ts` + `hooks/useAutoScroll.ts`）：
- 布尔开关 → **带过期时间的暂停**：用户明确上翻暂停 5 秒，持续上翻续期，
  停手自动恢复；回到底部 / 发消息 / 切会话立即恢复。
  **任何误判最多影响 5 秒，之后必然自愈 —— 不存在死状态。**
- **滚轮噪声过滤**：小于 8px 的向上增量一律忽略。macOS 触控板惯性与橡皮筋
  会在用户**向下滚**的过程中夹带一串向上的碎小增量，不过滤的话
  一次正常下滚就能把跟随关掉。
- **钉住循环**：内容一变就每帧 `el.scrollTop = el.scrollHeight`，
  持续 1.5 秒（发送/切会话 3 秒）。**无条件启动**，该不该真滚由循环内部
  每帧自判 —— 这是铁律 ②。
  为什么不是「内容变了 scrollTo 一次」：单次滚动要求调用那一刻就知道最终高度，
  而这个前提从不成立（Markdown 排版落定、代码高亮异步着色、图片视频加载完
  才撑开、工具卡展开、字体替换回流全在滚动之后）。与其枚举「什么时候补一次」，
  不如每帧都钉，对所有异步撑高天然免疫。

11 条单测全部围绕「不存在永久关闭状态」这一性质。**改动时不要把它改回布尔标志。**

### 同轮修掉的另外两条（独立问题）

1. **`content-visibility: auto` 已彻底移除**（`2cc8dd6` 引入的长会话优化）。
   WebKit 双内核实测：开启时 scrollHeight 被低估 35~47%
   （15128/19643 vs 真值 28703/30051），且用户截图实证**整个聊天区不绘制**
   （滚动条显示有内容，但一个像素都没画）。曾试过「只在 WebKit 上按 UA 关闭」，
   装机后症状照旧 —— 说明这条声明的风险不是条件判断能兜住的。
   **它换来的只是一点滚动流畅度，代价是界面直接空白，不要再加回来。**
   长会话真卡了，用虚拟滚动这类可控方案。
2. **用户附件的图片渲染 + 点击放大**。`UserBubble` 此前只把附件渲染成
   文件名小标签，图片本体从来不显示、也点不开。注意它与「AI 消息里引用的图片」
   是**两条独立链路** —— 上游 `3803448` 修的是后者（鉴权 401），
   这条从来没实现过。现走 `MediaPreview`（新增 `UserAttachments`），
   并给 `MediaPreview` 补了 `ImageLightbox`（此前只有视频有灯箱）。
   ✅ 用户已确认「图片处理好了」。

### ⚠️⚠️ 本轮最贵的教训：六次误判，每次都配了一套自证有效实则无效的验证

按时间顺序，六次错误根因 + 六套失效的验证手段：

| # | 错误假设 | 验证手段 | 为什么无效 |
|---|---|---|---|
| 1 | 滚动状态机时间窗错误 | 13 条纯逻辑单测 | 反向验证有效，但测的是**不存在的 bug** |
| 2 | 同上 | Playwright + **Chromium** | **生产是 WebKit，内核不对，结构性免疫** |
| 3 | content-visibility（WebKit） | Playwright + WebKit | 内核对了，但测试台是自己捏的假列表 |
| 4 | 同上（加异步撑高） | WebKit + 异步撑高测试台 | 新旧实现**都 6/6 通过**，仍复现不出 |
| 5 | 布局被输入框遮挡 | 后端埋点日志 | **日志行被 Rust sidecar 截断**，从残缺数据读出「dist 全是 0」 |
| 6 | WebKit 重绘失效 | 录屏逐帧比对 | 结论正确（重绘正常），但方向仍错 |

**共同点：每次都用一个没被检验过的手段去检验结论，拿到绿灯就信了。**
连安装脚本都是假的 —— 它靠版本号判断成功，而每次构建版本号都是 0.1.53，
**那个检查恒真**。已改为**二进制 sha256 比对**。

**真正推进方向的只有两步**：
- **录屏逐帧比对**（`screencapture` 连拍 + `sips` 裁剪 + 哈希比对）：
  证明了激活标签页里跟随正常、重绘正常，把方向从「滚动逻辑」逼到别处
- **用户截图 + 一句「hi 是我滚到底才看见的」**：直接定死「内容在、视口不动」

**下次遇到 UI 类 bug 的正确顺序**：先要用户的**录屏**（不是静态截图、
不是文字描述），再谈假设。文字描述和静态截图，我已经反复证明自己解读不可靠。

**环境事实**（排查同类问题必读）：
- 生产是 **Tauri 的 WKWebView**。Playwright 的 chromium **和** webkit
  都复现不出这个问题 —— 别指望本地测试台能替代真机验证
- WKWebView 的 console **读不到**（不进 Rust 日志、无 CDP，只认 Safari Web Inspector）
- `screencapture` 的屏幕录制授权**绑二进制签名，每次重装即失效**，
  需要用户重新授权
- macOS 触控板会在向下滚动时夹带向上的碎小 wheel 增量，任何
  「靠 deltaY 方向判断用户意图」的逻辑都必须设噪声阈值

### Bug 3 原始调查（下面这段是修改前的分析，结论未被证实）

**症状**：按 Enter 或点发送，消息列表不会自动滚到底部。

**已查明的事实**（别重查）：
- 全部逻辑只在 `client/src/hooks/useAutoScroll.ts`（173 行）+
  `MessageList.tsx`（`:37` 接入、`:40-60` 发送强制滚底、`:84-93` 容器、
  `:172` content-visibility）。**无虚拟滚动库**。
- **发送时确实有强制滚底**：`useAutoScroll.ts:167 scrollToBottom()` 会把
  `userScrolledUp` 重置为 false 再滚。所以「用户上翻过一次就永远不跟随」
  这个直觉假设**不成立**，真正要查的是「强制滚底之后是否被立刻打回」。
- 祖先链全是 `overflow-hidden`，滚动容器唯一，`scrollTo` 不会作用错对象。
- 全项目无 `scroll-behavior` / `overflow-anchor` 设置。

**两条候选机制**：
1. **滚到了但没到真底**：`MessageList.tsx:172` 的
   `content-visibility:auto` + `contain-intrinsic-size: auto 140px` 让视口外
   消息一律按 140px 估算，而真实消息普遍 200~600px → `el.scrollHeight` 是
   **被严重低估的移动靶**，一次 `scrollTo` 落在「当时以为的底部」，靠
   ResizeObserver 迭代补位收敛。
2. **收敛途中被自己判成「用户上翻」**：`useAutoScroll.ts:119`
   `userScrolledUp.current = !atBottom` 把「此刻不在底部」直接等同于
   「用户想往回看」，而收敛过程中本来就合法地不在底部。一旦某个 scroll 事件
   落在 150ms 抑制窗口（`SUPPRESS_MS.auto`）之外，标志被置真，此后
   `useLayoutEffect`（`:124`）和 ResizeObserver（`:137`）两条补位路径
   第一行都是 `if (userScrolledUp.current) return`，**全部熄火**。

**核心判断**：用**时间窗**（150ms）去守一个本质上是**状态**的条件
（「程序化滚动还在收敛中」），这个原语从一开始就是错的 —— 收敛要几轮取决于
布局多久落定，长会话轻松超过 150ms。

⚠️ **这段代码已被修过两次，每次都在修上一次改出来的回归**
（`5a65614` → `15c25cc` → `7a54c10`），别再凭感觉糊第三层。
建议修法：把 `suppressUntil` 时间窗换成显式的「程序化滚动进行中」状态，
只有真正抵达底部、或用户通过 wheel/touch 表达明确上翻意图时才清除；
并按项目惯例（`taskErrorCodes.ts` / `forkDecision.ts` / `mediaPaths.ts`）
把判定抽成纯函数 + 单测——**本机没有 Playwright，滚动只能靠纯逻辑单测取证**。

**待用户回答的关键问题**（改错就是第三次回归）：按下 Enter 后列表是
① 完全没动 / ② 动了一下但停在半路 / ③ 到底了但之后 AI 输出时不跟随；
以及是每次都发生还是只在长会话/先上翻过时发生。

### Bug 4 📌 已发现未处理 —— 多轮回答时上一轮文字被下一轮覆盖

**这是子 Agent 查 Bug 2 时顺带捞出来的独立真 bug**，对得上用户最初那句
「回答过程中文字会消失」。**是推理链，尚无实证，动手前先复现。**

`chatStore.ts:184` 的 `updateAssistantContent` 是**整体替换**语义
（`content: text`）而非追加。而后端 `new_turn`（该换新气泡了）的时机
**永远滞后一轮**：
- `new_turn` 只在**完整 assistant 消息**分支发出（`claudeAgentService.ts:1157`），
- 而 `assistant_text`（`:1312`）/ `tool_use_start`（`:1335`）来自
  `stream_event`，**到得更早**，
- 加上 `this.lastMessageId !== null` 守卫使**第 1 轮一定不发** `new_turn`，
  整条链被永久推后一轮。

结果：第 2 轮的文字提交进第 1 轮的气泡，把第 1 轮已显示的文字原地抹掉。
**只在带工具调用的多轮回答里出现**，单轮纯文本不触发 —— 所以它藏得住。

同一份报告还记了两个相关隐患：
- `useWebSocket.ts:619-627` `case "error"`：`accumulatedText` 为空时
  `updateAssistantContent(errorText)` 会把该气泡**已提交的全部文字**
  替换成一行错误提示（不是追加）。
- `useWebSocket.ts:156-157` `case "session_init"`：**无条件清空
  `accumulatedText` 且事先不提交**，而服务端在断线重连、任务仍在跑时会
  **补发 session_init**（`chatHandler.ts:377-384`）→ 已渲染的实时文字整段蒸发。

### 本轮踩的两个坑（macOS 打包）

1. **`cmd | tail` 会把失败伪装成成功** —— pipeline 退出码取最后一节。
   一次 `tauri build` 明明 exit 1，因为套了 `| tail -300` 报成 exit 0，
   差点当成打包成功。打包一律 `> log 2>&1; echo $?`。
   （同类：用 `tail -30` 截断后的日志去 grep「新测试跑了没」，得到 0 命中
   —— 搜的是残缺日志，**验证手段本身没被验证**，这是第 N 次。）
2. **macOS dmg 打包会被同名挂载卷卡死**：`bundle_dmg.sh` 固定挂到
   `/Volumes/<productName>`，只要有任何一个旧版本 dmg 还挂着（双击开过、
   或上一轮打包被 kill 在半路），新包必挂，且报错只有一句
   `failed to run bundle_dmg.sh`，**不提卷名**。
   打包前先 `hdiutil detach "/Volumes/Agent Flow"`，并清 `bundle/macos/rw.*.dmg`
   临时文件（一次积了 2.3 GB）。
   只装机不发布时可以 `--bundles app` 跳过 dmg，快一半且绕开这个坑。

### macOS 打包现状（回答「Mac 打包会不会简单点」）

**比 Windows 简单**，代码里 macOS 分支早就写全了，一条 `pnpm package:desktop`
即可，全程约 2 分钟：
- `scripts/package-desktop.mjs` 在 darwin 下自动追加 `--bundles app,dmg`，
  绕过 `tauri.conf.json` 里 Windows-only 的 `"nsis"`
- `client/scripts/prepare-sidecar.mjs` 有完整 macOS 分支：下载官方
  Node 22.23.1 standalone + sha256 校验（**不用 Homebrew 的 node**，避免
  依赖未随包分发的 dylib），按 `aarch64-apple-darwin` 命名 sidecar

**两个限制**：
1. 本机**没有更新签名私钥**（`~/.tauri/` 不存在），打包脚本检测不到私钥会
   **静默关掉 updater 产物**，包能装能跑但**不能用于自动更新分发**。
   要正式发布需从 Windows 机拷 `fufan-ccflow.key` 并
   `export TAURI_SIGNING_PRIVATE_KEY="$(cat ...)"`。
2. **没做 Apple 公证**，别人下载会被 Gatekeeper 拦，需右键打开或
   `xattr -dr com.apple.quarantine`。线上 `latest.json` 目前只挂 Windows 包，
   Mac 版属于另一条分发线，尚未规划。

### 本地安装脚本

`/tmp/install-agentflow.sh`（本轮临时写的，未入库）。设计要点：
**耗时的拷贝在旧应用仍运行时完成（暂存到 `/Applications/.Agent Flow.app.staged`），
真正的「退出 → 换掉 → 重启」压缩到最短窗口**，且失败自动回滚到
`/Applications/.Agent Flow.app.backup`。因为安装会连带杀掉发起它的进程
（Claude 自己就跑在 Agent Flow 的 sidecar 里），必须脱离进程树运行。
日志在 `/tmp/install-agentflow.log`。

## 【2026-08-10】v0.1.46 已发布上线

https://github.com/LYGOLANG/fufan-cc-flow-releases/releases/tag/v0.1.46
线上从 v0.1.27 一步跳到 v0.1.46（中间 18 个版本从未公开发布，一次带上）。

发布后端点实测：`releases/latest/download/latest.json` HTTP 200、version 0.1.46、
签名与本地逐字一致、安装包 HTTP 200 且 Content-Length 97771534 与本地相同。

**发布说明写「对外净差异」而不是内部流水**：看板娘从未公开发布过（加它、
修它、删它都发生在未发布的版本区间），说明里一个字都不该提，否则用户看到
「移除了一个我从没见过的功能」只会困惑。

**踩坑记（第 N 次「验证手段本身没被验证」）**：`Invoke-WebRequest -UseBasicParsing`
对 `application/octet-stream` 返回的 `.Content` 是 **byte[] 不是字符串**，
直接 `ConvertFrom-Json` 会得到一个字段全空的对象 —— 看起来像「线上 latest.json
是空的」这种要命的结论，实际文件完全正确。必须先
`[System.Text.Encoding]::UTF8.GetString($r.Content)` 再解析。

## 【2026-08-09】伴随角色功能已整体移除（用户决定）— v0.1.46 已装机验证

装机实测：app.exe 0.1.46 运行中、sidecar 正常、挂件窗口不存在、
安装目录 live2d/ 已清、启动日志零错误。安装包 109MB → 97.8MB（-11MB）。
exe 内容验证 companion.html / live2d / hiyori 全 False（阳性对照 index- True）。
已提交 `422ebee`（净删 9658 行）。

**注意打包与源码的时序**：首轮 0.1.46 打包启动早于最后几处清理
（`__APP_VERSION__`、playwright/pngjs），产物与源码不一致，已重打一次。
`package:desktop` 内含 `pnpm build`，改完源码要重打才算数。


v0.1.45 修好了建窗，但窗口仍会进入关不掉的黑框态（用户实报，日志显示
CloseRequested→Destroyed 后仍有残留窗口，得从外部 WM_CLOSE 处决）。
用户拍板：**去掉这个功能**。v0.1.46 起代码里不再有它。

删除清单（前端）：`src/companion/`、`utils/{companionBridge,desktopCompanion,
companionCharacters}.ts`、`components/shared/{CompanionAvatar,Live2DStage}.tsx`、
`components/settings/companion-panel.tsx`、`types/pixi-unsafe-eval.d.ts`、
`companion.html`、`live2d-lab.html`、`public/live2d/`（12MB 模型）。
断引用：App.tsx 两个 useEffect、AppLayout 的 `<CompanionAvatar/>`、
SettingsPage 的面板、uiStore 的 companionEnabled/companionModelUrl 及 setter、
index.html 的 Cubism Core `<script>`。
Rust：`commands/companion.rs`、mod.rs 声明、lib.rs 的 import/四条命令注册/
on_window_event 插桩/CC_FLOW_AUTO_COMPANION 钩子。
配置：capabilities 去掉 companion 窗口与**七条窗口权限**（start-dragging/
set-size/set-position/outer-position/inner-size/scale-factor/close/hide/show/
always-on-top —— 已 grep 确认仅挂件在用，taskNotify 只用 isFocused/isMinimized）。
vite.config 恢复单入口并删掉按入口裁剪 modulePreload 的逻辑。
依赖：`pnpm remove @jannchie/pixi-live2d-display pixi.js`。
脚本：live2d-lab.mjs / verify-live2d.mjs / gen-companion-stills.mjs /
debug-companion-invoke.mjs。

验证：typecheck 0、lint 0 error、cargo check 通过、测试 199+92 全过、
生产构建产物 companion/live2d 命中 0（阳性对照 index- 命中 4）。

**localStorage 残键**（`fufan_companion*`）留在用户机器上但已无人读取，无害。

### 【已结案 v0.1.45，代码已删】桌面挂件黑框的两个根因（留作方法论）

即便功能删了，这两条对**将来任何多窗口需求**仍然成立：

1. **`additionalBrowserArgs` 必须全窗口一致**。它在 tauri.conf.json 里是按
   窗口配的，运行时 builder 建的第二个窗口不会自动继承 → wry 用默认参数 →
   违反 WebView2「共享同一 user-data-dir 的 webview 环境参数必须完全一致」→
   `0x8007139F ERROR_INVALID_STATE`，第二个 webview 永远建不出来。
2. **Windows 上同步 command 里建 webview 窗口会死锁**（Tauri 文档明文警告）：
   controller 创建要主线程泵消息，而同步 command 正占着主线程 → 冻 60 秒
   （WebView2 内部超时）→ 看门狗误判主窗口断流强制 reload → 留下永不导航的
   黑壳窗口。必须 `async fn`。

**排障方法论（这轮连毙四个假设）**：
- ~~缓存中毒~~：取证文件来源 URL 是 `127.0.0.1:4173`（vite preview 残留），
  **证物错认——看缓存条目先看它的来源 URL**。
- ~~WebView2 .72 regression~~：钉回 .59 照样黑。**时间相关性 ≠ 因果**。
- ~~profile 降级损坏~~ / ~~启动早期时序~~：fresh profile、运行期点击照样死。
- 定位靠：Rust 侧建窗后 +3s/+10s 自检（存在性/可见性/**URL**）、全局
  on_window_event、300ms 轮询的 Win32 窗口生命周期监视器、PrintWindow 抢首帧。
  `FailedToReceiveMessage` + get_webview_window 返回 Some + 零窗口事件
  = **原生窗口已死而 Tauri 不知情**。
- **grep 日志别只搜业务关键词**：wry 的 `failed to create webview` 不含
  "companion"，按业务词搜整整漏了三轮。
- 调试钩子里 `block_on` 建窗 = 窗口建在临时线程上，线程一退即被 Windows
  连带销毁（生而即死 1.1s）。要模拟真实 invoke 路径得用 `async_runtime::spawn`。

两个叠加的根因（都修了才通）：

1. **`additionalBrowserArgs` 只配在主窗口上**（tauri.conf.json 是按窗口配置的），
   挂件用 builder 运行时建窗时没带 → wry 用默认参数（少了
   `--disable-renderer-accessibility`）→ 违反 WebView2 铁律「共享同一
   user-data-dir 的所有 webview 环境参数必须完全一致」→ 第二个 webview 的
   controller 创建报 `0x8007139F ERROR_INVALID_STATE`。
   修：`open_companion` 现读 `app.config().app.windows[0].additional_browser_args`
   传给 builder，改配置永不漂移。
2. **`open_companion` 是同步 command** —— Tauri 文档明确警告 Windows 上同步
   command 里建 webview 窗口会死锁（controller 创建需要主线程泵消息，主线程
   却被 command 占着）。表现为点击后主线程冻 61 秒（WebView2 内部 60s 超时）、
   watchdog 误判主窗口断流强制 reload、留下一个永不导航的黑壳窗口。
   修：`open_companion` 改 `async fn`（Tauri 调度到 tokio 池，建窗代理回空闲主循环）。

**排障教训（这轮连毙四个错误假设，各自的死因）**：
- ~~缓存中毒~~：取证文件的来源 URL 是 `127.0.0.1:4173`（vite preview 残留），
  证物错认。**看缓存条目先看它的来源 URL 再下结论。**
- ~~WebView2 .72 升级 regression~~：钉回 .59 照样黑。时间相关性 ≠ 因果。
- ~~profile 降级损坏~~：fresh profile 照样死。
- ~~启动早期时序~~：INVALID_STATE 其实任何时刻都发生，只是同步/异步路径
  表现不同（60s 挂死 vs ~300ms 静默拆窗）。
- 定位靠的是：Rust 侧插桩（建窗后 +3s/+10s 自检窗口存在性/可见性/**URL**、
  全局 on_window_event 记录）+ 300ms 轮询的 Win32 窗口生命周期监视器 +
  PrintWindow 抢首帧截图。`FailedToReceiveMessage` + get_webview_window 返回
  Some + 零窗口事件 = 原生窗口已死而 Tauri 不知情。
- **grep 日志别只搜业务关键词**：wry 的 `failed to create webview` 不含
  "companion"，按业务词搜整整漏了三轮。
- 调试钩子里 `block_on` 建窗 = 窗口建在临时线程上，线程一退窗口即被 Windows
  连带销毁（生而即死 1.1s）——钩子要用 `async_runtime::spawn` 模拟真实 invoke 路径。
- 排障插桩保留在代码里（全部环境变量门控）：`CC_FLOW_AUTO_COMPANION=1` 自动建窗
  + `CC_FLOW_AUTO_COMPANION_DELAY_MS` 延迟 + `CC_FLOW_COMPANION_MINIMAL/NOBG`
  参数裁剪 + companion 窗口事件日志。生产不设变量则行为不变。

**未提交**：companion.rs / lib.rs 携带整个挂件特性的历史未提交改动（v0.1.31 起
连续 14 个版本没 commit），今天的修复混在其中。等用户拍板做一次完整的特性提交。

### 2026-08-08 v0.1.44 已打包并安装（11:27 装机成功，app.exe 已确认 0.1.44 运行中）

`release/Agent Flow_0.1.44_x64-setup.exe`（109,075,477 字节）+ 424 字节 `.sig`。
核验过：代理修复文案在 SettingsPage chunk（阳性对照命中）；staged server-dist
内容含 8/5 三提交标记（turnSeq、附件守卫）——**mtime 显示 8/2 是拷贝保留的旧
时间戳，别再被它吓一次，认内容不认 mtime**（prepare:sidecar 在 beforeBuildCommand
里刷新）；隐私审计三处命中全是假阳性（credential 同名库代码 / UI 占位符
`C:\Users\you\...` / placeholder 前缀 `sk-ant-api03`），无真实泄露。
npm audit 未跑（只打包不发布，发布环节再跑）。版本号 bump（tauri.conf.json /
Cargo.toml → 0.1.44）未单独提交——这两个文件还压着挂件那轮的未提交改动，
沿用 0.1.31 以来「打包不 commit」的现状。

### 2026-08-08 代理持久化一轮（已完结）

用户报「每次打开都要重新输入网络代理」。查实：bug 本体 8/2 已修（`7a54c10`，
面板不自加载），且已随 v0.1.43 装机——安装产物 `server-dist` 内容验证过，
`proxy.json` 完好存着 `127.0.0.1:7897`。本轮补掉该修复漏的半个洞并已提交
（`6c512c9`）：loadProxy 失败被吞、面板把「加载尝试过」当「加载成功」解锁
保存，冷启动窗口内一点保存就清空真配置。现门闸以 store 新增的 `proxyLoaded`
为准（仅成功置真 + 冷启动重试 4 次）。**未装机**——改动只在源码里，要等下次
打包才生效；下次打包顺带带上。进化信号队列同轮清空，落了两条规则
（code-review 持久化闭环 / evolution-engine 先验时效）。

### 已确认修好（有证据）

- **看门狗误判**：日志里 `watchdog ... silent` 事件**清零**（此前每 22 秒一条、
  累计 `consecutive #24`，一直在强制 reload 主窗口、打断用户会话）。
  根因：Chromium 节流不可见窗口的 `setInterval`，而用户主窗口在第二显示器上。
  改动见 `watchdog.rs`：判定阈值 15s→60s，且**窗口不可见时根本不判死**。
- **`Number(null)` 陷阱（两处）**：`Number(localStorage.getItem(k))` 在没设过时
  返回 **0**，而 0 恰好是合法档位索引 → 「从没设置过」被当成「选了最小档」。
  `DesktopCompanion.readSizeIdx` 与 `desktopCompanion.currentSize` 都已改为先判 null。
- **窗口内角色脚被裁**：日和 zoom 1.25 时渲染高 275px 塞进 220px 画布，
  底部 38px（正好是鞋）被切。改回 zoom 1.0，并给探针加了**内容触底检测**。
- **画布强制正方形导致「一小条人 + 大片空白」**：实测日和只占画布宽度 21%。
  现按各角色实测比例收窄（aspect 0.44/0.8/0.54），人物占宽提到 47%/75%/63%。
- **窗口内角色不能缩放**：工具条补了 `＋ －`，四档 180/220/300/400。

### v0.1.38：「文字和图片隔太开 / 一思考图片就不见」的真正根源

**Live2D 插件与 PixiJS `resolution > 1` 不兼容。** dpr=1.5（用户的屏幕）时
人物被整体缩小约 1.5 倍（实测占画布高 89% → 62%），缩出来的空白全在人物
上方 —— 气泡孤零零挂在顶端，人缩在底部，深色背景里根本注意不到。
修法：`Live2DStage` 锁 `resolution: 1`（代价是高 DPI 下轻微发虚）。

**为什么我之前的验证全绿而用户全错：verify 脚本跑在 dpr=1。**
`deviceScaleFactor` 必须按用户真实 dpr（1.5）再验一遍才算数 ——
这与「验证环境必须注入生产 CSP」是同一条教训的两个面：
**验证环境与生产差一个维度，那个维度上的 bug 就结构性地看不见。**

配套改动：
- 气泡 absolute 悬浮贴头顶（原来是流内元素，出现时会把角色往下推）
- `×` 不再彻底消失，原位留一个半透明 ✨ 小圆点，点击恢复
  （「操作后进入看不出怎么回来的状态」已坑过两次：空串 modelUrl、点 ×）
- Suspense fallback 用静态立绘（加载那几秒不再空白）
- `Number(null)` 陷阱**第三处**：CompanionAvatar.readSizeIdx（前两处修的时候
  漏了它，默认档位一直被压成最小档 180）
- leveldb 取证不可靠：.ldb 块是 snappy 压缩的，grep 出的明文可能是历史值，
  **不能当作当前 localStorage 的证据**

### 【已结案 v0.1.40】桌面挂件一片空白 —— 真凶：透明窗口令渲染进程崩溃

**铁证**：用户截图（2026-08-07）里挂件窗口位置出现**白底 ☹ 的 sad-tab
崩溃页** —— WebView2 渲染进程在透明窗口上直接崩溃。主窗口同一套
additionalBrowserArgs 从不崩，唯一差异就是 `transparent(true)`。

为什么盲查了四个版本（v0.1.36~39）：**透明窗口 + 崩溃页在多数时刻呈现为
「完全空白」**，与「页面没加载」「CSS 全透明」「WebGL 画不出」在屏幕上
完全无法区分。历轮先后错怪了 index.css、WebGL 合成、premultipliedAlpha、
HTTP 缓存 —— 每个假设都修了点真问题（所以没白干），但都不是这个的根因。
Crashpad reports 目录为空、事件日志无 1000，renderer 是被静默杀的，
唯一可见证据就是那个 sad-tab。

修法（v0.1.40）：挂件窗口改**不透明** + `background_color(19,17,28)`，
页面本来就是深色卡片设计，视觉几乎无差。`transparent(true)` 别改回去。

顺带修好：挂件 URL 带 `?v=版本` 破 WebView2 升级缓存；设置面板选角色/
调档位经 storage 事件跨窗口同步（此前挂件只在启动时读一次 localStorage，
「设置里选角色挂件没反应」是实报 bug）；四层可见指纹保留（HTML 占位块 /
卡片底 / 静态图 / 版本角标），以后一张截图定位断层。

### 【历史】排查轨迹（保留作方法论参考）

排查轨迹（**每一步都推翻了上一步的假设，别再重走**）：
1. ~~黑块 = 透明失败~~ → 去掉 index.css（`html{background:#13111C}` + 全屏噪点层）
   后**透明确实生效了**，能透出桌面图标。
2. ~~透明好了但 WebGL 在分层窗口画不出来~~ → 加了静态立绘兜底 + `readPixels`
   首帧自检。装上后截图：**连静态图都不显示**。静态图是纯 `<img>`，不碰 WebGL——
   **所以根本不是 WebGL 问题，是页面没渲染出任何东西。**
3. 当前手段：`companion.html` 的 `#root` 里放了一个**纯 HTML 占位块**（橙框深底，
   写「伴随角色 加载中…」）。React 挂载会清掉它。三种情况从此可区分：
   - 看到橙框 → HTML 加载了，JS/React 没跑起来
   - 看到角色 → 正常
   - 仍全空 → 连 HTML 都没加载（URL 解析 / 资源没进包）

**下一步**：让用户开一次「设置 → 应用 → 伴随角色 → 放到桌面上」，
然后用下面的方法截图判定。**不要再靠推理猜，这一路上推理错了三次。**

```powershell
# 找挂件窗口坐标（EnumWindows 过滤 app.exe 的进程，标题含「伴随角色」）
# 再用 System.Drawing 的 CopyFromScreen 只截那一小块，不要截全屏（涉及隐私）
```

已验证入包：`dist/companion.html` 含占位块文本、阴性对照为 0、签名通过。

**v0.1.34 桌面挂件（独立置顶透明窗口）** —— 打包中。

角色可以脱离主窗口，作为一个独立的置顶小窗浮在桌面上；支持拖动、四档缩放、
换角色；任务结束时用气泡报**这一轮改了哪些文件、跑了几条命令、花了多少钱**，
需要确认权限时也会喊人。

新增/改动：
- `src-tauri/src/commands/companion.rs` — 窗口生命周期 + 跨窗口推送
- `src-tauri/capabilities/default.json` — **windows 加 "companion"**，
  并显式授 start-dragging / set-size / set-position 等（`core:default` 不含它们）
- `client/companion.html` + `client/src/companion/` — 挂件的**独立入口**
  （不复用 index.html：常驻窗口不该把整个 Agent Flow 加载进去）
- `client/src/utils/companionBridge.ts` — 主窗口 → 挂件的状态桥 + 摘要生成
- `client/src/utils/desktopCompanion.ts` — 开关（真相源是 Rust 侧窗口在不在）
- `vite.config.ts` — 双入口 + **按入口裁剪 modulePreload**

三条刻意的取舍：
1. **不做点击穿透**。需要全局鼠标钩子 + 按角色轮廓动态切换，多显示器/DPI
   缩放下不稳。窗口本身贴着角色大小，拖到角落即可。
2. **跨窗口通信必须经 Rust**。前端 `emit` 只在自己这个 WebView 内广播，
   主窗口直接 emit 挂件收不到 —— 走 `companion_push` 命令由 AppHandle 定向发。
3. **推送是节流的**。只在情绪变化或一轮结束时发；流式期间每个 token 都会让
   store 变一次，照单全发等于让挂件每秒重渲染几十次而显示内容没变。
4. **挂件开关不在前端存 boolean**，每次问 Rust 窗口在不在 —— 用户可以直接点
   挂件上的 × 关掉，前端那份状态立刻就开始说谎。

已验证（**注入生产 CSP 的真实浏览器**，两个入口各三个角色全绿）：
挂件页人物占比 16%/21%/12%、哨兵角 4/4、白角 0/4；主应用页同样占比、白角 0/4。
cargo check 通过、typecheck 0、lint 0 error、测试 199+92 全过。

**尚未验证（只有装了才知道）**：透明窗口在 Windows 上的实际观感、置顶行为、
系统拖拽、跨窗口事件是否真的送达。浏览器验证覆盖不到多窗口。

**v0.1.32 看板娘真正渲染出来了** —— 打包中。三个角色实测截图存于
`release/live2d-verify/*-canvas.png`，全身居中、背景透明。

### 元凶：import 了要求 Cubism 2 运行时的包主入口

`@jannchie/pixi-live2d-display` 有三个入口。主入口 `index.es.js` 的**模块顶层**
写着：

```js
if (!window.Live2D) throw new Error("Could not find Cubism 2 runtime...")
```

我们只随包带了 Cubism **4** 的 Core（三个模型也都是 Cubism 4），于是这个
`import()` 在求值那一刻就抛，模型一个字节都没开始加载。**必须用
`@jannchie/pixi-live2d-display/cubism4` 子路径入口**（它只检查
`window.Live2DCubismCore`）。`moduleResolution: "bundler"` 支持子路径。

症状极具误导性：看板娘静默退回简笔脸，看起来像「模型没打进安装包」，
而包里什么都不缺——v0.1.30 和 v0.1.31 两版都栽在这上面。

### 第二个：白底方块 = premultipliedAlpha

Cubism 渲染器内部用 `gl.clearColor(1, 1, 1, 0)` 清屏。在预乘画布里这是个
**非法组合**（RGB 分量大于 alpha），浏览器合成时吐出纯白。
`Application.init()` 必须带 `premultipliedAlpha: false`。

`backgroundAlpha: 0` 本身一直是生效的——对照实验里空 Application 确实透明，
白底只在加载模型之后出现。**没有那个对照组，几乎必然会去错怪 PixiJS。**

### 第三个：取景参数方向性错误

第一版凭直觉给 zoom 2.4~2.6（想着「全身太小要放大」），实际竖版模型的人物
本来就几乎占满自己的画布，正确值在 **1.25** 附近。而米粒的画布是**横版**
4500x3000 且人物偏右，必须用 `focusX: 0.72` 把取景推过去——写死居中会把她
大半个人推出画框。三组参数全部靠实验台肉眼比对确定，不是估的。

### 第四、五个：CSP 挡住了 PixiJS 的两条路（v0.1.33 修）

v0.1.32 装进应用后报
`Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval`。
**浏览器验证全绿却漏掉了它** —— 因为 vite dev/preview **不会应用
tauri.conf.json 里的 CSP**，只有 Tauri WebView 才注入。验证环境比生产宽松，
这类问题就永远看不见。

两条都被 `script-src 'self'` 挡住：
1. PixiJS 默认用 `new Function()` 生成 shader/uniform 同步代码 →
   副作用导入 `pixi.js/unsafe-eval`（模块顶层自调 selfInstall），
   **必须在 `new Application()` 之前**。它的 exports 没带 types，
   需要 `client/src/types/pixi-unsafe-eval.d.ts` 里的 `declare module`。
2. PixiJS 默认从 `blob:` URL 起 worker 解码贴图，而 worker-src 未单独设置时
   回退到 script-src（不含 blob:）→ `Assets.setPreferences({ preferWorkers: false })`。
   选择关 worker 而非给 CSP 开 blob: 口子：只有三个模型的贴图要解，主线程够用。

**verify-live2d.mjs 现在按 tauri.conf.json 现读并注入同一份 CSP**，
第二条正是靠它在装机之前就抓到的。

### 新增的验证基础设施（这次的最大收获）

- `client/live2d-lab.html` — 取景实验台，**不进生产构建**（vite build 只打
  index.html，已验证 dist 里没有它）。改一行刷新即可，不必重打安装包。
- `scripts/live2d-lab.mjs` — 逐个 case 截图对比。**一个 case 一次页面加载**：
  每个 PixiJS Application 占一个 WebGL context，一页里摆七个会被浏览器静默
  回收掉最老的几个，表现为前几格全空白、和「渲染失败」一模一样。
- `scripts/verify-live2d.mjs` — 生产构建的端到端验证，三个角色逐个渲染 +
  像素判定 + 截图存证。

用 `chromium.launch({ channel: "msedge" })` 借系统 Edge，不下载 chromium。

**CSP 自检那段别删。** 注入 CSP 之后，「修好了」和「CSP 压根没注进去」
在结果上完全一样（都通过），必须有独立证据证明 CSP 真的在起作用。
坑在于：**不能用 `page.evaluate` 试 `new Function`** —— Playwright 走
CDP Runtime.evaluate，天然绕过页面 CSP，不管注没注进去都报「可用」。
现在的做法是 route 伪造一个同源脚本 `/__csp_selftest.js`（preview 里并不
存在这个文件），由**页面自己**加载执行它、把结论写到 window，再读出来。
另外 CSP 要走 `<meta>` 注入进 HTML，改 HTTP 响应头实测不生效。

**v0.1.31 伴随角色（Live2D）三选一 + 拖拽 + 变装** —— 打包完成、签名有效，
**未安装 / 未提交 / 未发布**（用户明确要求不要自动重启他的应用，等他说）。

产物：`release/updates/AgentFlow_0.1.31_x64-setup.exe`（107,577,569 字节）
验签：`node scripts/release-update.mjs` 内已跑过，alg=ED keyid=19d9f96e097fbd06，
签名记录的文件名与产物一致。
发布命令（等用户拍板）：
```
gh release create v0.1.31 --repo LYGOLANG/fufan-cc-flow-releases --title "v0.1.31" \
  --notes-file <说明文件> "release/updates/AgentFlow_0.1.31_x64-setup.exe" \
  "release/updates/latest.json"
```

用户反馈链：「图片太丑」→「没有声音」→「要三个美少女而不是一个表情」
→「全装 + 可拖拽 + 变装」。

关键发现（v0.1.30 装了但用户看到的仍是 SVG 简笔脸）：
**`fufan_companionModel` 被误写成空串，且 `?? 默认值` 挡不住空串。**
设置面板的输入框 onChange 直写 localStorage，用户点进去再点走就存了空串，
之后无论怎么重装都退回简笔脸（localStorage 不随安装包更新）。
修法：换键 `fufan_companionModel2` + 一次性迁移（丢弃已下架的 haru 路径），
并把自定义地址收进折叠区、只有按「应用」才落盘。

本版改动：
- `client/src/utils/companionCharacters.ts`（新）— 三个角色 + **取景参数**。
  取景不是调味品：这些是全身模型，等比塞进 220px 方框脸不到 30px，
  必须放大到超出画布再靠 focusY 把取景推到头肩。
- `client/public/live2d/{hiyori,mao,rice}/` — 换掉 haru，取自
  Live2D/CubismWebSamples 官方示例（12.1MB）。三个都有 Idle+TapBody，
  真央另有 8 个表情。
- `Live2DStage.tsx` — 加 mood 驱动（表情按**序号**取，不写死模型的表情名）、
  点击播 TapBody；**修了一个缩放 bug**：`model.width` 在 `scale.set()` 后
  返回的是已缩放宽度，原代码又乘一次 scale，等于平方级缩小。
- `CompanionAvatar.tsx` — 拖拽（专用把手，不跟 Live2D 的点击互动抢手势）、
  变装（循环切换）、隐藏；坐标存 `fufan_companionPos`，**每次渲染都 clamp**
  （换显示器/改分辨率后旧坐标可能整个落在屏幕外，那时角色点不着）。

验证已过：typecheck 0 error、lint 0 error、测试 199+92 全过、
懒加载边界正确（入口 chunk 260K 不含 pixi；844K 的 pixi chunk 只被
Live2DStage 引用）、三个模型与 Cubism Core 都进了 dist。

**下一步**：打包完 → 核对产物内含三个模型 → 等用户说「重启」再装
（用户明确要求不要自动重启他的软件）。

历史遗留待办：
- 线上 Release 最新仍是 v0.1.27，v0.1.28～v0.1.31 未发布
- 远程功能三项验收未实测（卡在靶机没装 Claude Code CLI，只有用户能做）
- stock-research Skill 未实跑（用户的资料目录 `桌面\条件单` 不存在）

---

**下面是历史记录。**

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

## 2026-08-01 三视角独立审查的结论

派了三个独立视角（代码审查 / 界面说谎狩猎 / 技术债盘点）并行查，
**最有价值的发现是：当天的每一处修复都只做了一半**，而漏掉的那半
分别抵消或加剧了修复本身。已全部补完，教训记在这里：

1. **改一个判定前，先 grep 它的所有消费者。**
   `loadClaudeInfo` 修好了，紧挨着的 `loadAuthStatus` 没改，而后者在
   `useClaudeStatus.ts:16` 里优先级更高 —— 修复被完全抵消，症状只是
   从"未安装"变成"未登录"。
2. **同一份语义在两处判定时，必须同时改。**
   `error` 移出终态集合只改了项目标签那侧，聊天面板那侧没动，
   结果两个指示器互相矛盾。**修一半比不修更混乱。**
3. **测试不能复刻生产逻辑。**
   `busyTracking.test.ts` 在测试文件里抄了一份白名单，于是漏掉
   `UNKNOWN_PROVIDER` 时测试 100% 通过 —— 测的是抄件。判定表已抽到
   `client/src/services/taskErrorCodes.ts`，两侧与测试共用同一份。
4. **写了工具 + 加了测试 ≠ 落地。**
   `hostPath.ts` 七个导出只有 `isAbsolute` 被调用过一次，其余全是死代码，
   而 DEV-PLAN 的验收已经打了 ✅。10 个用例只证明工具自身正确，
   证明不了任何调用点用上了它。**验收要看调用点，不看工具。**
5. **给 store 函数加可选参数后，grep `onClick={fn}`。**
   React 会把事件对象塞给第一个参数。两轮各中两处；第二轮是 tsc 报错拦下的。

**审查报告上的问题已于 2026-08-01 全部清完**（v0.1.27）：
费用上限标注适用范围、远程孤儿改带鉴权探测、hostPath 接上三处调用点、
两条孤儿写接口移除、文档漂移修正。

**当前唯一的硬缺口 —— 只有用户能做的那一步**：
靶机需安装 Claude Code CLI 并**以运行后端的那个用户登录**。做完才能验证
Phase 15 剩下的三项（远程下的对话 / 文件树 / 终端）。在此之前，
远程功能的这三条只是「代码看着对」，没有任何实测支撑。

```bash
# 在靶机上
npm i -g @anthropic-ai/claude-code
claude   # 交互式登录
```

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

## 验证手段本身必须先被验证（2026-08-05 第三次栽在这上面）

同一个错误已经换三种形态出现过，模式是：**用一个没被检验过的手段去检验结论，
得到全绿或全红，然后相信它。**

1. 测试文件里抄了一份生产判定表 → 漏一个码也 100% 通过（测的是抄件）
2. `ls assets/index-*.js` 匹配到 6 个文件被当成一个文件名传给 grep
   → 全部报错走 `|| echo 0` → 「主 chunk 零命中」的结论是假的
3. Git Bash `grep -ac` 搜 27MB 的 app.exe → 全部返回 0，
   看着像「模型没进包」，实为 grep 对大二进制失效
4. **看板娘这一轮，同一个错误连犯四次**（2026-08-05）：
   ① Playwright 的 `evaluate(字符串)` 按**表达式**求值，`() => {...}` 的求值
      结果是函数对象本身而非返回值 → 探针恒返回 undefined；
   ② 在页面里 `ctx.drawImage(webglCanvas)` 读像素：PixiJS 默认
      `preserveDrawingBuffer=false`，缓冲区合成后即丢弃 → **人物明明渲染
      出来了，探针却报「非透明占比 0」**，差点据此判定渲染失败；
   ③ 元素截图的 `omitBackground` 不可靠，底下页面背景被合成进来 →
      「不透明占比」恒为 1，**白底和透明底给出完全相同的读数**，于是
      探针报「全部通过」而背景其实是白的。改判颜色（白角计数）才有意义；
   ④ 实验台里忘了写缩放，模型按原始 2976x4175 塞进 220x220 画布，只显示
      左上角一块透明区 → 又一次「看起来像渲染失败」。
   **共同点：失败和成功在读数上无法区分。** 每次识破都是靠对照
   （空 Application 对照组、已知好的那一格、肉眼看截图）。
5. `verify-signature.mjs` 裸跑报「✅ 验签通过」，但它读的是
   `release/updates/latest.json` —— 那份可能是**几个版本之前**的。
   刚打完 0.1.31 跑它，验的是 0.1.27，输出里那行小字
   「版本: 0.1.27」是唯一破绽。**先跑 `release-update.mjs` 刷新 updates
   目录再验**，或者盯着输出里的版本号和包大小对一遍。

**规矩：任何"扫一遍确认没有 X"的验证，必须同时跑一个已知存在的阳性对照。**
第 3 条正是靠阳性对照（`index-` 必然在包内）当场识破的；没有它就会去
返工一个根本不存在的问题。改用 PowerShell 读字节：

```powershell
$s=[System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($exe))
$s.Contains('index-')   # 阳性对照，必须 True
$s.Contains('hiyori')   # 待验目标
```

阴性对照同样有用：这次 `haru`（已删）与 `NOTICE`（build 之后才写的）
双双缺席，反过来证明了搜索确实在按内容判断。

## 死路（别重走）

- **打包不带 `TAURI_SIGNING_PRIVATE_KEY` 会静默产出「不可用于更新」的包**：
  `package-desktop.mjs:66` 检测到没私钥就写临时覆盖配置关掉 updater 产物，
  **日志里没有任何警告**，exit code 照样 0，安装包也照样能装。
  唯一症状是 `bundle/nsis/` 下缺了那个 424 字节的 `.sig`。
  发现它靠的是跟前几版横向对比（0.1.29/0.1.30 都有 sig，0.1.31 没有）。
  打包前一律先设：
  ```bash
  export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/fufan-ccflow.key)"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  ```
  （本项目这版 Tauri CLI 只认私钥**内容**，不认 `_PATH` 变体。）
- **Tauri 嵌入前端资源时只有路径名是明文，内容被压缩**：所以在 app.exe 里
  搜得到 `hiyori`、`NOTICE.md` 这类文件名，搜不到 `Free Material` 这类文件
  **内容**。验证「某段文案是否进了产物」要去 `client/dist/assets/*.js` 搜，
  那里是未压缩的；在 exe 里搜内容得到的「没找到」毫无意义。

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
