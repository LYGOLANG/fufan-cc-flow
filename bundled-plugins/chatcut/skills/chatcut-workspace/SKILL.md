---
name: chatcut-workspace
description: 当用户要打开 ChatCut 课程视频工作台、把几个视频组合起来、导入录屏或 HyperFrames 产物开始剪一集课程视频时使用。检测依赖、启动本地工作台并返回浏览器地址，然后把素材导入当前项目。
---

[任务]
    启动 ChatCut 工作台并把素材导入当前项目，让用户可以在浏览器里开始剪辑。

[启动检查]
    1. 调用 `dependency_check`，读它返回的 coreOk、blockedFeatures 与 **fetchActions**。
    2. coreOk 为 false 时立即停下，把缺失项与安装指引原样告诉用户，不要继续往下走。
        中途才失败比一开始就说清楚糟糕得多。
    3. blockedFeatures 非空时照常打开工作台，但要说明哪些能力暂不可用：
        - feature:annotation 缺失 → 标注层渲染不可用
        - feature:asr 缺失 → 录屏原声识别不可用，TTS 旁白的字幕不受影响
        - feature:tts 缺失 → 配音不可用，需要先配 MiniMax 凭据。
          **别停在"需要先配"**：`MINIMAX_API_KEY` 与 `MINIMAX_GROUP_ID` 两个值，
          可设为环境变量，或写进 `%APPDATA%\chatcut\credentials.json`
          （macOS / Linux 是 `~/.config/chatcut/credentials.json`），内容是
          `{"apiKey":"...","groupId":"..."}`；两者必须属于同一账户，否则接口返回 1004。
          完整说明见 chatcut-narration 技能的「MiniMax 凭据怎么配」。
    4. 只要 fetchActions 非空，就**主动把补齐这条路摆出来**，见下节。
        只说"不可用"而不说"怎么补"，等于把用户扔在死胡同里。

[缺依赖时怎么补：dependency_fetch]
    `dependency_check` 的 fetchActions 里每一条都带一个可以**原样照抄**的调用串，
    例如 `dependency_fetch({"id":"hyperframes","confirm":true})`。这是把重依赖补上的唯一入口。

    两步走，第一步绝不能跳（UX-006）：
    1. **先不带 confirm 调一次**：`dependency_fetch({"id":"<id>"})`。
        它不下载、不落盘，只返回一张单子——补什么、多大、从哪来、装到哪、不补的后果。
        把这张单子**念给用户**：几百 MB 的下载不能替他决定。
    2. 用户明确同意后再带 `confirm: true` 调一次。它立即返回 jobId，
        用 `job_status` 报进度，**不要在那里干等**：hyperframes 约 369 MB、whisper base 约 141 MiB，分钟级。
    3. 任务 succeeded 之后**再调一次 `dependency_check` 复核**，确认对应的 blockedFeatures 已经消掉。
        任务自报成功不算数，以复核结果为准。

    几条边界，说错了会让用户白等：
    - 一切都装进 `${CLAUDE_PLUGIN_DATA}`，**不写插件安装目录**（那里只读且随更新失效）。
    - 版本或 SHA-256 对不上会直接失败，不会返回一个没校验过的东西。
    - **ffmpeg 的 whisper / libass 滤镜补不了**：那是本机 ffmpeg 的编译选项，
        只能让用户换一个带这些滤镜的 ffmpeg 构建。别拿 dependency_fetch 去试。
    - 取消这个任务不会立刻打断已经在跑的 npm install / 下载，只会让它跑完后不再进入下一阶段。
        如实告诉用户，别说成"已经停了"。

[执行]
    1. 调用 `workspace_open`，参数只有可选的 projectDir，默认当前工作目录。
    2. 把返回的 url 完整交给用户，让他自己在浏览器打开。
        该 URL 带 session token，缺了它所有接口都返回 401。
    3. 用户提供素材路径后调用 `clip_import`，它会用 ffprobe 探测规格并生成预览代理。
        原始文件只被读取，不复制、不修改。
    4. 导入完成后告诉用户：导入了几段、总时长多少、有没有片段被标为缺失或格式不支持。

[界面提交的待办：先认领再执行]
    用户在工作台点「生成配音 / 生成标注层 / 生成字幕 / 导出成片」时，请求会进 `.chatcut/requests/queue.json`，
    **不会**自动变成一次 Tool 调用。你要主动去取，否则用户点了按钮，界面会一直等在「进行中」。

    固定四步，一步都不能省：
    1. `request_claim` 认领。返回 requestId、operation、selection、assetRefs 与用户意图。
        没有待办时它会明说队列是空的，那就照常处理用户当前的对话请求。
        认领是带租约的独占，默认 600 秒；导出这类分钟级任务就用默认值，别调短。
    2. 按 operation 决定调哪个 Tool，selection 就是入参来源：
        - `narration.synthesize` → `narration_synthesize`（segIds 取 selection.segIds）
        - `annotation.render`    → `annotation_render`（annIds 取 selection.annIds）
        - `captions.generate`    → `captions_generate`
        - `export.render`        → `export_render`
        - `clip.arrange` / `annotation.define` 等 → 对应领域 Tool
    3. **把认领来的 requestId 原样传给那个 Tool**。这一步决定了闭环成不成立：
        带了它，写回时队列条目自动结单、界面上那次点击才有回音；
        不带，请求会一直挂在 claimed 直到租约到期，中间显示的进度全是假的。
    4. 长任务用 `job_status` 跟进度，完成后告诉用户产出了什么。
        确定做不成时调 `request_resolve` 如实结掉（outcome=failed），
        暂时不处理就 outcome=released 退回队列。**不许让它自己烂在那儿。**

    每次准备开始一段较长的工作前，先 `request_claim` 看一眼——界面上的点击不会主动来找你。

[对话中可直接驱动]
    用户不打开界面也能干活。常见指令与对应工具：
    - 「导入这几段录屏」→ `clip_import`
    - 「把第 3 段挪到第 1 段前面」→ `clip_arrange`
    - 「现在什么状态」→ `project_read` 后用自然语言复述
    - 「渲染进度怎么样」→ `job_status`
    - 「停下 / 别跑了」→ `job_cancel`，取消后如实说明中间产物保留、可从中断处续跑

[界面与状态的关系]
    工作台显示的一切都来自 `.chatcut/project.json`，没有第二份真相源。
    - 你用领域 Tool 写回后，界面会自己刷新，**不需要**让用户手动刷新页面。
    - 用户在界面上的编辑（排序、裁剪、框选、改旁白、校对字幕）也直接落进同一个文件。
        所以任何写操作前先 `project_read` 取当前 projectVersion，拿它当 expectedVersion。
    - 收到 VERSION_CONFLICT 说明用户刚在界面上改过：重读状态、基于新版本重算，别覆盖。

[完成标准]
    - 用户拿到了可打开的工作台地址，或者拿到了明确的依赖缺失说明。
    - 素材已登记进工程状态，用户知道导入了什么。
    - 存在缺失或不支持的文件时，逐个说清楚是哪个、为什么。
    - 界面提交过的待办都已认领并结掉，没有条目停在 claimed。

[禁止]
    - 替用户执行插件安装或注册命令。
    - 在 core 依赖缺失时硬着头皮往下走。
    - 把 workspace_open 返回的 token 当作可省略的参数。
    - 复制或改写用户的原始素材文件。
    - 不认领就直接执行界面提交的操作，或执行时丢掉 requestId。
    - 队列里还有 pending 待办却告诉用户"没有进行中的任务"。
